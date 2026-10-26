// ==========================================
// 1. QUY ƯỚC KẾT NỐI KỸ THUẬT (Backend / ESP)
// ==========================================
const BROKER_URL = 'ws://broker.emqx.io:8083/mqtt';
const TOPIC_TELEMETRY = 'coldchain/nhom07/telemetry';
const MAX_CHART_POINTS = 20;

// ==========================================
// 2. CẤU HÌNH BIỂU ĐỒ CHART.JS
// ==========================================
const ctx = document.getElementById('telemetryChart').getContext('2d');
const telemetryChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Nhiệt độ (°C)',
        data: [],
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 2,
        tension: 0.2,
        yAxisID: 'yTemp',
        fill: true
      },
      {
        label: 'Độ ẩm (%)',
        data: [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        borderWidth: 2,
        tension: 0.2,
        yAxisID: 'yHum',
        fill: true
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false } },
      yTemp: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Nhiệt độ (°C)' },
        suggestedMin: -2,
        suggestedMax: 15
      },
      yHum: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Độ ẩm (%)' },
        suggestedMin: 30,
        suggestedMax: 90,
        grid: { drawOnChartArea: false }
      }
    }
  }
});

// ==========================================
// 3. KẾT NỐI WEBSOCKETS TỚI BROKER EMQX
// ==========================================
console.log('Đang kết nối WebSocket tới EMQX Broker...');
const client = mqtt.connect(BROKER_URL);

client.on('connect', () => {
  console.log('✅ Đã kết nối thành công WebSocket!');
  const badge = document.getElementById('connection-badge');
  badge.innerText = 'Online (EMQX WS:8083)';
  badge.className = 'px-3 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700';

  // Lắng nghe topic telemetry theo quy ước
  client.subscribe(TOPIC_TELEMETRY, (err) => {
    if (!err) {
      console.log(`📡 Đã Subscribe topic: ${TOPIC_TELEMETRY}`);
    } else {
      console.error('Lỗi Subscribe:', err);
    }
  });
});

client.on('offline', () => {
  const badge = document.getElementById('connection-badge');
  badge.innerText = 'Offline (Mất kết nối)';
  badge.className = 'px-3 py-1 text-xs font-semibold rounded-full bg-rose-100 text-rose-700';
});

// ==========================================
// 4. NHẬN VÀ XỬ LÝ DỮ LIỆU TỪ ESP32
// ==========================================
client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    console.log('📥 Payload nhận được:', payload);

    updateDashboardUI(payload);
    updateChart(payload);
  } catch (e) {
    console.error('❌ Lỗi định dạng JSON:', e);
  }
});

// ==========================================
// 5. CẬP NHẬT GIAO DIỆN & LẬP TRÌNH CẢNH BÁO
// ==========================================
function updateDashboardUI(data) {
  // Device ID
  if (data.device_id) {
    document.getElementById('device-id').innerText = data.device_id;
  }

  // Nhiệt độ & Độ ẩm
  const temp = data.temperature;
  const hum = data.humidity;
  document.getElementById('temp-val').innerText = temp !== undefined ? temp.toFixed(1) : '--';
  document.getElementById('hum-val').innerText = hum !== undefined ? hum.toFixed(1) : '--';

  // LOGIC CẢNH BÁO NHIỆT ĐỘ (2.0°C - 8.0°C)
  const tempCard = document.getElementById('temp-card');
  const tempStatus = document.getElementById('temp-status');

  if (temp < 2.0 || temp > 8.0) {
    // Vi phạm dải an toàn -> Nhấp nháy đỏ
    tempCard.className = 'bg-rose-50 p-4 rounded-xl shadow-sm border-2 border-rose-500 animate-pulse';
    tempStatus.innerText = '⚠️ VI PHẠM NHIỆT ĐỘ AN TOÀN!';
    tempStatus.className = 'text-xs mt-1 font-bold text-rose-600';
  } else {
    // Bình thường
    tempCard.className = 'bg-white p-4 rounded-xl shadow-sm border border-slate-200';
    tempStatus.innerText = 'Ngưỡng an toàn: 2.0°C - 8.0°C';
    tempStatus.className = 'text-xs text-slate-400 mt-1 font-medium';
  }

  // LOGIC CẢNH BÁO CỬA MỞ
  const doorElem = document.getElementById('door-status');
  const doorCard = document.getElementById('door-card');

  if (data.door_open) {
    doorElem.innerText = 'ĐANG MỞ';
    doorElem.className = 'px-3 py-1 text-sm font-bold rounded-md bg-amber-100 text-amber-700';
    doorCard.className = 'bg-amber-50 p-4 rounded-xl shadow-sm border border-amber-300';
  } else {
    doorElem.innerText = 'ĐANG ĐÓNG';
    doorElem.className = 'px-3 py-1 text-sm font-bold rounded-md bg-emerald-100 text-emerald-700';
    doorCard.className = 'bg-white p-4 rounded-xl shadow-sm border border-slate-200';
  }

  // TRẠNG THÁI QUẠT LÀM MÁT
  const coolingElem = document.getElementById('cooling-status');
  if (data.cooling_state) {
    coolingElem.innerText = 'ĐANG CHẠY';
    coolingElem.className = 'px-3 py-1 text-sm font-bold rounded-md bg-blue-100 text-blue-700';
  } else {
    coolingElem.innerText = 'TẮT';
    coolingElem.className = 'px-3 py-1 text-sm font-bold rounded-md bg-slate-100 text-slate-600';
  }

  // THỜI GIAN CẬP NHẬT (timestamp Epoch giây * 1000)
  const date = data.timestamp ? new Date(data.timestamp * 1000) : new Date();
  document.getElementById('last-update').innerText = `Cập nhật: ${date.toLocaleTimeString()}`;
}

// ==========================================
// 6. CẬP NHẬT DỮ LIỆU LÊN BIỂU ĐỒ
// ==========================================
function updateChart(data) {
  const timeStr = data.timestamp 
    ? new Date(data.timestamp * 1000).toLocaleTimeString() 
    : new Date().toLocaleTimeString();

  telemetryChart.data.labels.push(timeStr);
  telemetryChart.data.datasets[0].data.push(data.temperature);
  telemetryChart.data.datasets[1].data.push(data.humidity);

  // Giữ tối đa 20 điểm dữ liệu trên đồ thị
  if (telemetryChart.data.labels.length > MAX_CHART_POINTS) {
    telemetryChart.data.labels.shift();
    telemetryChart.data.datasets[0].data.shift();
    telemetryChart.data.datasets[1].data.shift();
  }

  telemetryChart.update('none'); // Update không animation để mượt mà hơn
}
// ==========================================
// 7. TÍCH HỢP REST API LỊCH SỬ & XUẤT CSV
// ==========================================
const API_HISTORY_URL = 'http://localhost:3000/api/history'; // Địa chỉ API Backend của bạn

// Hàm 1: Gọi REST API lấy lịch sử từ Backend
async function fetchHistoryData() {
  console.log('🔄 Đang gọi REST API lấy dữ liệu lịch sử...');
  try {
    const response = await fetch(API_HISTORY_URL);
    const result = await response.json();

    // Kiểm tra bao đóng Envelope: { success: true, data: [...] }
    if (result.success && Array.isArray(result.data)) {
      console.log(`✅ Tải thành công ${result.data.length} bản ghi lịch sử!`);

      // Làm sạch biểu đồ trước khi nạp lịch sử
      telemetryChart.data.labels = [];
      telemetryChart.data.datasets[0].data = [];
      telemetryChart.data.datasets[1].data = [];

      // Đưa dữ liệu lịch sử vào biểu đồ
      result.data.forEach(item => {
        const timeStr = new Date(item.timestamp * 1000).toLocaleTimeString();
        telemetryChart.data.labels.push(timeStr);
        telemetryChart.data.datasets[0].data.push(item.temperature);
        telemetryChart.data.datasets[1].data.push(item.humidity);
      });

      telemetryChart.update();
      alert(`Đã nạp ${result.data.length} bản ghi lịch sử lên biểu đồ!`);
    } else {
      console.warn('⚠️ API trả về định dạng chưa khớp:', result);
    }
  } catch (error) {
    console.error('❌ Lỗi kết nối API Backend:', error);
    alert('Chưa kết nối được Backend (http://localhost:3000). Bạn có thể test nút "Xuất Báo Cáo CSV" trước nhé!');
  }
}

// Hàm 2: Xuất toàn bộ dữ liệu đang có trên Biểu đồ thành file CSV
function exportCSV() {
  const labels = telemetryChart.data.labels;
  const temps = telemetryChart.data.datasets[0].data;
  const hums = telemetryChart.data.datasets[1].data;

  if (labels.length === 0) {
    alert('Chưa có dữ liệu nào trên biểu đồ để xuất!');
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,Thoi Gian,Nhiet Do (C),Do Am (%)\n";

  for (let i = 0; i < labels.length; i++) {
    csvContent += `${labels[i]},${temps[i]},${hums[i]}\n`;
  }

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `coldchain_log_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}