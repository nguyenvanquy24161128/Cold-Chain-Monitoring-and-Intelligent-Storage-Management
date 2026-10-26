const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
const port = 3000;
app.use(cors());

// 1. KẾT NỐI DATABASE
const db = new sqlite3.Database('./coldchain.db', (err) => {
    if (!err) console.log("✅ 1. Đã kết nối kho chứa SQLite.");
});

// 2. KẾT NỐI MÁY CHỦ QUỐC DÂN EMQX (KHÔNG CẦN PASS)
const mqttOptions = {
    host: 'broker.emqx.io',
    port: 1883,
    protocol: 'mqtt'
};

const client = mqtt.connect(mqttOptions);

client.on('connect', () => {
    console.log("✅ 2. Đã kết nối mạng MQTT EMQX thành công!");
    
    // Đổi tên luồng (thêm nhom07) để không bị trùng với người khác trên mạng public
    const topic = 'coldchain/nhom07/telemetry';
    client.subscribe(topic, (err) => {
        if (!err) console.log(`✅ 3. Đang chực chờ tại luồng: ${topic}`);
    });
});

client.on('message', (topic, message) => {
    try {
        // 1. Mổ bụng gói dữ liệu (Chuyển chuỗi JSON thành Object)
        const data = JSON.parse(message.toString());
        
        console.log(`\n📥 [CÓ DỮ LIỆU TỚI]`);
        console.log(`🌡️ Nhiệt độ: ${data.temperature}°C | 💧 Độ ẩm: ${data.humidity}%`);

        // 2. Nhét dữ liệu vào Kho (Bảng telemetry_data)
        const sqlInsert = `INSERT INTO telemetry_data (timestamp, device_id, temperature, humidity, door_open, cooling_state) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(sqlInsert, [data.timestamp, data.device_id, data.temperature, data.humidity, data.door_open, data.cooling_state], (err) => {
            if (err) {
                console.error("❌ Lỗi lưu Database:", err.message);
            } else {
                console.log("💾 Đã lưu thành công vào ổ cứng SQLite!");
            }
        });

        // 3. Logic Đời Thực: Kiểm tra vi phạm Chuỗi lạnh (2°C - 8°C)
        if (data.temperature > 8.0 || data.temperature < 2.0) {
            console.log("⚠️ CẢNH BÁO: Nhiệt độ vượt ngưỡng an toàn chuỗi lạnh!");
            
            // Tự động ghi chép lỗi vào Sổ xưng tội (Bảng event_logs)
            const sqlEvent = `INSERT INTO event_logs (timestamp, device_id, event_type, description) VALUES (?, ?, ?, ?)`;
            db.run(sqlEvent, [data.timestamp, data.device_id, "CRITICAL_TEMP", `Nhiệt độ bất thường: ${data.temperature}°C`]);
        }

    } catch (error) {
        console.error("❌ Lỗi phân tích JSON:", error.message);
    }
});
// ============================================================================
// 4. CÁC CỔNG REST API XUẤT DỮ LIỆU CHO FRONTEND (DASHBOARD)
// ============================================================================

// API 1: Lấy lịch sử nhiệt độ/độ ẩm (Lấy 50 mốc thời gian gần nhất để vẽ biểu đồ)
app.get('/api/history', (req, res) => {
    const sql = `SELECT * FROM telemetry_data ORDER BY timestamp DESC LIMIT 50`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error("❌ Lỗi truy vấn lịch sử:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, data: rows });
    });
});

// API 2: Lấy nhật ký vi phạm/cảnh báo chuỗi lạnh (Event Logs)
app.get('/api/events', (req, res) => {
    const sql = `SELECT * FROM event_logs ORDER BY timestamp DESC LIMIT 20`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error("❌ Lỗi truy vấn sự kiện:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, data: rows });
    });
});

// ============================================================================
// 5. KHỞI ĐỘNG MÁY CHỦ API
// ============================================================================
app.get('/', (req, res) => res.send('Server hoạt động API mượt mà!'));
app.listen(port, () => console.log(`✅ 4. Cổng API mở tại http://localhost:${port}`));
