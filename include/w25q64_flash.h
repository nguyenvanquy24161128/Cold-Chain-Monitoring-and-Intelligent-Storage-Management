#ifndef W25Q64_FLASH_H
#define W25Q64_FLASH_H

#include <Arduino.h>
#include <SPI.h>
#include "icte_protocol.h"

// Định nghĩa chân SPI cho ESP32 (VSPI)
#define FLASH_CS_PIN    5
#define FLASH_SCK_PIN   18
#define FLASH_MISO_PIN  19
#define FLASH_MOSI_PIN  23

// Lệnh SPI chuẩn công nghiệp của IC W25Q64
#define CMD_WRITE_ENABLE    0x06
#define CMD_SECTOR_ERASE    0x20
#define CMD_PAGE_PROGRAM    0x02
#define CMD_READ_DATA       0x03
#define CMD_READ_STATUS_1   0x05

// Thông số vùng Ring Buffer
#define SECTOR_SIZE             4096    // 4 KB
#define PACKET_SIZE             16      // 16 Bytes
#define PACKETS_PER_SECTOR      (SECTOR_SIZE / PACKET_SIZE) // 256 gói/sector
#define TOTAL_BUFFER_SECTORS    16      // Dành 16 Sectors (64KB = 4,096 gói tin đệm)

class FlashRingBuffer {
private:
    uint32_t head_index; // Vị trí ghi tiếp theo (0 -> TOTAL_BUFFER_SECTORS * 256 - 1)
    uint32_t tail_index; // Vị trí đọc tiếp theo
    uint32_t count;      // Số gói tin hiện có trong bộ nhớ Flash

    void select_chip() { digitalWrite(FLASH_CS_PIN, LOW); }
    void deselect_chip() { digitalWrite(FLASH_CS_PIN, HIGH); }

    void wait_busy() {
        select_chip();
        SPI.transfer(CMD_READ_STATUS_1);
        while (SPI.transfer(0x00) & 0x01); // Chờ bit BUSY về 0
        deselect_chip();
    }

    void write_enable() {
        select_chip();
        SPI.transfer(CMD_WRITE_ENABLE);
        deselect_chip();
    }

public:
    FlashRingBuffer() : head_index(0), tail_index(0), count(0) {}

    void begin() {
        pinMode(FLASH_CS_PIN, OUTPUT);
        deselect_chip();
        SPI.begin(FLASH_SCK_PIN, FLASH_MISO_PIN, FLASH_MOSI_PIN, FLASH_CS_PIN);
        erase_sector(0); // Xóa Sector đầu tiên làm sạch ban đầu
    }

    void erase_sector(uint32_t sector_num) {
        uint32_t addr = sector_num * SECTOR_SIZE;
        write_enable();
        select_chip();
        SPI.transfer(CMD_SECTOR_ERASE);
        SPI.transfer((addr >> 16) & 0xFF);
        SPI.transfer((addr >> 8) & 0xFF);
        SPI.transfer(addr & 0xFF);
        deselect_chip();
        wait_busy();
    }

    bool push(const icte_packet_t *pkt) {
        uint32_t current_sector = (head_index / PACKETS_PER_SECTOR) % TOTAL_BUFFER_SECTORS;
        uint32_t sector_offset = (head_index % PACKETS_PER_SECTOR) * PACKET_SIZE;
        uint32_t flash_addr = (current_sector * SECTOR_SIZE) + sector_offset;

        // Nếu bắt đầu ghi vào đầu một Sector mới -> Phải Erase Sector đó trước!
        if (sector_offset == 0) {
            erase_sector(current_sector);
        }

        // Ghi 16 Bytes gói tin vào Flash
        write_enable();
        select_chip();
        SPI.transfer(CMD_PAGE_PROGRAM);
        SPI.transfer((flash_addr >> 16) & 0xFF);
        SPI.transfer((flash_addr >> 8) & 0xFF);
        SPI.transfer(flash_addr & 0xFF);

        const uint8_t *data = (const uint8_t*)pkt;
        for (size_t i = 0; i < PACKET_SIZE; i++) {
            SPI.transfer(data[i]);
        }
        deselect_chip();
        wait_busy();

        head_index = (head_index + 1) % (TOTAL_BUFFER_SECTORS * PACKETS_PER_SECTOR);
        if (count < (TOTAL_BUFFER_SECTORS * PACKETS_PER_SECTOR)) {
            count++;
        } else {
            // Đã đầy bộ đệm -> Đẩy con trỏ Tail tiến lên (đè dữ liệu cũ nhất)
            tail_index = (tail_index + 1) % (TOTAL_BUFFER_SECTORS * PACKETS_PER_SECTOR);
        }
        return true;
    }

    bool pop(icte_packet_t *pkt) {
        if (count == 0) return false;

        uint32_t current_sector = (tail_index / PACKETS_PER_SECTOR) % TOTAL_BUFFER_SECTORS;
        uint32_t sector_offset = (tail_index % PACKETS_PER_SECTOR) * PACKET_SIZE;
        uint32_t flash_addr = (current_sector * SECTOR_SIZE) + sector_offset;

        select_chip();
        SPI.transfer(CMD_READ_DATA);
        SPI.transfer((flash_addr >> 16) & 0xFF);
        SPI.transfer((flash_addr >> 8) & 0xFF);
        SPI.transfer(flash_addr & 0xFF);

        uint8_t *data = (uint8_t*)pkt;
        for (size_t i = 0; i < PACKET_SIZE; i++) {
            data[i] = SPI.transfer(0x00);
        }
        deselect_chip();

        tail_index = (tail_index + 1) % (TOTAL_BUFFER_SECTORS * PACKETS_PER_SECTOR);
        count--;
        return true;
    }

    uint32_t get_count() const { return count; }
};

#endif // W25Q64_FLASH_H