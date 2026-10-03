export interface Order {
  id: string;
  userId: string;
  amount: number;
  status: 'CREATED' | 'CANCELLED';
  createdAt: number;
}

export interface OutboxEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  status: 'PENDING' | 'PROCESSED';
  createdAt: number;
  processedAt?: number;
}

/**
 * Giả lập Cơ sở dữ liệu quan hệ (PostgreSQL) hỗ trợ Transaction (ACID)
 */
export class MockDatabase {
  private orders: Map<string, Order> = new Map();
  private outbox: Map<string, OutboxEvent> = new Map();

  // Bắt đầu một Transaction cục bộ đảm bảo Atomicity (Cùng thành công hoặc cùng rollback)
  async withTransaction<T>(
    fn: (tx: {
      insertOrder: (order: Order) => void;
      insertOutbox: (event: OutboxEvent) => void;
    }) => Promise<T>
  ): Promise<T> {
    // Stage buffer lưu tạm dữ liệu trước khi Commit
    const stagedOrders: Order[] = [];
    const stagedOutbox: OutboxEvent[] = [];

    try {
      const result = await fn({
        insertOrder: (order) => stagedOrders.push(order),
        insertOutbox: (event) => stagedOutbox.push(event)
      });

      // COMMIT TRANSACTION: Lưu đồng thời vào cả 2 bảng
      for (const o of stagedOrders) {
        this.orders.set(o.id, o);
      }
      for (const e of stagedOutbox) {
        this.outbox.set(e.id, e);
      }

      return result;
    } catch (err) {
      // ROLLBACK: Bỏ qua toàn bộ dữ liệu staged buffer
      console.warn('[Database] ⚠️ TRANSACTION ROLLBACK! Không có dữ liệu nào được ghi.');
      throw err;
    }
  }

  // Ghi đơn lẻ không có transaction (cho kịch bản Naive)
  insertOrderDirect(order: Order): void {
    this.orders.set(order.id, order);
  }

  getOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  getPendingOutboxEvents(): OutboxEvent[] {
    return Array.from(this.outbox.values()).filter(e => e.status === 'PENDING');
  }

  getAllOutboxEvents(): OutboxEvent[] {
    return Array.from(this.outbox.values());
  }

  markOutboxProcessed(eventId: string) {
    const e = this.outbox.get(eventId);
    if (e) {
      e.status = 'PROCESSED';
      e.processedAt = Date.now();
    }
  }

  reset() {
    this.orders.clear();
    this.outbox.clear();
  }
}

export const db = new MockDatabase();
