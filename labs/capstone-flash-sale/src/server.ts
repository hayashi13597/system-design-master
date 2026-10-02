import express, { Request, Response } from 'express';
import { redisEngine } from './redis-inventory';
import { rateLimiter } from './rate-limiter';
import { orderQueue } from './order-queue';
import { dbStore } from './db-store';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);
const DEFAULT_ITEM = 'ticket_vip_blackpink';
const DEFAULT_INITIAL_STOCK = 50;

// 1. Pre-warm tồn kho trước giờ mở bán
redisEngine.initStock(DEFAULT_ITEM, DEFAULT_INITIAL_STOCK);

// 2. Khởi chạy hàng đợi bất đồng bộ
orderQueue.startWorker(20);

// Endpoint 1: Mua vé Flash Sale (Tích hợp trọn vẹn Phễu Lọc Tải Đa Tầng)
app.post('/api/flash-sale/buy', (req: Request, res: Response): any => {
  const { userId, itemId = DEFAULT_ITEM, quantity = 1 } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  // TẦNG 1: Rate Limiter (Chống spam và botnet click dồn dập)
  const rateLimitKey = `${req.ip || '127.0.0.1'}_${userId}`;
  const rateCheck = rateLimiter.isAllowed(rateLimitKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'TOO_MANY_REQUESTS',
      message: 'Bạn đang thao tác quá nhanh! Vui lòng thử lại sau giây lát.'
    });
  }

  // TẦNG 2: In-Memory Redis Atomic Lua Pre-deduction (Xử lý trong 1ms)
  const deductResult = redisEngine.atomicDeduct(itemId, userId, quantity);

  if (deductResult.status === 'ALREADY_PURCHASED') {
    return res.status(409).json({
      error: 'ALREADY_PURCHASED',
      message: deductResult.message,
      remainingStock: deductResult.remainingStock
    });
  }

  if (deductResult.status === 'OUT_OF_STOCK') {
    return res.status(400).json({
      error: 'OUT_OF_STOCK',
      message: deductResult.message,
      remainingStock: 0
    });
  }

  // TẦNG 3: Đẩy đơn vào Hàng đợi Bất đồng bộ (Peak Shaving Buffer)
  const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  orderQueue.enqueue({
    orderId,
    userId,
    itemId,
    quantity,
    timestamp: Date.now()
  });

  // PHẢN HỒI NHANH 202 ACCEPTED (Client không cần đợi DB disk write)
  return res.status(202).json({
    success: true,
    orderId,
    status: 'PROCESSING',
    remainingStock: deductResult.remainingStock,
    message: deductResult.message
  });
});

// Endpoint 2: Truy vấn thông tin sản phẩm và tồn kho
app.get('/api/flash-sale/product/:itemId', (req: Request, res: Response) => {
  const itemId = req.params.itemId as string;
  const stock = redisEngine.getStock(itemId);
  const buyersCount = redisEngine.getBuyersCount(itemId);

  res.json({
    itemId,
    remainingStock: stock,
    successfulBuyers: buyersCount,
    status: stock > 0 ? 'AVAILABLE' : 'SOLD_OUT'
  });
});

// Endpoint 3: Polling trạng thái đơn hàng từ Client
app.get('/api/flash-sale/order/:orderId', (req: Request, res: Response): any => {
  const orderId = req.params.orderId as string;
  const orderInDb = dbStore.getOrder(orderId);

  if (orderInDb) {
    return res.json({
      orderId,
      status: 'CONFIRMED',
      details: orderInDb
    });
  }

  // Nếu chưa có trong DB, kiểm tra xem có đang nằm trong Queue Buffer không
  return res.json({
    orderId,
    status: 'PROCESSING',
    message: 'Đơn hàng đang được xếp hàng xử lý ghi đĩa...'
  });
});

// Endpoint 4: Giám sát toàn bộ chỉ số hệ thống (Telemetry Dashboard)
app.get('/api/system/status', (req: Request, res: Response) => {
  const itemId = (req.query.itemId as string) || DEFAULT_ITEM;
  const queueStats = orderQueue.getStats();
  const dbOrders = dbStore.getAllOrders();
  const outboxEvents = dbStore.getAllOutboxRecords();

  res.json({
    inventory: {
      itemId,
      redisStock: redisEngine.getStock(itemId),
      redisBuyersCount: redisEngine.getBuyersCount(itemId)
    },
    rateLimiter: {
      blockedRequests: rateLimiter.getTotalBlocked()
    },
    queueBuffer: queueStats,
    database: {
      totalOrdersCommitted: dbOrders.length,
      outboxEventsEmitted: outboxEvents.length
    }
  });
});

// Endpoint 5: Reset hệ thống về trạng thái ban đầu sạch
app.post('/api/system/reset', (req: Request, res: Response) => {
  const { initialStock = DEFAULT_INITIAL_STOCK } = req.body;
  redisEngine.reset();
  rateLimiter.reset();
  orderQueue.reset();
  dbStore.reset();

  redisEngine.initStock(DEFAULT_ITEM, initialStock);
  res.json({
    message: `System reset complete. Initial stock set to ${initialStock}.`
  });
});

app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 CAPSTONE FLASH SALE SERVER ĐANG CHẠY TẠI CỔNG :${PORT}`);
  console.log(`   - POST /api/flash-sale/buy   (Đặt vé Flash Sale)`);
  console.log(`   - GET  /api/system/status    (Bảng điều khiển Giám sát)`);
  console.log(`===========================================================`);
});
