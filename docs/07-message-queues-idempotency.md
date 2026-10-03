# 07 — RabbitMQ, ACK, retry và idempotency

## Mục tiêu

Dùng queue để tách producer/consumer nhưng vẫn xác định dữ liệu bền vững lúc nào. Queue hấp thụ đỉnh tải tạm thời; nếu producer nhanh hơn consumer lâu dài, backlog vẫn tăng và cần backpressure/capacity planning.

## Delivery semantics

At-most-once có thể mất tác vụ khi ACK trước khi xử lý. At-least-once chấp nhận redelivery/duplicate để retry; guarantee cần durable queue, persistent message, broker confirmations, retention và failure model đúng. Không có nghĩa mọi lỗi phần cứng đều không mất dữ liệu.

Exactly-once effect trong một database có thể đạt bằng dedup key + transaction; transport và external side effect vẫn cần phân tích riêng. Broker duplicate là khả năng phải xử lý, không phải lúc nào cũng xảy ra. Không dùng phát biểu “exactly-once bất khả thi” để bỏ qua Kafka transactions hoặc atomic DB processing trong phạm vi được hỗ trợ.

## Hai loại xác nhận

Publisher confirms: broker xác nhận message đã được nhận theo guarantee của queue. Consumer ACK: consumer báo xử lý xong để broker loại delivery. Hai ACK độc lập; API nhận confirm không có nghĩa nghiệp vụ consumer đã hoàn thành.

```mermaid
sequenceDiagram
 participant P as Producer
 participant Q as RabbitMQ
 participant C as Consumer
 participant D as PostgreSQL
 P->>Q: Publish persistent message
 Q-->>P: Publisher confirm
 Q->>C: Deliver
 C->>D: BEGIN; dedup insert + balance update; COMMIT
 C->>Q: ACK
```

Lost confirm có thể làm producer gửi lại message đã nhận. Crash sau DB commit trước ACK khiến broker redeliver. Vì vậy message phải mang stable idempotency key xuyên các lần retry.

## Idempotent transaction

Consumer INSERT processed key unique trong cùng transaction với cập nhật balance. Conflict key → không cộng lại; commit rồi ACK. Không kiểm tra Redis key, ghi DB, rồi mới set processed: crash hoặc hai consumer cùng chạy sẽ tạo double effect.

Một key phải đại diện cùng một tác vụ nghiệp vụ. Lab duplicate check dùng key; caller phải không tái sử dụng key cho amount khác. Production nên lưu hash payload và báo mismatch. Amount trong lab là số nguyên đơn vị tiền nhỏ nhất; không dùng floating-point cho tiền.

Prefetch giới hạn unacknowledged deliveries; 2 consumer cùng queue chia việc, không bảo đảm total ordering khi xử lý song song. Consumer bị chặn lâu làm giảm throughput; theo dõi oldest message age, queue depth, retries và DLQ.

## Retry và DLQ

Lab dùng queue retry TTL 300ms rồi dead-letter về main queue. Tối đa ba lần xử lý (lần đầu + 2 retry), lỗi tiếp chuyển DLQ. Đây là delay cố định cho bài học, không quảng bá là exponential backoff. Transfer retry/DLQ đợi publisher confirm trước ACK message cũ; nếu crash giữa hai bước có duplicate, dedup vẫn cần.

DLQ là nơi cách ly để điều tra, không phải xử lý thành công. Không replay poison message vô hạn; sửa nguyên nhân và replay với key ổn định. Single-node classic queue lab không có quorum queue/HA trước broker host loss.

## Lab và tiêu chí đạt

[Lab 07](../labs/module-07-message-queues/) dùng RabbitMQ thật, PostgreSQL và hai consumer. Gửi 30 payment trùng chỉ cộng 100; poison đi DLQ; crash sau commit trước ACK rồi restart giữ đúng balance. API trả 202 sau publisher confirm, read balance có thể chưa phản ánh message đang xử lý.

Bài tập: consumer gọi payment provider sau DB commit và chết trước lưu kết quả. Thiết kế provider idempotency key/reconciliation; DB dedup một mình không đủ. Tiêu chí đạt: chỉ rõ confirm/commit/ACK boundary và failure windows.

Nguồn: [RabbitMQ confirms](https://www.rabbitmq.com/docs/confirms), [reliability](https://www.rabbitmq.com/docs/reliability), [consumer prefetch](https://www.rabbitmq.com/docs/consumer-prefetch).
