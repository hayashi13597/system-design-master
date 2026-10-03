# Vận hành lab và giới hạn

## Tổ chức repository

Runtime TypeScript dùng chung: `runtime/src/core.ts` quản lý DB/Redis/metrics, `lessons.ts` route bài học, `capstone.ts` transaction reservation, `broker.ts` outbox/consumer và `sharding.ts` routing. Các lab dùng image build từ root `infra/Dockerfile`, schema chung idempotent cho fixture. Dùng chung runtime giảm sai lệch giữa bài học; mỗi Compose chỉ bật dịch vụ cần thiết.

Compose được lưu dạng JSON hợp lệ với YAML parser của Docker Compose. Chỉnh `scripts/generate-compose.py` rồi chạy `python3 scripts/generate-compose.py` để sinh lại cấu hình; không chỉnh file sinh bằng tay. Dùng `node scripts/lab.mjs compose <lab> ...` để gọi Docker Compose trong đúng project.

## Lệnh và dữ liệu

- `npm ci`: cài dependency tại root. Không cần install riêng từng thư mục lab.
- `npm run lab:up -- 04`: build image, chạy dịch vụ và đợi healthcheck.
- `npm run lab:test -- 04`: integration assertions; cần lab đã chạy. Tests sửa fixture và tạo lỗi bằng stop/restart.
- `npm run lab:down -- 04`: dừng, giữ named volumes.
- `npm run lab:down -- 04 --volumes`: xóa cả dữ liệu của lab 04.
- `npm run lab:reset -- 04`: xóa volume rồi nạp fixture mới.
- `node scripts/verify-all.mjs`: chạy cả 11 lab lần lượt, **xóa volume từng project lab** trước/sau test, ghi log/kết quả vào `reports/`.

Tất cả host ports bind localhost; không expose lên mạng công khai. Mật khẩu là fixture lab, không chứa secret production. PostgreSQL host :55432; Redis :56379; RabbitMQ :55672, management :15672; Kafka external :19092. User RabbitMQ là `lab`, password `lab_password`; PostgreSQL database `lab`, user `postgres`, cùng password.

## Debug

```bash
node scripts/lab.mjs compose 04 ps
node scripts/lab.mjs compose 04 logs --tail 80
node scripts/lab.mjs compose 04 exec -T postgres psql -U postgres -d lab -c 'SELECT pg_current_wal_lsn();'
node scripts/lab.mjs compose 04 exec -T replica1 psql -U postgres -d lab -c 'SELECT pg_last_wal_replay_lsn();'
```

Nếu bind port thất bại: down lab trước đó, không tự kill process khác. Nếu init schema thay đổi mà volume cũ còn, reset lab để tránh schema cũ; repo chưa có migration nâng cấp dữ liệu v1. Nếu replica không lên: xem init log, kiểm tra primary replication role, pg_hba, pg_basebackup và credential trong standby conninfo.

App local có thể chạy `LAB=02 DB_URL=postgres://postgres:lab_password@localhost:55432/lab REDIS_URL=redis://localhost:56379 PORT=3006 npm start` khi hạ tầng Docker của lab đã chạy. Không fallback sang RAM; Compose vẫn là đường chạy chuẩn đã kiểm thử.

## Failure injection

- Replication: `SELECT pg_wal_replay_pause()` rồi `pg_wal_replay_resume()` trên replica; không sửa response để giả stale.
- Broker outage: `stop rabbitmq`/`stop redpanda`, gửi API, truy vấn outbox, `start` broker và chờ pending giảm.
- Crash relay: dừng relay chính, chạy `compose run --rm --no-deps -e CRASH_AFTER_PUBLISH=1 relay`; exit 86 sau publish, event vẫn pending, sau đó start relay chính.
- Crash consumer: dừng consumer thường, chạy `compose run --rm --no-deps -e CRASH_BEFORE_ACK=1 consumer-1`; exit 87 sau DB commit, sau đó start consumers thường và kiểm tra dedup.
- Reshard: `node scripts/lab.mjs reshard 05`; bật shard4, maintenance lock, copy/verify rồi đổi routing. Khi copy lỗi, giữ MAINTENANCE và nguồn cũ; sửa lỗi rồi chạy lại. Sau đổi routing nếu cleanup lỗi, chạy lại để loại bản sao thừa. Đây không phải online reshard hay distributed transaction giữa shard và coordinator.

## Giới hạn cần ghi rõ

Một host, một primary DB, một Redis và một broker không có HA trước host/disk loss. Volumes không phải backup. Worker/relay dùng at-least-once; exactly-once **effect trong DB** phụ thuộc unique key và local transaction, không bao gồm email/payment provider bên ngoài. Kafka lab mặc định auto-create một partition và replication factor 1; chưa minh họa quorum broker hoặc Kafka transactions. Polling outbox có chi phí query/row lock; CDC chỉ được giải thích trong tài liệu.

Cache-aside delete-after-write vẫn có race với reader đang tái tạo cache; TTL giới hạn stale, không biến cache thành linearizable store. Distributed cache lock là tối ưu tải, không phải nguồn tính đúng đắn nghiệp vụ. Sliding-window counter là xấp xỉ; token bucket refill theo thời gian nên một burst không thể mặc định luôn đúng 25 response khi test kéo dài.

Fencing kiểm tra tại tài nguyên đích ngăn token cũ ghi sau token mới đã áp dụng. Nó không chứng minh lease luôn hợp lệ tại thời điểm DB write, không làm Redis failover linearizable và không thay business constraints. Snowflake yêu cầu worker ID duy nhất; clone node với cùng worker ID có thể trùng ID.

Runtime tách liveness/readiness. Worker không có HTTP readiness endpoint; Compose `--wait` chỉ chứng minh worker đang chạy, integration test mới chứng minh pipeline thực sự xử lý dữ liệu.
