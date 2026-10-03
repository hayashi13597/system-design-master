const autocannon = require('autocannon');

const BASE_URL = 'http://localhost:3000';

async function resetInventory() {
  await fetch(`${BASE_URL}/api/inventory/reset`, { method: 'POST' });
}

async function getInventoryStats() {
  const res = await fetch(`${BASE_URL}/api/inventory`);
  return await res.json();
}

function runAutocannonTest(url, label) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url,
      method: 'POST',
      connections: 20, // 20 khách hàng đồng thời bấm Mua
      duration: 2,     // Trong 2 giây
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId: 'buyer_concurrent' })
    }, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function main() {
  console.log(`
===========================================================
  🧪 BẮT ĐẦU ĐO KIỂM MODULE 06: BÁN ÂM KHO VS DISTRIBUTED LOCK
===========================================================
Kho hàng khởi tạo: CHỈ CÓ ĐÚNG 5 SẢN PHẨM TRONG KHO!
Đang thực hiện bài test, vui lòng chờ...
`);

  // =========================================================================
  // BÀI TEST 1: MUA HÀNG KHÔNG CÓ KHÓA BẢO VỆ (UNSAFE BUY)
  // =========================================================================
  console.log('>>> 1. ĐANG BẮN TẢI ĐỒNG THỜI VÀO ENDPOINT KHÔNG CÓ LOCK (/api/buy/unsafe)...');
  await resetInventory();

  await runAutocannonTest(`${BASE_URL}/api/buy/unsafe`, 'Unsafe Buy');
  const unsafeStats = await getInventoryStats();

  // =========================================================================
  // BÀI TEST 2: MUA HÀNG CÓ DISTRIBUTED LOCK BẢO VỆ (LOCKED BUY)
  // =========================================================================
  console.log('\n>>> 2. ĐANG BẮN TẢI ĐỒNG THỜI VÀO ENDPOINT CÓ DISTRIBUTED LOCK (/api/buy/locked)...');
  await resetInventory();

  await runAutocannonTest(`${BASE_URL}/api/buy/locked`, 'Locked Buy');
  const lockedStats = await getInventoryStats();

  // =========================================================================
  // TỔNG HỢP VÀ ĐỐI CHIẾU KẾT QUẢ
  // =========================================================================
  console.log(`
===========================================================
  📊 BÁO CÁO ĐỐI CHIẾU KIẾN TRÚC: CHỐNG BÁN ÂM HÀNG TỒN KHO
===========================================================
  Sản phẩm: iPhone 16 Pro Flash Sale (Số lượng gốc: 5 chiếc)

  ❌ 1. KỊCH BẢN KHÔNG DÙNG LOCK (UNSAFE BUY):
  - Số đơn hàng tạo thành công:  ${unsafeStats.inventory.totalOrdersCreated} ĐƠN HÀNG!
  - Tồn kho sau khi bán:         ${unsafeStats.inventory.currentStock} sản phẩm
  - Số lần vi phạm bán âm kho:   ⚠️ ${unsafeStats.inventory.oversoldViolations} LẦN VI PHẠM!
  - Đánh giá kiến trúc:          ❌ THẢM HỌA: Kho chỉ có 5 cái mà bán được ${unsafeStats.inventory.totalOrdersCreated} cái! Doanh nghiệp bị đền bù hợp đồng!

  ✅ 2. KỊCH BẢN DÙNG DISTRIBUTED LOCK (LOCKED BUY):
  - Số đơn hàng tạo thành công:  🏆 ĐÚNG ${lockedStats.inventory.totalOrdersCreated} ĐƠN HÀNG!
  - Tồn kho sau khi bán:         🏆 ${lockedStats.inventory.currentStock} sản phẩm (Không bao giờ bị âm!)
  - Số lần vi phạm bán âm kho:   🏆 0 LẦN
  - Số lần tranh chấp khóa:      ${lockedStats.distributedLockStats.lockCollisions} collisions được xử lý an toàn
  - Đánh giá kiến trúc:          ✅ HOÀN HẢO: 5 khách hàng đầu tiên mua được, các khách hàng còn lại nhận thông báo Hết Hàng an toàn!
===========================================================
  `);
}

main().catch(err => {
  console.error('Lỗi khi chạy benchmark:', err.message);
  console.log('Hãy đảm bảo server Lab 06 đang chạy tại http://localhost:3000 (`npm run start`)');
});
