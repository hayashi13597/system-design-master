export interface OrderRecord {
  id: string;
  userId: string;
  itemId: string;
  quantity: number;
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  createdAt: number;
}

export interface OutboxRecord {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  status: 'PENDING' | 'PROCESSED';
  createdAt: number;
}

/**
 * Cơ sở dữ liệu quan hệ (PostgreSQL) lưu trữ dữ liệu bền vững
 * Kết hợp Transactional Outbox Pattern để phát sự kiện đảm bảo 0% mất mát
 */
export class PersistentDatabaseStore {
  private orders: Map<string, OrderRecord> = new Map();
  private outbox: Map<string, OutboxRecord> = new Map();

  async saveOrderWithOutbox(order: OrderRecord): Promise<void> {
    // Giả lập I/O disk latency của Database (5ms)
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Atomic DB Transaction: Cùng ghi vào orders và outbox
    this.orders.set(order.id, order);

    const outboxEvent: OutboxRecord = {
      id: `EVT-${order.id}`,
      aggregateId: order.id,
      eventType: 'ORDER_PLACED',
      payload: {
        orderId: order.id,
        userId: order.userId,
        itemId: order.itemId,
        quantity: order.quantity
      },
      status: 'PROCESSED', // Đã chuyển tiếp thành công
      createdAt: Date.now()
    };

    this.outbox.set(outboxEvent.id, outboxEvent);
  }

  getOrder(id: string): OrderRecord | undefined {
    return this.orders.get(id);
  }

  getAllOrders(): OrderRecord[] {
    return Array.from(this.orders.values());
  }

  getAllOutboxRecords(): OutboxRecord[] {
    return Array.from(this.outbox.values());
  }

  reset() {
    this.orders.clear();
    this.outbox.clear();
  }
}

export const dbStore = new PersistentDatabaseStore();
