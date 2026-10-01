export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number; // Unix timestamp tính bằng giây
  retryAfter: number; // Số giây cần chờ nếu bị 429
}

// =========================================================================
// 1. NAIVE LIMITER (DỄ BỊ LỖI RACE CONDITION TRONG MÔI TRƯỜNG PHÂN TÁN)
// =========================================================================
// Mô phỏng luồng code non-atomic thường gặp: Đọc counter -> Check -> Ghi counter
export class NaiveRateLimiter {
  private counts: Map<string, number> = new Map();
  private windowStart: number = Date.now();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number = 30, windowMs: number = 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.counts.clear();
      this.windowStart = now;
    }

    // BƯỚC 1: Đọc counter hiện tại (Mô phỏng GET counter từ Redis)
    const currentCount = this.counts.get(key) || 0;

    // BƯỚC 2: Mô phỏng độ trễ I/O mạng 2-5ms tới Redis (CẠM BẪY TOCTOU!)
    // Trong thời gian 3ms này, hàng chục request khác cũng đang đọc ra cùng giá trị currentCount!
    await new Promise(resolve => setTimeout(resolve, 3));

    // BƯỚC 3: Kiểm tra điều kiện và tăng biến đếm
    if (currentCount >= this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetTime: Math.ceil((this.windowStart + this.windowMs) / 1000),
        retryAfter: Math.ceil((this.windowStart + this.windowMs - now) / 1000)
      };
    }

    this.counts.set(key, currentCount + 1);

    return {
      allowed: true,
      limit: this.limit,
      remaining: Math.max(0, this.limit - (currentCount + 1)),
      resetTime: Math.ceil((this.windowStart + this.windowMs) / 1000),
      retryAfter: 0
    };
  }

  reset() {
    this.counts.clear();
    this.windowStart = Date.now();
  }
}

// =========================================================================
// 2. ATOMIC SLIDING WINDOW COUNTER (CHUẨN CLOUDFLARE - KHÔNG RACE CONDITION)
// =========================================================================
// Thuật toán: Ước lượng số lượng request trượt dựa trên tỷ lệ thời gian giữa 2 cửa sổ
export class AtomicSlidingWindowLimiter {
  // Key -> { prevCount, currentCount, currentWindowStart }
  private windows: Map<string, { prev: number; current: number; windowStart: number }> = new Map();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number = 30, windowMs: number = 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  // Phương thức nguyên tử (tương đương với chạy Lua Script trong Redis)
  check(key: string): RateLimitResult {
    const now = Date.now();
    let win = this.windows.get(key);

    if (!win) {
      win = { prev: 0, current: 0, windowStart: now };
      this.windows.set(key, win);
    }

    // Nếu thời gian đã trôi qua cửa sổ hiện tại
    const elapsedSinceWindowStart = now - win.windowStart;
    if (elapsedSinceWindowStart >= this.windowMs) {
      const windowsPassed = Math.floor(elapsedSinceWindowStart / this.windowMs);
      if (windowsPassed === 1) {
        win.prev = win.current;
        win.current = 0;
        win.windowStart += this.windowMs;
      } else {
        win.prev = 0;
        win.current = 0;
        win.windowStart = now;
      }
    }

    // Tính toán trọng số cửa sổ trượt (Sliding Window Weight)
    const timeInCurrentWindow = now - win.windowStart;
    const currentWindowWeight = timeInCurrentWindow / this.windowMs;
    const prevWindowWeight = 1 - currentWindowWeight;

    const estimatedRequests = Math.floor(win.prev * prevWindowWeight) + win.current;

    const resetTime = Math.ceil((win.windowStart + this.windowMs) / 1000);
    const retryAfter = Math.max(1, Math.ceil((win.windowStart + this.windowMs - now) / 1000));

    if (estimatedRequests >= this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        resetTime,
        retryAfter
      };
    }

    // Tăng biến đếm nguyên tử
    win.current++;

    return {
      allowed: true,
      limit: this.limit,
      remaining: Math.max(0, this.limit - (estimatedRequests + 1)),
      resetTime,
      retryAfter: 0
    };
  }

  reset() {
    this.windows.clear();
  }
}

// =========================================================================
// 3. TOKEN BUCKET LIMITER (HỖ TRỢ LƯU LƯỢNG BÙNG NỔ - TRAFFIC BURSTS)
// =========================================================================
export class TokenBucketLimiter {
  private capacity: number;      // Dung lượng tối đa của thùng
  private refillRatePerSec: number; // Tốc độ bơm token mỗi giây
  private buckets: Map<string, { tokens: number; lastRefill: number }> = new Map();

  constructor(capacity: number = 30, refillRatePerSec: number = 10) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Bơm thêm token dựa trên thời gian đã trôi qua
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsedSec * this.refillRatePerSec;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    const resetTime = Math.ceil(now / 1000 + 1);
    const retryAfter = Math.ceil((1 - bucket.tokens) / this.refillRatePerSec);

    if (bucket.tokens < 1) {
      return {
        allowed: false,
        limit: this.capacity,
        remaining: 0,
        resetTime,
        retryAfter: Math.max(1, retryAfter)
      };
    }

    // Tiêu thụ 1 token
    bucket.tokens -= 1;

    return {
      allowed: true,
      limit: this.capacity,
      remaining: Math.floor(bucket.tokens),
      resetTime,
      retryAfter: 0
    };
  }

  reset() {
    this.buckets.clear();
  }
}
