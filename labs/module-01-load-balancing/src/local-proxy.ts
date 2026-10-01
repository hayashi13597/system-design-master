import http from 'http';
import httpProxy from 'http-proxy';

interface BackendServer {
  url: string;
  name: string;
  isAlive: boolean;
  activeConnections: number;
}

const BACKENDS: BackendServer[] = [
  { url: 'http://127.0.0.1:3001', name: 'app-node-1', isAlive: true, activeConnections: 0 },
  { url: 'http://127.0.0.1:3002', name: 'app-node-2', isAlive: true, activeConnections: 0 },
  { url: 'http://127.0.0.1:3003', name: 'app-node-3', isAlive: true, activeConnections: 0 },
];

const PROXY_PORT = parseInt(process.env.PORT || '8080', 10);
let currentIndex = 0;

// Tạo reverse proxy instance
const proxy = httpProxy.createProxyServer({
  proxyTimeout: 3000,
  timeout: 3000
});

// Thuật toán Round Robin: chọn node sống kế tiếp
function getNextHealthyServer(): BackendServer | null {
  const healthyNodes = BACKENDS.filter(b => b.isAlive);
  if (healthyNodes.length === 0) return null;

  currentIndex = (currentIndex + 1) % healthyNodes.length;
  return healthyNodes[currentIndex];
}

// Giám sát sức khỏe chủ động (Active Health Check) mỗi 2 giây
async function performActiveHealthCheck() {
  for (const backend of BACKENDS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      const res = await fetch(`${backend.url}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);

      const wasAlive = backend.isAlive;
      backend.isAlive = res.ok;

      if (!wasAlive && backend.isAlive) {
        console.log(`[HealthCheck] 🟢 Node ${backend.name} (${backend.url}) đã PHỤC HỒI và hoạt động trở lại!`);
      } else if (wasAlive && !backend.isAlive) {
        console.log(`[HealthCheck] 🔴 CẢNH BÁO: Node ${backend.name} (${backend.url}) trả về status ${res.status}. ĐÃ TÁCH KHỎI POOL!`);
      }
    } catch (err: any) {
      if (backend.isAlive) {
        backend.isAlive = false;
        console.log(`[HealthCheck] 🔴 CẢNH BÁO: Không thể kết nối tới ${backend.name} (${backend.url}). ĐÃ TÁCH KHỎI POOL!`);
      }
    }
  }
}

setInterval(performActiveHealthCheck, 2000);

// Khởi tạo HTTP Server của Load Balancer
const server = http.createServer((req, res) => {
  // Route kiểm tra trạng thái của Load Balancer
  if (req.url === '/lb-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      loadBalancer: 'Node.js L7 Round-Robin Proxy',
      healthyNodesCount: BACKENDS.filter(b => b.isAlive).length,
      totalNodes: BACKENDS.length,
      backends: BACKENDS
    }, null, 2));
    return;
  }

  // Chọn node bằng thuật toán Round Robin
  const targetBackend = getNextHealthyServer();

  if (!targetBackend) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: '503 Service Unavailable',
      message: 'Toàn bộ backend servers đều đang sập hoặc không phản hồi!'
    }));
    return;
  }

  targetBackend.activeConnections++;

  // Gắn header đánh dấu node nào đang xử lý request
  res.setHeader('X-Served-By', targetBackend.name);
  res.setHeader('X-Load-Balancer', 'Custom-L7-RoundRobin');

  // Chuyển tiếp request tới backend đã chọn
  proxy.web(req, res, { target: targetBackend.url }, (err) => {
    targetBackend.activeConnections = Math.max(0, targetBackend.activeConnections - 1);
    targetBackend.isAlive = false;
    console.error(`[Failover] ⚠️ Chuyển tiếp tới ${targetBackend.name} thất bại (${err.message}). Tự động thử lại node khác...`);

    // Cơ chế Passive Failover: Thử lại ngay lập tức với 1 node khỏe mạnh khác
    const retryBackend = getNextHealthyServer();
    if (retryBackend) {
      console.log(`[Failover] 🔄 Đang tự động chuyển request sang ${retryBackend.name}...`);
      res.setHeader('X-Served-By', retryBackend.name);
      res.setHeader('X-Failover-Retry', 'true');
      proxy.web(req, res, { target: retryBackend.url }, (retryErr) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway sau khi đã failover thử lại thất bại.' }));
      });
    } else {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Không còn node nào khả dụng để failover.' }));
    }
  });

  res.on('finish', () => {
    targetBackend.activeConnections = Math.max(0, targetBackend.activeConnections - 1);
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`
===========================================================
  🌐 L7 LOAD BALANCER ĐÃ KHỞI CHẠY THÀNH CÔNG!
  Cổng lắng nghe: http://localhost:${PROXY_PORT}
  Thuật toán: Round-Robin + Active Health Check + Failover
  Kiểm tra trạng thái cluster: http://localhost:${PROXY_PORT}/lb-status
===========================================================
  `);
  // Kiểm tra sức khỏe ngay lần đầu
  performActiveHealthCheck();
});
