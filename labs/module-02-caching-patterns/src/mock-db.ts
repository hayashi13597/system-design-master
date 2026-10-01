export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

// Giả lập Database với Connection Pool có giới hạn (giống PostgreSQL / MySQL)
export class MockDatabase {
  private products: Map<string, Product> = new Map();
  private maxPoolSize: number = 8; // Tối đa 8 kết nối DB đồng thời
  private activeConnections: number = 0;
  private peakConnections: number = 0;
  private totalQueriesExecuted: number = 0;
  private simulatedDiskLatencyMs: number = 40; // Mỗi query mất 40ms I/O ổ đĩa

  constructor() {
    // Khởi tạo một số sản phẩm mẫu
    for (let i = 1; i <= 50; i++) {
      this.products.set(String(i), {
        id: String(i),
        name: `Sản phẩm cao cấp #${i}`,
        price: 199.99 * i,
        stock: 100,
        category: 'Electronics'
      });
    }
  }

  // Lấy sản phẩm từ DB với mô phỏng Connection Pool và Disk I/O
  async getProductById(id: string): Promise<Product | null> {
    // Nếu hết connection trong pool, request phải xếp hàng đợi (Queueing delay)
    while (this.activeConnections >= this.maxPoolSize) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    this.activeConnections++;
    this.totalQueriesExecuted++;
    if (this.activeConnections > this.peakConnections) {
      this.peakConnections = this.activeConnections;
    }

    try {
      // Mô phỏng thời gian đọc đĩa B-Tree / Network socket của DB
      await new Promise(resolve => setTimeout(resolve, this.simulatedDiskLatencyMs));

      const product = this.products.get(id);
      return product ? { ...product } : null;
    } finally {
      this.activeConnections--;
    }
  }

  // Thống kê tải của Database
  getStats() {
    return {
      totalQueriesExecuted: this.totalQueriesExecuted,
      activeConnections: this.activeConnections,
      peakConnections: this.peakConnections,
      maxPoolSize: this.maxPoolSize
    };
  }

  // Reset thống kê để chạy bài test mới
  resetStats() {
    this.totalQueriesExecuted = 0;
    this.peakConnections = 0;
    this.activeConnections = 0;
  }
}

export const db = new MockDatabase();
