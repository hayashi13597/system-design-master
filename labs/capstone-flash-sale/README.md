# 🏛️ Đồ Án Tổng Hợp (Capstone): Kiến Trúc Flash Sale & Săn Vé 100,000 QPS

Chào mừng bạn đến với **Capstone Project: High-Concurrency Flash Sale / Ticket Booking Architecture**.

Đây là đồ án tổng kết tích hợp toàn bộ kiến thức và kỹ thuật đã học từ **Module 01 đến Module 08**:
- **Module 01:** Horizontal Scaling & Stateless App Node Cluster
- **Module 02:** In-Memory Caching & Thundering Herd Defense
- **Module 03:** Sliding Window Counter Rate Limiting (Traffic Shaping / WAF)
- **Module 04 & 05:** Database Sharding & Read/Write Splitting
- **Module 06:** Concurrency Control, Zero Overselling & Atomic Lua Script Execution
- **Module 07:** Asynchronous Message Queue Peak Shaving Buffer & Idempotency
- **Module 08:** Transactional Outbox Pattern & Event-Driven Reliability

---

## 🏗️ Cấu trúc Thư mục

```text
labs/capstone-flash-sale/
├── src/
│   ├── redis-inventory.ts     # In-memory Redis Engine (Atomic Lua Pre-deduction + User Limit)
│   ├── rate-limiter.ts        # Sliding Window Rate Limiter (Chống Spam / Botnet)
│   ├── order-queue.ts         # Asynchronous Message Queue (Peak Shaving Buffer)
│   ├── db-store.ts            # PostgreSQL Store với Transactional Outbox Pattern
│   └── server.ts              # Express API Server tích hợp toàn bộ Phễu Lọc Tải Đa Tầng
├── Dockerfile                 # Image build cho App Cluster Node (Node.js 22 Alpine)
├── nginx.conf                 # Cấu hình API Gateway / Reverse Proxy & Load Balancer
├── docker-compose.yml         # Cụm Production: Nginx + 2 App Nodes + Redis + RabbitMQ + PostgreSQL
├── benchmark-flash-sale.js    # Bài test bắn 1,000 concurrent requests tranh mua 50 vé
├── package.json
└── tsconfig.json
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### Cách 1: Khởi chạy bằng Docker Compose (Khuyên dùng)

Toàn bộ cụm bao gồm Load Balancer (Nginx), 2 App Nodes (`app-1`, `app-2`), Redis, RabbitMQ và PostgreSQL:

```bash
cd labs/capstone-flash-sale
docker compose up -d --build
```
*API Gateway sẽ lắng nghe tại cổng `http://localhost:80` (hoặc test trực tiếp từng app node tại cổng `3000`).*

### Cách 2: Khởi chạy Local (Node.js)

```bash
cd labs/capstone-flash-sale
npm install
npm run build
npm start
```
*Server sẽ lắng nghe tại cổng `http://localhost:3000`.*

---

## 🧪 Chạy Bài Kiểm Tra Tự Động (Stress Test Benchmark)

Mở một terminal khác và chạy:

```bash
npm run test:capstone
```

### Kịch bản kiểm tra gồm 4 giai đoạn thực chiến:
1. **Giai đoạn 1 (Cơn bão 1,000 Users tranh mua 50 vé):**
   - 1,000 requests đồng thời kích hoạt trong vài mili-giây.
   - Đúng **50 khách hàng đầu tiên** nhận phản hồi `202 Accepted` ($< 5\text{ms}$).
   - **950 khách hàng còn lại** nhận phản hồi `400 Out of Stock` ngay lập tức mà **không chạm tới Database**.
2. **Giai đoạn 2 (Tấn công mua lặp / Double-spending):**
   - User đã mua thành công cố tình gửi thêm 5 requests liên tiếp $\rightarrow$ Bị chặn ngay với `409 Conflict (Mỗi user chỉ được mua 1 vé)`.
3. **Giai đoạn 3 (Tấn công Botnet Click-Spam):**
   - Botnet gửi 15 requests dồn dập $\rightarrow$ Tầng Rate Limiter chặn đứng với `429 Too Many Requests`.
4. **Giai đoạn 4 (Kiểm chứng Ghi đĩa DB & Outbox):**
   - Queue Consumer dàn phẳng lưu lượng và ghi êm dịu 50 đơn hàng vào PostgreSQL.
   - **Cam kết vàng:** Tồn kho Redis = 0, Đơn hàng DB = 50, **Bán âm kho = 0 ĐƠN (ZERO OVERSELLING)!**

---

## 📡 API Endpoints Tham Khảo

- `POST /api/flash-sale/buy`: Đặt vé Flash Sale (yêu cầu `{ userId, itemId, quantity }`).
- `GET /api/flash-sale/product/:itemId`: Kiểm tra thông tin vé và tồn kho thời gian thực.
- `GET /api/flash-sale/order/:orderId`: Tra cứu tiến độ xuất vé theo `orderId`.
- `GET /api/system/status`: Bảng điều khiển giám sát toàn bộ chỉ số từ Gateway đến Database.
- `POST /api/system/reset`: Reset hệ thống và nạp lại tồn kho thử nghiệm.
