import express, { Request, Response } from 'express';
import { broker } from './message-broker';
import { consumer } from './idempotent-consumer';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);

// 1. Xem số dư tài khoản và lịch sử Idempotency
app.get('/api/account', (req: Request, res: Response) => {
  res.json(consumer.getStats());
});

// 2. Xem trạng thái Hàng đợi (Main Queue & Dead Letter Queue)
app.get('/api/queue/status', (req: Request, res: Response) => {
  res.json(broker.getStatus());
});

// 3. Webhook thanh toán (Mô phỏng Stripe/VNPay gửi thông báo bất đồng bộ)
app.post('/api/webhooks/payment', async (req: Request, res: Response) => {
  const { idempotencyKey, amount, userId } = req.body;

  if (!idempotencyKey || !amount) {
    return res.status(400).json({ error: 'Thiếu idempotencyKey hoặc amount!' });
  }

  // Đẩy tin nhắn vào Queue (mất chưa tới 2ms) và phản hồi ngay 202 Accepted
  const messageId = await broker.publish({
    idempotencyKey,
    userId: userId || 'user_1',
    amount: parseInt(amount, 10)
  });

  res.status(202).json({
    status: 'ACCEPTED',
    message: 'Webhook thanh toán đã được tiếp nhận và đưa vào hàng đợi xử lý bất đồng bộ!',
    messageId,
    idempotencyKey
  });
});

// 4. Webhook gửi tin nhắn Độc hại (Poison Message để test Dead Letter Queue)
app.post('/api/webhooks/poison-message', async (req: Request, res: Response) => {
  const { idempotencyKey } = req.body;

  const messageId = await broker.publish({
    idempotencyKey: idempotencyKey || `POISON-${Date.now()}`,
    userId: 'hacker_bot',
    amount: -999999, // Số tiền âm hoặc dữ liệu hỏng
    isPoison: true
  });

  res.status(202).json({
    status: 'ACCEPTED',
    message: 'Tin nhắn độc hại đã được gửi vào Queue. Hệ thống sẽ retry 3 lần rồi cách ly vào DLQ!',
    messageId
  });
});

// 5. Reset toàn bộ hệ thống
app.post('/api/reset', (req: Request, res: Response) => {
  broker.reset();
  consumer.reset();
  res.json({ message: 'Đã reset tài khoản và làm sạch toàn bộ hàng đợi!' });
});

app.listen(PORT, () => {
  console.log(`
===========================================================
  📬 LAB 07: MESSAGE QUEUE & IDEMPOTENCY SERVER RUNNING
  Cổng lắng nghe:    http://localhost:${PORT}
  Xem số dư ví:      http://localhost:${PORT}/api/account
  Xem hàng đợi/DLQ:  http://localhost:${PORT}/api/queue/status
===========================================================
  `);
});
