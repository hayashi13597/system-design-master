interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Timestamp tính bằng ms
}

export class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private hits: number = 0;
  private misses: number = 0;

  // Lấy dữ liệu từ cache
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Kiểm tra hết hạn TTL
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  // Ghi vào cache với TTL (giây)
  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  // Ghi vào cache với TTL Jitter (chống hiện tượng Cache Avalanche)
  setWithJitter<T>(key: string, value: T, baseTtlSeconds: number, maxJitterSeconds: number = 5): void {
    const jitter = Math.floor(Math.random() * maxJitterSeconds);
    const actualTtl = baseTtlSeconds + jitter;
    this.set(key, value, actualTtl);
  }

  // Xóa key
  del(key: string): void {
    this.cache.delete(key);
  }

  // Xóa sạch cache
  flush(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  // Thống kê hiệu suất Cache
  getStats() {
    const total = this.hits + this.misses;
    const hitRatio = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0%';
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio
    };
  }
}

export const cache = new CacheService();
