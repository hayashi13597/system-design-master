import { distributedLock } from './distributed-lock';

export interface Order {
  orderId: string;
  userId: string;
  productId: string;
  remainingStockAfterBuy: number;
  fencingToken?: number;
  createdAt: number;
}

export class InventoryStore {
  public readonly productId: string = 'iphone-16-pro-flash-sale';
  private stock: number = 5; // Chỉ có đúng 5 sản phẩm trong kho!
  private orders: Order[] = [];
  public oversoldViolations: number = 0; // Đếm số lần bán âm kho

  // =========================================================================
  // 1. KỊCH BẢN NGUY HIỂM: MUA HÀNG KHÔNG CÓ LOCK (RACE CONDITION OVERSELLING)
  // =========================================================================
  async unsafeBuy(userId: string): Promise<Order> {
    // BƯỚC 1: Đọc tồn kho hiện tại
    const currentStock = this.stock;

    if (currentStock <= 0) {
      throw new Error('Sản phẩm đã hết hàng (Stock = 0)!');
    }

    // BƯỚC 2: Mô phỏng độ trễ kiểm tra thanh toán / thẻ tín dụng (15ms)
    // CẠM BẪY: Trong 15ms này, hàng chục request khác cùng đọc ra currentStock = 5!
    await new Promise(r => setTimeout(r, 15));

    // BƯỚC 3: Trừ tồn kho và tạo đơn hàng
    this.stock = this.stock - 1;

    if (this.stock < 0) {
      this.oversoldViolations++;
      console.warn(`[Overselling Danger] ⚠️ BÁN ÂM HÀNG TỒN KHO! Tồn kho hiện tại: ${this.stock}`);
    }

    const order: Order = {
      orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId,
      productId: this.productId,
      remainingStockAfterBuy: this.stock,
      createdAt: Date.now()
    };

    this.orders.push(order);
    return order;
  }

  // =========================================================================
  // 2. KỊCH BẢN AN TOÀN: MUA HÀNG BẢO VỆ BẰNG DISTRIBUTED LOCK
  // =========================================================================
  async lockedBuy(userId: string): Promise<Order> {
    const lockKey = `lock:product:${this.productId}`;

    // Sử dụng Distributed Lock bảo vệ Critical Section
    return await distributedLock.withLock(lockKey, 2000, async (ctx) => {
      // Bên trong Critical Section: Đảm bảo DUY NHẤT 1 request được kiểm tra và trừ kho tại một thời điểm
      if (this.stock <= 0) {
        throw new Error('Sản phẩm đã hết hàng (Stock = 0)!');
      }

      // Mô phỏng độ trễ I/O 10ms
      await new Promise(r => setTimeout(r, 10));

      this.stock = this.stock - 1;

      const order: Order = {
        orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId,
        productId: this.productId,
        remainingStockAfterBuy: this.stock,
        fencingToken: ctx.fencingToken,
        createdAt: Date.now()
      };

      this.orders.push(order);
      return order;
    });
  }

  getStats() {
    return {
      productId: this.productId,
      currentStock: this.stock,
      totalOrdersCreated: this.orders.length,
      oversoldViolations: this.oversoldViolations,
      isOversold: this.stock < 0
    };
  }

  reset() {
    this.stock = 5;
    this.orders = [];
    this.oversoldViolations = 0;
  }
}

export const inventory = new InventoryStore();
