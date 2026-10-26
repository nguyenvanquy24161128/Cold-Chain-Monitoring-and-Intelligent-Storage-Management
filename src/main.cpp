#include <Arduino.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <AccelStepper.h>
#include "icte_protocol.h"
#include "w25q64_flash.h"

// 1. CHÂN CẮM PHẦN CỨNG
#define DHTPIN          27
#define DHTTYPE         DHT22
#define DOOR_PIN        4
#define FAN_PIN         26
#define DS18B20_PIN     14

#define IN1 19
#define IN2 18
#define IN3 5
#define IN4 21

DHT dht(DHTPIN, DHTTYPE);
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);
AccelStepper stepper(AccelStepper::FULL4WIRE, IN1, IN3, IN2, IN4);
FlashRingBuffer flashBuffer;

const long STEPS_OPEN = 512;
const long STEPS_CLOSED = 0;

// 2. BIẾN DÙNG CHUNG FREERTOS
SemaphoreHandle_t xDataMutex;
icte_packet_t global_packet;

enum ThermalState { STATE_NORMAL = 0, STATE_WARNING = 1, STATE_VIOLATION = 2 };
ThermalState currentState = STATE_NORMAL;

float totalExposure = 0.0;
unsigned long lastCalcTime = 0;

// 3. TASK 1: ĐỌC CẢM BIẾN & TÍNH TOÁN FSM (2000ms)
void Task_Sensors(void *pvParameters) {
    (void) pvParameters;
    TickType_t xLastWakeTime = xTaskGetTickCount();

    for (;;) {
        float t_dht = dht.readTemperature();
        float h_dht = dht.readHumidity();

        if (isnan(t_dht)) t_dht = 5.0;
        if (isnan(h_dht)) h_dht = 85.0;

        bool isDoorOpen = (digitalRead(DOOR_PIN) == LOW);

        unsigned long currentTime = millis();
        if (lastCalcTime > 0) {
            float dt_minutes = (currentTime - lastCalcTime) / 60000.0;
            if (t_dht > 8.0) totalExposure += (t_dht - 8.0) * dt_minutes;
            else if (t_dht < 2.0) totalExposure += (2.0 - t_dht) * dt_minutes;
        }
        lastCalcTime = currentTime;

        if (totalExposure >= 30.0) currentState = STATE_VIOLATION;
        else if (t_dht > 8.0 || t_dht < 2.0 || isDoorOpen) currentState = STATE_WARNING;
        else currentState = STATE_NORMAL;

        digitalWrite(FAN_PIN, (t_dht > 8.0) ? LOW : HIGH);

        if (xSemaphoreTake(xDataMutex, portMAX_DELAY) == pdTRUE) {
            global_packet.header = 0xAA55;
            global_packet.device_id = 0x0001;
            global_packet.timestamp = (millis() / 1000) + 1773700000;
            global_packet.temperature = (int16_t)(t_dht * 100);
            global_packet.humidity = (uint16_t)(h_dht * 100);
            global_packet.door_status = isDoorOpen ? 0x01 : 0x00;
            global_packet.severity = (uint8_t)currentState;
            global_packet.crc16 = calculate_crc16((uint8_t*)&global_packet, 14);

            xSemaphoreGive(xDataMutex);
        }

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(2000));
    }
}

// 4. TASK 2: ĐIỀU KHIỂN CỬA BẰNG ĐỘNG CƠ BƯỚC
void Task_DoorControl(void *pvParameters) {
    (void) pvParameters;
    bool lastSwitchState = false;

    for (;;) {
        bool currentSwitchState = (digitalRead(DOOR_PIN) == LOW);

        if (currentSwitchState && !lastSwitchState) {
            lastSwitchState = true;
            stepper.enableOutputs();
            stepper.moveTo(STEPS_OPEN);
        } else if (!currentSwitchState && lastSwitchState) {
            lastSwitchState = false;
            stepper.enableOutputs();
            stepper.moveTo(STEPS_CLOSED);
        }

        if (stepper.distanceToGo() != 0) {
            stepper.run();
        } else {
            stepper.disableOutputs();
        }

        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

// 5. TASK 3: LƯU TỰ ĐỘNG VÀO FLASH RING BUFFER VÀ TRUYỀN DỮ LIỆU
void Task_TelemetryTx(void *pvParameters) {
    (void) pvParameters;

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(3000));

        if (xSemaphoreTake(xDataMutex, portMAX_DELAY) == pdTRUE) {
            // 1. Lưu gói tin vào bộ nhớ SPI Flash W25Q64
            flashBuffer.push(&global_packet);

            // 2. Xuất dữ liệu ra Serial Terminal
            uint8_t *raw_bytes = (uint8_t*)&global_packet;

            Serial.printf("[SPI FLASH LOG] Da luu 16B vao Ring Buffer! (Tong trong Flash: %d goi)\n", 
                          flashBuffer.get_count());
            Serial.print("  └─> [RAW 16B]: ");
            for (size_t i = 0; i < sizeof(icte_packet_t); i++) {
                if (raw_bytes[i] < 0x10) Serial.print("0");
                Serial.print(raw_bytes[i], HEX);
                Serial.print(" ");
            }
            Serial.println();

            Serial.printf("  └─> [DECODED] Temp: %.2f C | Hum: %.2f %% | Door: %s | CRC: 0x%04X\n\n",
                          global_packet.temperature / 100.0,
                          global_packet.humidity / 100.0,
                          global_packet.door_status ? "MO" : "DONG",
                          global_packet.crc16);

            xSemaphoreGive(xDataMutex);
        }
    }
}

void setup() {
    Serial.begin(115200);

    dht.begin();
    ds18b20.begin();
    flashBuffer.begin();

    pinMode(DOOR_PIN, INPUT_PULLUP);
    pinMode(FAN_PIN, OUTPUT);
    digitalWrite(FAN_PIN, HIGH);

    stepper.setMaxSpeed(600.0);
    stepper.setAcceleration(300.0);
    stepper.setCurrentPosition(0);
    stepper.disableOutputs();

    xDataMutex = xSemaphoreCreateMutex();

    xTaskCreatePinnedToCore(Task_Sensors,     "TaskSensors",     4096, NULL, 2, NULL, 1);
    xTaskCreatePinnedToCore(Task_DoorControl, "TaskDoorControl", 2048, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(Task_TelemetryTx,  "TaskTelemetry",   4096, NULL, 1, NULL, 0);

    Serial.println("=================================================");
    Serial.println(" FREERTOS + W25Q64 FLASH RING BUFFER ACTIVE     ");
    Serial.println("=================================================");
}

void loop() {
    // FreeRTOS Kernel quản lý toàn bộ tác vụ
}