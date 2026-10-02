export interface QueueMessage {
  id: string;
  payload: any;
  retryCount: number;
  errorReason?: string;
  publishedAt: number;
}

export type MessageHandler = (msg: QueueMessage) => Promise<void>;

/**
 * Message Broker mô phỏng cơ chế của RabbitMQ / AWS SQS:
 * - Hàng đợi chính (Main Queue)
 * - Hàng đợi chết (Dead Letter Queue - DLQ)
 * - Cơ chế ACK / NACK
 * - Exponential Backoff Retry (Tối đa 3 lần)
 */
export class MessageBroker {
  private mainQueue: QueueMessage[] = [];
  private deadLetterQueue: QueueMessage[] = [];
  private handler: MessageHandler | null = null;
  private isProcessing: boolean = false;
  private maxRetries: number = 3;

  public stats = {
    totalPublished: 0,
    totalProcessed: 0,
    totalRetries: 0,
    totalDeadLettered: 0
  };

  // Đăng ký Consumer lắng nghe hàng đợi
  subscribe(handler: MessageHandler) {
    this.handler = handler;
    this.processNext();
  }

  // Đẩy tin nhắn vào Hàng đợi chính (Publisher)
  async publish(payload: any): Promise<string> {
    const id = `MSG-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const msg: QueueMessage = {
      id,
      payload,
      retryCount: 0,
      publishedAt: Date.now()
    };

    this.mainQueue.push(msg);
    this.stats.totalPublished++;

    // Kích hoạt luồng xử lý bất đồng bộ
    setImmediate(() => this.processNext());
    return id;
  }

  // Xác nhận tin nhắn đã xử lý thành công (ACK)
  ack(msg: QueueMessage) {
    this.stats.totalProcessed++;
  }

  // Từ chối tin nhắn do lỗi (NACK) -> Kích hoạt Retry hoặc chuyển sang DLQ
  nack(msg: QueueMessage, errorReason: string) {
    msg.retryCount++;
    msg.errorReason = errorReason;
    this.stats.totalRetries++;

    if (msg.retryCount < this.maxRetries) {
      // Exponential Backoff: Thử lại sau 40ms, 80ms, 160ms...
      const delayMs = 40 * Math.pow(2, msg.retryCount);
      console.log(`[Broker] ⚠️ Tin nhắn [${msg.id}] xử lý thất bại (Lần ${msg.retryCount}/${this.maxRetries}). Thử lại sau ${delayMs}ms...`);

      setTimeout(() => {
        this.mainQueue.push(msg);
        this.processNext();
      }, delayMs);
    } else {
      // VƯỢT QUÁ SỐ LẦN RETRY CHO PHÉP -> ĐẨY VÀO DEAD LETTER QUEUE (DLQ)!
      this.stats.totalDeadLettered++;
      this.deadLetterQueue.push(msg);
      console.error(`[Broker] ☠️ BÁO ĐỘNG ĐỎ: Tin nhắn [${msg.id}] đã vượt quá ${this.maxRetries} lần retry! ĐÃ CÁCH LY VÀO DEAD LETTER QUEUE (DLQ)! Lý do: ${errorReason}`);
    }
  }

  // Vòng lặp xử lý tin nhắn
  private async processNext() {
    if (this.isProcessing || !this.handler || this.mainQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const msg = this.mainQueue.shift()!;

    try {
      await this.handler(msg);
    } catch (err: any) {
      this.nack(msg, err.message);
    } finally {
      this.isProcessing = false;
      if (this.mainQueue.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }

  getStatus() {
    return {
      mainQueueSize: this.mainQueue.length,
      deadLetterQueueSize: this.deadLetterQueue.length,
      deadLetterMessages: this.deadLetterQueue.map(m => ({
        id: m.id,
        payload: m.payload,
        retries: m.retryCount,
        error: m.errorReason
      })),
      stats: this.stats
    };
  }

  reset() {
    this.mainQueue = [];
    this.deadLetterQueue = [];
    this.stats = {
      totalPublished: 0,
      totalProcessed: 0,
      totalRetries: 0,
      totalDeadLettered: 0
    };
  }
}

export const broker = new MessageBroker();
