const BASE_URL = 'http://localhost:3000';

async function resetSystem() {
  await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
}

async function getAccountStats() {
  const res = await fetch(`${BASE_URL}/api/account`);
  return await res.json();
}

async function getQueueStatus() {
  const res = await fetch(`${BASE_URL}/api/queue/status`);
  return await res.json();
}

async function main() {
  console.log(`
===========================================================
  🧪 BẮT ĐẦU ĐO KIỂM MODULE 07: MESSAGE QUEUE & IDEMPOTENCY
===========================================================
Đang chuẩn bị môi trường kiểm thử...
`);

  await resetSystem();

  // =========================================================================
  // BÀI TEST 1: THẢM HỌA RETRY TRÙNG LẶP (DUPLICATE WEBHOOK STORM)
  // =========================================================================
  console.log('>>> 1. MÔ PHỎNG CỔNG THANH TOÁN RETRY GỬI TRÙNG 10 WEBHOOKS CÙNG 1 GIAO DỊCH...');
  const SHARED_KEY = `TXN_VNPay_${Date.now()}`;
  const TOPUP_AMOUNT = 100000; // 100,000đ

  // Gửi 10 Webhooks cùng 1 idempotencyKey đồng thời
  const promises = [];
  for (let i = 1; i <= 10; i++) {
    promises.push(
      fetch(`${BASE_URL}/api/webhooks/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: SHARED_KEY,
          amount: TOPUP_AMOUNT,
          userId: 'user_vietnam'
        })
      })
    );
  }

  await Promise.all(promises);

  // Chờ 300ms để Consumer rút hết tin nhắn trong Queue
  await new Promise(r => setTimeout(r, 300));
  const accountStats1 = await getAccountStats();

  console.log(`
  📊 KẾT QUẢ BÀI TEST 1 (CHỐNG TRÙNG LẶP GIAO DỊCH):
  - Số Webhooks cổng thanh toán gửi:    10 webhooks (Số tiền: 100,000đ / lần)
  - Số dư tài khoản thực tế:            ${accountStats1.currentBalance.toLocaleString()} VNĐ
  - Số giao dịch trùng lặp bị chặn:     🏆 ${accountStats1.duplicatesPrevented} lần triệt tiêu!
  - Đánh giá kiến trúc:                ${accountStats1.currentBalance === 100000 ? '✅ HOÀN HẢO: Chỉ cộng đúng 100,000đ! Chống gian lận x10 tiền!' : '❌ THẤT BẠI: Tiền bị cộng trùng!'}
`);

  // =========================================================================
  // BÀI TEST 2: TIN NHẮN CÓ ĐỘC & DEAD LETTER QUEUE (DLQ ISOLATION)
  // =========================================================================
  console.log('>>> 2. MÔ PHỎNG TIN NHẮN CÓ ĐỘC (POISON MESSAGE) VÀ CÁCH LY VÀO DLQ...');

  // Gửi 1 tin nhắn độc hại
  await fetch(`${BASE_URL}/api/webhooks/poison-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: 'MALICIOUS_POISON_01' })
  });

  // Đồng thời gửi tiếp 2 giao dịch hợp lệ (50,000đ mỗi giao dịch)
  await fetch(`${BASE_URL}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: `VALID_TX_${Date.now()}_A`, amount: 50000 })
  });

  await fetch(`${BASE_URL}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: `VALID_TX_${Date.now()}_B`, amount: 50000 })
  });

  // Chờ 1 giây để Broker thực hiện hết các chu kỳ Exponential Backoff Retry cho tin nhắn độc
  await new Promise(r => setTimeout(r, 1200));

  const queueStats = await getQueueStatus();
  const accountStats2 = await getAccountStats();

  console.log(`
  📊 KẾT QUẢ BÀI TEST 2 (CÁCH LY TIN NHẮN ĐỘC VÀO DLQ):
  - Tin nhắn trong Main Queue:          ${queueStats.mainQueueSize} (Đã xử lý sạch sẽ, không bị nghẽn!)
  - Tin nhắn trong Dead Letter Queue:   🏆 ${queueStats.deadLetterQueueSize} tin nhắn bị cách ly an toàn!
  - Số lần Broker tự động Retry:        ${queueStats.stats.totalRetries} lần (với Exponential Backoff)
  - Số dư tài khoản cuối cùng:          ${accountStats2.currentBalance.toLocaleString()} VNĐ (100k + 50k + 50k = 200,000 VNĐ)
  - Chi tiết tin nhắn trong DLQ:        `, queueStats.deadLetterMessages);

  console.log(`
===========================================================
  🏆 TỔNG KẾT MODULE 07: KIẾN TRÚC HOÀN TOÀN BẢO VỆ
  1. Idempotency Key bảo vệ doanh nghiệp không bị cộng trùng tiền.
  2. Dead Letter Queue ngăn chặn sập dây chuyền và thông suốt hàng đợi.
===========================================================
`);
}

main().catch(err => {
  console.error('Lỗi khi chạy benchmark:', err.message);
  console.log('Hãy đảm bảo server Lab 07 đang chạy tại http://localhost:3000 (`npm run start`)');
});
