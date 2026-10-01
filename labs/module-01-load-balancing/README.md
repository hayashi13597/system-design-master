# 🧪 THỰC HÀNH LAB 01: HORIZONTAL SCALING & LOAD BALANCING

> **Mục tiêu thực hành**:
> 1. Trực tiếp kiểm chứng tại sao **Stateful** làm hỏng việc mở rộng hệ thống.
> 2. Đo đạc bằng số liệu thực tế sự khác biệt về **RPS (Throughput) & p99 Latency** giữa 1 Single Node và Cụm 3 Nodes cân bằng tải.
> 3. Kiểm chứng cơ chế **Tự phục hồi (Failover)**: Khi 1 node gặp sự cố, hệ thống tự động cách ly mà không làm gián đoạn người dùng.

---

## 🛠️ Cách khởi chạy Lab

### Cách 1: Khởi chạy trực tiếp bằng Node.js (Khuyên dùng - Chạy ngay không cần Docker)

1. Mở terminal tại thư mục này và cài đặt thư viện:
   ```bash
   cd labs/module-01-load-balancing
   npm install
   ```

2. Khởi chạy toàn bộ cụm gồm **3 App Nodes + 1 Layer 7 Load Balancer**:
   ```bash
   npm run start:cluster
   ```
   * App Node 1: `http://localhost:3001`
   * App Node 2: `http://localhost:3002`
   * App Node 3: `http://localhost:3003`
   * **Load Balancer**: `http://localhost:8080`

### Cách 2: Khởi chạy bằng Docker Compose (Production-grade Nginx)

Nếu máy bạn đã cài Docker Desktop:
```bash
npm run docker:up
```

---

## 🔬 3 Bài Thí nghiệm Thực chiến

### Thí nghiệm 1: Cạm bẫy "Stateful" (Stateful Anti-pattern)
Gửi 4 request liên tiếp tăng biến đếm in-memory thông qua cổng Load Balancer (`http://localhost:8080/api/stateful/increment`):

```bash
# Gửi liên tục bằng curl hoặc Postman / trình duyệt:
curl -X POST http://localhost:8080/api/stateful/increment
curl -X POST http://localhost:8080/api/stateful/increment
curl -X POST http://localhost:8080/api/stateful/increment
curl -X POST http://localhost:8080/api/stateful/increment
```
* **Hiện tượng quan sát**: Bạn sẽ thấy `localNodeCounter` trả về giá trị lộn xộn (ví dụ: Node 1 đếm 1, Node 2 đếm 1, Node 3 đếm 1, rồi Node 1 mới đếm 2).
* **Bài học kiến trúc**: Nếu lưu giỏ hàng hoặc session người dùng trong RAM của server, người dùng f5 một cái sẽ bị văng sang server khác và mất sạch giỏ hàng! **Bắt buộc phải chuyển State ra Redis (sẽ học ở Module 02)**.

---

### Thí nghiệm 2: Đo lường Sức mạnh Scale Out (Benchmark tải k6 / autocannon)

Mở một cửa sổ terminal mới và chạy lệnh so sánh hiệu năng:

1. **Bắn tải vào 1 Node duy nhất (Node 1 - Port 3001)**:
   ```bash
   npm run benchmark:single
   ```
   * Ghi nhận lại: **RPS (req/s)** và **p99 latency**. Do Node.js là Single-Threaded Event Loop, khi xử lý tác vụ CPU nặng, CPU node 1 chạm đỉnh 100% và độ trễ tăng vọt.

2. **Bắn tải cùng mức độ vào Cụm 3 Nodes qua Load Balancer (Port 8080)**:
   ```bash
   npm run benchmark:cluster
   ```
   * **Hiện tượng quan sát**: Nhờ thuật toán Round Robin phân phối đều CPU cho cả 3 tiến trình, thông lượng (RPS) tăng gần gấp **3 lần**, và độ trễ p99 giảm đáng kể!

---

### Thí nghiệm 3: Kiểm chứng Cơ chế Tự phục hồi (Failover & Self-Healing)

1. Mở trình duyệt xem trang giám sát trạng thái của Load Balancer:
   👉 `http://localhost:8080/lb-status` (Hiện đang có 3 nodes sống `healthyNodesCount: 3`).

2. Mô phỏng "giết" Node 1 bằng cách gửi request gây lỗi:
   ```bash
   curl -X POST http://localhost:3001/api/simulate-crash
   ```

3. Quan sát log trên terminal của Load Balancer:
   * Load Balancer phát hiện Node 1 trả về 503 và lập tức **tách Node 1 ra khỏi Routing Pool**.
   * F5 lại `http://localhost:8080/lb-status` $\rightarrow$ chỉ còn 2 nodes hoạt động (`app-node-2`, `app-node-3`).
   * Người dùng truy cập `http://localhost:8080/api/info` hoàn toàn bình thường, không nhận bất kỳ lỗi 502/503 nào!

4. Khôi phục lại Node 1:
   ```bash
   curl -X POST http://localhost:3001/api/simulate-recover
   ```
   * Sau 2 giây, Load Balancer tự động đưa Node 1 trở lại phục vụ tải (`🟢 Node app-node-1 đã PHỤC HỒI`).
