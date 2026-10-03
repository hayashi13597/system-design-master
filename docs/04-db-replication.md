# 04 — PostgreSQL replication và read-your-writes

## Mục tiêu

Hiểu replica giúp đọc/dự phòng nhưng không mặc nhiên giữ dữ liệu mới nhất. Phân biệt WAL được nhận, flush và replay; tránh nói “replica đã nhận” đồng nghĩa truy vấn thấy transaction.

## Async và sync

Primary ghi WAL; physical standby nhận và replay WAL để tạo bản sao. Async commit không chờ replica nên có lag và có thể mất acknowledged writes khi failover. Sync chờ số standby/ack stage đã cấu hình, đánh đổi write latency/availability. `remote_write`, flush và `remote_apply` có guarantee khác nhau.

Sync replication chỉ bảo vệ trong failure model phù hợp: phải promote đúng standby chứa dữ liệu, không mất đồng thời mọi bản sao và có fencing ngăn hai primary. Không suy từ hai node thành “RPO=0 trong mọi tình huống”. Replica không phải backup chống xóa nhầm.

```mermaid
sequenceDiagram
 participant C as Client
 participant P as Primary
 participant R as Replica
 C->>P: UPDATE bio; COMMIT
 P-->>C: version + WAL LSN after commit
 C->>R: Read immediately
 R-->>C: Old version if replay lag
 C->>P: Read with min-LSN fallback
 P-->>C: New version
```

## Các mức consistency

Read-your-writes: phiên người dùng đọc thấy write đã xác nhận. Monotonic reads: không đọc lùi về version cũ hơn từng thấy. Linearizability mạnh hơn hai guarantee phiên này; async read replica không tự có nó.

Time-based primary pinning là heuristic: lag có thể dài hơn thời gian ghim, history cục bộ mất khi chuyển app node. Lab dùng token WAL LSN mà client chuyển qua node bất kỳ. Sau COMMIT, primary trả `pg_current_wal_lsn`; replica chỉ phục vụ read khi `pg_last_wal_replay_lsn >= token`, nếu không fallback primary. LSN giữ dạng chuỗi PostgreSQL `pg_lsn`, không ép vào Number JavaScript.

LSN sau commit có thể bao gồm write khác; conservative fallback vẫn an toàn cho read-your-writes, có thể tăng tải primary. Client phải gửi token mới nhất đã nhận. Không tuyên bố monotonic reads nếu client bỏ token hoặc token thiếu write của thiết bị khác.

## Transaction và failover

Trong lab, transaction ghi nằm trên một primary connection. Không chia các statement của cùng transaction sang replica. Read-only transaction có thể chạy replica nếu chấp nhận lag; đây là quyết định theo workload.

Failover production cần detect lỗi, chọn standby, promote, cập nhật routing và fencing primary cũ. Lab chưa tự promote; pause/resume WAL dùng để kiểm chứng lag, không giả lập failover đầy đủ. `wal_keep_size` lab hữu hạn; standby offline quá lâu có thể cần base backup lại.

## Lab và tiêu chí đạt

[Lab 04](../labs/module-04-db-replication/) bootstrap replica bằng `pg_basebackup -R`, replication role và pg_hba. Test pause WAL replay, ghi primary, đọc replica thấy version cũ, gửi X-Min-LSN qua cả hai app node thấy mới, resume rồi đợi version bắt kịp.

Bài tập: trang profile cần read-your-writes nhưng feed chấp nhận lag 5s. Thiết kế hai read policy và cách đo replica replay lag; tính lượng đọc quay về primary khi replica chậm. Tiêu chí đạt: mô tả ACK stage, stale window và failure assumptions.

Nguồn: [PostgreSQL streaming standby](https://www.postgresql.org/docs/16/warm-standby.html), [replication configuration](https://www.postgresql.org/docs/16/runtime-config-replication.html).
