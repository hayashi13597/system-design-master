# 🧪 THỰC HÀNH LAB 05: SHARDING, CONSISTENT HASHING & SNOWFLAKE ID

> **Mục tiêu thực hành**:
> 1. Trực tiếp kiểm chứng hiệu năng và cơ chế sinh mã của **Twitter Snowflake ID** (64-bit BigInt): Đảm bảo tính duy nhất phân tán và sắp xếp tự nhiên theo thời gian (Time-Sortable).
> 2. Đo đạc sự chênh lệch to lớn giữa **Modulo Hashing** vs **Consistent Hashing**: Thấy rõ tại sao Modulo làm xáo trộn $75\%$ dữ liệu khi scale từ 3 lên 4 shards, trong khi Consistent Hashing chỉ di chuyển đúng $\sim 25\%$.
> 3. Trải nghiệm 2 cơ chế định tuyến phân tán:
>    * **Point Query ($O(1)$)**: Dùng Shard Key định tuyến thẳng vào đúng 1 Shard duy nhất.
>    * **Scatter-Gather**: Bắn truy vấn song song tới tất cả các Shards và gom nhóm kết quả khi không có Shard Key.

---

## 🛠️ Cài đặt & Khởi động Server

1. Mở terminal, di chuyển vào thư mục lab và cài đặt dependencies:
   ```bash
   cd labs/module-05-db-sharding
   npm install
   npm run build
   ```

2. Khởi động server:
   ```bash
   npm run start
   ```
   * Server lắng nghe tại: `http://localhost:3000`
   * Xem phân bổ Shard: `http://localhost:3000/api/cluster/distribution`

---

## 🔬 2 Bài Thí nghiệm Thực chiến

### Thí nghiệm 1: Chạy Script Đo kiểm Tự động (Benchmark)

Mở terminal thứ hai và chạy:
```bash
npm run test:sharding
```

* **Phần 1: Kiểm thử Snowflake ID**:
  * Sinh **10,000 IDs** liên tiếp trong vài mili-giây.
  * Kiểm tra tính duy nhất ($100\%$ Unique) và kiểm tra tính sắp xếp tăng dần theo thời gian (Time-sortable).
* **Phần 2: Thảm họa Re-sharding (Modulo vs Consistent Hashing)**:
  * So sánh tỷ lệ dữ liệu bị đổi node khi bổ sung thêm Shard thứ 4 vào cụm:
    * Modulo Hashing: **$\sim 75\%$** số bản ghi bị văng sang node khác!
    * Consistent Hashing: Chỉ đúng **$\sim 25\%$** số bản ghi phải di chuyển!

---

### Thí nghiệm 2: Kiểm thử Cụm Sharding Thực tế với cURL

1. **Nạp thử 300 Users vào Cụm**:
   ```bash
   curl -X POST http://localhost:3000/api/cluster/seed \
     -H "Content-Type: application/json" \
     -d '{"count": 300}'
   ```

2. **Xem dữ liệu được phân bổ đồng đều giữa 3 Shards**:
   ```bash
   curl http://localhost:3000/api/cluster/distribution
   ```
   Bạn sẽ thấy dữ liệu được băm rải đều xấp xỉ $\sim 33\%$ cho mỗi Shard nhờ các Virtual Nodes!

3. **Tạo 1 User cụ thể và xem giải mã Snowflake ID**:
   ```bash
   curl -X POST http://localhost:3000/api/users \
     -H "Content-Type: application/json" \
     -d '{"name": "Tran Van B", "email": "b@architect.io"}'
   ```
   * Quan sát ID trả về là một số 64-bit (ví dụ: `1982736481726354`), kèm metadata giải mã rõ `timestamp`, `workerId`, `sequence`.

4. **Đọc theo ID (Point Query - $O(1)$ chỉ chạm vào 1 Shard duy nhất)**:
   ```bash
   # Thay <ID_CUA_USER> bằng ID vừa sinh ở trên:
   curl http://localhost:3000/api/users/<ID_CUA_USER>
   ```
   * Trả về kết quả từ đúng Shard chứa user đó (`"routingType": "POINT_QUERY_SINGLE_SHARD"`).

5. **Đọc không có ID (Scatter-Gather Pattern)**:
   ```bash
   curl http://localhost:3000/api/users
   ```
   * Hệ thống sẽ phát truy vấn song song tới tất cả các Shards và gom toàn bộ 301 users lại.

6. **Bổ sung Shard thứ 4 vào cụm (Dynamic Resharding)**:
   ```bash
   curl -X POST http://localhost:3000/api/cluster/add-shard \
     -H "Content-Type: application/json" \
     -d '{"shardName": "shard-04"}'
   ```
   * Cụm lập tức mở rộng lên 4 shards mà không làm gián đoạn hệ thống.
