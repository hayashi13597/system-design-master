import express, { Request, Response } from 'express';
import { shardedRouter } from './sharded-router';
import { cluster } from './shard-cluster';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);

// 1. Xem thống kê phân bổ dữ liệu giữa các Shards
app.get('/api/cluster/distribution', (req: Request, res: Response) => {
  res.json(cluster.getDistributionStats());
});

// 2. Tạo User mới (Ghi có Sharding + Snowflake ID)
app.post('/api/users', async (req: Request, res: Response) => {
  const { name, email } = req.body;
  const result = await shardedRouter.createUser(
    name || 'Anonymous User',
    email || `user_${Date.now()}@example.com`
  );

  res.status(201).json({
    message: 'Tạo user thành công!',
    user: result.user,
    routedToShard: result.targetShard,
    snowflakeMetadata: result.parsedId
  });
});

// 3. Đọc User theo ID (Point Query: O(1) định tuyến thẳng vào 1 Shard)
app.get('/api/users/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await shardedRouter.getUserById(id);

  if (!result.user) {
    return res.status(404).json({
      error: 'Không tìm thấy user',
      queriedShard: result.queriedShard
    });
  }

  res.json({
    user: result.user,
    queriedShard: result.queriedShard,
    routingType: 'POINT_QUERY_SINGLE_SHARD'
  });
});

// 4. Đọc toàn bộ Users (Scatter-Gather: Bắn query song song tới tất cả Shards)
app.get('/api/users', async (req: Request, res: Response) => {
  const result = await shardedRouter.getAllUsers();
  res.json({
    totalUsers: result.users.length,
    totalShardsQueried: result.totalShardsQueried,
    routingType: 'SCATTER_GATHER_ALL_SHARDS',
    users: result.users
  });
});

// 5. Thêm Shard mới vào cụm (Dynamic Scaling)
app.post('/api/cluster/add-shard', (req: Request, res: Response) => {
  const { shardName } = req.body;
  const name = shardName || `shard-0${cluster.getAllShards().length + 1}`;

  shardedRouter.addNewShard(name);

  res.json({
    message: `Đã bổ sung thành công ${name} vào cụm Shards và cập nhật Consistent Hash Ring!`,
    currentShards: shardedRouter.ring.getNodes()
  });
});

// 6. Nạp dữ liệu mẫu để quan sát phân bổ đồng đều
app.post('/api/cluster/seed', async (req: Request, res: Response) => {
  const count = parseInt(req.body.count || '300', 10);
  const startTime = Date.now();

  for (let i = 1; i <= count; i++) {
    await shardedRouter.createUser(`User #${i}`, `user${i}@domain.com`);
  }

  const durationMs = Date.now() - startTime;
  res.json({
    message: `Đã nạp thành công ${count} users vào cụm Database!`,
    durationMs,
    distribution: cluster.getDistributionStats()
  });
});

// 7. Xóa sạch dữ liệu
app.post('/api/cluster/reset', (req: Request, res: Response) => {
  cluster.clearAll();
  res.json({ message: 'Đã xóa sạch dữ liệu trên toàn bộ các Shards!' });
});

app.listen(PORT, () => {
  console.log(`
===========================================================
  🌐 LAB 05: SHARDING & CONSISTENT HASHING CLUSTER RUNNING
  Cổng lắng nghe: http://localhost:${PORT}
  Xem phân bổ: http://localhost:${PORT}/api/cluster/distribution
===========================================================
  `);
});
