#ifndef ICTE_PROTOCOL_H
#define ICTE_PROTOCOL_H

#include <stdint.h>
#include <stddef.h>

#pragma pack(push, 1)

typedef struct {
    uint16_t header;       // 2 Bytes: 0xAA55
    uint16_t device_id;    // 2 Bytes: 0x0001
    uint32_t timestamp;    // 4 Bytes: Unix Epoch Timestamp
    int16_t  temperature;  // 2 Bytes: Temp x 100
    uint16_t humidity;     // 2 Bytes: Hum x 100
    uint8_t  door_status;  // 1 Byte : 0x00=Đóng, 0x01=Mở
    uint8_t  severity;     // 1 Byte : Mức độ cảnh báo
    uint16_t crc16;        // 2 Bytes: Mã kiểm tra lỗi CRC16
} icte_packet_t;

#pragma pack(pop)

inline uint16_t calculate_crc16(const uint8_t *data, size_t length) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < length; i++) {
        crc ^= data[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
            else crc >>= 1;
        }
    }
    return crc;
}

#endif // ICTE_PROTOCOL_H