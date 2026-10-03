const autocannon = require('autocannon');

const args = process.argv.slice(2);
let mode = 'atomic';
let label = 'Atomic Sliding Window Limiter (Strict Defense)';
let connections = 25; // 25 concurrent clients
let duration = 2;     // 2 seconds test

args.forEach(arg => {
  if (arg.startsWith('--mode=')) mode = arg.replace('--mode=', '');
  if (arg.startsWith('--label=')) label = arg.replace('--label=', '');
  if (arg.startsWith('--connections=')) connections = parseInt(arg.replace('--connections=', ''), 10);
  if (arg.startsWith('--duration=')) duration = parseInt(arg.replace('--duration=', ''), 10);
});

let endpoint = '';
if (mode === 'unprotected') {
  endpoint = 'http://localhost:3000/api/unprotected';
} else if (mode === 'vulnerable') {
  endpoint = 'http://localhost:3000/api/vulnerable';
} else if (mode === 'atomic') {
  endpoint = 'http://localhost:3000/api/atomic-sliding';
} else if (mode === 'token-bucket') {
  endpoint = 'http://localhost:3000/api/token-bucket';
}

async function run() {
  try {
    await fetch('http://localhost:3000/api/reset', { method: 'POST' });
  } catch (e) {
    console.error('Không thể kết nối đến server tại http://localhost:3000. Hãy đảm bảo bạn đã chạy `npm run start`!');
    process.exit(1);
  }

  console.log(`
===========================================================
  🛡️ BẮT ĐẦU TEST TẢI RATE LIMITER
  Kịch bản: [${label}]
  URL: ${endpoint}
  Giới hạn lý thuyết cấu hình: 25 requests / giây (~50 requests trong 2s)
  Số kết nối đồng thời: ${connections} VUs
  Thời gian test: ${duration}s
===========================================================
Đang bắn tải, vui lòng chờ trong giây lát...
`);

  const instance = autocannon({
    url: endpoint,
    connections,
    duration,
    pipelining: 1
  }, (err, result) => {
    if (err) {
      console.error('Lỗi khi test tải:', err);
      return;
    }

    const total = result.requests.total;
    const allowed2xx = result['2xx'] || 0;
    const blocked429 = result['4xx'] || 0; // 429 nằm trong dải 4xx
    const expectedLimit = 25 * duration;
    const leakCount = Math.max(0, allowed2xx - expectedLimit);

    console.log(`
===========================================================
  📊 KẾT QUẢ ĐO ĐẠC KIẾN TRÚC CHO: [${label}]
===========================================================
  🚀 TỔNG LƯỢNG TRUY CẬP:
  - Tổng số Requests gửi đến: ${total.toLocaleString()} requests
  - Thông lượng trung bình:    ${result.requests.average.toFixed(2)} req/s

  🛡️ KẾT QUẢ KIỂM SOÁT LƯU LƯỢNG:
  - Cho phép thành công (200 OK):      ${allowed2xx} requests
  - Bị chặn lại (429 Too Many Requests): ${blocked429} requests

  🔍 ĐÁNH GIÁ CHẤT LƯỢNG BẢO VỆ:
  - Giới hạn lý thuyết cho phép:        ~${expectedLimit} requests (trong ${duration}s)
  - Số request thực tế lọt qua:         ${allowed2xx} requests
  - Số lượng bị lọt tải (Leak / Race):  ${leakCount > 10 ? `⚠️ ${leakCount} requests (BỊ LỖI RACE CONDITION LỌT TẢI!)` : `✅ 0 - ${leakCount} requests (Chặn nghiêm ngặt tuyệt đối!)`}
===========================================================
  `);
  });

  autocannon.track(instance, { renderProgressBar: true });
}

run();
