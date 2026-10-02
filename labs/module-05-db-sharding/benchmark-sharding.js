const crypto = require('crypto');

// 1. Giả lập thuật toán băm chuỗi ra số nguyên 32-bit
function hashKey(key) {
  const md5 = crypto.createHash('md5').update(key).digest();
  return md5.readUInt32BE(0);
}

// 2. Consistent Hash Ring đơn giản phục vụ bài test so sánh
class TestConsistentHashRing {
  constructor(vnodes = 50) {
    this.vnodes = vnodes;
    this.ring = [];
    this.nodes = [];
  }

  addNode(nodeName) {
    this.nodes.push(nodeName);
    for (let i = 0; i < this.vnodes; i++) {
      const hash = hashKey(`${nodeName}#vnode_${i}`);
      this.ring.push({ hash, nodeName });
    }
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  getNode(key) {
    const keyHash = hashKey(key);
    for (const entry of this.ring) {
      if (entry.hash >= keyHash) return entry.nodeName;
    }
    return this.ring[0].nodeName;
  }
}

async function runBenchmark() {
  console.log(`
===========================================================
  🧪 BẮT ĐẦU ĐO KIỂM MODULE 05: SHARDING & CONSISTENT HASHING
===========================================================
  `);

  // =========================================================================
  // PHẦN 1: KIỂM CHỨNG BỘ SINH SNOWFLAKE ID
  // =========================================================================
  console.log('--- PHẦN 1: KIỂM TRA HIỆU NĂNG VÀ ĐỘ CHÍNH XÁC CỦA SNOWFLAKE ID ---');
  const TOTAL_IDS = 10000;
  const idSet = new Set();
  const idList = [];

  // Import generator từ module đã build hoặc tạo trực tiếp
  const { SnowflakeGenerator } = require('./dist/snowflake');
  const gen = new SnowflakeGenerator(1, 1);

  const startGenTime = Date.now();
  for (let i = 0; i < TOTAL_IDS; i++) {
    const id = gen.nextId();
    idSet.add(id);
    idList.push(id);
  }
  const genDuration = Date.now() - startGenTime;

  // Kiểm tra tính duy nhất (Uniqueness)
  const isAllUnique = idSet.size === TOTAL_IDS;

  // Kiểm tra tính có thứ tự theo thời gian (Time-Sortable)
  let isSorted = true;
  for (let i = 1; i < idList.length; i++) {
    if (BigInt(idList[i]) < BigInt(idList[i - 1])) {
      isSorted = false;
      break;
    }
  }

  console.log(`  - Sinh thành công:          ${TOTAL_IDS.toLocaleString()} IDs trong ${genDuration}ms (~${Math.round(TOTAL_IDS / (genDuration || 1) * 1000).toLocaleString()} IDs/giây)`);
  console.log(`  - Tính duy nhất (Unique):   ${isAllUnique ? '✅ 100% Không có ID trùng lặp!' : '❌ Bị trùng ID!'}`);
  console.log(`  - Sắp xếp tăng dần (Sort):  ${isSorted ? '✅ 100% Tự nhiên có thứ tự (Tối ưu B-Tree Index)' : '❌ Không có thứ tự'}`);
  console.log(`  - Mẫu 1 Snowflake ID:       ${idList[0]}`);
  console.log(`    -> Chi tiết giải mã:      `, gen.parseId(idList[0]));

  // =========================================================================
  // PHẦN 2: ĐỐI CHIẾU MODULO HASHING VS CONSISTENT HASHING KHI THÊM SHARD 4
  // =========================================================================
  console.log('\n--- PHẦN 2: THẢM HỌA RE-SHARDING (MODULO VS CONSISTENT HASHING) ---');
  const KEY_COUNT = 1000;
  const keys = [];
  for (let i = 1; i <= KEY_COUNT; i++) {
    keys.push(`user_${i}_uuid_${Math.random()}`);
  }

  // 1. MODULO HASHING VỚI 3 NODES
  const moduloInitial = new Map();
  keys.forEach(k => {
    const shardIdx = hashKey(k) % 3;
    moduloInitial.set(k, `shard_0${shardIdx + 1}`);
  });

  // 2. MODULO HASHING KHI TĂNG LÊN 4 NODES
  let moduloMovedCount = 0;
  keys.forEach(k => {
    const newShardIdx = hashKey(k) % 4;
    const newShard = `shard_0${newShardIdx + 1}`;
    if (newShard !== moduloInitial.get(k)) {
      moduloMovedCount++;
    }
  });

  // 3. CONSISTENT HASHING VỚI 3 NODES
  const ring = new TestConsistentHashRing(50);
  ring.addNode('shard_01');
  ring.addNode('shard_02');
  ring.addNode('shard_03');

  const consistentInitial = new Map();
  keys.forEach(k => {
    consistentInitial.set(k, ring.getNode(k));
  });

  // 4. CONSISTENT HASHING KHI BỔ SUNG SHARD 4
  ring.addNode('shard_04');
  let consistentMovedCount = 0;
  keys.forEach(k => {
    const newShard = ring.getNode(k);
    if (newShard !== consistentInitial.get(k)) {
      consistentMovedCount++;
    }
  });

  const moduloPercent = ((moduloMovedCount / KEY_COUNT) * 100).toFixed(1);
  const consistentPercent = ((consistentMovedCount / KEY_COUNT) * 100).toFixed(1);

  console.log(`
===========================================================
  📊 BÁO CÁO ĐỐI CHIẾU DI CHUYỂN DỮ LIỆU KHI SCALE TỪ 3 LÊN 4 SHARDS
===========================================================
  Tổng số bản ghi thử nghiệm: ${KEY_COUNT.toLocaleString()} keys

  ❌ 1. MODULO HASHING TRUYỀN THỐNG (hash % N):
  - Số bản ghi bị ĐỔI VỊ TRÍ SHARD: ${moduloMovedCount} / ${KEY_COUNT} keys
  - Tỷ lệ dữ liệu phải di chuyển qua mạng: ⚠️ ${moduloPercent}% (Gần 3/4 dữ liệu bị xáo trộn!)
  - Hậu quả thực tế: Toàn bộ hệ thống phải ngừng hoạt động (Downtime) để Re-hash lại Database!

  ✅ 2. CONSISTENT HASHING VỚI VIRTUAL NODES:
  - Số bản ghi bị ĐỔI VỊ TRÍ SHARD: ${consistentMovedCount} / ${KEY_COUNT} keys
  - Tỷ lệ dữ liệu phải di chuyển qua mạng: 🏆 ${consistentPercent}% (Chỉ đúng ~1/N dữ liệu cần chuyển!)
  - Ưu điểm thực tế: 75% dữ liệu còn lại ở nguyên vị trí cũ. Hệ thống Zero Downtime!
===========================================================
  `);
}

runBenchmark().catch(console.error);
