# 🧪 THỰC HÀNH LAB 04: DATABASE REPLICATION & READ/WRITE SPLITTING

> **Mục tiêu thực hành**:
> 1. Trực tiếp quan sát và tái hiện sự cố **Replication Lag**: Người dùng vừa cập nhật dữ liệu ở Primary, nhưng đọc ngay lập tức từ Replica thì bị trả về dữ liệu cũ (Stale Read).
> 2. Kiểm chứng giải pháp **Smart Database Router** với cơ chế **Read-Your-Own-Writes Consistency (Time-based Pinning & LSN Tracking)**.
> 3. Hiểu rõ quy tắc bắt buộc: Mọi câu truy vấn nằm trong **Transaction** phải được ghim vào Primary Database.

---

## 🛠️ Cài đặt & Khởi động Server

1. Mở terminal, di chuyển vào thư mục lab và cài đặt dependencies:
   ```bash
   cd labs/module-04-db-replication
   npm install
   ```

2. Khởi động server:
   ```bash
   npm run start
   ```
   * Server lắng nghe tại: `http://localhost:3000`
   * Kiểm tra thông số Cluster & Replication Lag: `http://localhost:3000/api/cluster/status`

---

## 🔬 2 Thí nghiệm Kiến trúc Trực quan

### Thí nghiệm 1: Chạy Script Đo kiểm Tự động (Benchmark)

Mở một terminal thứ hai và chạy:
```bash
npm run test:replication
```
* **Kịch bản kiểm thử**: Script sẽ thực hiện 30 chu kỳ liên tiếp:
  1. Gửi request `POST` cập nhật Bio lên Primary.
  2. Gửi request `GET` đọc lại ngay lập tức (0ms delay).
* **Kết quả quan sát**:
  * **Naive Router**: Tỷ lệ đọc phải dữ liệu cũ (Stale Data) lên tới **$50\%$** vì một nửa số request đọc bị điều hướng vào Replica-2 đang bị lag 400ms!
  * **Consistent Router**: Tỷ lệ Stale Data là **$0\%$** nhờ cơ chế Time-based Pinning tự động ghim request đọc của người vừa ghi vào Primary trong 1 giây!

---

### Thí nghiệm 2: Kiểm chứng thủ công bằng cURL

1. **Xem trạng thái cụm Database**:
   ```bash
   curl http://localhost:3000/api/cluster/status
   ```
   Bạn sẽ thấy: Primary đang ở `LSN = 100`, Replica-1 (lag 50ms), Replica-2 (lag 400ms).

2. **Cập nhật Bio mới cho User**:
   ```bash
   curl -X POST http://localhost:3000/api/users/user_1/bio \
     -H "Content-Type: application/json" \
     -d '{"bio":"Avatar và Bio vừa đổi lúc 10h!"}'
   ```
   * Primary tăng LSN lên `101`, trả về `newVersion = 2`.

3. **Thử đọc bằng Naive Router (ngay lập tức)**:
   ```bash
   curl "http://localhost:3000/api/naive/users/user_1/bio?expectedVersion=2"
   ```
   * Nếu request rơi vào Replica-2 (đang lag 400ms), bạn sẽ thấy:
     `"isStale": true`, `"bio": "Bio ban đầu..."` $\rightarrow$ **Người dùng F5 thấy dữ liệu cũ!**

4. **Thử đọc bằng Consistent Router**:
   ```bash
   curl "http://localhost:3000/api/consistent/users/user_1/bio?expectedVersion=2"
   ```
   * Phản hồi trả về:
     `"servedBy": "PRIMARY (Routed via Read-Your-Own-Writes Pinning)"`, `"isStale": false` $\rightarrow$ **Dữ liệu luôn tươi mới 100%!**

5. **Kiểm tra Transaction Context**:
   ```bash
   curl -X POST http://localhost:3000/api/orders/checkout
   ```
   * Đảm bảo toàn bộ các thao tác trong chuỗi thanh toán đều được thực thi trên Primary.
