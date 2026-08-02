# Tech Books — Backend

API cho [tech-books](../tech-books): thay `data.json` hardcode bằng database thật,
có xác thực bằng mã PIN, và cho phép upload sách (PDF + ảnh bìa) qua form.

## 1. Chuẩn bị database

Cần một database Postgres hoặc MySQL (tùy chọn qua `DB_TYPE`). Ví dụ nhanh với Docker:

```bash
docker run -d --name tech-books-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tech_books \
  -p 5432:5432 postgres:16
```

Không có Docker cũng được — trỏ `.env` vào bất kỳ Postgres/MySQL nào bạn có sẵn
(local, Neon, Railway, PlanetScale, v.v).

## 2. Cấu hình

```bash
cp .env.example .env
```

Sửa lại các giá trị `DB_*` cho đúng database của bạn. Mặc định sẵn:
- `AUTH_PIN=010826` (mã PIN vào web). Muốn an toàn hơn thì dùng `AUTH_PIN_HASH`
  thay vì `AUTH_PIN` — tạo hash bằng:
  ```bash
  node -e "console.log(require('bcryptjs').hashSync('010826', 12))"
  ```
  rồi dán vào `AUTH_PIN_HASH`, xoá dòng `AUTH_PIN`.
- `JWT_SECRET` nên đổi thành chuỗi random dài (`openssl rand -hex 32`).
- `CORS_ORIGIN` đổi thành domain thật của frontend khi deploy (vd.
  `https://book.dangpham.id.vn`), để `*` chỉ tiện cho dev local.

## 3. Cài đặt & chạy

```bash
npm install
npm run start:dev
```

Server chạy tại `http://localhost:3000/api`. Swagger docs (chỉ bật khi
`NODE_ENV != production`) tại `http://localhost:3000/api/docs`.

Schema DB tự đồng bộ (`synchronize: true`) — không cần chạy migration cho dự án
nhỏ này. Nếu sau này dữ liệu quan trọng hơn, nên chuyển sang TypeORM migrations.

## 4. Import dữ liệu cũ từ data.json

Dữ liệu gốc (`data.json` + toàn bộ PDF local, ~10MB) đã được đóng gói sẵn trong
thư mục [`seed-data/`](seed-data) của chính repo này — không phụ thuộc vào repo
`tech-books` nằm cạnh nữa. Vì vậy trên máy dev hay trên server prod đều chỉ cần:

```bash
npm run seed          # chạy bằng ts-node, dùng lúc dev
npm run seed:prod     # chạy bằng bản đã build (npm run build trước), dùng trên server
```

Script sẽ: copy PDF từ `seed-data/` vào `UPLOAD_DIR` (mặc định `./uploads`),
tạo category + book tương ứng trong DB, cập nhật thông tin curator. Ảnh bìa là
URL ngoài (http/https) thì giữ nguyên link, không copy.

An toàn để chạy lại nhiều lần — sách/ngăn đã tồn tại (so theo `slug` và
`title`) sẽ tự bị bỏ qua, không tạo trùng. Điều này có nghĩa là mỗi lần deploy
lại, chỉ cần chạy `npm run seed:prod` một phát là có sẵn dữ liệu, không cần
thao tác tay gì thêm.

Nếu muốn seed từ một `data.json` khác (vd. đang sửa trực tiếp repo
`tech-books` cũ và muốn re-import):

```bash
npm run seed -- /duong/dan/data.json /duong/dan/toi/tech-books
```

## 5. Deploy lên production

Vì `seed-data/` nằm sẵn trong git repo, quy trình deploy trên server mới chỉ
gồm:

```bash
git clone <repo-url> tech-books-backend && cd tech-books-backend
cp .env.example .env        # rồi sửa DB_*, JWT_SECRET, CORS_ORIGIN, PUBLIC_URL cho đúng server thật
npm ci
npm run build
npm run seed:prod           # có data ngay, chạy lại vẫn an toàn
npm run start:prod          # hoặc quản lý bằng pm2/systemd/docker tuỳ bạn
```

Nhớ set `PUBLIC_URL` trong `.env` prod thành domain thật của API (vd.
`https://api.book.dangpham.id.vn`) — nếu để trống, link PDF/ảnh trong
`/api/catalog` sẽ là đường dẫn tương đối và vỡ khi frontend nằm ở domain khác.

## 6. Kết nối với frontend

Sửa hằng số `API_BASE` ở đầu phần `<script>` trong
[`../tech-books/index.html`](../tech-books/index.html) và
[`../tech-books/admin.html`](../tech-books/admin.html) trỏ về URL backend thật
sau khi deploy (vd. `https://api.book.dangpham.id.vn/api`).

Frontend giờ đọc dữ liệu từ `GET /api/catalog` thay vì `data.json`, và bắt nhập
mã PIN trước khi vào trang — gọi `POST /api/auth/login` để lấy JWT, lưu ở
`localStorage`, tự động hỏi lại PIN khi hết hạn.

`tech-books/data.json` vẫn giữ lại trong repo cũ chỉ để làm nguồn cho
`npm run seed`, trang web không còn fetch file này nữa.

## 7. Endpoint chính

| Method | Path                    | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/auth/login`        | công khai | Gửi `{ pin }`, trả về JWT |
| GET  | `/api/catalog`            | JWT | Toàn bộ dữ liệu cho trang chính (curator + categories + books) |
| GET/POST/PATCH/DELETE | `/api/categories` | JWT | CRUD ngăn sách |
| GET/POST/PATCH/DELETE | `/api/books` | JWT | CRUD sách. POST/PATCH nhận `multipart/form-data` (field `file` = PDF, `cover` = ảnh, hoặc `coverUrl` = link ngoài) |
| GET/PATCH | `/api/settings` | JWT | Thông tin curator hiển thị ở sidebar |
| GET | `/api/files/:type/:filename` | công khai (xem ghi chú) | Phục vụ PDF/ảnh đã upload (`type` = `books` hoặc `covers`) |
| GET | `/api/health` | công khai | Health check |

`/api/files/*` cố tình để công khai: link này chỉ được trả về bên trong response
`/api/catalog` (vốn đã cần JWT để lấy), và tên file là UUID ngẫu nhiên — bắt
buộc thêm JWT ở đây sẽ phá `<img src>`/`<a href>` thuần trên frontend mà không
tăng thêm bảo mật đáng kể.

Đăng nhập bị giới hạn 5 lần/phút/IP (chống dò PIN).

## Run tests

```bash
npm run test        # unit
npm run test:e2e    # e2e (không cần DB — chỉ test HealthController)
```
