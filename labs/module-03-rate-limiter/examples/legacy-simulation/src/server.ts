import express, { Request, Response, NextFunction } from 'express';
import { NaiveRateLimiter, AtomicSlidingWindowLimiter, TokenBucketLimiter, RateLimitResult } from './rate-limiter';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);

// Cấu hình giới hạn: Tối đa 25 requests / 1 giây (để dễ kiểm chứng khi bắn tải)
const LIMIT = 25;
const WINDOW_MS = 1000;

const naiveLimiter = new NaiveRateLimiter(LIMIT, WINDOW_MS);
const atomicLimiter = new AtomicSlidingWindowLimiter(LIMIT, WINDOW_MS);
const tokenBucketLimiter = new TokenBucketLimiter(LIMIT, 5); // Capacity 25, hồi 5 token/s

// Middleware gắn HTTP Headers chuẩn IETF
function applyRateLimitHeaders(res: Response, result: RateLimitResult) {
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', result.resetTime);
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfter);
  }
}

// 1. Endpoint không được bảo vệ (Unprotected)
app.get('/api/unprotected', (req: Request, res: Response) => {
  res.json({
    status: 'SUCCESS',
    message: 'Request được xử lý tự do, không có Rate Limiter bảo vệ.'
  });
});

// 2. Endpoint với Naive Rate Limiter (Bị lỗi Race Condition TOCTOU)
app.get('/api/vulnerable', async (req: Request, res: Response) => {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const result = await naiveLimiter.check(clientIp);
  applyRateLimitHeaders(res, result);

  if (!result.allowed) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Bạn đã vượt quá giới hạn ${LIMIT} req/s! Vui lòng thử lại sau ${result.retryAfter}s.`,
      limiter: 'NaiveNonAtomic'
    });
  }

  res.json({
    status: 'SUCCESS',
    message: 'Request hợp lệ!',
    remaining: result.remaining
  });
});

// 3. Endpoint với Atomic Sliding Window Limiter (Chuẩn Cloudflare - Bảo vệ nghiêm ngặt)
app.get('/api/atomic-sliding', (req: Request, res: Response) => {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const result = atomicLimiter.check(clientIp);
  applyRateLimitHeaders(res, result);

  if (!result.allowed) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Bảo vệ nghiêm ngặt: Đã vượt quá ${LIMIT} req/s! Vui lòng thử lại sau ${result.retryAfter}s.`,
      limiter: 'AtomicSlidingWindow'
    });
  }

  res.json({
    status: 'SUCCESS',
    message: 'Request hợp lệ!',
    remaining: result.remaining
  });
});

// 4. Endpoint với Token Bucket (Cho phép Burst)
app.get('/api/token-bucket', (req: Request, res: Response) => {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const result = tokenBucketLimiter.check(clientIp);
  applyRateLimitHeaders(res, result);

  if (!result.allowed) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Hết token trong thùng! Vui lòng đợi ${result.retryAfter}s để hồi token.`,
      limiter: 'TokenBucket'
    });
  }

  res.json({
    status: 'SUCCESS',
    message: 'Request hợp lệ (Đã tiêu thụ 1 token)!',
    remainingTokens: result.remaining
  });
});

// 5. Reset các limiters
app.post('/api/reset', (req: Request, res: Response) => {
  naiveLimiter.reset();
  atomicLimiter.reset();
  tokenBucketLimiter.reset();
  res.json({ message: 'Đã reset toàn bộ Rate Limiters!' });
});

app.listen(PORT, () => {
  console.log(`
===========================================================
  🛡️ LAB 03: DISTRIBUTED RATE LIMITER ĐÃ KHỞI CHẠY!
  Cổng lắng nghe: http://localhost:${PORT}
  Giới hạn cấu hình: ${LIMIT} requests / giây
===========================================================
  `);
});
