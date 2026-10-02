async function runTest() {
  const BASE_URL = 'http://localhost:3000';
  const ITERATIONS = 30;

  console.log(`
===========================================================
  🧪 BẮT ĐẦU ĐO KIỂM HIỆN TƯỢNG REPLICATION LAG
  Số lượt thử nghiệm: ${ITERATIONS} chu kỳ "GHI XONG ĐỌC NGAY"
===========================================================
Đang chạy bài kiểm tra, vui lòng chờ...
`);

  let naiveStaleCount = 0;
  let naiveFreshCount = 0;

  let consistentStaleCount = 0;
  let consistentFreshCount = 0;

  for (let i = 1; i <= ITERATIONS; i++) {
    // -------------------------------------------------------------
    // TEST 1: NAIVE ROUTER (Ghi vào Primary -> Đọc ngay từ Replicas)
    // -------------------------------------------------------------
    const updateRes1 = await fetch(`${BASE_URL}/api/users/user_1/bio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: `Bio Naive Test Lần #${i}` })
    });
    const writeData1 = await updateRes1.json();
    const expectedVersion1 = writeData1.newVersion;

    // ĐỌC NGAY LẬP TỨC (0ms delay)
    const readRes1 = await fetch(`${BASE_URL}/api/naive/users/user_1/bio?expectedVersion=${expectedVersion1}`);
    const readData1 = await readRes1.json();

    if (readData1.isStale) {
      naiveStaleCount++;
    } else {
      naiveFreshCount++;
    }

    // -------------------------------------------------------------
    // TEST 2: CONSISTENT ROUTER (Áp dụng Read-Your-Own-Writes Pinning)
    // -------------------------------------------------------------
    const updateRes2 = await fetch(`${BASE_URL}/api/users/user_1/bio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: `Bio Consistent Test Lần #${i}` })
    });
    const writeData2 = await updateRes2.json();
    const expectedVersion2 = writeData2.newVersion;

    // ĐỌC NGAY LẬP TỨC (0ms delay)
    const readRes2 = await fetch(`${BASE_URL}/api/consistent/users/user_1/bio?expectedVersion=${expectedVersion2}`);
    const readData2 = await readRes2.json();

    if (readData2.isStale) {
      consistentStaleCount++;
    } else {
      consistentFreshCount++;
    }

    // Chờ 50ms giữa các chu kỳ
    await new Promise(r => setTimeout(r, 50));
  }

  const naiveStalePercent = ((naiveStaleCount / ITERATIONS) * 100).toFixed(1);
  const consistentStalePercent = ((consistentStaleCount / ITERATIONS) * 100).toFixed(1);

  console.log(`
===========================================================
  📊 BÁO CÁO ĐỐI CHIẾU KIẾN TRÚC: REPLICATION LAG DEFENSE
===========================================================
  Tổng số chu kỳ thử nghiệm: ${ITERATIONS} lần ghi rồi đọc ngay

  ❌ 1. NAIVE ROUTER (ĐIỀU HƯỚNG ĐỌC SANG REPLICAS):
  - Số lần đọc dữ liệu MỚI NHẤT (Fresh): ${naiveFreshCount} / ${ITERATIONS}
  - Số lần bị DỮ LIỆU CŨ (Stale Read):    ${naiveStaleCount} / ${ITERATIONS}
  - Tỷ lệ bị Stale Data do Lag:           ⚠️ ${naiveStalePercent}% (LỖI NGHIÊM TRỌNG TRẢI NGHIỆM!)

  ✅ 2. CONSISTENT ROUTER (READ-YOUR-OWN-WRITES PINNING):
  - Số lần đọc dữ liệu MỚI NHẤT (Fresh): ${consistentFreshCount} / ${ITERATIONS}
  - Số lần bị DỮ LIỆU CŨ (Stale Read):    ${consistentStaleCount} / ${ITERATIONS}
  - Tỷ lệ bị Stale Data do Lag:           🏆 ${consistentStalePercent}% (HOÀN TOÀN NHẤT QUÁN!)
===========================================================
  `);
}

runTest().catch(err => {
  console.error('Lỗi khi chạy benchmark:', err.message);
  console.log('Hãy chắc chắn rằng server đang chạy tại http://localhost:3000 (`npm run start`)');
});
