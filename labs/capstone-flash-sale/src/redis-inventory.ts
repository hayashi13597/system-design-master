export interface DeductResult {
  status: 'SUCCESS' | 'OUT_OF_STOCK' | 'ALREADY_PURCHASED';
  remainingStock: number;
  message: string;
}

/**
 * Giả lập Redis In-Memory Engine với LUA Script thực thi Nguyên tử (Atomic)
 * Đảm bảo: 
 * 1. Kiểm tra tồn kho và trừ kho trong 1ms
 * 2. Mỗi user chỉ mua tối đa 1 vé (Chống bot và đầu cơ)
 * 3. Tuyệt đối không bao giờ xảy ra Race Condition bán âm kho
 */
export class RedisInventoryEngine {
  private stockMap: Map<string, number> = new Map();
  private buyersMap: Map<string, Set<string>> = new Map();

  /**
   * Khởi tạo tồn kho ảo trên Redis trước giờ Flash Sale (Pre-warming)
   */
  initStock(itemId: string, initialStock: number) {
    this.stockMap.set(itemId, initialStock);
    this.buyersMap.set(itemId, new Set());
    console.log(`[RedisEngine] 🔥 Pre-warmed tồn kho sản phẩm [${itemId}]: ${initialStock} chiếc.`);
  }

  /**
   * Mô phỏng LUA SCRIPT: Thực thi Atomic toàn bộ logic phán quyết
   */
  atomicDeduct(itemId: string, userId: string, quantity: number = 1): DeductResult {
    const buyers = this.buyersMap.get(itemId);
    if (!buyers) {
      return { status: 'OUT_OF_STOCK', remainingStock: 0, message: 'Sản phẩm không tồn tại trong phiên Flash Sale!' };
    }

    // 1. Kiểm tra User đã mua vé chưa (Chống đầu cơ / spam click)
    if (buyers.has(userId)) {
      const currentStock = this.stockMap.get(itemId) || 0;
      return {
        status: 'ALREADY_PURCHASED',
        remainingStock: currentStock,
        message: 'Mỗi tài khoản chỉ được phép mua tối đa 1 sản phẩm trong đợt Flash Sale!'
      };
    }

    // 2. Kiểm tra tồn kho hiện tại
    const currentStock = this.stockMap.get(itemId) || 0;
    if (currentStock < quantity) {
      return {
        status: 'OUT_OF_STOCK',
        remainingStock: currentStock,
        message: 'Rất tiếc! Vé Flash Sale đã được bán hết.'
      };
    }

    // 3. Trừ tồn kho và ghi nhận User đã mua (Atomic Execution)
    const newStock = currentStock - quantity;
    this.stockMap.set(itemId, newStock);
    buyers.add(userId);

    return {
      status: 'SUCCESS',
      remainingStock: newStock,
      message: 'Đặt chỗ thành công! Đang chuyển đơn hàng vào hàng đợi xử lý...'
    };
  }

  /**
   * Hoàn tồn kho (Compensation / Rollback) khi đơn hàng hết hạn thanh toán (TTL Timeout)
   */
  compensateStock(itemId: string, userId: string, quantity: number = 1) {
    const currentStock = this.stockMap.get(itemId) || 0;
    this.stockMap.set(itemId, currentStock + quantity);

    const buyers = this.buyersMap.get(itemId);
    if (buyers) {
      buyers.delete(userId);
    }
    console.log(`[RedisEngine] 🔄 Hoàn tồn kho: +${quantity} cho [${itemId}] do đơn hàng hết hạn. Tồn kho mới: ${currentStock + quantity}`);
  }

  getStock(itemId: string): number {
    return this.stockMap.get(itemId) || 0;
  }

  getBuyersCount(itemId: string): number {
    return this.buyersMap.get(itemId)?.size || 0;
  }

  reset() {
    this.stockMap.clear();
    this.buyersMap.clear();
  }
}

export const redisEngine = new RedisInventoryEngine();
