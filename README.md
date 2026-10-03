# System Design Master

Giáo trình tiếng Việt dành cho người đã biết backend, HTTP và SQL, bắt đầu học system design. Bạn học cách làm rõ yêu cầu, lựa chọn kiến trúc và kiểm chứng trade-off bằng dịch vụ thật trên Docker.

## Bắt đầu

Cần Git, Node.js 22+, npm, Docker Engine/Desktop có Compose v2. Khuyến nghị tối thiểu 8 GiB RAM, 10 GiB disk trống; cấp Docker ít nhất 4 GiB RAM, chạy một lab tại một thời điểm. Lab replication/sharding cần nhiều PostgreSQL instance; profile quan sát cần thêm RAM.

```bash
npm ci
npm run build
npm test
npm run lab:up -- 00
npm run lab:test -- 00
npm run lab:down -- 00
```

Gateway: http://localhost:8080. App node: :3001/:3002; lab 01 thêm :3003. Dữ liệu tồn tại khi `down` và được giữ lại khi restart. `npm run lab:reset -- 00` **xóa dữ liệu lab**, rồi khởi tạo lại. Test thay đổi fixture và có thể stop/restart container; hãy dùng môi trường lab sạch.

## Lộ trình

| Thứ tự | Nội dung | Tài liệu | Lab |
|---|---|---|---|
| 00 | Cách giải bài thiết kế; mạng, storage, database và ước tính tải | [Nền tảng](docs/00-foundations.md) | [Index và concurrency](labs/module-00-foundations/) |
| 01 | Scaling, state, load balancing | [Lý thuyết](docs/01-scaling-and-load-balancing.md) | [Nginx + Redis](labs/module-01-load-balancing/) |
| 02 | Cache, invalidation, stampede | [Lý thuyết](docs/02-caching-strategies.md) | [Redis + PostgreSQL](labs/module-02-caching-patterns/) |
| 03 | Quota phân tán và thuật toán rate limit | [Lý thuyết](docs/03-rate-limiting.md) | [Redis Lua](labs/module-03-rate-limiter/) |
| 04 | Replication lag và read-your-writes | [Lý thuyết](docs/04-db-replication.md) | [Streaming replication](labs/module-04-db-replication/) |
| 05 | Shard key, hashing, reshard, ID | [Lý thuyết](docs/05-db-sharding-consistent-hashing.md) | [PostgreSQL shards](labs/module-05-db-sharding/) |
| 06 | CAP/PACELC, lease và fencing | [Lý thuyết](docs/06-cap-distributed-locks.md) | [Redis lock + DB fence](labs/module-06-distributed-lock/) |
| 07 | ACK, retry, DLQ, idempotency | [Lý thuyết](docs/07-message-queues-idempotency.md) | [RabbitMQ](labs/module-07-message-queues/) |
| 08 | Outbox, streaming và replay | [Lý thuyết](docs/08-outbox-pattern-event-streaming.md) | [PostgreSQL + Redpanda](labs/module-08-outbox-kafka/) |
| 09 | Flash sale: reservation, payment và phục hồi | [Thiết kế](docs/09-capstone-flash-sale.md) | [Capstone](labs/capstone-flash-sale/) |
| 10 | Timeout, retry, backpressure, circuit breaker, observability | [Lý thuyết](docs/10-reliability-observability.md) | [Dependency HTTP thật](labs/module-10-reliability/) |

Mỗi module: đọc lý thuyết → chạy ví dụ có lỗi chủ đích → đo/giải thích → chạy giải pháp → thực hiện bài tập. Sau module 10, giải [ba bài tập thiết kế](docs/11-design-exercises.md) và tự đánh giá theo rubric. Phần thuật toán có thể đọc trước; chưa cần triển khai microservices ngay từ đầu.

## Hạ tầng thật và phạm vi kiểm chứng

Runtime TypeScript tại [runtime/src](runtime/src/), schema/Compose/image tại `infra/` và từng lab. Redis, PostgreSQL, RabbitMQ và Redpanda thực sự tham gia đường dữ liệu. Không có chế độ tự fallback sang Map trong RAM. Code mô phỏng v1 được lưu tại `examples/legacy-simulation` của từng lab, không tham gia đường chạy chính.

Lab chứng minh transaction, state dùng chung, persistent messages, ACK, idempotency và một số failure windows trên **một Docker host**. Đây không phải chứng nhận high availability khi host chết hay đạt 100.000 QPS. Xem [vận hành và giới hạn](docs/lab-operations.md) trước khi diễn giải kết quả.

```bash
npm run lab:up -- 09
npm run lab:test -- 09
REQUESTS=1000 CONCURRENCY=30 npm run lab:benchmark -- 09
npm run lab:down -- 09
```

Benchmark xuất JSON trong `reports/` với status codes, error rate, p50/p95/p99 và cấu hình máy. Responses bị từ chối cũng được tính vào RPS; cần báo riêng số đơn đã commit. Test có assertions độc lập và trả exit code khác 0 khi sai.

CI build rồi chạy 11 bộ integration test lần lượt trên môi trường sạch. Xem [kết quả kiểm tra](docs/verification.md) cho bằng chứng của lần chạy trong workspace.
