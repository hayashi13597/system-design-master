# 🧪 THỰC HÀNH LAB 07: MESSAGE QUEUES, DLQ & IDEMPOTENCY

> **Mục tiêu thực hành**:
> 1. Trực tiếp kiểm chứng cơ chế **At-Least-Once Delivery**: Khi cổng thanh toán retry gửi lại 10 lần cùng một webhook giao dịch, **Idempotent Consumer Pattern** đảm bảo chỉ cộng tiền ĐÚNG 1 LẦN duy nhất.
> 2. Trực tiếp quan sát thảm họa **Poison Message (Tin nhắn có độc)**: Cơ chế **Dead Letter Queue (DLQ)** kết hợp **Exponential Backoff Retry** giúp cách ly tin nhắn lỗi sang một hàng đợi riêng, bảo vệ hàng đợi chính không bao giờ bị nghẽn (Head-of-Line Blocking).

---

## 🛠️ Cài đặt & Khởi động Server

1. Mở terminal, di chuyển vào thư mục lab và cài đặt dependencies:
   ```bash
   cd labs/module-07-message-queues
   npm install
   npm run build
   ```

2. Khởi động server:
   ```bash
   npm run start
   ```
   * Server lắng nghe tại: `http://localhost:3000`
   * Xem số dư ví: `http://localhost:3000/api/account`
   * Xem trạng thái Hàng đợi/DLQ: `http://localhost:3000/api/queue/status`

---

## 🔬 2 Bài Thí nghiệm Thực chiến

### Thí nghiệm 1: Chạy Script Đo kiểm Tự động (Benchmark)

Mở terminal thứ hai và chạy:
```bash
npm run test:idempotency
```

* **Kết quả quan sát**:
  1. **Bài test 1: Cổng thanh toán Retry 10 lần cùng 1 giao dịch**:
     * Cổng thanh toán gửi 10 webhooks liên tiếp nạp 100,000đ.
     * Consumer phát hiện **9 giao dịch trùng lặp** và triệt tiêu.
     * Số dư tài khoản tăng **ĐÚNG 100,000đ** (thay vì bị cộng lố lên 1,000,000đ!).
  2. **Bài test 2: Tin nhắn có độc & Dead Letter Queue (DLQ)**:
     * Gửi 1 tin nhắn hỏng kèm theo 2 giao dịch hợp lệ.
     * Broker tự động retry 3 lần với Exponential Backoff (40ms, 80ms, 160ms).
     * Khi hết 3 lần, tin nhắn độc tự động bị cách ly vào **Dead Letter Queue (`deadLetterQueueSize: 1`)**.
     * Hàng đợi chính thông suốt hoàn toàn, 2 giao dịch hợp lệ sau đó được xử lý thành công!

---

### Thí nghiệm 2: Kiểm thử thủ công bằng cURL

1. **Gửi một giao dịch nạp tiền lần 1**:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/payment \
     -H "Content-Type: application/json" \
     -d '{"idempotencyKey": "TX_TEST_01", "amount": 250000}'
   ```
   * Server phản hồi `202 Accepted` ngay lập tức trong 2ms!

2. **Xem số dư tài khoản**:
   ```bash
   curl http://localhost:3000/api/account
   ```
   * `"currentBalance": 250000`.

3. **Cố tình gửi lại đúng giao dịch đó lần 2 (Mô phỏng mạng retry)**:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/payment \
     -H "Content-Type: application/json" \
     -d '{"idempotencyKey": "TX_TEST_01", "amount": 250000}'
   ```
   * Kiểm tra lại số dư: Vẫn giữ nguyên `250,000đ`, trường `"duplicatesPrevented": 1` tăng lên!

4. **Gửi một tin nhắn độc hại để xem nó vào DLQ**:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/poison-message \
     -H "Content-Type: application/json" \
     -d '{"idempotencyKey": "MALICIOUS_BOT"}'
   ```
   * Sau 1 giây, kiểm tra `http://localhost:3000/api/queue/status`: Bạn sẽ thấy tin nhắn này đã nằm gọn trong `deadLetterMessages`!
