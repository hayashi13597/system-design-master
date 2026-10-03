# 00 — Nền tảng và cách giải bài system design

## Mục tiêu và kiến thức đầu vào

Bạn cần viết được một API HTTP, hiểu JSON, SQL `SELECT/INSERT/UPDATE`, Promise và sử dụng terminal. Chưa cần biết Kafka hoặc Kubernetes. Hoàn thành phần này khi bạn giải thích được một request đi qua đâu, tính được tải sơ bộ và phân biệt tính đúng đắn với hiệu năng.

## Quy trình thiết kế

1. **Làm rõ sản phẩm:** ai sử dụng, thao tác nào, dữ liệu nào, quy tắc nào không được vi phạm. Đặt câu hỏi trước khi chọn công nghệ.
2. **Chốt yêu cầu phi chức năng:** tải trung bình/đỉnh, latency percentile, durability, consistency, availability, chi phí và giới hạn thời gian.
3. **Ước tính:** QPS, payload, storage, bandwidth, số kết nối, hot key và tăng trưởng. Ghi giả định, không coi con số ví dụ là benchmark.
4. **Thiết kế API và data model:** request/response, validation, unique constraints, transaction boundary, idempotency và trạng thái nghiệp vụ.
5. **Vẽ phiên bản đơn giản:** client → app → database; tìm bottleneck từ workload trước khi thêm cache, replica, shard hay queue.
6. **Đi sâu một failure window:** DB commit rồi client timeout; message gửi xong nhưng chưa ACK; replica chậm; lock hết hạn.
7. **So sánh lựa chọn:** điều gì được cải thiện, chi phí/độ phức tạp nào tăng và đo bằng cách nào.

Ví dụ URL shortener: cần tạo link, redirect và expiration; analytics có thể xử lý async. Hỏi redirect chấp nhận cache cũ bao lâu và link có cần chống đoán không. Đừng mặc định sharding trước khi biết kích thước dữ liệu.

## Capacity estimation

- 1 triệu người dùng/ngày × 20 request/người ≈ 20 triệu request/ngày ≈ 231 QPS trung bình. Đỉnh 10 lần ≈ 2.310 QPS; đây là giả định cần kiểm chứng.
- Payload 2 KiB × 2.310 QPS ≈ 4,5 MiB/s, chưa gồm headers/TLS, response và replication.
- 100 triệu bản ghi × 200 bytes ≈ 20 GB dữ liệu thô; cần cộng index, WAL, backup và replicas.
- Little's Law trong trạng thái ổn định: concurrency trung bình ≈ throughput × thời gian trong hệ thống. 1.000 request/s × 0,2s ≈ 200 request đang xử lý; không đồng nghĩa 200 DB connections.
- Số app node ≈ tải đỉnh / năng lực đo của một node, rồi cộng headroom. Database/hot key có thể vẫn là bottleneck dù thêm app.

Dùng p95/p99 để nhìn đuôi latency; average che khuất request chậm. Đo throughput **được xử lý thành công** và error rate cùng nhau. Bài stress đẩy tới saturation khác bài soak kéo dài để tìm leak.

## Request đi qua mạng như thế nào?

DNS ánh xạ hostname; TCP thiết lập kết nối có bảo đảm luồng byte; TLS mã hóa và xác thực máy chủ; HTTP mô tả method, headers, status và body. Keep-alive tái sử dụng kết nối; timeout cần riêng cho kết nối, đọc và toàn request. Retry POST chỉ an toàn khi nghiệp vụ có idempotency phù hợp.

CDN cache static assets hoặc nội dung cho phép cache gần người dùng. `Cache-Control`, private/public và `Vary` ảnh hưởng dữ liệu được chia sẻ. Không cache nội dung riêng tư vào key chung. L4 định tuyến theo transport; L7 hiểu HTTP để route theo path/header.

## Chọn nơi lưu dữ liệu

| Loại | Hợp với | Điều cần cân nhắc |
|---|---|---|
| SQL | Transaction nhiều bảng, constraints, truy vấn linh hoạt | Index, contention, isolation, connection pool |
| Key-value | Lookup theo key, cache, quota | Expiration, eviction, durability và hot key |
| Document | Aggregate linh hoạt, dữ liệu theo tài liệu | Index và atomicity theo hệ quản trị |
| Object storage | Ảnh/video/file lớn | Metadata riêng, signed URL, lifecycle, checksum |
| Search index | Full-text và ranking | Là bản sao dẫn xuất, refresh lag và rebuild |

SQL cũng scale được; NoSQL không mặc nhiên nhanh hơn hoặc nhất quán yếu hơn. Chọn theo access pattern và guarantee cụ thể.

## PostgreSQL trước replication và sharding

B-tree index giúp lookup/range nhưng tốn dung lượng và chi phí ghi; column order của index ghép ảnh hưởng truy vấn. Xem `EXPLAIN (ANALYZE, BUFFERS)` để kiểm tra scan, estimated/actual rows và I/O. `ANALYZE` thực thi query, nên cẩn thận với câu ghi.

Read Committed là mặc định PostgreSQL. Chuỗi đọc balance → tính ở app → ghi lại có thể lost update. `UPDATE balance=balance+1`, row lock hoặc mức isolation phù hợp giúp bảo vệ, nhưng Serializable có thể yêu cầu retry cả transaction. Constraints là tuyến phòng thủ cuối, không thay bằng kiểm tra trước ở app.

Pool giới hạn connection; 20 API node × pool 10 có thể tạo 200 connection. Hạn chế concurrency, timeout query và đo pool wait. Thêm replica không chia tải ghi hoặc loại bỏ hot-row contention.

## Lab, tiêu chí đạt và câu hỏi

Chạy [lab 00](../labs/module-00-foundations/). Query theo category chuyển từ sequential scan sang index-based plan; 20 atomic increments giữ đủ 20, trong khi unsafe có lost update. Thảo luận vì sao planner có thể vẫn chọn sequential scan nếu bảng nhỏ hoặc điều kiện trả về phần lớn bảng.

Bài tập: thiết kế service lưu ảnh. Tính storage một năm; chọn nơi lưu bytes/metadata; chỉ ra bước nào cần transaction và xử lý upload thành công nhưng metadata commit thất bại.

Nguồn: [PostgreSQL isolation](https://www.postgresql.org/docs/16/transaction-iso.html), [EXPLAIN](https://www.postgresql.org/docs/16/using-explain.html), [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html).
