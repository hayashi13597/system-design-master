# Kế hoạch kiểm chứng Chat & Realtime Notification

**Trạng thái: kế hoạch, chưa thực thi các kịch bản bên dưới.** Dự án hiện chỉ có tài liệu; chưa có test runner, ứng dụng, Docker Compose hoặc kết quả đạt 100.000 connection. Các SQL/configuration trong [thiết kế hệ thống](system-design.md) phải được chuyển thành implementation trước khi dùng kế hoạch này làm release gate.

## 1. Các cam kết cần chứng minh

| ID | Invariant | Oracle độc lập với code đang kiểm tra |
|---|---|---|
| I1 | Không mất message đã accepted trong failure model một máy/AZ | Client-side durable ACK journal đối chiếu trực tiếp DB sau failover |
| I2 | Retry cùng key chỉ có một message/seq | Đếm rows message/dedup, so payload hash và response của mọi attempt |
| I3 | Conversation order không đảo, không có lỗ committed seq trong retained interval | Đọc DB theo seq, so unique IDs, local client store và cursor progression |
| I4 | Replay hội tụ, UI không tạo hai bản cùng message | So tập `(conversation, seq)` local với tập DB đủ quyền và còn retention |
| I5 | Không đọc ngoài membership/epoch; revoke theo bounded window | Network capture tại Gateway egress và timestamp revoke từ DB |
| I6 | Presence đúng ngữ nghĩa any-live-session, TTL 30 giây | Redis TIME, session key TTL, deadlines và query aggregate |
| I7 | Bộ nhớ/queues có giới hạn, overload không gây mất ACKed data | RSS/heap/queue metrics, accepted journal và recovery sau overload |
| I8 | Routing cutover không có hai writer | DB ownership audit, coordinator epochs và write attempts tới cả hai owner |

“Không mất” chỉ áp dụng sau khi đã nhận accepted ACK hoặc durable delivered data theo protocol, trong retention và khi user còn quyền. Kết quả gửi chưa biết sau timeout được phân loại riêng; không ép tổng message bằng tổng send attempts. Duplication trên wire được phép; duplicate persisted effect/display không được phép.

## 2. Môi trường, dữ liệu và cách đo

### 2.1. Các tầng kiểm chứng

| Tầng | Môi trường | Chứng minh được | Không suy ra được |
|---|---|---|---|
| Component | Clock kiểm soát, property tests cho cursor/dedup/state machine | Biên, protocol, monotonicity, permissions | Network, fsync hoặc HA thật |
| Integration | Real PostgreSQL 16 primary/standbys, Redis 7+ cluster, ≥ 2 Gateway | Transaction, expiry, retries, Pub/Sub drops, persistence | Single Docker host không chứng minh mất AZ |
| Failure drill | Hosts ở 3 AZ, etcd/Patroni/fencing thật | RPO/RTO theo failure model đã chọn | Mất cả region hoặc corruption đồng thời |
| Capacity | Distributed load generators, topology và data volume ghi rõ | Connection/throughput/latency tại cấu hình đo | Một run nhỏ không chứng minh storage một năm |

Data generator ghi seed, phân bố conversation, group sizes, user/device counts, payload distribution và timeline faults. Tạo ledger riêng trên load-generator disk cho `client_message_id`, request ID, accepted seq, receive/store/ACK timestamps. Journal không lấy từ chính outbox để tránh dùng cùng nguồn lỗi làm oracle.

Client giả lập phải thực hiện local atomic persistence, contiguous cursor, duplicate handling và slow-consumer behavior. Không dùng client chỉ mở socket rồi bỏ mọi data để tuyên bố fan-out đã được kiểm chứng. Đồng bộ clocks giữa hosts; dùng monotonic clock cho latency tại cùng tiến trình và công bố clock-skew cho phép đo xuyên máy.

### 2.2. Workload bắt buộc

| Profile | Cấu hình | Thời lượng / mục đích |
|---|---|---|
| Idle connection | 100.000 authenticated sockets, heartbeat 10s, 1,2 session/user trung bình | 60 phút; FD, TLS, heartbeat, memory và TTL |
| Baseline | 100.000 sockets; 5.000 new message/s; 70% DM/30% group; nhóm trung bình 20; 30% recipient online | Warm-up 15 phút + steady 60 phút; SLO và correctness |
| Fan-out bound | 5.000/s, nhóm 100 online, một session/user; groups đủ để không vi phạm quota | 30 phút; 500.000 deliveries/s trước overhead |
| Multi-device fan-out | Cùng profile nhóm nhưng hai session/user, tổng sockets vẫn 100.000 | 30 phút; tính lại số user và deliveries, không giữ đồng thời hai giả định user/connection mâu thuẫn |
| Burst | 10.000 new message/s trong 60 giây, sau đó 5.000/s | Đo latency, backlog drain và explicit overload responses |
| Long run | Baseline 24 giờ | Leak, outbox cleanup, dedup churn, autovacuum, WAL và pool health |
| History/reconciliation | 20 conversations/session bình quân; watermark 24–30s, auth lease 5s; history 1.000 page requests/s | Chạy đồng thời baseline; không bỏ background reads khỏi phép đo |
| Subscription upper bound | 200 conversations/session, mọi conversation có lưu lượng đủ kích hoạt lease refresh | Đo heap, authorization/reconciliation QPS và admission threshold |
| Reconnect storm | Cắt 10.000 sockets, mỗi session thiếu 100 message, reconnect có jitter | 1 triệu replay message; mục tiêu 95% hoàn tất ≤ 120s sau dependency phục hồi |
| Hot conversation | 50/s steady, burst 100 trong một nhóm; đồng thời nhiều nhóm khác | Đo row-lock/commit RTT và fairness, quá quota trả 429 |

Trên fixture baseline, kỳ vọng khoảng 17.520 socket deliveries/s chỉ là phép tính trước đo. Công bố observed online/session distribution và fan-out thực; không loại sender echo rồi giữ nguyên công thức cũ. Payload fixture trung bình 1 KiB, có đuôi tới 4 KiB; cần thêm Unicode và mention fields.

Benchmark query với các partition tháng rỗng/đầy, conversation có 1 triệu và 10 triệu message, cold cache và warm cache; chạy `EXPLAIN (ANALYZE, BUFFERS)` ở môi trường benchmark. Cần evidence pruning và số rows scanned theo page, không chỉ một câu “đã có index”. Nếu chưa dựng dung lượng tương đương một năm, công bố cỡ dataset thực và hạn chế suy rộng rõ ràng.

## 3. Ma trận correctness và fault injection

### 3.1. Gửi, transaction, idempotency

| Case | Cách tạo tình huống | Kết quả phải thấy |
|---|---|---|
| C01 — Retry đồng thời | 100 attempts cùng key qua nhiều Gateway | Một message, một dedup receipt, một seq; accepted responses trỏ cùng seq |
| C02 — Key đổi payload | Retry key với text/mentions khác | 409, không có message mới, không sửa payload cũ |
| C03 — Crash trước commit | Kill service sau INSERT nhưng trước COMMIT | Rollback hoặc unknown outcome; retry hội tụ về một message |
| C04 — Crash sau durable commit | Kill trước khi gửi ACK | Message/outbox tồn tại; retry nhận seq cũ sau barrier |
| C05 — Lost ACK | Proxy drop server ACK, sender retry | Không tạo bubble/message mới; I1/I2 đúng |
| C06 — Commit cancel | Chặn replication, cancel backend đang chờ sync; đọc retry/history/relay | Không ACK/publish/return row tới client trước barrier hoàn tất; recovery không reuse seq mà client đã durable-store |
| C07 — Rollback sequence | Force constraint error sau increment | last_seq không tăng; lần send kế tiếp dùng seq đúng |
| C08 — Concurrent sends | 5 thiết bị cùng gửi vào một conversation | Unique contiguous committed seq; thứ tự theo commit serialization, không theo client clock |
| C09 — Month boundary retry | Lần gửi cuối tháng, retry đầu tháng | Cùng seq/created_at, không bị partition mới phá dedup |
| C10 — Tuổi UUIDv7 | Future +6 phút, age >365 ngày, ledger cleanup | Từ chối new key không hợp lệ; key cũ không được tái tạo sau ledger expiry |
| C11 — Accepted/event đảo | Deliver event trước ACK hoặc duplicate ACK | Một pending bubble được hợp nhất; không tiến cursor qua gap |
| C12 — Body/mention limits | Unicode vượt byte cap, duplicate mentions, nonmember mention, malformed frame | Validation rõ ràng, rollback toàn transaction, không partial mention |
| C13 — Receipt persistence | Crash sau client ACK trước server coalesced flush | Client resend cursor; eventual receipt hội tụ; không giả server đã commit receipt |
| C14 — Retry sau recipient leave | Send mention thành công, recipient rời nhóm, sender retry cùng key | Trả receipt cũ; không validate mention hiện tại để từ chối một send đã thành công |

Đặc biệt C06 phải dùng chặn replication/cancel thật; mock promise reject không tạo đúng failure window của PostgreSQL. Kiểm tra cả trường hợp driver promise resolve nhưng có protocol WARNING do sync wait bị hủy: adapter phải trả unknown, không accepted hoặc publish. Capture primary/standby WAL positions và timeline để xác minh barrier thay vì chỉ kiểm tra HTTP code.

### 3.2. Relay, replay và lưu trữ client

| Case | Cách tạo tình huống | Kết quả phải thấy |
|---|---|---|
| R01 — Relay crash sau publish | Kill trước mark published | Event được phát lại sau lease; DB/local UI chỉ một message |
| R02 — Worker cũ | Delay worker vượt lease, worker mới claim | Mark cũ bị lease-token condition từ chối; không xóa công việc mới |
| R03 — Redis outage | Ngắt Redis backplane 5 phút khi DB/quota store vẫn khỏe | Sends commit/outbox giữ; realtime degraded; reconnect/periodic DB catch-up bù đủ |
| R04 — Tail loss | Drop đúng event cuối; không gửi message tiếp theo; socket còn mở | Watermark đối soát phát hiện thiếu, p99 catch-up ≤35s sau dependency khỏe |
| R05 — Redis subscriber reconnect | Mất subscription nhưng client socket không mất | Resubscribe, immediate rate-limited reconciliation, không đợi client tự reconnect |
| R06 — Handoff race | Gửi trước subscribe, giữa subscribe/H, sau H | Mọi committed seq đủ quyền được lưu đúng một lần; không lỗ |
| R07 — Out-of-order | Phát 103, 105, 104 và duplicate 103 | Cursor không vượt 103 trước khi 104 đã được lưu; cuối cùng tới 105 |
| R08 — Local crash boundaries | Crash trước local commit, sau commit/trước delivery ACK | Replay lần đầu được lưu; lần hai bị dedup; cursor không cao hơn data |
| R09 — Lost local DB | Server receipt cao nhưng client cache mất | Device mới bootstrap từ floor, không lấy server delivery receipt làm resume proof |
| R10 — Retention giữa pages | Advance clock/cutoff khi đang replay | Explicit 410/reset; không kết luận gap ngoài retention là server mất message |
| R11 — Slow consumer | Giảm tốc đọc socket dưới fan-out, rồi tạm dừng 30s | Bounded queues, close/resync, không OOM hoặc silent message drop |
| R12 — Poison event | Event schema không được hỗ trợ | Durable quarantine + alert; message vẫn có trong history; replay sau fix |
| R13 — Receiver hoàn toàn offline | Publish tới 0 subscribers | Event có thể mark; client online sau đọc được toàn bộ retained messages |
| R14 — Unknown WS event type | Inject additive field và event chưa biết | Field được bỏ qua; event lạ không làm tiến message cursor |
| R15 — Backlog dài có live traffic | Replay backlog đủ lớn để live buffer chạm cap trong khi vẫn có message mới | Coalesce thành rescan hint, replay H tiếp theo, cuối cùng hội tụ; không reconnect loop hoặc tiến cursor theo hint |

### 3.3. Membership, notification và presence

| Case | Cách tạo tình huống | Kết quả phải thấy |
|---|---|---|
| A01 — Join boundary | Add user đồng thời với send | Join floor nhất quán với thứ tự row lock; không đọc tin trước floor |
| A02 — Revoke mất invalidation | Drop membership pubsub event, tiếp tục gửi vào nhóm | Không socket write mới sau lease deadline ≤5s; bytes đã gửi trước đó ghi riêng |
| A03 — Revoke khi replay | Remove user giữa các pages | Pages mới bị từ chối; buffered outbound bị purge; không kéo dài auth nhờ replay |
| A04 — Rejoin epoch | Leave/rejoin, gửi ACK và DELETE cũ | Không áp dụng receipt hoặc remove lên epoch mới |
| A05 — Cursor giả/mượn | Sửa HMAC, đổi conversation/user/mode, dùng cursor người khác | Không lộ message/metadata, không bypass quyền |
| A06 — Cap membership | Hai owner operations thêm người thứ 100/101; joins đồng thời ở nhiều nhóm | Group ≤100, user ≤200; reservation unknown được reconcile, không tự TTL giải phóng sai |
| A07 — Directory đảo event | Deliver join/leave/rejoin versions ngược | Highest version thắng; không resurrect membership; shard vẫn quyết định quyền |
| A08 — Mention/read | Gửi mention, duplicate relay, read từ nhiều devices | Một mention pointer; read chỉ tăng trong epoch; unread theo công thức, count không âm |
| A09 — Receipt vượt H | Device ACK seq chưa được gửi hoặc read vượt token H | Reject, không tạo delivered/read giả vượt phạm vi protocol |
| A10 — Auth lease chậm | Delay auth snapshot response >5s | Lease hết hạn bị bỏ; không bắt đầu lại TTL lúc response về |
| A11 — Heartbeat TTL | Ngừng heartbeat một session, giữ session còn lại | User vẫn online; session hết hạn được dọn |
| A12 — Session cuối hết hạn | Kill Gateway không có disconnect event | Offline trong mục tiêu ≤40s; không phụ thuộc keyspace notification |
| A13 — Disconnect cũ | Renew/register session mới rồi giao disconnect cũ | Session mới tồn tại; không xóa user-wide presence |
| A14 — Expiry/heartbeat race | Sweep và renew cùng thời điểm; drop expired notifications | Script đọc deadline mới, không false-offline khi còn lease |
| A15 — Redis failover | Mất primary Redis, heartbeat write chưa replicate | Unknown/recovery epoch rồi re-register; không ảnh hưởng message cursor |
| A16 — Origin/ticket | Ticket replay, sai Origin, expiry, token vào logs | Reject handshake; không có token/body trong logs |

### 3.4. HA, migration và overload

| Case | Fault | Pass condition |
|---|---|---|
| H01 — Primary host chết | Kill/power-off primary sau ACK journal checkpoint | Mọi accepted ID còn trên promoted DB; RTO đo được, mục tiêu ≤120s |
| H02 — Mất sync standby | Cắt AZ chứa synchronous standby | Write block/chuyển sync an toàn; không local-only ACK |
| H03 — Mất cả AZ | Cắt network/power tất cả thành phần AZ | Surviving Gateway capacity ≥100k; safe primary promotion; eventual replay đủ |
| H04 — Partition control plane | Primary bị cô lập khỏi etcd majority | Primary cũ bị fence; không hai writer và không ACK trái routing |
| H05 — Replica lag | Pause WAL replay trên standby | Primary replay không trả dữ liệu thiếu; failover không chọn replica chưa an toàn |
| H06 — Reshard trước CAS | Crash copy/controller, lỗi hash verification | Source là sole writer hoặc freeze an toàn; resume không mất rows |
| H07 — Reshard sau CAS | Stale router ghi source; controller crash sau switch | Source reject; destination giữ dedup/cursors/outbox; không flip map ngược đơn giản |
| H08 — Metadata recovery | Restore directory/coordinator cùng message shards có timeline kiểm soát | Routing đúng, directory rebuild theo version, không cấp quyền từ stale index |
| H09 — Backup/PITR | Restore shard mới từ base backup + WAL archive | Known accepted IDs trước recovery point đủ, schema/index/receipt nhất quán; đo RTO |
| H10 — Disk/outbox pressure | Redis outage dài, giới hạn disk test volume | Admission trước khi đầy; không xóa pending events/needed WAL |
| H11 — Reconnect storm | 10k sessions mất kết nối; deterministic jitter seed | Handshake/replay fair, accepted latency của user khác đo riêng, target catch-up như workload |
| H12 — Rolling deploy | Drain một node khi tải và một AZ không sẵn sàng | Không thiếu capacity; close có jitter, replay không duplicate effect |
| H13 — Quota Redis mất | Chỉ tắt presence/quota cluster | New send/handshake fail closed; existing authorized history có bounded throughput |
| H14 — DB pool bão hòa | History/replay burst tới shard nóng | Write pool không bị chiếm hết; 503 có retry-after, queue không vô hạn |

Faults dùng hosts/disks/network thật trong môi trường dành cho thử nghiệm. Không chạy kill-AZ, reshard hoặc restore phá dữ liệu trên production để “xác minh nhanh”. Tập accepted IDs phải được snapshot **trước** khi inject fault và bổ sung tất cả ACK nhận sau đó, tránh bỏ sót ACK trong lúc network đang partition.

## 4. Acceptance gates và báo cáo

### 4.1. Release gates

1. **Correctness:** I1–I8 không có vi phạm trong các kịch bản bắt buộc. Mất một accepted message, duplicate persisted message hoặc bypass quyền là fail ngay, không lấy tỷ lệ trung bình để che.
2. **Steady state:** 100k sockets và 5k unique messages/s trong 60 phút sau warm-up; ACK p99 ≤200ms, online delivery p99 ≤500ms và history p99 ≤300ms với network assumptions công bố.
3. **Recovery:** failover một máy/AZ RPO = 0 với ACK journal, mục tiêu RTO ≤120s; tail-loss catch-up p99 ≤35s; 95% reconnect-storm fixture xong ≤120s sau dependency khỏe. Nếu chậm nhưng không mất dữ liệu, báo đúng là chưa đạt RTO/capacity.
4. **Resource:** queues không vượt cap, bộ nhớ không tăng không giới hạn trong 24h, có đủ headroom cho mất AZ. Disk/WAL/outbox cleanup và background reads nằm trong phép đo.
5. **Operations:** restore/PITR đã diễn tập, alerts đúng người trực, dashboard/trace có thể xác định nơi ACK hoặc event bị chậm; rollout/rollback procedure đã chạy staging.

99,9%/tháng cần quan sát vận hành theo tháng; một giờ load test không chứng nhận SLO availability. Mốc throughput chỉ đạt nếu đếm unique message đã accepted, không tính 429/503/retry là business success. Realtime throughput phải đếm cả receiver deliveries, không chỉ số publisher requests.

### 4.2. Nội dung report bắt buộc khi có implementation

Lưu report tương lai dưới thư mục dự án với ngày/run ID; chưa tạo report giả cho thiết kế này. Report cần ghi:

- Git SHA, protocol/schema versions, generator seed và thời gian UTC bắt đầu/kết thúc.
- Sơ đồ hosts/AZ, CPU/RAM/disks/IOPS, kernel/FD settings, component versions, config checksum và network RTT.
- Workload thực: unique users/devices/conversations, payload histogram, group distribution, new sends, retries, accepted, rejected và fan-out factor.
- Histograms p50/p95/p99/max, sample count, missing ACKs, offline exclusions, queue/heap/CPU/NIC/DB/WAL charts trước-trong-sau fault.
- Fault timeline, accepted journal checksum, direct DB/local-store reconciliation results, recovery time và mọi invariant violation.
- Dataset size/age, warm/cold cache, query plans, physical storage amplification và phạm vi không được kiểm chứng.

Không tự chấm “pass” cho case chưa chạy. Dùng trạng thái `NOT_RUN`, `PASS`, `FAIL`, `BLOCKED` với evidence link và lý do cho từng case. Một failure có workaround vẫn cần rerun case liên quan trước khi đổi trạng thái.

## 5. Review theo rubric của repo

| Tiêu chí | Trọng số | Bằng chứng cần reviewer tìm trong thiết kế |
|---|---:|---|
| Yêu cầu và assumptions | 15 | 5k/s sustained, multi-device, retention, revoke window, failure model và SLO denominator |
| Ước tính và bottleneck | 15 | 157,68 tỷ tin/năm; storage multiplier; FD/memory; fan-out; background auth/reconciliation; hot conversation |
| API/data model | 20 | Cursor/epoch/key semantics, unique constraints, retention/partition limits, mutation idempotency |
| Kiến trúc và trade-off | 20 | Vì sao DB/outbox/PubSub, sync replication, visibility barrier, không tự hứa ordering từ relay |
| Failure recovery | 20 | Commit/ACK cancellation, tail loss, local atomic cursor, failover fencing, reshard và retention |
| Vận hành và kiểm chứng | 10 | Workloads, metrics, runbooks, backup/restore và ranh giới test thực tế |

Rubric gốc ở [bài tập thiết kế](../../../docs/11-design-exercises.md). Không tự gán 100/100 chỉ vì đủ đề mục: reviewer cần đi theo một message qua từng failure window và đối chiếu protocol, schema, sizing cùng test oracle.
