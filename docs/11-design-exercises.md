# Bài tập thiết kế và rubric

Viết mỗi bài thành một tài liệu có yêu cầu, giả định, phép tính, API/data model, sơ đồ, quyết định và failure recovery. Các workload dưới đây là fixture để suy luận; không phải benchmark đã đạt. Thời lượng gợi ý 60–90 phút/bài, sau đó sửa thiết kế theo phản biện.

## 1. URL shortener

Yêu cầu: tạo link, redirect, expiration và analytics theo ngày. 1 triệu link mới/ngày, 100 triệu redirect/ngày, peak 10 lần average, lưu 3 năm; redirect p99 mục tiêu 100ms trong cùng region. Link private phải kiểm tra quyền, không được chia sẻ qua cache công khai.

Quyết định cần giải thích: random ID hay sequence, collision, data model, TTL/cache invalidation, hot link, index và write amplification. API tối thiểu `POST /links`, `GET /:code`, `DELETE /links/:id`. Analytics async có thể eventual; redirect link vừa xóa được cũ bao lâu phải ghi rõ.

Thử phản biện: cùng key tạo link hai lần khi client timeout; một link chiếm 50% traffic; cache sập; analytics broker offline. Bài đạt khi redirect không phụ thuộc analytics, estimate storage có index/replicas và giải thích rõ cache staleness.

## 2. Chat

Yêu cầu: chat 1–1 và nhóm tối đa 100 người, 100.000 connection đồng thời, 5.000 message/s, lịch sử 1 năm, multi-device, người offline đọc lại. Ordering theo conversation; không yêu cầu total order toàn hệ thống. Message đã ACK phải tồn tại sau app restart.

API/capability tối thiểu: WebSocket send/receive với client message ID, reconnect từ cursor; HTTP lịch sử paginated theo conversation. Chọn partition/shard key, persistent message log, fan-out, backpressure và presence TTL. Phân biệt sent/delivered/read; ghi rõ cursor có thể replay và client dedup thế nào.

Thử phản biện: reconnect 10.000 client cùng lúc; slow consumer; message đã lưu nhưng app chết trước ACK; nhiều thiết bị gửi đồng thời. Bài đạt khi ACK boundary gắn với durable store, replay không mất message và không hứa WebSocket memory có durability.

## 3. File storage

Yêu cầu: upload tối đa 1 GiB/file, 100.000 upload/ngày, average 10 MiB, resumable upload, sharing có expiration, quota 100 GiB/user, retention 1 năm. Bytes lưu object storage; metadata/quota lưu DB. Tính storage thô rồi cộng versioning/replication theo giả định riêng.

API tối thiểu: initiate upload, signed upload URL, complete, get signed download URL và delete. Chọn checksum, multipart, trạng thái UPLOADING/READY/DELETED, quota reservation và orphan cleanup; URL download phải kiểm tra quyền trước khi ký.

Thử phản biện: upload xong nhưng complete timeout; file thiếu part; malware scan thất bại; DB metadata đã xóa nhưng object delete thất bại. Bài đạt khi bytes/metadata failure window có reconciliation và retry không tính quota hai lần.

## Rubric chung — 100 điểm

| Tiêu chí | Điểm | Bằng chứng cần có |
|---|---:|---|
| Yêu cầu và assumptions | 15 | Phân biệt functional, SLO, constraints, consistency |
| Ước tính và bottleneck | 15 | QPS, bandwidth/storage, peak, hot key, headroom |
| API/data model | 20 | Validation, index/constraints, pagination, idempotency |
| Kiến trúc và trade-off | 20 | Một baseline đơn giản; giải thích mỗi thành phần thêm vào |
| Failure recovery | 20 | Ít nhất 3 failure windows, ACK/commit boundary, replay/compensation |
| Vận hành và kiểm chứng | 10 | Metrics, test scenario, backup/recovery và giới hạn |

Mức đạt: ≥70 điểm, không có lỗi nghiêm trọng mất dữ liệu đã ACK hoặc bypass quyền truy cập. Không cộng điểm chỉ vì liệt kê nhiều công nghệ. Nếu thiết kế phụ thuộc giả định mạnh, ghi giả định đó và thí nghiệm cần làm để xác nhận.
