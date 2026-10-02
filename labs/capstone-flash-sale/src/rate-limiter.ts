export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Sliding Window Counter Rate Limiter (Tầng Gateway / WAF)
 * Chặn đứng botnet spam và hạn chế tần suất click của người dùng
 */
export class SlidingWindowRateLimiter {
  private windows: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowSizeMs: number;
  private totalBlocked: number = 0;

  constructor(maxRequests: number = 10, windowSizeMs: number = 1000) {
    this.maxRequests = maxRequests;
    this.windowSizeMs = windowSizeMs;
  }

  isAllowed(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    let timestamps = this.windows.get(key) || [];
    // Loại bỏ các timestamp cũ hơn cửa sổ hiện tại
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.totalBlocked++;
      this.windows.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        limit: this.maxRequests
      };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      limit: this.maxRequests
    };
  }

  getTotalBlocked(): number {
    return this.totalBlocked;
  }

  reset() {
    this.windows.clear();
    this.totalBlocked = 0;
  }
}

export const rateLimiter = new SlidingWindowRateLimiter(5, 1000); // 5 reqs / giây
