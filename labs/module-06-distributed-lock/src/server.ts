import express, { Request, Response } from 'express';
import { inventory } from './inventory-store';
import { distributedLock } from './distributed-lock';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);

// 1. Xem trạng thái kho hàng và thống kê Khóa phân tán
app.get('/api/inventory', (req: Request, res: Response) => {
  res.json({
    inventory: inventory.getStats(),
    distributedLockStats: distributedLock.stats
  });
});

// 2. Reset kho về 5 sản phẩm
app.post('/api/inventory/reset', (req: Request, res: Response) => {
  inventory.reset();
  distributedLock.reset();
  res.json({
    message: 'Đã reset kho hàng về 5 sản phẩm và xóa sạch đơn hàng cũ!',
    inventory: inventory.getStats()
  });
});

// 3. Mua hàng KHÔNG DÙNG LOCK (Nguy cơ bán âm)
app.post('/api/buy/unsafe', async (req: Request, res: Response) => {
  const userId = (req.body.userId as string) || `user_${Math.floor(Math.random() * 1000)}`;

  try {
    const order = await inventory.unsafeBuy(userId);
    res.status(201).json({
      status: 'ORDER_SUCCESS',
      message: 'Đặt hàng thành công (Không có khóa bảo vệ)!',
      order
    });
  } catch (err: any) {
    res.status(409).json({
      status: 'ORDER_FAILED',
      error: err.message
    });
  }
});

// 4. Mua hàng VỚI DISTRIBUTED LOCK (Bảo vệ tuyệt đối)
app.post('/api/buy/locked', async (req: Request, res: Response) => {
  const userId = (req.body.userId as string) || `user_${Math.floor(Math.random() * 1000)}`;

  try {
    const order = await inventory.lockedBuy(userId);
    res.status(201).json({
      status: 'ORDER_SUCCESS',
      message: 'Đặt hàng thành công với Distributed Lock an toàn!',
      order
    });
  } catch (err: any) {
    res.status(409).json({
      status: 'ORDER_FAILED',
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`
===========================================================
  🔒 LAB 06: DISTRIBUTED LOCK & OVERSELLING DEFENSE RUNNING
  Cổng lắng nghe: http://localhost:${PORT}
  Xem kho hàng:   http://localhost:${PORT}/api/inventory
===========================================================
  `);
});
