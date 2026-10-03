# Lab 02: Caching và stampede

## Mục tiêu và hạ tầng

2 app node, Redis, PostgreSQL. Mọi dữ liệu nghiệp vụ trong đường chạy chính đều dùng dịch vụ thật. Runtime dùng chung nằm trong `runtime/src` tại root; schema và image trong `infra`. Các ví dụ v1 ở `examples/legacy-simulation` chỉ để tham khảo, không tham gia lệnh chạy chính.

## Chạy từ root repository

```bash
npm ci
npm run lab:up -- 02
npm run lab:test -- 02
npm run lab:benchmark -- 02
npm run lab:down -- 02
```

Gateway: http://localhost:8080. App node: http://localhost:3001 và :3002 (lab 01 thêm :3003). PostgreSQL: localhost:55432, database `lab`, user `postgres`, password `lab_password`. Chạy một lab tại một thời điểm vì các cổng host dùng chung. `down` giữ dữ liệu; `npm run lab:reset -- 02` **xóa volume và dữ liệu của lab** trước khi nạp fixture.

## API và thí nghiệm

GET /api/products/1?mode=none|naive|singleflight|distributed; PUT /api/products/1; GET /api/cache/stats

Naive gây nhiều query khi cache miss; distributed khóa dùng chung giảm burst cùng key xuống 1 query khi lease còn hiệu lực. Singleflight chỉ gom trong từng tiến trình. Missing product được negative-cache TTL 500ms.

Integration test kiểm tra bằng assertion, truy vấn PostgreSQL và broker trực tiếp; test có lỗi trả exit code khác 0. Test cần môi trường sạch, có thể dừng/restart container và thay đổi fixture. Chạy reset trước khi chạy test lại sau một bài thực hành.

## Quan sát và phục hồi

```bash
node scripts/lab.mjs compose 02 logs --tail 30 app-1
node scripts/lab.mjs compose 02 stop app-1
node scripts/lab.mjs compose 02 start app-1
node scripts/lab.mjs compose 02 exec -T postgres psql -U postgres -d lab
```

`/health/live` kiểm tra tiến trình; `/health/ready` kiểm tra dependency phục vụ API; `/metrics` xuất Prometheus; response có `X-Request-ID` và `X-Instance-ID`. Header định danh trong bài học là fixture, chưa phải xác thực production. Benchmark xuất JSON trong `reports/`, tách khỏi kiểm thử đúng/sai.

## Tự đánh giá

TTL lock hết hạn trước query thì điều gì xảy ra? Vì sao delete cache sau DB commit vẫn có race với request đang đọc?

Viết nhận xét với số liệu thực trên máy của bạn, chỉ rõ giả định và failure window. Xem tài liệu chuyên đề trong `docs/` và [giới hạn vận hành](../../docs/lab-operations.md).
