# Lab 08: Transactional Outbox Pattern & Event Streaming (Kafka)

Chào mừng bạn đến với phòng thí nghiệm chuyên sâu **Module 08: Transactional Outbox Pattern & Event Streaming**.

Trong kiến trúc Microservices và Event-Driven Architecture, **vấn nạn Dual-Write** (ghi đồng thời vào Database và bắn Message sang Kafka/RabbitMQ) là nguyên nhân hàng đầu gây mất mát dữ liệu và mất tính nhất quán giữa các dịch vụ. Lab này sẽ giúp bạn thực chứng:
1. **Sự cố Dual-Write:** Khi Broker (Kafka) gặp sự cố mạng hoặc sập, đơn hàng đã lưu trong DB nhưng Event bị mất vĩnh viễn (Data Loss).
2. **Giải pháp Transactional Outbox:** Đảm bảo Atomicity 100% bằng cách lưu Event vào cùng một ACID DB Transaction với nghiệp vụ, và sử dụng **Outbox Relay (CDC / Polling)** để tự động gửi bù khi Broker phục hồi.

---

## 🏗️ Cấu trúc Thư mục

```text
labs/module-08-outbox-kafka/
├── src/
│   ├── mock-db.ts             # ACID Database giả lập (hỗ trợ rollback & commit đồng thời)
│   ├── mock-kafka.ts          # Kafka Broker giả lập (hỗ trợ toggle Online/Offline)
│   ├── order-service.ts       # Service tạo đơn: Naive Dual-Write vs Transactional Outbox
│   ├── outbox-relay.ts        # Polling Worker quét bảng outbox và chuyển tiếp sang Kafka
│   └── server.ts              # Express API Server
├── benchmark-outbox.js        # Kịch bản tự động đo kiểm đối chiếu khi Kafka sập
├── docker-compose.yml         # Kiến trúc Docker thật: PostgreSQL 16 + Redpanda + Console
├── init.sql                   # SQL Schema cho bảng orders & outbox
├── package.json
└── tsconfig.json
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### 1. Cài đặt Dependencies và Build Code

```bash
cd labs/module-08-outbox-kafka
npm install
npm run build
```

### 2. Khởi động Lab Server

```bash
npm start
```
*Server sẽ lắng nghe tại cổng `http://localhost:3000`.*

---

## 🧪 Chạy Bài Kiểm Tra Tự Động (Benchmark)

Mở một terminal khác và chạy:

```bash
npm run test:outbox
```

### Kịch bản kiểm thử mô phỏng 3 giai đoạn:
1. **Giai đoạn 1 (Kafka Online):** Tạo 5 đơn Naive và 5 đơn Outbox. Cả 2 đều chuyển được sự kiện vào Kafka.
2. **Giai đoạn 2 (Kafka Crash / Sập mạng):** Broker bị ngắt kết nối (`/api/kafka/toggle`). Hệ thống nhận thêm 10 đơn Naive và 10 đơn Outbox:
   - Naive: Ghi đơn vào DB thành công, nhưng bắn Kafka thất bại $\rightarrow$ **10 Sự kiện bị bốc hơi vĩnh viễn!**
   - Outbox: Ghi đơn và ghi Outbox Event trong cùng 1 DB Transaction $\rightarrow$ **10 Sự kiện nằm an toàn ở trạng thái `PENDING`.**
3. **Giai đoạn 3 (Kafka phục hồi):** Bật lại Kafka. Outbox Relay tự động kích hoạt quét bù và gửi toàn bộ sự kiện còn thiếu sang Kafka $\rightarrow$ **Khôi phục 100% dữ liệu không mất một sự kiện nào!**

---

## 📡 API Tham Khảo (Manual Testing qua cURL)

### 1. Tạo đơn hàng bằng Naive Dual-Write
```bash
curl -X POST http://localhost:3000/api/orders/naive \
  -H "Content-Type: application/json" \
  -d '{"userId": "alice", "amount": 250}'
```

### 2. Tạo đơn hàng bằng Transactional Outbox
```bash
curl -X POST http://localhost:3000/api/orders/outbox \
  -H "Content-Type: application/json" \
  -d '{"userId": "bob", "amount": 500}'
```

### 3. Mô phỏng Sập Kafka Broker (Offline)
```bash
curl -X POST http://localhost:3000/api/kafka/toggle \
  -H "Content-Type: application/json" \
  -d '{"online": false}'
```

### 4. Kiểm tra Trạng thái Toàn bộ Hệ thống
```bash
curl http://localhost:3000/api/system/status
```

### 5. Khôi phục Kafka Broker (Online)
```bash
curl -X POST http://localhost:3000/api/kafka/toggle \
  -H "Content-Type: application/json" \
  -d '{"online": true}'
```

### 6. Kích hoạt Outbox Relay quét bù ngay lập tức
```bash
curl -X POST http://localhost:3000/api/relay/trigger
```

---

## 🐳 Khởi chạy Môi trường Production Thực tế với Docker (Tùy chọn)

Nếu máy bạn có Docker Desktop, bạn có thể khởi chạy cụm Database PostgreSQL và Redpanda thật bằng lệnh:

```bash
docker compose up -d
```
- PostgreSQL: `localhost:5432` (user: `postgres`, password: `password123`, db: `ecommerce`)
- Redpanda Kafka Broker: `localhost:19092`
- Redpanda Web Console: `http://localhost:8080` (giao diện web trực quan quan sát topic, partitions, và messages)
