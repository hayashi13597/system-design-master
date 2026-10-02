import { db } from './mock-db';
import { kafka } from './mock-kafka';

export interface RelayStats {
  pendingBefore: number;
  processedInThisBatch: number;
  failedInThisBatch: number;
  pendingRemaining: number;
}

/**
 * Outbox Relay (Polling Publisher / CDC Worker)
 * Chịu trách nhiệm quét bảng 'outbox' và chuyển tiếp các sự kiện PENDING sang Kafka
 * Đảm bảo ngữ nghĩa: At-least-once Delivery
 */
export class OutboxRelayWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;

  /**
   * Khởi chạy Relay quét ngầm theo chu kỳ
   */
  start(intervalMs: number = 300) {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      await this.pollAndRelay();
    }, intervalMs);
    console.log(`[OutboxRelay] 🚀 Worker đã khởi động (chu kỳ quét: ${intervalMs}ms)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log(`[OutboxRelay] 🛑 Worker đã dừng`);
    }
  }

  /**
   * Quét một batch các sự kiện PENDING và gửi sang Kafka
   */
  async pollAndRelay(batchSize: number = 50): Promise<RelayStats> {
    if (this.isProcessing) {
      return { pendingBefore: 0, processedInThisBatch: 0, failedInThisBatch: 0, pendingRemaining: 0 };
    }

    this.isProcessing = true;
    try {
      const pendingEvents = db.getPendingOutboxEvents().slice(0, batchSize);
      const pendingBefore = pendingEvents.length;
      let processedInThisBatch = 0;
      let failedInThisBatch = 0;

      for (const event of pendingEvents) {
        try {
          // Bắn sang Kafka với Key là AggregateId (Đảm bảo thứ tự theo Partition của Order)
          await kafka.produce('order-events', event.aggregateId, {
            ...event.payload,
            outboxEventId: event.id,
            relayedAt: Date.now()
          });

          // Đánh dấu đã gửi thành công trong DB
          db.markOutboxProcessed(event.id);
          processedInThisBatch++;
        } catch (err: any) {
          failedInThisBatch++;
          // Nếu Kafka bị lỗi (offline), dừng batch hiện tại để retry ở chu kỳ sau
          // Giữ nguyên trạng thái PENDING
          break;
        }
      }

      const pendingRemaining = db.getPendingOutboxEvents().length;
      return {
        pendingBefore,
        processedInThisBatch,
        failedInThisBatch,
        pendingRemaining
      };
    } finally {
      this.isProcessing = false;
    }
  }
}

export const outboxRelay = new OutboxRelayWorker();
