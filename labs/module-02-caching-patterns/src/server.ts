import express, { Request, Response } from 'express';
import { db } from './mock-db';
import { cache } from './cache-service';
import { singleflight } from './singleflight';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);

// 1. Endpoint xem thông số trạng thái toàn hệ thống
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    database: db.getStats(),
    cache: cache.getStats(),
    singleflightSuppressedCalls: singleflight.getSuppressedCount()
  });
});

// 2. Endpoint đặt lại toàn bộ thông số
app.post('/api/reset', (req: Request, res: Response) => {
  db.resetStats();
  cache.flush();
  singleflight.resetStats();
  res.json({ message: 'Đã reset toàn bộ thông số Database và Cache!' });
});

// 3. KỊCH BẢN 1: KHÔNG DÙNG CACHE (100% đổ vào DB)
app.get('/api/products/no-cache/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const product = await db.getProductById(id);

  if (!product) {
    return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  }

  res.json({ source: 'DATABASE', data: product });
});

// 4. KỊCH BẢN 2: CACHE-ASIDE NGÂY THƠ (DỄ BỊ THUNDERING HERD / CACHE BREAKDOWN)
app.get('/api/products/naive/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const cacheKey = `product:${id}`;

  // Kiểm tra Cache
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return res.json({ source: 'CACHE', data: cachedData });
  }

  // Cache Miss! Nhiều request cùng lúc sẽ cùng chạy dòng này!
  const product = await db.getProductById(id);

  if (!product) {
    return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  }

  // Lưu vào Cache với TTL ngắn (2 giây) để dễ test hiện tượng hết hạn
  cache.set(cacheKey, product, 2);

  res.json({ source: 'DATABASE', data: product });
});

// 5. KỊCH BẢN 3: PHÒNG THỦ THUNDERING HERD VỚI SINGLEFLIGHT PATTERN
app.get('/api/products/singleflight/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const cacheKey = `product:${id}`;

  // 1. Kiểm tra Cache trước
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return res.json({ source: 'CACHE', data: cachedData });
  }

  // 2. Cache Miss: Sử dụng Singleflight để gom nhóm toàn bộ request đồng thời
  const product = await singleflight.do(cacheKey, async () => {
    // Double check: có thể request trước trong nhóm đã vừa cập nhật cache xong
    const rechecked = cache.get(cacheKey);
    if (rechecked) return rechecked;

    // Chỉ DUY NHẤT 1 request được thực thi câu query DB này
    const dbResult = await db.getProductById(id);
    if (dbResult) {
      cache.set(cacheKey, dbResult, 2); // TTL 2s
    }
    return dbResult;
  });

  if (!product) {
    return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  }

  res.json({ source: 'SINGLEFLIGHT_PROTECTED', data: product });
});

// 6. KỊCH BẢN 4: CACHE PENETRATION (THỦNG CACHE KHI ID KHÔNG TỒN TẠI)
// 6a. Dễ bị tấn công: ID không có thì không cache -> 100% query vào DB
app.get('/api/products/penetration-vulnerable/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const cacheKey = `product-vuln:${id}`;

  const cached = cache.get(cacheKey);
  if (cached) return res.json({ source: 'CACHE', data: cached });

  const product = await db.getProductById(id);
  if (!product) {
    // KHÔNG LƯU GÌ VÀO CACHE -> Request sau lại tiếp tục đâm vào DB!
    return res.status(404).json({ error: 'Sản phẩm không tồn tại' });
  }

  cache.set(cacheKey, product, 60);
  res.json({ source: 'DATABASE', data: product });
});

// 6b. Đã phòng thủ: Áp dụng Null Object Caching
app.get('/api/products/penetration-protected/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const cacheKey = `product-safe:${id}`;

  const cached = cache.get(cacheKey);
  if (cached !== null) {
    // Nếu là cờ đánh dấu không tồn tại
    if (cached === '__NULL_OBJECT__') {
      return res.status(404).json({ source: 'CACHE_NULL_OBJECT', error: 'Sản phẩm không tồn tại (Chặn từ Cache!)' });
    }
    return res.json({ source: 'CACHE', data: cached });
  }

  const product = await db.getProductById(id);
  if (!product) {
    // PHÒNG THỦ: Lưu giá trị Null Object với TTL ngắn (30s) để bảo vệ DB
    cache.set(cacheKey, '__NULL_OBJECT__', 30);
    return res.status(404).json({ source: 'DATABASE_FIRST_HIT', error: 'Sản phẩm không tồn tại' });
  }

  cache.set(cacheKey, product, 60);
  res.json({ source: 'DATABASE', data: product });
});

app.listen(PORT, () => {
  console.log(`
===========================================================
  🚀 LAB 02: CACHE DEEP-DIVE & DEFENSE SERVER ĐÃ KHỞI CHẠY!
  Cổng lắng nghe: http://localhost:${PORT}
  Kiểm tra thống kê: http://localhost:${PORT}/api/status
===========================================================
  `);
});
