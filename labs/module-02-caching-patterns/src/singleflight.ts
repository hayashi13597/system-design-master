/**
 * Singleflight Pattern (Tương đương với golang.org/x/sync/singleflight)
 * 
 * Nguyên lý: Gom nhóm nhiều request đồng thời cho cùng 1 key thành đúng 1 lời gọi duy nhất.
 * Nếu 1000 request cùng hỏi "Sản phẩm 1" khi Cache vừa hết hạn:
 * - Request đầu tiên thực thi hàm fetcher() (query DB).
 * - 999 request còn lại chia sẻ chung Promise của request đầu tiên.
 * - Khi DB trả về kết quả, TẤT CẢ 1000 request nhận kết quả cùng lúc!
 * - Số query đâm vào DB giảm từ 1000 xuống DUY NHẤT 1!
 */

export class SingleflightGroup {
  private inFlight: Map<string, Promise<any>> = new Map();
  private suppressedCalls: number = 0; // Đếm số lời gọi bị chặn lại và gom nhóm

  async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Nếu đã có 1 request đang chạy cho key này:
    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      this.suppressedCalls++;
      // Đợi chung kết quả với request đầu tiên
      return existingPromise as Promise<T>;
    }

    // Nếu là request đầu tiên: Tạo Promise mới và lưu vào danh sách đang chạy
    const promise = (async () => {
      try {
        return await fn();
      } finally {
        // Dù thành công hay lỗi, luôn dọn dẹp key sau khi chạy xong
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  getSuppressedCount(): number {
    return this.suppressedCalls;
  }

  resetStats(): void {
    this.suppressedCalls = 0;
  }
}

export const singleflight = new SingleflightGroup();
