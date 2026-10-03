# 10 — Reliability và observability

## Mục tiêu

Biết đặt timeout, giới hạn retry/concurrency, phân biệt liveness/readiness và dùng số liệu để xác định bottleneck. Reliability là khả năng đáp ứng mục tiêu khi có lỗi; nhiều replicas trên một máy không bảo vệ khi máy đó chết.

## Các cơ chế bảo vệ

- **Deadline:** ngân sách toàn request phải chứa thời gian connect, xử lý và retry. Lab timeout mỗi HTTP dependency call 200ms, tối đa 2 attempts và jitter 30–70ms; request thất bại thường kết thúc dưới khoảng 500ms, nhưng event-loop scheduling có thể làm chậm hơn.
- **Retry budget:** retry lỗi tạm thời ở một tầng đã chọn, không retry vô hạn; write cần idempotency hoặc transaction retry policy. Ba tầng mỗi tầng 3 attempts có thể biến một request thành 27 dependency calls.
- **Backpressure:** tối đa 4 request đang xử lý trên mỗi API node trong lab 10, không có queue vô hạn. Vượt ngưỡng trả 503; client cần backoff. Đây là giới hạn tài nguyên, khác quota theo user.
- **Circuit breaker:** sau 3 request thất bại, mở 2 giây, sau đó chỉ một half-open probe. Probe thành công đóng circuit; thất bại mở lại. Trong lab state breaker cục bộ từng node, phù hợp bảo vệ kết nối của node đó.
- **Bulkhead:** pool và concurrency riêng cho dependency giúp cô lập lỗi; lab minh họa HTTP dependency, chưa cung cấp nhiều pool nghiệp vụ độc lập.

## Health checks

`/health/live`: tiến trình có phục vụ health endpoint không. `/health/ready`: DB và các dependency bắt buộc cho API đã sẵn sàng chưa. Broker không phải dependency đồng bộ của capstone vì outbox đã lưu bền vững; Redis quota và DB là dependency của đường mua.

Compose healthcheck dùng readiness khi khởi động; Compose không tự loại app unhealthy khỏi Nginx. Nginx dùng passive checks dựa trên lỗi kết nối/HTTP; một node chết có failure window trước khi bị loại. Không bật retry POST không idempotent. `/health/live` thành công cũng không chứng minh mọi request nghiệp vụ đúng.

## Metrics, logs và traces

Runtime có structured JSON logs với request ID, instance, method, route và status. `X-Request-ID` được nhận nếu định dạng hợp lệ, nếu không sinh UUID; response trả ID cho người gọi. Metric labels dùng route template để không tạo một time series cho mỗi user/order.

`/metrics` cung cấp histogram HTTP, default Node.js metrics và counter product DB queries. Capstone thêm gauge tồn kho PostgreSQL và số outbox event pending. HTTP p99 dùng:

```promql
histogram_quantile(0.99, sum by (le) (rate(lab_http_duration_seconds_bucket[5m])))
```

Error ratio dùng status 5xx chia toàn request; cần tách `/health` khỏi nghiệp vụ. Quota 429 và hết kho 409 là kết quả nghiệp vụ riêng, không tự coi là service unavailable.

```bash
node scripts/lab.mjs compose 09 --profile observability up -d
```

Prometheus: http://localhost:9090. Grafana: http://localhost:3005, user `admin`, password `lab_password`, datasource được provision. Dashboard tự động có latency, throughput và process memory. Request ID hỗ trợ nối logs trong lab; chưa triển khai OpenTelemetry distributed tracing backend.

## SLO, recovery và backup

Ví dụ SLO: 99,9% request hợp lệ được xử lý trong một tháng; latency p99 dưới ngưỡng đã thống nhất. Cần xác định rõ success và measurement window, error budget ≈ 0,1% request. SLA là cam kết với người sử dụng, không phải số in trong README.

RPO là mức mất dữ liệu chấp nhận; RTO là thời gian phục hồi mục tiêu. Docker volume bảo vệ trước restart container, không thay backup. `pg_dump` tạo logical backup; restore thử vào database riêng, so sánh số bản ghi/constraints. PITR cần WAL archiving và base backup; replication không bảo vệ xóa dữ liệu nhầm vì thao tác xóa cũng được replicate.

## Lab và tiêu chí đạt

Chạy [lab 10](../labs/module-10-reliability/). Đặt dependency delay 600ms: request timeout với số attempts giới hạn; burst vượt concurrency bị từ chối sớm; circuit mở và tự phục hồi sau probe. Ghi lại p99/error rate khi dependency khỏe/chậm/lỗi và giải thích vì sao tăng timeout có thể tăng backlog.

Nguồn: [Google SRE monitoring](https://sre.google/sre-book/monitoring-distributed-systems/), [PostgreSQL backup](https://www.postgresql.org/docs/16/backup.html), [Prometheus histograms](https://prometheus.io/docs/practices/histograms/).
