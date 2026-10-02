import { broker, QueueMessage } from './message-broker';

export interface PaymentPayload {
  idempotencyKey: string;
  userId: string;
  amount: number;
  isPoison?: boolean;
}

export class IdempotentConsumer {
  private userBalance: number = 0;
  // Bảng lưu trữ Idempotency Key (Tương đương Redis SET hoặc Unique Table trong PostgreSQL)
  private processedKeys: Map<string, { amount: number; processedAt: number }> = new Map();
  public duplicatesPrevented: number = 0;

  constructor() {
    // Đăng ký nhận tin nhắn từ Broker
    broker.subscribe(this.handleMessage.bind(this));
  }

  async handleMessage(msg: QueueMessage): Promise<void> {
    const payload = msg.payload as PaymentPayload;
    const { idempotencyKey, amount, isPoison } = payload;

    // 1. KIỂM TRA POISON MESSAGE (Mô phỏng tin nhắn có độc gây lỗi code/DB)
    if (isPoison || amount <= 0) {
      throw new Error(`[PoisonMessage] Số tiền không hợp lệ hoặc dữ liệu độc hại (${amount})!`);
    }

    // 2. KIỂM TRA TÍNH BẤT BIẾN (IDEMPOTENCY CHECK)
    if (this.processedKeys.has(idempotencyKey)) {
      this.duplicatesPrevented++;
      console.log(`[IdempotentConsumer] 🛡️ PHÁT HIỆN TIN NHẮN TRÙNG LẶP! Key: [${idempotencyKey}]. BỎ QUA KHÔNG CỘNG TIỀN LẦN 2!`);
      // Gửi ACK ngay để loại bỏ tin nhắn trùng lặp khỏi hàng đợi
      broker.ack(msg);
      return;
    }

    // Mô phỏng thời gian xử lý ghi Database 10ms
    await new Promise(r => setTimeout(r, 10));

    // 3. THỰC HIỆN NGHIỆP VỤ: CỘNG TIỀN VÀO TÀI KHOẢN
    this.userBalance += amount;

    // 4. LƯU LẠI IDEMPOTENCY KEY ĐỂ BẢO VỆ CÁC LẦN GỌI SAU
    this.processedKeys.set(idempotencyKey, {
      amount,
      processedAt: Date.now()
    });

    console.log(`[IdempotentConsumer] 💰 Nạp tiền thành công! +${amount.toLocaleString()}đ | Số dư mới: ${this.userBalance.toLocaleString()}đ (Key: ${idempotencyKey})`);
    broker.ack(msg);
  }

  getBalance(): number {
    return this.userBalance;
  }

  getStats() {
    return {
      currentBalance: this.userBalance,
      totalUniqueTransactions: this.processedKeys.size,
      duplicatesPrevented: this.duplicatesPrevented,
      processedKeys: Array.from(this.processedKeys.keys())
    };
  }

  reset() {
    this.userBalance = 0;
    this.processedKeys.clear();
    this.duplicatesPrevented = 0;
  }
}

export const consumer = new IdempotentConsumer();
