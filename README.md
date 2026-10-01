# 🏛️ System Design Master (Senior & Architect Track)

> Khóa học thực chiến toàn diện từ lý thuyết chuyên sâu đến code triển khai thực tế các mô hình hệ thống phân tán chịu tải cao (High Concurrency & High Availability) bằng **Node.js, TypeScript, Docker và các công cụ đo kiểm hiệu năng**.

---

## 🧭 Tiến độ Lộ trình (Roadmap Progress)

| Module | Tên chuyên đề | Trạng thái | Tài liệu lý thuyết | Thư mục Lab |
| :--- | :--- | :---: | :---: | :---: |
| **01** | **Horizontal Scaling & Load Balancing** | ✅ **Hoàn thành** | [docs/01-scaling-and-load-balancing.md](docs/01-scaling-and-load-balancing.md) | [labs/module-01-load-balancing/](labs/module-01-load-balancing/) |
| **02** | **Caching Strategies & Thundering Herd Defense** | ✅ **Hoàn thành** | [docs/02-caching-strategies.md](docs/02-caching-strategies.md) | [labs/module-02-caching-patterns/](labs/module-02-caching-patterns/) |
| **03** | **Distributed Rate Limiting (Token Bucket / Sliding Window)** | ✅ **Hoàn thành** | [docs/03-rate-limiting.md](docs/03-rate-limiting.md) | [labs/module-03-rate-limiter/](labs/module-03-rate-limiter/) |
| **04** | **Database Replication, Read/Write Splitting & Lag** | 🟢 **Đang học** | [docs/04-db-replication.md](docs/04-db-replication.md) | [labs/module-04-db-replication/](labs/module-04-db-replication/) |
| **05** | **Database Sharding, Consistent Hashing & Snowflake ID** | ⚪ Chờ | [docs/05-db-sharding-consistent-hashing.md](docs/05-db-sharding-consistent-hashing.md) | `labs/module-05-db-sharding/` |
| **06** | **CAP/PACELC, Distributed Locks & Redlock** | ⚪ Chờ | [docs/06-cap-distributed-locks.md](docs/06-cap-distributed-locks.md) | `labs/module-06-distributed-lock/` |
| **07** | **Message Queues, Dead Letter Queue & Idempotency** | ⚪ Chờ | [docs/07-message-queues-idempotency.md](docs/07-message-queues-idempotency.md) | `labs/module-07-message-queues/` |
| **08** | **Event Streaming & Transactional Outbox Pattern** | ⚪ Chờ | [docs/08-outbox-pattern-event-streaming.md](docs/08-outbox-pattern-event-streaming.md) | `labs/module-08-outbox-kafka/` |
| **09** | **Capstone: High-Concurrency Flash Sale Architecture** | ⚪ Chờ | [docs/09-capstone-flash-sale.md](docs/09-capstone-flash-sale.md) | `labs/capstone-flash-sale/` |

---

## 🚀 Cách chạy các bài Lab
Mỗi bài lab được thiết kế để có thể chạy theo 2 cách:
1. **Docker Compose**: Môi trường chuẩn production với Nginx, Redis, PostgreSQL, Kafka...
2. **Local Multi-instance Runner (Node.js/npm)**: Chạy tức thì không cần cài thêm công cụ hạ tầng phức tạp, dùng trực tiếp thư viện Node.js để kiểm thử thuật toán và benchmark tải với `autocannon`.

Xem chi tiết trong từng thư mục lab!
