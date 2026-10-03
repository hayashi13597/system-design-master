# Lab 07: RabbitMQ và idempotent consumer

## Mục tiêu và hạ tầng

RabbitMQ, PostgreSQL, 2 API và 2 consumer. Mọi dữ liệu nghiệp vụ trong đường chạy chính đều dùng dịch vụ thật. Runtime dùng chung nằm trong `runtime/src` tại root; schema và image trong `infra`. Các ví dụ v1 ở `examples/legacy-simulation` chỉ để tham khảo, không tham gia lệnh chạy chính.

## Chạy từ root repository

```bash
npm ci
npm run lab:up -- 07
npm run lab:test -- 07
npm run lab:benchmark -- 07
npm run lab:down -- 07
```

Gateway: http://localhost:8080. App node: http://localhost:3001 và :3002 (lab 01 thêm :3003). PostgreSQL: localhost:55432, database `lab`, user `postgres`, password `lab_password`. Chạy một lab tại một thời điểm vì các cổng host dùng chung. `down` giữ dữ liệu; `npm run lab:reset -- 07` **xóa volume và dữ liệu của lab** trước khi nạp fixture.

## API và thí nghiệm

POST /api/payments {"idempotencyKey":"p1","amount":100}; GET /api/payments/balance

Gửi 30 message trùng: balance chỉ tăng 100. Poison message thêm poison:true đi retry rồi DLQ. Crash sau commit trước ACK không cộng tiền lần hai.

Integration test kiểm tra bằng assertion, truy vấn PostgreSQL và broker trực tiếp; test có lỗi trả exit code khác 0. Test cần môi trường sạch, có thể dừng/restart container và thay đổi fixture. Chạy reset trước khi chạy test lại sau một bài thực hành.

## Quan sát và phục hồi

```bash
node scripts/lab.mjs compose 07 logs --tail 30 app-1
node scripts/lab.mjs compose 07 stop app-1
node scripts/lab.mjs compose 07 start app-1
node scripts/lab.mjs compose 07 exec -T postgres psql -U postgres -d lab
```

`/health/live` kiểm tra tiến trình; `/health/ready` kiểm tra dependency phục vụ API; `/metrics` xuất Prometheus; response có `X-Request-ID` và `X-Instance-ID`. Header định danh trong bài học là fixture, chưa phải xác thực production. Benchmark xuất JSON trong `reports/`, tách khỏi kiểm thử đúng/sai.

## Tự đánh giá

Tại sao processed key phải commit cùng balance? DLQ cần quy trình kiểm tra và replay nào?

Viết nhận xét với số liệu thực trên máy của bạn, chỉ rõ giả định và failure window. Xem tài liệu chuyên đề trong `docs/` và [giới hạn vận hành](../../docs/lab-operations.md).
