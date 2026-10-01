# 🧪 THỰC HÀNH LAB 03: DISTRIBUTED RATE LIMITING & TRAFFIC SHAPING

> **Mục tiêu thực hành**:
> 1. Trực tiếp kiểm chứng lỗ hổng **Race Condition (TOCTOU)** trong các Rate Limiter viết ẩu, khiến lưu lượng bị lọt qua (Traffic Leak) dù đã cấu hình limit.
> 2. Kiểm chứng thuật toán **Atomic Sliding Window Counter** (chuẩn Cloudflare): Chặn đứng lưu lượng vượt ngưỡng nghiêm ngặt và chính xác.
> 3. Trải nghiệm cơ chế **Token Bucket**: Cho phép các đợt lưu lượng bùng nổ (Traffic Burst) an toàn.
> 4. Kiểm tra các chuẩn HTTP Headers quốc tế: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, và `Retry-After`.

---

## 🛠️ Cài đặt & Khởi động Server

1. Mở terminal, di chuyển vào thư mục lab và cài đặt thư viện:
   ```bash
   cd labs/module-03-rate-limiter
   npm install
   ```

2. Khởi động server:
   ```bash
   npm run start
   ```
   * Server lắng nghe tại: `http://localhost:3000`
   * Giới hạn cấu hình cho bài test: **25 requests / 1 giây**

---

## 🔬 4 Kịch bản Đo kiểm Thực tế

Mở một terminal thứ hai để chạy các lệnh benchmark:

### Kịch bản 1: API không được bảo vệ (Unprotected)
```bash
npm run benchmark:unprotected
```
* **Hiện tượng quan sát**: 100% request đều lọt qua (200 OK). Nếu có botnet hoặc DDOS, toàn bộ backend và DB phía sau sẽ gánh trọn tải.

---

### Kịch bản 2: Rate Limiter ngây thơ bị lỗi Race Condition (TOCTOU Leakage)
```bash
npm run benchmark:vulnerable
```
* **Hiện tượng quan sát**:
  * Giới hạn lý thuyết trong 2 giây là $\sim 50$ requests ($25 \times 2$).
  * Nhưng vì thuật toán non-atomic (đọc counter từ cache $\rightarrow$ chờ $\rightarrow$ kiểm tra $\rightarrow$ ghi counter), các request đồng thời cùng đọc ra giá trị cũ.
  * **Hậu quả**: Hàng chục đến hàng trăm request **bị lọt qua rào chắn** (Số request 200 OK cao hơn nhiều so với 50)! Hệ thống bị lọt tải nghiêm trọng.

---

### Kịch bản 3: Phòng thủ nghiêm ngặt với Atomic Sliding Window Limiter
```bash
npm run benchmark:atomic
```
* **Hiện tượng quan sát**:
  * Thuật toán Atomic Sliding Window Counter (tương đương với việc chạy **Lua Script** nguyên tử trong Redis).
  * Trong 2 giây, số lượng request thành công (200 OK) được giới hạn **chính xác tuyệt đối xung quanh mức ~50 requests**.
  * Toàn bộ hàng ngàn request vượt ngưỡng còn lại đều bị chặn đứng ngay lập tức với mã lỗi **`429 Too Many Requests`**!

---

### Kịch bản 4: Kiểm tra HTTP Headers chuẩn bằng cURL
Gửi 1 request đơn lẻ bằng cURL để xem các headers phản hồi:
```bash
curl -i http://localhost:3000/api/atomic-sliding
```
Quan sát các headers trả về trong phản hồi HTTP:
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 25
X-RateLimit-Remaining: 24
X-RateLimit-Reset: 1727827250
```

Nếu bạn gửi liên tục vượt quá 25 request, bạn sẽ nhận được:
```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 25
X-RateLimit-Remaining: 0
Retry-After: 1
```
Client có thể đọc header `Retry-After: 1` để tự động lập lịch thử lại sau 1 giây mà không cần đoán mò!
