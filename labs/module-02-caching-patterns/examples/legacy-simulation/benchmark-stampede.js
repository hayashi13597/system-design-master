const autocannon = require('autocannon');

const args = process.argv.slice(2);
let mode = 'naive';
let label = 'Naive Cache-Aside (Thundering Herd Vulnerable)';
let connections = 30; // 30 concurrent users
let duration = 6;     // 6 seconds (dài hơn TTL 2s của cache để chứng kiến thời điểm cache hết hạn!)

args.forEach(arg => {
  if (arg.startsWith('--mode=')) mode = arg.replace('--mode=', '');
  if (arg.startsWith('--label=')) label = arg.replace('--label=', '');
  if (arg.startsWith('--connections=')) connections = parseInt(arg.replace('--connections=', ''), 10);
  if (arg.startsWith('--duration=')) duration = parseInt(arg.replace('--duration=', ''), 10);
});

let endpoint = '';
if (mode === 'none') {
  endpoint = 'http://localhost:3000/api/products/no-cache/1';
} else if (mode === 'naive') {
  endpoint = 'http://localhost:3000/api/products/naive/1';
} else if (mode === 'singleflight') {
  endpoint = 'http://localhost:3000/api/products/singleflight/1';
} else if (mode === 'penetration') {
  endpoint = 'http://localhost:3000/api/products/penetration-protected/9999';
}

async function run() {
  // 1. Reset metrics trước khi test
  try {
    await fetch('http://localhost:3000/api/reset', { method: 'POST' });
  } catch (e) {
    console.error('Không thể kết nối đến server tại http://localhost:3000. Hãy đảm bảo bạn đã chạy `npm run start`!');
    process.exit(1);
  }

  console.log(`
===========================================================
  🧪 BẮT ĐẦU TEST SỰ CỐ CACHE & PHÒNG THỦ
  Kịch bản: [${label}]
  URL: ${endpoint}
  Số người dùng đồng thời (VUs): ${connections}
  Thời gian test: ${duration}s (Cache TTL = 2s)
===========================================================
Đang bắn tải, vui lòng chờ trong giây lát...
`);

  const instance = autocannon({
    url: endpoint,
    connections,
    duration,
    pipelining: 1
  }, async (err, result) => {
    if (err) {
      console.error('Lỗi khi test tải:', err);
      return;
    }

    // 2. Lấy thông số nội bộ của Server sau khi test xong
    let serverStats = { database: {}, cache: {}, singleflightSuppressedCalls: 0 };
    try {
      const res = await fetch('http://localhost:3000/api/status');
      serverStats = await res.json();
    } catch (e) {}

    console.log(`
===========================================================
  📊 KẾT QUẢ ĐO ĐẠC KIẾN TRÚC CHO: [${label}]
===========================================================
  🚀 HIỆU NĂNG TỔNG QUAN:
  - Tổng số Requests:        ${result.requests.total.toLocaleString()} requests
  - Thông lượng (RPS):       ${result.requests.average.toFixed(2)} req/s
  - Độ trễ trung bình (Avg):  ${result.latency.average.toFixed(2)} ms
  - Độ trễ đuôi (p99):        ${result.latency.p99} ms
  - Thành công (2xx):        ${result['2xx']} responses
  - Lỗi 4xx (Not Found):     ${result['4xx']} responses
  - Lỗi 5xx (Server Error):  ${result['5xx']} responses

  💾 SỨC ÉP LÊN DATABASE (DATABASE METRICS):
  - Số câu query đâm vào DB: ${serverStats.database.totalQueriesExecuted} queries
  - Đỉnh kết nối DB (Peak):  ${serverStats.database.peakConnections} / ${serverStats.database.maxPoolSize} connections

  ⚡ HIỆU SUẤT CACHE (CACHE METRICS):
  - Cache Hits:              ${serverStats.cache.hits}
  - Cache Misses:            ${serverStats.cache.misses}
  - Tỷ lệ Cache Hit:         ${serverStats.cache.hitRatio}
  - Request gom nhóm (Singleflight Suppressed): ${serverStats.singleflightSuppressedCalls} calls
===========================================================
  `);
  });

  autocannon.track(instance, { renderProgressBar: true });
}

run();
