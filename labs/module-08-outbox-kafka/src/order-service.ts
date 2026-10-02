import { db, Order, OutboxEvent } from './mock-db';
import { kafka } from './mock-kafka';

export interface CreateOrderResult {
  orderId: string;
  strategy: 'NAIVE_DUAL_WRITE' | 'TRANSACTIONAL_OUTBOX';
  dbCommitted: boolean;
  eventPublishedToKafka: boolean;
  outboxPersisted: boolean;
  error?: string;
}

export class OrderService {
  /**
   * KỊCH BẢN 1: NAIVE DUAL-WRITE (LỖI THIẾT KẾ PHỔ BIẾN)
   * 1. Ghi đơn hàng vào Database
   * 2. Bắn Message trực tiếp sang Kafka
   * ⚠️ Vấn đề: Nếu Kafka sập hoặc mất mạng ở bước 2, Order đã nằm trong DB nhưng
   * Downstream Service (Kho, Thanh toán, Email) KHÔNG BAO GIỜ nhận được thông báo!
   */
  async createOrderNaive(userId: string, amount: number): Promise<CreateOrderResult> {
    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const order: Order = {
      id: orderId,
      userId,
      amount,
      status: 'CREATED',
      createdAt: Date.now()
    };

    // Bước 1: Ghi vào DB (Thành công)
    db.insertOrderDirect(order);
    const dbCommitted = true;

    // Bước 2: Bắn sang Kafka (Nếu broker sập -> Bị mất event vĩnh viễn!)
    let eventPublished = false;
    let errorMsg: string | undefined;

    try {
      await kafka.produce('order-events', order.id, {
        eventType: 'ORDER_CREATED',
        orderId: order.id,
        userId: order.userId,
        amount: order.amount,
        createdAt: order.createdAt
      });
      eventPublished = true;
    } catch (err: any) {
      errorMsg = err.message;
      // Dữ liệu trong DB đã commit, không thể tự động rollback nếu không có 2PC
      console.warn(`[OrderService - Naive] ❌ Dual-write thất bại! Order [${orderId}] đã lưu DB nhưng Kafka bị lỗi: ${err.message}`);
    }

    return {
      orderId,
      strategy: 'NAIVE_DUAL_WRITE',
      dbCommitted,
      eventPublishedToKafka: eventPublished,
      outboxPersisted: false,
      error: errorMsg
    };
  }

  /**
   * KỊCH BẢN 2: TRANSACTIONAL OUTBOX PATTERN (CHUẨN KIẾN TRÚC ENTERPRISE)
   * 1. Bắt đầu ACID Database Transaction
   * 2. Ghi Order vào bảng 'orders'
   * 3. Ghi Sự kiện tương ứng vào bảng 'outbox' (Trạng thái: PENDING)
   * 4. COMMIT cả 2 bảng cùng một lúc (Atomic 100%)
   * 👉 Dù Kafka có sập 3 ngày, dữ liệu trong Outbox vẫn an toàn và sẽ được Relay gửi bù khi Kafka phục hồi!
   */
  async createOrderOutbox(userId: string, amount: number): Promise<CreateOrderResult> {
    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const eventId = `EVT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const order: Order = {
      id: orderId,
      userId,
      amount,
      status: 'CREATED',
      createdAt: Date.now()
    };

    const outboxEvent: OutboxEvent = {
      id: eventId,
      aggregateId: orderId,
      eventType: 'ORDER_CREATED',
      payload: {
        orderId: order.id,
        userId: order.userId,
        amount: order.amount,
        createdAt: order.createdAt
      },
      status: 'PENDING',
      createdAt: Date.now()
    };

    // Thực hiện trong một Database Transaction duy nhất
    await db.withTransaction(async (tx) => {
      tx.insertOrder(order);
      tx.insertOutbox(outboxEvent);
    });

    return {
      orderId,
      strategy: 'TRANSACTIONAL_OUTBOX',
      dbCommitted: true,
      eventPublishedToKafka: false, // Sẽ do Relay đảm bảo sau (Asynchronous)
      outboxPersisted: true
    };
  }
}

export const orderService = new OrderService();
