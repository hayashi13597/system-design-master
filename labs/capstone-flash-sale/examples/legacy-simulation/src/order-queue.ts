import { dbStore, OrderRecord } from './db-store';

export interface QueuedOrder {
  orderId: string;
  userId: string;
  itemId: string;
  quantity: number;
  timestamp: number;
}

/**
 * Hàng đợi Bất đồng bộ (Message Queue / Kafka Buffer - Tầng 4)
 * Trách nhiệm: Hấp thụ đỉnh tải tức thì (Peak Shaving) và dàn phẳng tải ghi đĩa xuống Database
 */
export class AsynchronousOrderQueue {
  private queue: QueuedOrder[] = [];
  private isProcessing: boolean = false;
  private enqueuedCount: number = 0;
  private processedCount: number = 0;
  private timer: NodeJS.Timeout | null = null;

  startWorker(pollIntervalMs: number = 50) {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      await this.processNextBatch();
    }, pollIntervalMs);
  }

  stopWorker() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Đẩy đơn hàng vào hàng đợi (Thực thi trong 0.1ms, không nghẽn luồng)
   */
  enqueue(order: QueuedOrder): void {
    this.queue.push(order);
    this.enqueuedCount++;
  }

  /**
   * Worker nền lấy đơn hàng từ Queue ghi vào Persistent DB theo lô
   */
  private async processNextBatch(batchSize: number = 10): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    try {
      const batch = this.queue.splice(0, batchSize);
      for (const item of batch) {
        const record: OrderRecord = {
          id: item.orderId,
          userId: item.userId,
          itemId: item.itemId,
          quantity: item.quantity,
          status: 'PENDING_PAYMENT',
          createdAt: item.timestamp
        };

        // Ghi xuống DB qua Transactional Outbox
        await dbStore.saveOrderWithOutbox(record);
        this.processedCount++;
      }
    } catch (err) {
      console.error('[OrderQueue] ❌ Lỗi xử lý đơn hàng trong hàng đợi:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  getStats() {
    return {
      enqueuedCount: this.enqueuedCount,
      processedCount: this.processedCount,
      currentDepth: this.queue.length
    };
  }

  reset() {
    this.queue = [];
    this.enqueuedCount = 0;
    this.processedCount = 0;
  }
}

export const orderQueue = new AsynchronousOrderQueue();
