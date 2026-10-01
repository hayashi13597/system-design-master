import express, { Request, Response } from 'express';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);
const INSTANCE_ID = process.env.INSTANCE_ID || `app-node-${PORT}`;

// Mô phỏng trạng thái sức khỏe của node (Healthy vs Unhealthy)
let isHealthy = true;

// Mô phỏng trạng thái lưu trong RAM (Stateful Anti-pattern)
let inMemoryCounter = 0;

// 1. Endpoint thông tin node (Stateless)
app.get('/api/info', (req: Request, res: Response) => {
  res.json({
    message: 'Hello from backend instance!',
    instanceId: INSTANCE_ID,
    pid: process.pid,
    port: PORT,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    }
  });
});

// 2. Endpoint tác vụ nặng CPU (để test tải và so sánh 1 node vs cụm 3 node)
app.get('/api/cpu-task', (req: Request, res: Response) => {
  const iterations = parseInt(req.query.iterations as string || '2000000', 10);
  const startTime = Date.now();

  // Tác vụ tính toán toán học làm nghẽn CPU (blocking Event Loop tạm thời)
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += Math.sqrt(i) * Math.sin(i);
  }

  const durationMs = Date.now() - startTime;

  res.json({
    instanceId: INSTANCE_ID,
    durationMs,
    iterations,
    result: sum.toFixed(2)
  });
});

// 3. Endpoint minh họa Anti-pattern: Lưu State trong bộ nhớ RAM
app.post('/api/stateful/increment', (req: Request, res: Response) => {
  inMemoryCounter++;
  res.json({
    warning: 'Đây là Stateful Anti-pattern! Giá trị counter phụ thuộc vào máy chủ nhận request!',
    instanceId: INSTANCE_ID,
    localNodeCounter: inMemoryCounter
  });
});

// 4. Endpoint Health Check (cho Load Balancer giám sát)
app.get('/health', (req: Request, res: Response) => {
  if (!isHealthy) {
    return res.status(503).json({
      status: 'DOWN',
      instanceId: INSTANCE_ID,
      error: 'Node is currently unhealthy / degraded'
    });
  }

  res.status(200).json({
    status: 'UP',
    instanceId: INSTANCE_ID,
    timestamp: new Date().toISOString()
  });
});

// 5. Endpoint mô phỏng sự cố (Chaos Engineering / Failover test)
app.post('/api/simulate-crash', (req: Request, res: Response) => {
  isHealthy = false;
  console.log(`[${INSTANCE_ID}] ⚠️ Đã kích hoạt mô phỏng lỗi! Node chuyển sang trạng thái 503 UNHEALTHY.`);
  res.json({
    message: `Node ${INSTANCE_ID} đã chuyển sang trạng thái không khỏe mạnh (503). Load Balancer sẽ tự động cách ly node này!`,
    instanceId: INSTANCE_ID,
    healthStatus: 'DOWN'
  });
});

// 6. Endpoint phục hồi lại node
app.post('/api/simulate-recover', (req: Request, res: Response) => {
  isHealthy = true;
  console.log(`[${INSTANCE_ID}] ✅ Đã phục hồi node! Node chuyển sang trạng thái 200 HEALTHY.`);
  res.json({
    message: `Node ${INSTANCE_ID} đã phục hồi (200 OK). Load Balancer sẽ đưa node trở lại danh sách phân phối tải!`,
    instanceId: INSTANCE_ID,
    healthStatus: 'UP'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 [${INSTANCE_ID}] đang chạy tại http://localhost:${PORT}`);
});
