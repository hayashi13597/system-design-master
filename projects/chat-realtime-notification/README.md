# Chat & Realtime Collaborative Notification

Bản thiết kế tham chiếu cho một chat engine kiểu Slack/Discord: chat 1–1, nhóm tối đa 100 người, 100.000 WebSocket đồng thời, 5.000 message/s liên tục và lịch sử một năm. Thiết kế sử dụng Nginx, WebSocket Gateway Cluster, Redis Pub/Sub và PostgreSQL sharding theo conversation.

**Trạng thái: tài liệu thiết kế, chưa có ứng dụng hoặc benchmark của dự án này.** Các cấu hình, SQL và pseudocode là đặc tả để triển khai; chúng không phải lab đã chạy. Mục tiêu không mất tin đã ACK áp dụng cho mất một máy/AZ trong một region, với các điều kiện replication và fencing được nêu trong thiết kế.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Thiết kế hệ thống](docs/system-design.md) | Yêu cầu, SLO, capacity, kiến trúc, schema, API, ACK/replay, presence, bảo mật và vận hành |
| [Kế hoạch kiểm chứng](docs/verification-plan.md) | Invariants, kịch bản lỗi, workload, bằng chứng nghiệm thu và rubric review |

Nên đọc phần yêu cầu và các cam kết trước, sau đó theo luồng gửi → lưu → phát → reconnect. Dùng kế hoạch kiểm chứng để phản biện từng cam kết trước khi viết ứng dụng.

## Các quyết định nền tảng

- Database là nguồn sự thật. Message và outbox cùng transaction; ACK sau WAL được flush trên primary và synchronous standby ở AZ khác.
- Redis Pub/Sub truyền sự kiện tức thời. Lịch sử, retry, đối soát và replay dựa trên dữ liệu bền vững.
- Sequence tăng theo từng conversation; client lưu message/cursor nguyên tử và chống hiển thị trùng. Không có total order toàn hệ thống.
- Presence dùng heartbeat 10 giây, TTL 30 giây theo session, hỗ trợ nhiều thiết bị và trạng thái `unknown` khi không xác định được.
- 5.000 message/s liên tục tương đương 157,68 tỷ message/năm. Capacity phải tính index, replicas, WAL, backup và fan-out ngoài payload thô.

Phạm vi notification gồm mention trong conversation, unread, delivered/read, typing và presence. Thành viên chỉ đọc từ lần tham gia hiện tại; rời nhóm thì mất quyền truy cập server. Chưa gồm push/email, attachment, full-text search, edit/delete, E2EE, global notification inbox hoặc active-active nhiều region.

## Liên hệ với giáo trình

| Module | Áp dụng vào dự án |
|---|---|
| [01 — Scaling](../../docs/01-scaling-and-load-balancing.md) | Connection state, cân bằng tải, reconnect và connection draining |
| [02 — Caching](../../docs/02-caching-strategies.md) | Cache membership có lease; Redis không phải nguồn quyền truy cập |
| [03 — Rate limiting](../../docs/03-rate-limiting.md) | Quota gửi, handshake, replay và chống reconnect storm |
| [04 — Replication](../../docs/04-db-replication.md) | ACK boundary, synchronous replication và đọc primary khi replay |
| [05 — Sharding](../../docs/05-db-sharding-consistent-hashing.md) | Conversation affinity, logical buckets, routing version và reshard |
| [06 — Locks](../../docs/06-cap-distributed-locks.md) | Fencing leader và cutover; ưu tiên consistency khi partition |
| [07 — Idempotency](../../docs/07-message-queues-idempotency.md) | Retry cùng client ID, phân biệt accepted/delivered/read |
| [08 — Outbox](../../docs/08-outbox-pattern-event-streaming.md) | Atomic persistence, relay retry và duplicate events |
| [10 — Reliability](../../docs/10-reliability-observability.md) | Backpressure, SLO, metrics, fault injection và recovery |

Bản thiết kế mở rộng [bài tập Chat và rubric](../../docs/11-design-exercises.md). Các lab hiện có hỗ trợ học từng cơ chế, chưa chứng minh khả năng đạt tải hoặc HA của kiến trúc này.
