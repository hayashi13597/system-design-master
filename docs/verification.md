# Kết quả kiểm tra trong workspace

Ngày kiểm tra: 2026-10-03. Host Linux x64, 12 CPU logic, RAM 7,44 GiB, Node.js v24.14.1; app container dùng Node.js 22. Docker Engine 28.4.0, Compose v2.39.4.

`node scripts/verify-all.mjs` đã chạy từng lab từ named volume sạch, build image, integration assertions và dọn container/volume sau mỗi lab. Không chạy nhiều lab đồng thời. Thời gian dưới đây gồm startup, test và cleanup, **không phải latency benchmark**.

| Lab | Kết quả | Thời gian toàn bước (giây) |
|---|---|---:|
| 00 | PASS | 14.3 |
| 01 | PASS | 14.1 |
| 02 | PASS | 17.1 |
| 03 | PASS | 13.7 |
| 04 | PASS | 18.4 |
| 05 | PASS | 17.9 |
| 06 | PASS | 14.4 |
| 07 | PASS | 25.1 |
| 08 | PASS | 47.3 |
| 09 | PASS | 42.4 |
| 10 | PASS | 12.1 |

Các kiểm tra bổ sung đã đạt: build TypeScript runtime; typecheck TypeScript tests; unit test consistent hashing/Snowflake; `npm audit --omit=dev` không ghi nhận vulnerability; `git diff --check`.

## Những hành vi đã kiểm chứng

- Index/query plan và lost update vs atomic update trên PostgreSQL.
- Counter Redis dùng chung qua 3 app; gateway tiếp tục GET khi một app dừng.
- Distributed cache regeneration và negative caching, invalidation trong điều kiện không có reader cạnh tranh; Redis outage khiến API từ chối và liveness vẫn sống.
- Quota Lua dùng chung hai node; token refill được tính vào ngưỡng kiểm tra; unsafe counter leak.
- WAL replay bị pause thực sự: stale reads và min-LSN fallback qua cả hai app.
- 100 user đọc đủ sau reshard 3 → 4 PostgreSQL shard; Snowflake không trùng giữa worker fixture.
- Lease hết hạn, ownership release và DB từ chối fence cũ.
- 30 payment trùng chỉ cộng tiền một lần; poison tới DLQ; crash sau commit trước ACK không double effect.
- Redpanda offline giữ outbox, phục hồi gửi lại; crash relay sau publish không tạo delivery trùng.
- Capstone 1.000 request tạo đúng 50 reservation; payload quantity sai bị chặn; idempotency replay, trạng thái đơn giữa node, API/DB restart, broker outage, expiry/payment và inventory invariant.
- HTTP dependency chậm: timeout/retry có giới hạn, backpressure, circuit mở và half-open phục hồi.

Log và kết quả JSON chi tiết nằm trong `reports/` (gitignored), được tạo lại bằng lệnh verify. CI workflow dùng cùng đường chạy và fixtures. Việc có workflow không đồng nghĩa đã chạy trên GitHub Actions trong phiên này.

## Dashboard và benchmark kiểm tra thêm

Profile observability đã khởi chạy thành công: Grafana health OK, dashboard `sdm-labs` được provision, hai Prometheus scrape targets đều UP và metric tồn kho đọc được từ cả hai app.

Một lần benchmark capstone: 1.000 request, concurrency 30, 50 response 202 và 950 response 409; khoảng 640 response/s, p50 42,9ms, p95 91,6ms, p99 182,3ms, không lỗi mạng/5xx. Đây là một lần chạy ngắn trên máy nêu trên, không tách warm-up và không đại diện throughput đơn hàng thành công. Không đạt hay cam kết p99 50ms. Báo cáo JSON nằm trong `reports/benchmark-09-1791023856036.json`.

## Giới hạn của bằng chứng

Không chứng minh HA trước mất Docker host, Redis failover, nhiều Kafka broker/quorum, workload kéo dài, online reshard, payment/email thực hoặc mức tải production. Không suy throughput thành công từ số response 409/429; mọi ngưỡng hiệu năng cần đo riêng theo cấu hình máy và workload.
