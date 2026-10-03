const autocannon = require('autocannon');

// Đọc tham số dòng lệnh
const args = process.argv.slice(2);
let targetUrl = 'http://localhost:8080/api/cpu-task?iterations=500000';
let label = 'Cụm Load Balancer (Cổng 8080)';
let connections = 30; // 30 người dùng đồng thời (Concurrent Connections)
let duration = 10;     // Chạy trong 10 giây

args.forEach(arg => {
  if (arg.startsWith('--target=')) targetUrl = arg.replace('--target=', '');
  if (arg.startsWith('--label=')) label = arg.replace('--label=', '');
  if (arg.startsWith('--connections=')) connections = parseInt(arg.replace('--connections=', ''), 10);
  if (arg.startsWith('--duration=')) duration = parseInt(arg.replace('--duration=', ''), 10);
});

console.log(`
===========================================================
  🚀 BẮT ĐẦU BÀI TEST TẢI (LOAD TEST BENCHMARK)
  Mục tiêu: ${label}
  URL: ${targetUrl}
  Số kết nối đồng thời: ${connections} VUs
  Thời gian test: ${duration}s
===========================================================
Đang bắn tải, vui lòng chờ trong giây lát...
`);

const instance = autocannon({
  url: targetUrl,
  connections,
  duration,
  pipelining: 1,
  headers: {
    'content-type': 'application/json'
  }
}, (err, result) => {
  if (err) {
    console.error('Lỗi khi chạy benchmark:', err);
    return;
  }

  console.log(`
===========================================================
  📊 KẾT QUẢ ĐO ĐẠC HIỆU NĂNG CHO: [${label}]
===========================================================
  Tổng số Requests:     ${result.requests.total.toLocaleString()} requests
  Thông lượng (RPS):    ${result.requests.average.toFixed(2)} req/s
  Dữ liệu truyền:       ${(result.throughput.total / 1024 / 1024).toFixed(2)} MB (${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s)
  
  ⏱️ PHÂN BỐ ĐỘ TRỄ (LATENCY PERCENTILES):
  - Trung bình (Avg):   ${result.latency.average.toFixed(2)} ms
  - p50 (Median):       ${result.latency.p50} ms
  - p90:                ${result.latency.p90} ms
  - p99 (Độ trễ đuôi):  ${result.latency.p99} ms
  - Max:                ${result.latency.max} ms

  🛑 TỶ LỆ LỖI:
  - Thành công (2xx):   ${result['2xx']} requests
  - Lỗi 5xx:            ${result['5xx']} requests
  - Lỗi kết nối / Drop: ${result.errors} errors
  - Timeouts:           ${result.timeouts} timeouts
===========================================================
  `);
});

autocannon.track(instance, { renderProgressBar: true });
