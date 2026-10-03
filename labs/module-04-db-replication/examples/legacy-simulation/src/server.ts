import express, { Request, Response } from 'express';
import { primaryDb } from './db-cluster';
import { naiveRouter, consistentRouter } from './smart-router';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);

// 1. Endpoint kiểm tra trạng thái cụm Database Cluster & Replication Lag
app.get('/api/cluster/status', (req: Request, res: Response) => {
  const replicas = primaryDb.getReplicas().map(r => ({
    name: r.name,
    configuredLagMs: r.replicationLagMs,
    appliedLsn: r.appliedLsn,
    lagInLsn: primaryDb.currentLsn - r.appliedLsn
  }));

  res.json({
    primary: {
      name: 'Primary Database (Master)',
      currentLsn: primaryDb.currentLsn
    },
    replicas
  });
});

// 2. Endpoint cập nhật Profile (Ghi vào Primary)
app.post('/api/users/:id/bio', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { bio, callerUserId } = req.body;
  const userId = callerUserId || id;

  const result = await consistentRouter.write(userId, id, { bio });

  res.json({
    message: 'Cập nhật Bio thành công trên Primary DB!',
    newVersion: result.profile.version,
    newBio: result.profile.bio,
    lsn: result.lsn
  });
});

// 3. Endpoint đọc dữ liệu bằng NAIVE ROUTER (DỄ BỊ STALE READ DO REPLICATION LAG)
app.get('/api/naive/users/:id/bio', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const expectedVersion = req.query.expectedVersion ? parseInt(req.query.expectedVersion as string, 10) : undefined;
  const callerUserId = (req.query.callerUserId as string) || id;

  const result = await naiveRouter.read(callerUserId, id, expectedVersion);

  res.json({
    router: 'NaiveRouter (Pure Round-Robin to Replicas)',
    servedBy: result.servedBy,
    isStale: result.isStale,
    expectedVersion: result.expectedVersion,
    actualVersion: result.data ? result.data.version : 0,
    bio: result.data ? result.data.bio : null
  });
});

// 4. Endpoint đọc dữ liệu bằng CONSISTENT ROUTER (READ-YOUR-OWN-WRITES CONSISTENCY)
app.get('/api/consistent/users/:id/bio', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const expectedVersion = req.query.expectedVersion ? parseInt(req.query.expectedVersion as string, 10) : undefined;
  const callerUserId = (req.query.callerUserId as string) || id;

  const result = await consistentRouter.read(callerUserId, id, expectedVersion);

  res.json({
    router: 'ConsistentRouter (Smart Pinning & LSN Tracking)',
    servedBy: result.servedBy,
    isStale: result.isStale,
    expectedVersion: result.expectedVersion,
    actualVersion: result.data ? result.data.version : 0,
    bio: result.data ? result.data.bio : null
  });
});

// 5. Endpoint Transaction: Đặt hàng / Thanh toán (Bắt buộc chạy 100% trên Primary)
app.post('/api/orders/checkout', async (req: Request, res: Response) => {
  const result = await consistentRouter.withTransaction(async (tx) => {
    // Bước 1: Đọc số dư ví (trên Primary)
    const user = await tx.read('user_1');
    // Bước 2: Kiểm tra tồn kho & trừ số dư (trên Primary)
    // Bước 3: Tạo đơn hàng (trên Primary)
    return {
      status: 'ORDER_COMPLETED',
      executionNode: 'PRIMARY (Transaction guarantees Strong Consistency)',
      currentLsn: primaryDb.currentLsn
    };
  });

  res.json(result);
});

app.listen(PORT, () => {
  console.log(`
===========================================================
  🗄️ LAB 04: DB REPLICATION & READ/WRITE SPLITTING SERVER
  Cổng lắng nghe: http://localhost:${PORT}
  Trạng thái Cluster: http://localhost:${PORT}/api/cluster/status
===========================================================
  `);
});
