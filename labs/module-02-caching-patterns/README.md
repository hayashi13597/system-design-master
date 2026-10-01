# 🧪 THỰC HÀNH LAB 02: CACHING DEEP-DIVE & DEFENSE

> **Mục tiêu thực hành**:
> 1. Trực tiếp so sánh hiệu năng giữa **Không có Cache** vs **Có Cache**.
> 2. Tái hiện hiện tượng **Cache Stampede / Thundering Herd** (khi Hot Key hết hạn, hàng chục request cùng ùa vào đánh nghẽn Database Connection Pool).
> 3. Kiểm chứng sức mạnh của **Singleflight Pattern**: Gom nhóm hàng ngàn request đồng thời thành DUY NHẤT 1 query vào Database.
> 4. Kiểm chứng kỹ thuật **Null Object Caching** chống sự cố **Cache Penetration**.

---

## 🛠️ Cài đặt & Khởi động Server

1. Mở terminal, di chuyển vào thư mục lab và cài đặt dependencies:
   ```bash
   cd labs/module-02-caching-patterns
   npm install
   ```

2. Khởi động server:
   ```bash
   npm run start
   ```
   * Server lắng nghe tại: `http://localhost:3000`
   * Kiểm tra thông số thời gian thực: `http://localhost:3000/api/status`

---

## 🔬 4 Kịch bản Đo kiểm Thực tế

Mở một terminal thứ hai để chạy các lệnh benchmark:

### Kịch bản 1: Không sử dụng Cache (Direct to Database)
```bash
npm run benchmark:no-cache
```
* **Hiện tượng quan sát**: 
  * 100% request đâm thẳng vào Database (`totalQueriesExecuted` tăng vọt bằng đúng số lượng request).
  * Đỉnh kết nối DB (`peakConnections`) chạm trần `8/8` (hết pool, các request bắt đầu bị nghẽn và phải xếp hàng).
  * Độ trễ trung bình bị kéo dài lên tới `60 - 150 ms`.

---

### Kịch bản 2: Cache-Aside ngây thơ (Bị tổn thương bởi Thundering Herd)
```bash
npm run benchmark:naive
```
* **Hiện tượng quan sát**:
  * Khi cache còn hạn, tốc độ cực nhanh (0.5 ms).
  * Tuy nhiên, vì thời gian test là 6 giây mà TTL của cache là 2 giây, cache sẽ bị **hết hạn giữa chừng**.
  * Đúng khoảnh khắc hết hạn, 30 người dùng đồng thời cùng gặp `Cache Miss` và cùng lao vào query DB cùng 1 mili-giây!
  * Số câu query đâm vào DB tăng vọt theo từng đợt hết hạn.

---

### Kịch bản 3: Phòng thủ triệt để với Singleflight Pattern
```bash
npm run benchmark:singleflight
```
* **Hiện tượng quan sát**:
  * Dù 30 kết nối liên tục bắn hàng nghìn request, vào thời điểm cache hết hạn, **Singleflight gom nhóm tất cả lại thành đúng 1 câu query duy nhất vào DB**!
  * Hãy nhìn vào dòng:
    * `Số câu query đâm vào DB`: Chỉ khoảng **2 - 3 queries** trong suốt 6 giây (chỉ query đúng 1 lần cho mỗi chu kỳ TTL 2s)!
    * `Request gom nhóm (Singleflight Suppressed)`: Hàng ngàn cuộc gọi trùng lặp được triệt tiêu hoàn toàn mà không cần chạm vào DB!
  * Đỉnh kết nối DB luôn an toàn ở mức **1 / 8**. Database hoàn toàn không bị sốc tải!

---

### Kịch bản 4: Phòng thủ Thủng Cache (Cache Penetration với Null Object)
```bash
npm run benchmark:penetration
```
* **Hiện tượng quan sát**:
  * Truy vấn sản phẩm ID không tồn tại (`id = 9999`).
  * Nhờ lưu kết quả rỗng `__NULL_OBJECT__` vào Cache với TTL ngắn, chỉ request đầu tiên chạm vào DB.
  * Hàng ngàn request tiếp theo nhận kết quả 404 ngay từ Cache, bảo vệ DB không bị quét cạn tài nguyên.
