import express from 'express';
import { db } from './mock-db.js';
import { kafka } from './mock-kafka.js';
import { orderService } from './order-service.js';
import { outboxRelay } from './outbox-relay.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Khởi chạy ngầm Outbox Relay
outboxRelay.start(500);

// Endpoint 1: Tạo Order theo Naive Dual-Write (Dễ mất event khi Kafka lỗi)
app.post('/api/orders/naive', async (req, res) => {
  const { userId = 'user_1', amount = 100 } = req.body;
  const result = await orderService.createOrderNaive(userId, amount);
  res.status(result.eventPublishedToKafka ? 201 : 200).json(result);
});

// Endpoint 2: Tạo Order theo Transactional Outbox (Atomicity 100%)
app.post('/api/orders/outbox', async (req, res) => {
  const { userId = 'user_1', amount = 100 } = req.body;
  const result = await orderService.createOrderOutbox(userId, amount);
  res.status(201).json(result);
});

// Endpoint 3: Bật / Tắt Kafka Broker (Mô phỏng sự cố Broker Down)
app.post('/api/kafka/toggle', (req, res) => {
  const { online } = req.body;
  const targetStatus = typeof online === 'boolean' ? online : !kafka.getOnlineStatus();
  kafka.setOnline(targetStatus);
  res.json({
    kafkaOnline: kafka.getOnlineStatus(),
    message: `Kafka hiện đang ${kafka.getOnlineStatus() ? 'ONLINE' : 'OFFLINE'}`
  });
});

// Endpoint 4: Kích hoạt thủ công Outbox Relay quét bù dữ liệu
app.post('/api/relay/trigger', async (req, res) => {
  const stats = await outboxRelay.pollAndRelay();
  res.json({
    message: 'Outbox Relay triggered',
    stats
  });
});

// Endpoint 5: Lấy toàn bộ trạng thái hệ thống để đo kiểm
app.get('/api/system/status', (req, res) => {
  const orders = db.getOrders();
  const allOutbox = db.getAllOutboxEvents();
  const pendingOutbox = db.getPendingOutboxEvents();
  const kafkaRecords = kafka.getTopicRecords('order-events');

  res.json({
    kafkaOnline: kafka.getOnlineStatus(),
    ordersCount: orders.length,
    outbox: {
      total: allOutbox.length,
      pending: pendingOutbox.length,
      processed: allOutbox.length - pendingOutbox.length
    },
    kafka: {
      recordsCount: kafkaRecords.length,
      records: kafkaRecords
    }
  });
});

// Endpoint 6: Reset toàn bộ dữ liệu sạch
app.post('/api/system/reset', (req, res) => {
  db.reset();
  kafka.reset();
  res.json({ message: 'System state reset to clean initial condition.' });
});

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 MODULE 08 LAB SERVER ĐANG CHẠY TẠI CỔNG :${PORT}`);
  console.log(`   - POST /api/orders/naive   (Tạo đơn Naive Dual-Write)`);
  console.log(`   - POST /api/orders/outbox  (Tạo đơn Transactional Outbox)`);
  console.log(`   - POST /api/kafka/toggle   (Mô phỏng sập / bật Kafka)`);
  console.log(`   - GET  /api/system/status  (Kiểm tra trạng thái DB & Kafka)`);
  console.log(`===========================================================`);
});
