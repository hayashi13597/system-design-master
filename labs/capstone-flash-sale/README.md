# Lab 09: Flash sale với nguồn dữ liệu chuẩn PostgreSQL

## Mục tiêu và hạ tầng

Nginx, 2 API, PostgreSQL, Redis, RabbitMQ, relay, 2 consumer, expiry worker. Mọi dữ liệu nghiệp vụ trong đường chạy chính đều dùng dịch vụ thật. Runtime dùng chung nằm trong `runtime/src` tại root; schema và image trong `infra`. Các ví dụ v1 ở `examples/legacy-simulation` chỉ để tham khảo, không tham gia lệnh chạy chính.

## Chạy từ root repository

```bash
npm ci
npm run lab:up -- 09
npm run lab:test -- 09
npm run lab:benchmark -- 09
npm run lab:down -- 09
```

Gateway: http://localhost:8080. App node: http://localhost:3001 và :3002 (lab 01 thêm :3003). PostgreSQL: localhost:55432, database `lab`, user `postgres`, password `lab_password`. Chạy một lab tại một thời điểm vì các cổng host dùng chung. `down` giữ dữ liệu; `npm run lab:reset -- 09` **xóa volume và dữ liệu của lab** trước khi nạp fixture.

## API và thí nghiệm

POST /api/flash-sale/buy {"userId":"buyer_1","quantity":1} — header Idempotency-Key; GET /api/flash-sale/order/:id; POST /api/flash-sale/order/:id/pay; GET /api/system/status

1.000 người tranh 50 vé: 50 reservation, 950 conflict; kiểm tra SQL trực tiếp. Restart API không mất đơn; broker offline giữ outbox; hết hạn hoàn kho một lần.

Integration test kiểm tra bằng assertion, truy vấn PostgreSQL và broker trực tiếp; test có lỗi trả exit code khác 0. Test cần môi trường sạch, có thể dừng/restart container và thay đổi fixture. Chạy reset trước khi chạy test lại sau một bài thực hành.

## Quan sát và phục hồi

```bash
node scripts/lab.mjs compose 09 logs --tail 30 app-1
node scripts/lab.mjs compose 09 stop app-1
node scripts/lab.mjs compose 09 start app-1
node scripts/lab.mjs compose 09 exec -T postgres psql -U postgres -d lab
```

`/health/live` kiểm tra tiến trình; `/health/ready` kiểm tra dependency phục vụ API; `/metrics` xuất Prometheus; response có `X-Request-ID` và `X-Instance-ID`. Header định danh trong bài học là fixture, chưa phải xác thực production. Benchmark xuất JSON trong `reports/`, tách khỏi kiểm thử đúng/sai.

## Tự đánh giá

Reservation khác đơn đã thanh toán thế nào? Vì sao broker outage không cần rollback đơn đã commit?

Viết nhận xét với số liệu thực trên máy của bạn, chỉ rõ giả định và failure window. Xem tài liệu chuyên đề trong `docs/` và [giới hạn vận hành](../../docs/lab-operations.md).
