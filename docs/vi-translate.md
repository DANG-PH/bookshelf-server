# Bản dịch tiếng Việt cho sách nước ngoài

Cho phép mỗi cuốn sách có thêm 1 file PDF **bản dịch tiếng Việt**, tuỳ chọn,
đính kèm bên cạnh file gốc — để không phải đọc bằng ngôn ngữ khác hoặc dịch
từng đoạn qua trình duyệt khi đọc sách nước ngoài. Đi kèm là 1 cơ chế **tự
động nhận diện ngôn ngữ** ngay lúc thêm sách, để không phải tự nhớ/đoán cuốn
nào là sách nước ngoài, cuốn nào đã là tiếng Việt sẵn rồi.

> Toàn bộ tài liệu này viết cho môi trường **Linux** — cả máy dev cá nhân lẫn
> VPS đều là Linux, không có phần Windows/macOS ở đây.

> [!IMPORTANT]
> **Ranh giới tự động hoá — đọc trước khi bối rối**: chỉ có **nhận diện
> ngôn ngữ** (mục 1) là tự động, chạy ngay trong backend lúc thêm sách,
> không cần làm gì thêm. Việc **dịch file PDF ra bản tiếng Việt thật sự**
> (mục 2-3) **không tự động** — vẫn phải chạy tay ở máy cá nhân rồi upload
> lại. Đây là 2 việc khác nhau: 1 cái là "biết cuốn nào cần dịch" (tự động),
> 1 cái là "thực sự tạo ra bản dịch" (thủ công, có chủ đích — xem mục 5 vì
> sao). Nhận diện tự động giúp *biết* cuốn nào đáng để dịch, không có nghĩa
> là *tự dịch luôn*.

## Mục lục

1. [Tự động nhận diện ngôn ngữ](#1-tự-động-nhận-diện-ngôn-ngữ)
2. [Dịch PDF bằng VI-Translate](#2-dịch-pdf-bằng-vi-translate)
3. [Quy trình thêm bản dịch cho 1 cuốn sách](#3-quy-trình-thêm-bản-dịch-cho-1-cuốn-sách)
4. [Chi tiết triển khai](#4-chi-tiết-triển-khai)
5. [Vì sao không dịch ngay trong backend](#5-vì-sao-không-dịch-ngay-trong-backend)
6. [Deploy lên VPS (Linux)](#6-deploy-lên-vps-linux)

---

## 1. Tự động nhận diện ngôn ngữ

Vấn đề cần giải: nếu để admin tự nhớ/đoán cuốn nào là sách nước ngoài để đi
dịch, rất dễ nhầm — nhất là dịch nhầm 1 cuốn **đã là tiếng Việt sẵn** (vô
nghĩa, tốn công). Nên việc nhận diện được làm **tự động, ngay lúc thêm sách**,
không phụ thuộc vào admin phải tự phán đoán.

### Cách nhận diện

Code ở [`src/modules/books/detect-language.ts`](../src/modules/books/detect-language.ts).
Không dùng thư viện nhận diện ngôn ngữ tổng quát, không gọi API ngoài — vì bài
toán thực tế ở đây hẹp hơn nhiều so với "đoán 1 trong hàng trăm ngôn ngữ": chỉ
cần trả lời đúng 1 câu **"đây có phải tiếng Việt không"**.

Cách làm: đếm mật độ các ký tự chỉ tiếng Việt mới có —

- Toàn bộ khối Unicode **Latin Extended Additional** (`U+1EA0`–`U+1EF9`) —
  khối này gần như được tạo ra riêng cho các nguyên âm có dấu thanh của tiếng
  Việt (ạ, ả, ấ, ầ, ẩ, ẫ, ậ, ẻ, ẽ, ế, ề, ể, ễ, ệ, ỉ, ị, ọ, ỏ, ố, ồ, ổ, ỗ, ộ,
  ớ, ờ, ở, ỡ, ợ, ụ, ủ, ứ, ừ, ử, ữ, ự, ỳ, ỵ, ỷ, ỹ...).
- Cộng thêm `đ/Đ`, `ơ/Ơ`, `ư/Ư` — cũng gần như chỉ tiếng Việt dùng.

Văn xuôi tiếng Việt thật sự có tỉ lệ ký tự này rất cao (thường 20-40%+ tổng số
chữ cái), trong khi bất kỳ ngôn ngữ Latin nào khác (Anh, Pháp, Đức, Tây Ban
Nha...) gần như không bao giờ có — nếu có cũng chỉ 1-2 từ mượn tình cờ. Nên
chỉ cần ngưỡng rất thấp (1%) là đủ phân biệt chắc chắn, không cần model hay
thư viện gì.

```ts
// đơn giản hoá từ detect-language.ts
const VIETNAMESE_CHARS_RE = /[Ạ-ỹĐđƠơƯư]/g;
const hits = text.match(VIETNAMESE_CHARS_RE) ?? [];
const letters = text.match(/\p{L}/gu) ?? [];
const isVietnamese = hits.length / letters.length >= 0.01;
```

### Lấy văn bản mẫu từ đâu

Dùng thư viện `pdf-parse` **đã có sẵn** trong project (đang dùng cho tính
năng hỏi-đáp AI qua RAG) — không thêm dependency nào mới. Chỉ đọc **5 trang
đầu** của file PDF (đủ để có tín hiệu, đọc cả cuốn sách chỉ để lấy mẫu là phí
thời gian không cần thiết).

### Kết quả lưu ở đâu, dùng khi nào

- Cột mới `detectedLanguage` trên bảng `books`, giá trị `'vi'` | `'foreign'` |
  `null`.
- `null` nghĩa là **không đủ tín hiệu để đoán** (PDF quét ảnh không có lớp
  chữ, PDF bị mã hoá, trang đầu gần như trống...) — trường hợp này **không
  đoán bừa**, cứ để trống, tốt hơn là đoán sai.
- Tính lại **mỗi khi thêm sách mới**, và **mỗi khi sửa sách kèm đổi file PDF
  gốc** (sửa những thứ khác như tên/tác giả/tag thì không tính lại — file
  không đổi thì ngôn ngữ không đổi).
- Hiện ngay trên trang admin: danh sách sách có thêm nhãn "Tiếng Việt" hoặc
  "Sách nước ngoài" cạnh tên tác giả/chủ đề. Sách nào không đoán được thì
  không có nhãn gì thêm.
- Khi sửa 1 cuốn đã được nhận diện là **tiếng Việt** mà admin định upload
  thêm 1 file "bản dịch", form sẽ tự hiện dòng nhắc: *"File sách này được
  nhận diện là tiếng Việt sẵn rồi — có lẽ không cần thêm bản dịch"* — chỉ là
  gợi ý, không chặn upload (vẫn có trường hợp nhận diện sai, ví dụ sách song
  ngữ hoặc PDF scan lẫn lộn).

Tính năng này **chỉ ở phía admin** — trang đọc sách (`index.html`) không hiện
nhãn ngôn ngữ, vì mục đích duy nhất của nó là giúp admin quyết định có nên đi
dịch cuốn nào hay không, không phải để phân loại cho người đọc.

---

## 2. Dịch PDF bằng VI-Translate

Việc dịch PDF **không nằm trong backend này** — xem lý do ở [mục 5](#5-vì-sao-không-dịch-ngay-trong-backend).
Backend chỉ lưu file PDF dịch sẵn; việc tạo ra file đó làm ở máy cá nhân,
bằng công cụ ngoài: **[VI-Translate](https://github.com/breslee1707/VI-Translate)**
— dịch PDF sang tiếng Việt mà vẫn giữ nguyên bố cục, công thức, bảng, hình
(quan trọng với sách kỹ thuật, khác hẳn kiểu dán từng đoạn vào Google
Translate rồi mất sạch bố cục).

### Cài đặt (Linux)

Trên Ubuntu/Debian, `python3-venv` thường **không có sẵn** — thiếu gói này
thì `python3 -m venv` báo lỗi `ensurepip is not available`. Cài trước:

```bash
python3 --version   # ví dụ: Python 3.12.3 — nhớ số bản, dùng ở dòng dưới
sudo apt update
sudo apt install python3.12-venv   # đổi "3.12" theo đúng version python3 --version vừa báo
```

(Không chắc số bản, hoặc không dùng Ubuntu/Debian: `sudo apt install
python3-venv` trước, thiếu thì apt sẽ tự gợi ý đúng tên gói version-cụ-thể
cần cài như thông báo lỗi ở trên.)

Sau đó mới clone và tạo venv:

```bash
git clone https://github.com/breslee1707/VI-Translate.git
cd VI-Translate
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### Chọn chế độ dịch

| Chế độ | Cách dịch | Dùng khi |
| --- | --- | --- |
| `google` | Gọi thẳng trang web dịch của Google (không cần key, nhưng dễ dịch sai thuật ngữ chuyên ngành) | Sách phổ thông, ít jargon |
| `handoff` | Xuất đoạn văn ra JSONL, để 1 AI agent (Claude Code, Codex, Copilot...) dịch có ngữ cảnh rồi build lại PDF | **Sách kỹ thuật** — ví dụ thật trong README của họ: "conduction" bị Google dịch thành "dẫn điện", Handoff dịch đúng "dẫn nhiệt" |

Thư viện này chủ yếu là sách kỹ thuật nên **ưu tiên `handoff`**.

```bash
# chế độ Handoff — khuyên dùng cho sách kỹ thuật
.venv/bin/python scripts/translate_pdf.py INPUT.pdf --engine handoff --emit-segments segments.jsonl
# nhờ 1 AI agent (vd. Claude Code, chạy ngay trong repo VI-Translate đã clone) dịch segments.jsonl -> translations.jsonl
.venv/bin/python scripts/translate_pdf.py INPUT.pdf --engine handoff --segments translations.jsonl --output-dir OUT

# hoặc đơn giản hơn — chế độ Google, không cần agent, chấp nhận độ chính xác thấp hơn
.venv/bin/python scripts/translate_pdf.py INPUT.pdf --output-dir OUT
```

Kết quả nằm ở `OUT/INPUT-vi.pdf`.

---

## 3. Quy trình thêm bản dịch cho 1 cuốn sách

| Bước | Ai/cái gì làm |
| --- | --- |
| 1 | **Tự động** — backend làm |
| 2 | **Thủ công** — bạn làm, ở máy cá nhân |
| 3 | **Thủ công** — bạn làm, qua trang admin |
| 4 | Tự động (chỉ là hiển thị) |

1. Thêm sách vào thư viện như bình thường qua trang admin. **Không cần làm
   gì thêm** — hệ thống tự nhận diện ngôn ngữ ngay lúc này (xem mục 1), tự
   gắn nhãn "Tiếng Việt" hoặc "Sách nước ngoài" trong danh sách sách.
2. Xem danh sách sách ở admin, cuốn nào gắn nhãn **"Sách nước ngoài"** mà
   muốn có bản dịch thì **tự chạy VI-Translate ở máy cá nhân** (mục 2) —
   bước này bắt buộc phải làm tay, xem [mục 5](#5-vì-sao-không-dịch-ngay-trong-backend)
   để hiểu vì sao không thể tự động hoá được bước này.
3. Cầm file PDF vừa dịch xong ở bước 2, vào trang admin → bấm **Sửa** trên
   cuốn sách đó → mở mục **"Thêm chi tiết"** → ở ô **"Bản dịch tiếng Việt
   (PDF)"**, chọn file đó → **Lưu**.
4. Xong. Ở trang đọc sách, cuốn đó tự hiện thêm dòng **"Đọc bản dịch tiếng
   Việt"** ngay dưới hàng trạng thái đọc trên thẻ sách — không cần làm gì
   thêm ở bước này.

---

## 4. Chi tiết triển khai

**Backend** (`tech-books-backend`):

- `Book` entity thêm 3 cột, tất cả nullable:
  - `translatedFileUrl`, `translatedFileOriginalName` — cùng kiểu với
    `fileUrl`/`fileOriginalName` sẵn có.
  - `detectedLanguage: 'vi' | 'foreign' | null` — set tự động, xem mục 1.
- `POST /books` và `PATCH /books/:id` nhận thêm 1 field multipart tên
  `translatedFile` (PDF), đi cùng `file` và `cover` sẵn có — cùng validate
  PDF-only, cùng giới hạn dung lượng `MAX_PDF_SIZE_BYTES` (80MB), lưu vào
  `UPLOAD_DIR/books/` như file gốc (không có subfolder riêng).
- Không có field "dán link" cho bản dịch (khác với `pdfUrl` của file gốc) —
  bản dịch luôn phải upload trực tiếp, không tải hộ từ URL, vì nó luôn được
  tạo ra ở bước 2 rồi mới đưa vào đây.
- `GET /catalog` (dùng bởi trang đọc) trả thêm field `translatedFile` (URL
  tuyệt đối, đã resolve qua `/api/files/...`) trong mỗi book object — `null`
  nếu chưa có bản dịch. `detectedLanguage` **không** có trong response này —
  chỉ trả qua `GET /books` (dùng bởi trang admin).
- Sửa/xoá sách thì file bản dịch cũ cũng được dọn theo (cùng cơ chế
  `deleteLocalAsset` đang dùng cho `fileUrl`/`coverUrl`).
- Không thêm dependency npm nào mới cho cả 2 tính năng — `pdf-parse` đã có
  sẵn trong `package.json` từ trước (dùng cho RAG chatbot).

**Frontend** (`tech-books`):

- `admin.html`: ô upload `translatedFile` trong mục "Thêm chi tiết" của form
  thêm/sửa sách; danh sách sách hiện nhãn ngôn ngữ + "Có bản dịch tiếng Việt"
  nếu có; hiện dòng nhắc khi sửa 1 cuốn tiếng-Việt-sẵn mà vẫn định thêm bản
  dịch.
- `index.html`: `cardHTML()` hiện thêm dòng "Đọc bản dịch tiếng Việt" (mở
  file dịch ở tab mới) khi book có `translatedFile`, không hiện gì nếu
  không có.

---

## 5. Vì sao không dịch ngay trong backend

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

Riêng phần **nhận diện ngôn ngữ** (mục 1) thì ngược lại — đủ nhẹ và đủ nhanh
(1 phép đếm ký tự trên vài trang PDF) nên chạy thẳng trong backend, ngay lúc
thêm sách, không cần tách ra ngoài.

---

## 6. Deploy lên VPS (Linux)

Không có bước đặc biệt nào cho riêng 2 tính năng này — **không cần cài
Python, không cần VI-Translate, không cần model gì trên VPS**, vì việc dịch
xảy ra hoàn toàn ở máy cá nhân; phần nhận diện ngôn ngữ chỉ dùng `pdf-parse`
vốn đã có sẵn trong `package.json`. Deploy đúng như quy trình backend bình
thường của project.

### Backend

SSH vào VPS, vào đúng thư mục đã clone repo (đường dẫn thật tuỳ máy bạn, ví
dụ dưới đây dùng `~/tech-books-backend`):

```bash
ssh <user>@<vps-host>
cd ~/tech-books-backend

# lấy code mới
git pull origin master

# không có dependency mới cho tính năng này, nhưng chạy install cho chắc
# (đề phòng lần deploy trước còn thiếu gì)
npm install

# build ra dist/
npm run build

# restart qua pm2 — --update-env bắt buộc nếu .env có gì thay đổi,
# không thì bỏ qua cũng được, không hại gì khi thêm vào
pm2 restart all --update-env

# xem log để chắc app khởi động sạch, không lỗi TypeORM/migration
pm2 logs --lines 60
```

Kiểm tra nhanh sau khi restart:

- Log không có dòng `ERROR` nào liên quan `TypeOrmModule`/`QueryFailedError`.
- Cột mới (`translatedFileUrl`, `translatedFileOriginalName`,
  `detectedLanguage`) tự được tạo trong bảng `books` nhờ `synchronize: true`
  đang bật sẵn trong `src/config/typeorm.config.ts` — **không cần chạy
  migration tay**, không cần đụng vào Postgres.
- Test nhanh: vào trang admin, sửa 1 cuốn sách bất kỳ (không cần đổi gì),
  bấm Lưu — nếu không lỗi, cột mới đã tồn tại và hoạt động bình thường.

### Frontend

Deploy lại 3 file `index.html` / `diary.html` / `admin.html` theo đúng cách
bạn vẫn làm (không có gì đổi ở quy trình deploy, chỉ là nội dung file mới).

### Không cần

- Không cần cài `python3`/`pip` gì thêm trên VPS cho riêng tính năng này —
  `python3` trên VPS (nếu có sẵn cho việc khác) không liên quan gì đến
  backend NestJS cả.
- Không cần mở port mới, không cần service/systemd mới.
- Không cần sửa `.env` — không có biến môi trường mới nào cho 2 tính năng
  này.
