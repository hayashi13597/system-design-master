import crypto from 'crypto';

interface LockEntry {
  token: string;
  expiresAt: number;
  fencingToken: number;
}

export interface LockContext {
  key: string;
  token: string;
  fencingToken: number;
}

/**
 * Triển khai Distributed Lock chuẩn kiến trúc Redis:
 * 1. Acquire nguyên tử: SET resource_key token NX PX ttlMs
 * 2. Token duy nhất (UUID): Chống xóa nhầm lock của tiến trình khác
 * 3. Fencing Token: Mã số tự tăng đơn điệu bảo vệ tầng DB
 * 4. Release nguyên tử bằng Lua Script: Chỉ xóa nếu Token khớp chính xác
 */
export class DistributedLock {
  private locks: Map<string, LockEntry> = new Map();
  private monotonicCounter: number = 1000;

  // Thống kê đo đạc
  public stats = {
    locksAcquired: 0,
    lockCollisions: 0,
    locksReleasedSafely: 0,
    mismatchedReleasesPrevented: 0
  };

  // 1. Thao tác Acquire (Tương đương: SET key token NX PX ttlMs trong Redis)
  async acquire(key: string, ttlMs: number = 3000): Promise<LockContext | null> {
    const now = Date.now();
    const existing = this.locks.get(key);

    // Kiểm tra xem lock có đang tồn tại và còn hạn không
    if (existing && now < existing.expiresAt) {
      this.stats.lockCollisions++;
      return null; // Không lấy được lock (Mutual Exclusion!)
    }

    // Sinh token ngẫu nhiên duy nhất cho lần acquire này (chống xóa nhầm)
    const token = crypto.randomUUID();
    const fencingToken = ++this.monotonicCounter;

    this.locks.set(key, {
      token,
      expiresAt: now + ttlMs,
      fencingToken
    });

    this.stats.locksAcquired++;
    return { key, token, fencingToken };
  }

  // 2. Thao tác Release (Tương đương: chạy LUA SCRIPT trong Redis)
  async release(key: string, token: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (!existing) {
      return false; // Lock đã hết hạn tự giải phóng
    }

    // LUA SCRIPT LOGIC: Chỉ xóa nếu Token khớp chính xác!
    if (existing.token === token) {
      this.locks.delete(key);
      this.stats.locksReleasedSafely++;
      return true;
    } else {
      // CẢNH BÁO: Phát hiện tiến trình cố tình xóa lock của tiến trình khác (do lock cũ đã hết hạn)!
      this.stats.mismatchedReleasesPrevented++;
      console.warn(`[DistributedLock] 🛑 ĐÃ CHẶN ĐỨNG THAO TÁC XÓA NHẦM LOCK! Token ${token} không khớp với token đang giữ.`);
      return false;
    }
  }

  // 3. Helper bọc Critical Section tự động Retry với Exponential Backoff + Jitter
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: (ctx: LockContext) => Promise<T>,
    maxRetries: number = 15,
    baseDelayMs: number = 20
  ): Promise<T> {
    let retries = 0;

    while (retries < maxRetries) {
      const lock = await this.acquire(key, ttlMs);
      if (lock) {
        try {
          return await fn(lock);
        } finally {
          await this.release(key, lock.token);
        }
      }

      // Spin-lock với Exponential Backoff + Random Jitter
      retries++;
      const jitter = Math.floor(Math.random() * 15);
      const delay = baseDelayMs * Math.pow(1.2, retries) + jitter;
      await new Promise(r => setTimeout(r, delay));
    }

    throw new Error(`[DistributedLock] Hết thời gian chờ: Không thể giành được lock cho [${key}] sau ${maxRetries} lần thử.`);
  }

  reset() {
    this.locks.clear();
    this.stats = {
      locksAcquired: 0,
      lockCollisions: 0,
      locksReleasedSafely: 0,
      mismatchedReleasesPrevented: 0
    };
  }
}

export const distributedLock = new DistributedLock();
