# 🧪 THỰC HÀNH LAB 06: DISTRIBUTED LOCK & CHỐNG BÁN ÂM KHO (OVERSELLING)

> **Mục tiêu thực hành**:
> 1. Trực tiếp tái hiện lỗi tương tranh kinh điển trong thương mại điện tử: **Bán âm hàng tồn kho (Overselling / Double Spending)** khi nhiều khách hàng cùng tranh mua số lượng hàng có hạn.
> 2. Kiểm chứng giải pháp **Distributed Lock (Khóa phân tán chuẩn Redis)**:
>    * Acquire nguyên tử: `SET NX PX`.
>    * Release an toàn bằng **Lua Script**: Chống xóa nhầm lock của tiến trình khác khi bị trễ mạng/GC pause.
>    * Fencing Token: Mã số tự tăng bảo vệ tầng cơ sở dữ liệu.
> 3. Chứng minh: Kho có đúng 5 sản phẩm $\rightarrow$ Chỉ đúng 5 đơn thành công, các khách hàng còn lại nhận thông báo Hết Hàng, kho về 0 không bao giờ bị âm!

---

## 🛠️ Cài đặt & Khởi động Server

1. Mở terminal, di chuyển vào thư mục lab và cài đặt dependencies:
   ```bash
   cd labs/module-06-distributed-lock
   npm install
   npm run build
   ```

2. Khởi động server:
   ```bash
   npm run start
   ```
   * Server lắng nghe tại: `http://localhost:3000`
   * Xem tình trạng kho hàng & số liệu Lock: `http://localhost:3000/api/inventory`

---

## 🔬 2 Bài Thí nghiệm Thực chiến

### Thí nghiệm 1: Chạy Script Đo kiểm Tự động (Benchmark)

Mở terminal thứ hai và chạy:
```bash
npm run test:overselling
```

* **Kịch bản kiểm thử**:
  1. Kho khởi tạo có **ĐÚNG 5 SẢN PHẨM**.
  2. Bắn 20 kết nối đồng thời trong 2 giây vào kịch bản **Unsafe Buy** (không khóa).
  3. Bắn 20 kết nối đồng thời trong 2 giây vào kịch bản **Locked Buy** (có Distributed Lock).
* **Kết quả quan sát**:
  * **Kịch bản Unsafe Buy**: Bán được **hơn 20 đơn hàng** trong khi kho chỉ có 5 cái! Tồn kho bị âm nghiêm trọng (`currentStock < 0`).
  * **Kịch bản Locked Buy**: Đạt độ chính xác tuyệt đối **ĐÚNG 5 ĐƠN HÀNG** được tạo, 0 lần vi phạm bán âm, tồn kho dừng lại ở mức **0**!

---

### Thí nghiệm 2: Thử nghiệm thủ công bằng cURL

1. **Xem trạng thái kho hàng ban đầu**:
   ```bash
   curl http://localhost:3000/api/inventory
   ```
   * `"currentStock": 5`, `"totalOrdersCreated": 0`.

2. **Thực hiện mua 1 đơn hàng an toàn với Distributed Lock**:
   ```bash
   curl -X POST http://localhost:3000/api/buy/locked \
     -H "Content-Type: application/json" \
     -d '{"userId": "alice_01"}'
   ```
   * Nhận phản hồi thành công kèm `fencingToken` và số lượng tồn kho còn lại là `4`.

3. **Reset kho hàng về 5 chiếc**:
   ```bash
   curl -X POST http://localhost:3000/api/inventory/reset
   ```
