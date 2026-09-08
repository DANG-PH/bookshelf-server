# Bản dịch tiếng Việt cho sách nước ngoài

Cho phép mỗi cuốn sách có thêm 1 file PDF **bản dịch tiếng Việt**, tuỳ chọn,
đính kèm bên cạnh file gốc — để không phải đọc bằng ngôn ngữ khác hoặc dịch
từng đoạn qua trình duyệt khi đọc sách nước ngoài.

## Cách hoạt động

Việc **dịch PDF không nằm trong backend này**. Đây là quyết định có chủ đích,
không phải thiếu sót — xem phần "Vì sao không dịch ngay trong backend" bên
dưới. Backend chỉ lưu thêm 1 file PDF thứ hai cho mỗi cuốn sách; việc tạo ra
file đó nằm ngoài, làm 1 lần khi thêm/sửa sách.

Công cụ dịch dùng ngoài: **[VI-Translate](https://github.com/breslee1707/VI-Translate)**
— dịch PDF sang tiếng Việt mà vẫn giữ nguyên bố cục, công thức, bảng, hình
(quan trọng với sách kỹ thuật, không giống kiểu dán từng đoạn vào Google
Translate rồi mất hết bố cục).

Có 2 chế độ dịch:

| Chế độ | Cách dịch | Dùng khi |
| --- | --- | --- |
| `google` | Gọi thẳng trang web dịch của Google (không cần key, nhưng không chính xác thuật ngữ chuyên ngành) | Sách phổ thông, không nhiều jargon |
| `handoff` | Xuất đoạn văn ra JSONL, để 1 AI agent (Claude Code, Codex, Copilot...) dịch có ngữ cảnh rồi build lại PDF | **Sách kỹ thuật** — chính xác thuật ngữ hơn hẳn Google (ví dụ thật trong README của họ: "conduction" bị Google dịch thành "dẫn điện", Handoff dịch đúng "dẫn nhiệt") |

Với thư viện sách kỹ thuật thì nên ưu tiên `handoff`.

## Quy trình thêm bản dịch cho 1 cuốn sách

1. **Dịch file PDF trước, ở máy cá nhân** (không phải trên VPS):
   ```bash
   git clone https://github.com/breslee1707/VI-Translate.git
   cd VI-Translate
   python -m venv .venv
   .venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip

   # chế độ Handoff — khuyên dùng cho sách kỹ thuật
   .venv/bin/python scripts/translate_pdf.py INPUT.pdf --engine handoff --emit-segments segments.jsonl
   # nhờ 1 AI agent (vd. Claude Code) dịch segments.jsonl -> translations.jsonl
   .venv/bin/python scripts/translate_pdf.py INPUT.pdf --engine handoff --segments translations.jsonl --output-dir OUT

   # hoặc đơn giản hơn — chế độ Google, không cần agent
   .venv/bin/python scripts/translate_pdf.py INPUT.pdf --output-dir OUT
   ```
   Hoặc dùng bản app desktop dựng sẵn (Windows/macOS) trong phần Releases của
   repo đó, kéo-thả file vào là xong, không cần cài Python.

2. **Vào trang admin của thư viện** (`admin.html`) → thêm sách mới hoặc bấm
   **Sửa** trên sách đã có → mở mục **"Thêm chi tiết"** → ở ô **"Bản dịch
   tiếng Việt (PDF)"**, chọn file PDF vừa dịch được ở bước 1 → **Lưu**.

3. Xong. Ở trang đọc sách, cuốn nào có bản dịch sẽ hiện thêm 1 dòng
   **"Đọc bản dịch tiếng Việt"** ngay dưới hàng trạng thái đọc trên thẻ sách —
   không có bản dịch thì không hiện gì thêm, không ảnh hưởng cuốn khác.

## Chi tiết triển khai (cho việc bảo trì sau này)

**Backend** (`tech-books-backend`):
- `Book` entity thêm 2 cột: `translatedFileUrl`, `translatedFileOriginalName`
  (cả hai nullable) — cùng kiểu với `fileUrl`/`fileOriginalName` sẵn có.
- `POST /books` và `PATCH /books/:id` nhận thêm 1 field multipart tên
  `translatedFile` (PDF), đi cùng `file` và `cover` sẵn có — cùng validate
  PDF-only, cùng giới hạn dung lượng `MAX_PDF_SIZE_BYTES` (80MB), lưu vào
  `UPLOAD_DIR/books/` như file gốc (không có subfolder riêng).
- Không có field "dán link" cho bản dịch (khác với `pdfUrl` của file gốc) —
  bản dịch luôn phải upload trực tiếp, không tải hộ từ URL, vì nó luôn được
  tạo ra ở bước 1 rồi mới đưa vào đây.
- `GET /catalog` (dùng bởi trang đọc) trả thêm field `translatedFile` (URL
  tuyệt đối, đã resolve qua `/api/files/...`) trong mỗi book object — `null`
  nếu chưa có bản dịch.
- Sửa/xoá sách thì file bản dịch cũ cũng được dọn theo (cùng cơ chế
  `deleteLocalAsset` đang dùng cho `fileUrl`/`coverUrl`).

**Frontend** (`tech-books`):
- `admin.html`: thêm ô upload `translatedFile` trong mục "Thêm chi tiết" của
  form thêm/sửa sách; danh sách sách đã thêm hiện thêm dòng "Có bản dịch
  tiếng Việt" nếu có.
- `index.html`: `cardHTML()` hiện thêm dòng "Đọc bản dịch tiếng Việt" (click
  mở file dịch ở tab mới) khi book có `translatedFile`, không hiện gì nếu
  không có.

## Vì sao không dịch ngay trong backend

Cân nhắc rồi quyết định **không** gọi VI-Translate như 1 service chạy sau
API, vì:

- **Stack nặng**: VI-Translate cần cả 1 dàn Python + ML (numpy, opencv,
  onnxruntime, pymupdf, model layout ONNX ~75MB...) — VPS hiện chỉ chạy
  NestJS + Postgres nhẹ, không đáng cài thêm cả đống này chỉ để phục vụ 1
  sự kiện hiếm (thêm sách nước ngoài mới).
- **Chậm, không hợp với 1 request HTTP**: dịch cả cuốn sách mất vài phút
  (không phải mili-giây) — phải làm hàng đợi job riêng mới chạy được trong
  web app, thêm phức tạp không cần thiết cho 1 project cá nhân.
- **Chế độ Google không chính thức**: chỉ là scrape trang web dịch của
  Google, có thể gãy bất cứ lúc nào họ đổi giao diện — chạy tay và kiểm tra
  kết quả từng lần vẫn ổn hơn để nó tự chạy ngầm trong production.
- **Chế độ Handoff (bản dịch chính xác hơn) cần 1 AI agent thật** — backend
  không tự làm được, muốn tự động hoá thì phải gọi thêm 1 API LLM riêng
  (tốn phí theo lượng token, thêm hạ tầng).
- **Giấy phép AGPL-3.0**: nếu biến VI-Translate thành 1 service chạy sau
  API công khai thì phát sinh nghĩa vụ phải mở mã nguồn tương ứng theo điều
  khoản AGPL. Dùng như công cụ ngoài (CLI/app desktop) chạy tay thì không
  vướng gì.

## Deploy lên VPS

Phần deploy **không có gì đặc biệt** — vì việc dịch xảy ra hoàn toàn bên
ngoài, VPS không cần cài Python, không cần VI-Translate, không cần model
gì cả. Chỉ deploy code backend + frontend như mọi lần:

```bash
# backend
cd tech-books-backend
git pull
npm install
npm run build
pm2 restart all --update-env

# frontend — deploy lại 3 file .html như cách vẫn làm
```

Không cần chỉnh `.env`, không cần migration tay (`synchronize: true` tự
tạo 2 cột mới trong bảng `books` ở lần khởi động đầu sau khi deploy).

Sau khi deploy xong, upload bản dịch cho từng cuốn qua trang admin như mô tả
ở "Quy trình" bên trên — hoàn toàn thao tác qua UI, không đụng gì tới server.
