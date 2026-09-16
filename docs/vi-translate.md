# Bản dịch tiếng Việt cho sách nước ngoài

Mỗi cuốn sách có thể có thêm 1 file PDF **bản dịch tiếng Việt** đi kèm file
gốc — để không phải đọc bằng ngôn ngữ khác hoặc dịch từng đoạn qua trình
duyệt. Ngôn ngữ được **tự động nhận diện** ngay lúc thêm sách, và việc dịch
thật sự cũng **tự động chạy trong 1 hàng đợi nền** — admin chỉ cần bấm 1 nút,
không phải tự chạy công cụ dịch bằng tay nữa.

> Toàn bộ tài liệu này viết cho môi trường **Linux** — cả máy dev cá nhân lẫn
> VPS đều là Linux.

## Mục lục

1. [Tổng quan luồng nghiệp vụ (BA)](#1-tổng-quan-luồng-nghiệp-vụ-ba)
2. [Tự động nhận diện ngôn ngữ](#2-tự-động-nhận-diện-ngôn-ngữ)
3. [Kiến trúc hàng đợi biên dịch tự động](#3-kiến-trúc-hàng-đợi-biên-dịch-tự-động)
4. [Chi tiết triển khai](#4-chi-tiết-triển-khai)
5. [Vì sao thiết kế như vậy](#5-vì-sao-thiết-kế-như-vậy)
6. [Cách dịch tay (dự phòng / sách cần chất lượng cao hơn)](#6-cách-dịch-tay-dự-phòng--sách-cần-chất-lượng-cao-hơn)
7. [Deploy lên VPS (Linux)](#7-deploy-lên-vps-linux)

---

## 1. Tổng quan luồng nghiệp vụ (BA)

### Trạng thái của 1 cuốn sách

Cột `translationJobStatus` trên `books`: `null` | `queued` | `processing` |
`partial` | `done` | `failed`. Kết hợp với `detectedLanguage`
(`vi` | `foreign` | `null`) và `translatedFileUrl` (có file hay chưa) để
quyết định UI/hành vi cho phép.

| detectedLanguage | translationJobStatus | translatedFileUrl | Admin/reader thấy gì | Được làm gì |
| --- | --- | --- | --- | --- |
| `vi` hoặc `null` | bất kỳ | — | Nhãn ngôn ngữ tương ứng (hoặc không có nhãn) | Không có nút "Biên dịch" — không nhận diện được là sách nước ngoài thì không đề xuất dịch |
| `foreign` | `null` | không | Nhãn "Sách nước ngoài" | Nút **Biên dịch** |
| `foreign` | `queued` | tuỳ (có thể còn file cũ từ lần `partial` trước) | " · Đang chờ biên dịch…" | Không nút gì — đang xếp hàng |
| `foreign` | `processing` | tuỳ | " · Đang biên dịch…" | Không nút gì — đang chạy thật |
| `foreign` | `partial` | **có** | " · Đã dịch một phần, đọc được ngay (còn X/Y đoạn chưa dịch) (tự thử lại sau ~N giờ)" — reader thấy link "Đọc bản dịch tiếng Việt (đang tiếp tục hoàn thiện)" | Nút **Dịch tiếp ngay** (ép chạy lại sớm, không bắt buộc — tự động cũng sẽ retry sau ~24h) |
| `foreign` | `done` | có | " · Có bản dịch tiếng Việt" | **Không còn nút Biên dịch nữa** — không tự dịch lại. Muốn thay bản dịch thì upload tay qua ô "Bản dịch tiếng Việt (PDF)" ở form sửa (đường thủ công vẫn luôn mở, không bị khoá) |
| `foreign` | `failed` | tuỳ (giữ nguyên file `partial` cũ nếu có, không bị xoá bởi 1 lần chạy lỗi) | " · Biên dịch lỗi: <lý do> (tự thử lại sau ~N giờ)" | Nút **Thử lại ngay** (ép chạy lại sớm — tự động cũng sẽ retry) |

Quy tắc: **chỉ `done` là điểm dừng vĩnh viễn** của luồng tự động — không có
cách nào từ UI tự động kích hoạt dịch lại 1 cuốn đã `done`. `partial` và
`failed` thì ngược lại: **tự động thử lại mỗi ~24 giờ** cho tới khi đạt
`done` (xem [mục 3](#3-kiến-trúc-hàng-đợi-biên-dịch-tự-động) và
[mục 5](#5-vì-sao-thiết-kế-như-vậy) — lý do đổi từ "1 lần duy nhất" sang mô
hình này là để đọc được dần thay vì phải đợi dịch xong 100%).

### Hành trình người dùng (admin)

```
Thêm sách → tự nhận diện ngôn ngữ
  │
  ├─ Tiếng Việt / không rõ → xong, không có gì thêm
  │
  └─ Sách nước ngoài → hỏi ngay: "Biên dịch sang tiếng Việt luôn không?"
        │
        ├─ Đồng ý → xếp hàng đợi ngay lúc đó
        │
        └─ Huỷ → KHÔNG mất cơ hội — danh sách sách vẫn có nút
                  "Biên dịch" cho cuốn này, bấm được bất cứ lúc nào sau

Vào hàng đợi (queued) → worker rảnh thì lấy ra xử lý (processing)
        │
        ├─ Dịch xong hẳn (done, ≤ 50 đoạn chưa dịch) → có file dịch, nút Biên
        │    dịch biến mất vĩnh viễn, có thông báo qua chuông/push:
        │    "Đã biên dịch xong "<tên sách>" sang tiếng Việt."
        │
        ├─ Dịch được một phần (partial, còn > 50 đoạn chưa dịch) → VẪN có
        │    file để đọc ngay (thay file cũ nếu có, bản mới luôn đầy đủ hơn
        │    hoặc bằng bản cũ nhờ cache dịch), có thông báo: ""<tên sách>" đã
        │    có bản dịch một phần, đọc được ngay — sẽ tự tiếp tục hoàn thiện."
        │    Tự động xếp lịch thử lại sau ~24 giờ, không cần ai bấm gì.
        │
        └─ Lỗi thật sự (failed — sidecar không phản hồi được, crash...) →
             hiện lý do lỗi ngay trong danh sách, có thông báo: "Biên dịch
             "<tên sách>" thất bại, sẽ tự thử lại sau." File dịch cũ (nếu có
             từ lần `partial` trước) KHÔNG bị xoá hay mất link đọc. Cũng tự
             xếp lịch thử lại sau ~24 giờ.
```

Không có "huỷ 1 job đang chạy" ở bản này — 1 job `processing` luôn chạy tới
khi xong hoặc lỗi (thường vài phút tới vài giờ tuỳ sách, không phải việc cần
huỷ giữa chừng). Việc duy nhất "huỷ được" là ở bước hỏi lúc mới thêm sách —
bấm Huỷ ở đó chỉ là "không làm ngay bây giờ", không phải huỷ vĩnh viễn. Nút
**Dịch tiếp ngay**/**Thử lại ngay** ở trạng thái `partial`/`failed` cũng
không phải "huỷ lịch tự động" — chỉ là ép chạy sớm hơn lịch ~24 giờ đó thôi.

### Vì sao không dùng popup riêng cho thông báo "biên dịch xong"

Đã có sẵn hệ thống chuông thông báo + push notification (dùng cho "thêm sách
mới", nhắc nhở định kỳ...) — dùng lại đúng kênh đó
(`NotificationsService.create()`) thay vì dựng thêm 1 cơ chế popup riêng chỉ
cho mỗi việc này. Admin đã quen nhìn vào chuông, không cần học thêm 1 chỗ mới.

---

## 2. Tự động nhận diện ngôn ngữ

Vấn đề cần giải: nếu để admin tự nhớ/đoán cuốn nào là sách nước ngoài để đi
dịch, rất dễ nhầm — nhất là dịch nhầm 1 cuốn **đã là tiếng Việt sẵn**. Nên
việc nhận diện được làm **tự động, ngay lúc thêm sách**.

### Cách nhận diện

Code ở [`src/modules/books/detect-language.ts`](../src/modules/books/detect-language.ts).
Không dùng thư viện nhận diện ngôn ngữ tổng quát, không gọi API ngoài — bài
toán thực tế hẹp hơn nhiều so với "đoán 1 trong hàng trăm ngôn ngữ": chỉ cần
trả lời đúng 1 câu **"đây có phải tiếng Việt không"**.

Cách làm: đếm mật độ các ký tự chỉ tiếng Việt mới có — toàn bộ khối Unicode
**Latin Extended Additional** (`U+1EA0`–`U+1EF9`, gần như tạo ra riêng cho
nguyên âm có dấu thanh tiếng Việt) cộng thêm `đ/Đ`, `ơ/Ơ`, `ư/Ư`. Văn xuôi
tiếng Việt thật có tỉ lệ này rất cao (20-40%+ tổng số chữ cái), ngôn ngữ Latin
khác gần như không bao giờ có. Ngưỡng 1% là đủ phân biệt chắc chắn:

```ts
// đơn giản hoá từ detect-language.ts
const VIETNAMESE_CHARS_RE = /[Ạ-ỹĐđƠơƯư]/g;
const isVietnamese =
  (text.match(VIETNAMESE_CHARS_RE) ?? []).length /
    (text.match(/\p{L}/gu) ?? []).length >=
  0.01;
```

Lấy mẫu 5 trang đầu qua `pdf-parse` (đã có sẵn trong `package.json`, dùng cho
RAG chatbot — không thêm dependency nào). `null` (không đoán được — PDF quét
ảnh không lớp chữ, mã hoá...) thì để trống, không đoán bừa. Tính lại mỗi khi
thêm sách mới, mỗi khi sửa sách kèm đổi file PDF gốc — **và mỗi khi sửa 1
cuốn mà `detectedLanguage` đang là `null`**, dùng thẳng file đang lưu sẵn, dù
không đổi file. Điểm cuối này là để **backfill** những cuốn thêm từ trước khi
tính năng này tồn tại (chưa từng được nhận diện lần nào): chỉ cần vào trang
admin → **Sửa** cuốn đó → **Lưu** ngay (không cần đổi gì, không cần upload
lại PDF) là tự chạy nhận diện — không phải sửa DB tay.

---

## 3. Kiến trúc hàng đợi biên dịch tự động

```
┌─────────────────┐   POST /books/:id/translate   ┌──────────────────────┐
│  admin.html      │ ─────────────────────────────▶│  BooksService        │
│  (bấm "Biên dịch")│                               │  .queueTranslation() │
└─────────────────┘                                 └──────────┬───────────┘
                                                                │ set translationJobStatus='queued'
                                                                ▼
                                                     ┌──────────────────────┐
                                    mỗi 15s   ◀──────│  Postgres: books     │
                                    kiểm tra          └──────────┬───────────┘
┌──────────────────────────┐                                    │
│ TranslationWorkerService  │◀───────────────────────────────────┘
│ (@Cron mỗi 15s + nudge    │  tìm book 'queued' cũ nhất, không có
│  ngay lúc vừa xếp hàng)   │  book nào khác đang 'processing'
└────────────┬───────────────┘
             │ set 'processing', rồi gọi HTTP
             ▼
┌──────────────────────────┐   POST /translate    ┌───────────────────────────┐
│  pdf-translator container │◀─────────────────────│ TranslationWorkerService  │
│  (Docker, server.py +     │  {inputPath,          └───────────────────────────┘
│   VI-Translate, engine    │   outputDir}
│   "google")                │──────────────────────▶ {ok, outputPath}
└──────────────────────────┘
             │ đọc/ghi qua volume dùng chung
             ▼
     UPLOAD_DIR (host)  ==  /uploads (trong container pdf-translator)
```

- **`TranslationWorkerService`** (`src/modules/translation-queue/`) — chạy
  ngay trong process NestJS hiện có, **không phải** event listener
  (`@nestjs/event-emitter`) và không phải service riêng biệt/Redis/BullMQ —
  đơn giản hơn: 1 method `poll()` được gọi từ 2 chỗ:
  - `@Cron('*/15 * * * * *')` — an toàn nền, đảm bảo job luôn được nhặt lên
    kể cả khi backend vừa restart giữa lúc có sách đang `queued`.
  - `BooksService.queueTranslation()` gọi thẳng `poll()` **ngay khi vừa xếp
    hàng xong** (không `await`, không chặn response trả về admin) — để việc
    xử lý bắt đầu gần như tức thì thay vì phải đợi tới lượt tick tiếp theo
    (tối đa 15s). 2 đường gọi vào **cùng 1 method**, cùng logic, không có gì
    khác nhau ngoài "khi nào được gọi".

  Mỗi lần `poll()` chạy: nếu không có sách nào `processing`, ưu tiên lấy
  sách `queued` **cũ nhất** (mới thêm/vừa bấm nút — chờ ngay không đáng), nếu
  không có `queued` nào thì tìm sách `partial`/`failed` có
  `translationNextRetryAt <= now` (đến lịch tự thử lại), lấy cái đến hạn sớm
  nhất. Luôn xử lý đúng 1 cuốn 1 lúc, không song song. Lý do xem
  [mục 5](#5-vì-sao-thiết-kế-như-vậy).

  Về phần "fire-and-forget" bạn hỏi: đúng vậy — `POST /books/:id/translate`
  chỉ set `translationJobStatus='queued'` trong Postgres rồi trả lời ngay,
  **không đợi** việc dịch xong. Việc dịch thật sự chạy hoàn toàn tách biệt
  khỏi mọi HTTP request, kể cả request đã tạo ra job đó — kết quả (xong hay
  lỗi) chỉ được biết qua thông báo chuông/push sau này, không qua response
  của request nào cả.
- **`pdf-translator`** — container Docker riêng
  ([`pdf-translator/Dockerfile`](../pdf-translator/Dockerfile),
  [`server.py`](../pdf-translator/server.py)) đóng gói VI-Translate + Python.
  `server.py` là 1 HTTP server tối giản (chỉ dùng thư viện chuẩn của Python,
  không FastAPI/Flask) nhận `{inputPath, outputDir}`, chạy
  `scripts/translate_pdf.py` (engine mặc định `google`), trả về
  `{ok:true, outputPath, untranslatedCount, totalSegments, complete}` (bất
  cứ khi nào tool tạo ra được 1 file PDF, dù dịch được ít hay nhiều — file
  đó vẫn hữu ích để đọc dở, xem [mục 5](#5-vì-sao-thiết-kế-như-vậy)) hoặc
  `{ok:false, error}` khi bản thân `translate_pdf.py` lỗi thật (crash,
  timeout, không tạo được file nào). `complete` là cờ duy nhất Node dùng để
  quyết định `done` hay `partial` — do Python tính (`untranslatedCount <= 50`),
  Node không tự lặp lại con số đó.
- **Fork riêng, không clone thẳng từ upstream** — `Dockerfile` clone từ
  `github.com/DANG-PH/translate-vi-language` (fork riêng), không phải
  `breslee1707/VI-Translate` trực tiếp. Lý do: build image ở đây tự động mỗi
  khi cần (VPS, máy dev...) — nếu clone thẳng từ upstream, tác giả gốc đổi gì
  ở nhánh `main` của họ là hành vi dịch của bạn đổi theo **ngay lần build kế
  tiếp, không ai chọn**. Fork về tay mình thì `main` chỉ đổi khi chính bạn
  `git push` lên đó — coi như đã pin sẵn theo mặc định, không cần nhớ ghim
  commit SHA thủ công. Muốn lấy cập nhật từ tác giả gốc thì làm có chủ đích:
  ```bash
  cd VI-Translate   # bản clone cục bộ đã đổi remote (xem dưới)
  git fetch upstream
  git log main..upstream/main --oneline   # xem trước có gì mới
  git merge upstream/main                 # đồng ý thì mới merge
  git push origin main                    # rồi mới đẩy lên fork của mình
  ```
  Bản clone cục bộ ở máy dev đã đổi remote: `origin` → fork riêng (để push),
  `upstream` → repo gốc của breslee1707 (chỉ để `fetch`, không push).
- **Thư mục dùng chung** — `docker-compose.yml` bind-mount `UPLOAD_DIR` của
  backend vào `/uploads` trong container `pdf-translator`. 2 process thấy
  cùng 1 file vật lý qua 2 đường dẫn khác nhau (`PDF_TRANSLATOR_UPLOAD_PATH`
  cho phía container, `UPLOAD_DIR` cho phía NestJS) — không cần truyền file
  qua mạng.
- **Engine dịch: `google`, không phải `handoff`** — quyết định có chủ đích
  sau khi cân nhắc: dùng Gemini (chế độ tương đương Handoff) sẽ chính xác
  thuật ngữ hơn, nhưng tốn thêm token/chi phí Gemini mỗi cuốn sách, và API
  key Gemini hiện tại nên **dành riêng cho chatbot** của thư viện, không chia
  sẻ ngân sách với việc dịch hàng loạt đoạn văn. `google` miễn phí, không
  đụng tới Gemini, đổi lại độ chính xác thuật ngữ chuyên ngành thấp hơn — nếu
  1 cuốn cụ thể cần chất lượng cao hơn, vẫn dịch tay bằng Handoff được, xem
  [mục 6](#6-cách-dịch-tay-dự-phòng--sách-cần-chất-lượng-cao-hơn).

---

## 4. Chi tiết triển khai

**Backend** (`tech-books-backend`):

- `Book` entity thêm các cột (tất cả nullable):
  - `translatedFileUrl`, `translatedFileOriginalName` — cùng kiểu với
    `fileUrl`/`fileOriginalName`. Có thể trỏ tới 1 file **chưa dịch hết**
    khi `translationJobStatus==='partial'`.
  - `detectedLanguage: 'vi' | 'foreign' | null`.
  - `translationJobStatus: 'queued' | 'processing' | 'partial' | 'done' | 'failed' | null`.
  - `translationJobError: string | null` — lý do lỗi lần gần nhất, hiện
    thẳng trong danh sách sách ở admin.
  - `translationUntranslatedCount`, `translationTotalSegments: number | null`
    — số đoạn chưa dịch / tổng số đoạn của lần chạy gần nhất, chỉ để hiển thị
    tiến độ (" · còn X/Y đoạn chưa dịch"), không dùng để quyết định logic gì.
  - `translationNextRetryAt: Date | null` — worker chỉ tự nhặt lại 1 job
    `partial`/`failed` khi mốc này đã qua; `null` nghĩa là không có lịch thử
    lại (đang `done`, hoặc chưa từng chạy).
- `POST /books/:id/translate` (`BooksController`/`BooksService.queueTranslation`)
  — validate rồi set `translationJobStatus='queued'`. Chặn nếu: sách không
  phải `detectedLanguage==='foreign'`, đã `done`, hoặc đang `queued`/
  `processing` sẵn. **Cho phép** re-queue khi đang `partial` hoặc `failed` —
  đây là cách ép chạy sớm hơn lịch tự động ~24 giờ, không phải trường hợp đặc
  biệt gì.
- `TranslationQueueModule` (`src/modules/translation-queue/`) — chỉ cần
  `TypeOrmModule.forFeature([Book])` + `NotificationsModule`, đăng ký thẳng
  trong `AppModule` giống `RemindersModule`. Có `exports: [TranslationWorkerService]`
  để `BooksModule` import và gọi `poll()` ngay khi vừa xếp hàng (xem mục 3) —
  chiều phụ thuộc chỉ 1 hướng (`BooksModule` → `TranslationQueueModule`),
  không có gì import ngược lại nên không vòng lặp.
- `POST /books` và `PATCH /books/:id` vẫn nhận field multipart `translatedFile`
  như trước — đường **upload tay** không bị thay thế, chỉ là giờ có thêm
  đường **tự động** song song. Không có field "dán link" cho bản dịch.
- `GET /catalog` trả thêm `translatedFile` (URL tuyệt đối, có cả khi
  `partial`) và `translationComplete` (`true` chỉ khi `done` — cho
  `index.html` biết có hiện thêm nhãn "(đang tiếp tục hoàn thiện)" hay
  không). `translatedFile` dùng chung cho cả file đến từ tự động lẫn upload
  tay, trang đọc không phân biệt được và không cần phân biệt.
  `detectedLanguage`/`translationJobStatus`/`translationJobError`/
  `translationUntranslatedCount`/`translationTotalSegments`/
  `translationNextRetryAt` **chỉ** có trong `GET /books` (trang admin dùng).
- Không thêm dependency npm nào — `pdf-parse` đã có sẵn; hàng đợi dùng
  Postgres + `@nestjs/schedule` (đã cài từ tính năng nhắc nhở định kỳ), không
  cần Redis/BullMQ.

**Sidecar** (`pdf-translator/`, repo `tech-books-backend`):

- `Dockerfile` — `python:3.12-slim`, clone VI-Translate ở build time
  (`ARG VI_TRANSLATE_REF`, mặc định `main` — nên ghim về 1 commit/tag cụ thể
  1 khi mọi thứ chạy ổn, để repo đó đổi gì cũng không tự động đổi hành vi
  service đang chạy), cài `requirements.txt` (không cài `requirements-ocr.txt`
  — sách scan cần OCR không nằm trong luồng tự động này, xem mục 6).
- `server.py` — HTTP server tối giản, 1 request xử lý tại 1 thời điểm (khớp
  với việc `TranslationWorkerService` cũng chỉ xử lý 1 cuốn 1 lúc).

**Frontend** (`tech-books`, `admin.html`):

- Sau khi thêm sách, nếu `detectedLanguage==='foreign'`: `confirm()` hỏi có
  muốn biên dịch ngay không.
- Danh sách sách: nhãn ngôn ngữ, trạng thái biên dịch (đang chờ/đang
  chạy/lỗi), nút **Biên dịch**/**Thử lại** theo đúng bảng ở mục 1.
- Khi có sách đang `queued`/`processing`, tự làm mới danh sách mỗi 10 giây
  (dừng ngay khi không còn job nào đang chạy) — thấy trạng thái cập nhật mà
  không cần bấm F5.

`index.html` không đổi gì thêm so với tính năng "Đọc bản dịch tiếng Việt" đã
có — file đến từ đâu (tự động hay upload tay) không quan trọng với trang đọc.

---

## 5. Vì sao thiết kế như vậy

Bản đầu của tính năng này (trước khi có hàng đợi) cố tình **không** chạy
VI-Translate trong backend — lý do lúc đó: chậm (không hợp 1 request HTTP),
stack Python nặng, và giấy phép AGPL-3.0. Sau khi cân nhắc lại theo đúng yêu
cầu "tự động, tiện lợi, hệ thống thông minh", từng lý do được giải quyết thay
vì bỏ qua:

- **"Chậm, không hợp 1 request HTTP"** → giải quyết bằng **hàng đợi**: admin
  bấm nút, server trả lời ngay "đã xếp hàng", việc dịch thật chạy nền, xong
  thì báo qua thông báo. Không có request nào phải đợi vài phút.
- **"Stack Python nặng"** → giải quyết bằng **Docker**: cô lập hoàn toàn
  trong 1 container riêng (`pdf-translator/`), không cài gì lên host VPS,
  không đụng tới Python/venv của hệ thống (né đúng lỗi `ensurepip` bạn từng
  gặp khi tự cài tay).
- **"Engine Handoff cần AI agent thật, backend không tự làm được"** → không
  dùng Handoff cho luồng tự động nữa — dùng thẳng engine `google` (không cần
  AI agent, không cần LLM API key nào), đổi lại chất lượng thuật ngữ thấp hơn
  1 chút cho những cuốn cần cao hơn thì vẫn dịch tay bằng Handoff được (mục 6).
- **Giấy phép AGPL-3.0** — đây là điểm **chưa giải quyết hoàn toàn, cần biết
  rõ để tự quyết**: chạy VI-Translate không sửa đổi, gọi qua subprocess từ 1
  container riêng, cho 1 app cá nhân 2 người dùng (không phải dịch vụ công
  khai) — rủi ro thực tế rất thấp, nhưng về mặt câu chữ AGPL, việc "cung cấp
  phần mềm AGPL như 1 dịch vụ qua mạng" (kể cả nội bộ) vẫn có thể được hiểu
  là phát sinh nghĩa vụ mở mã tương ứng. Chấp nhận rủi ro này là quyết định
  có chủ đích cho quy mô dự án này (cá nhân, không thương mại hoá) — không
  phải một khe hở bị bỏ sót.

Vẫn giữ nguyên **đường thủ công** (upload tay bản dịch qua form sửa sách) —
không bị thay thế, phòng khi worker lỗi, chưa deploy container, hoặc cần
dùng Handoff cho 1 cuốn cụ thể.

### Vì sao thêm trạng thái `partial` (dịch dở vẫn đọc được)

Thiết kế ban đầu là "tất cả hoặc không gì cả": 1 lần chạy phải dịch xong gần
hết mới được coi là thành công, còn lại thì xoá file vừa tạo và báo lỗi
(`failed`) để giữ nguyên tắc "không đánh dấu `done` cho 1 bản dịch dở dang".
Vấn đề gặp phải trong thực tế: **quota miễn phí của MyMemory (~200 đoạn/ngày)
quá nhỏ so với 1 cuốn sách kỹ thuật thật** (ví dụ *Designing Data-Intensive
Applications*: 4279 đoạn) — với luật cũ, sách sẽ **không có gì để đọc trong
~3 tuần liền**, rồi mới xong nguyên cuốn 1 lần, dù server dịch được thêm mỗi
ngày (nhờ cache dịch giữ tiến độ qua các lần chạy, xem
[`pdf2zh/cache.py`](https://github.com/DANG-PH/translate-vi-language/blob/main/pdf2zh/cache.py) —
sqlite trong container, còn miễn container không bị rebuild).

Sửa lại: tách rõ 2 khái niệm vốn bị gộp làm một — "**tool chạy có lỗi
không**" (crash, timeout → `failed`, giữ nguyên) và "**dịch được bao nhiêu**"
(số đoạn còn thiếu → không còn quyết định thành/bại nữa, chỉ quyết định
`done` hay `partial`). Một file dịch dở vẫn là thứ hữu ích để đọc — chương
đầu thường dịch xong trước (dịch theo thứ tự trang), nên trải nghiệm thực tế
gần với "đọc dần mỗi ngày một ít" dù cơ chế bên dưới vẫn là "thay nguyên file
mỗi lần chạy lại", không phải cập nhật từng đoạn.

Đánh đổi cần biết: **không còn khái niệm "bản dịch luôn hoàn chỉnh hoặc
không có gì"** — reader có thể mở 1 file còn nhiều đoạn tiếng Anh xen giữa.
Nhãn "(đang tiếp tục hoàn thiện)" ở `index.html` và tỉ lệ đoạn chưa dịch ở
admin.html là để không ai hiểu lầm 1 bản `partial` là bản cuối cùng.

---

## 6. Cách dịch tay (dự phòng / sách cần chất lượng cao hơn)

Vẫn hữu ích khi: sidecar chưa deploy xong, muốn dùng engine `handoff` (chính
xác thuật ngữ hơn cho 1 cuốn quan trọng), hoặc sách cần OCR (bản scan).

```bash
# venv cần python3-venv trước (Ubuntu/Debian không có sẵn):
python3 --version   # xem đúng số bản, vd 3.12.3
sudo apt update && sudo apt install python3.12-venv   # đổi số theo bản của bạn

git clone https://github.com/DANG-PH/translate-vi-language.git VI-Translate
cd VI-Translate
git remote add upstream https://github.com/breslee1707/VI-Translate.git
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# chế độ Handoff — chính xác thuật ngữ hơn hẳn Google (ví dụ trong README của
# họ: "conduction" bị Google dịch thành "dẫn điện", Handoff dịch đúng "dẫn nhiệt")
.venv/bin/python scripts/translate_pdf.py INPUT.pdf --engine handoff --emit-segments segments.jsonl
# nhờ 1 AI agent (vd. Claude Code, chạy ngay trong repo VI-Translate đã clone) dịch segments.jsonl -> translations.jsonl
.venv/bin/python scripts/translate_pdf.py INPUT.pdf --engine handoff --segments translations.jsonl --output-dir OUT
```

Kết quả ở `OUT/INPUT-vi.pdf` — vào trang admin → **Sửa** cuốn sách đó → mục
"Thêm chi tiết" → ô "Bản dịch tiếng Việt (PDF)" → chọn file đó → **Lưu**.
Nếu cuốn này từng chạy qua luồng tự động và đã `done`, upload tay ở đây vẫn
**thay thế được** bản dịch cũ — chỉ luồng tự động mới bị khoá không tự dịch
lại, đường thủ công luôn mở.

---

## 7. Deploy lên VPS (Linux)

### 7.1. Sidecar `pdf-translator` (chỉ cần làm 1 lần, hoặc khi đổi Dockerfile)

```bash
ssh <user>@<vps-host>
cd ~/tech-books-backend   # đường dẫn thật tuỳ máy bạn

docker compose build pdf-translator   # kéo VI-Translate + cài Python deps —
                                       # có thể mất vài phút, tải kha khá (opencv,
                                       # onnxruntime, model layout ~75MB...)
docker compose up -d pdf-translator

# kiểm tra đã sống chưa
curl http://127.0.0.1:8787/health   # mong đợi: {"ok": true}
docker compose logs pdf-translator --tail 30
```

### 7.2. `.env` của backend — thêm các dòng sau

```bash
PDF_TRANSLATOR_URL=http://127.0.0.1:8787
PDF_TRANSLATOR_UPLOAD_PATH=/uploads
# tuỳ chọn — mặc định đã là 10800 (3 giờ) nếu bỏ trống; chỉnh khi cần
PDF_TRANSLATOR_TIMEOUT_SECONDS=10800
```

Không set `PDF_TRANSLATOR_URL` thì tính năng biên dịch tự động chỉ đơn giản
**không khả dụng** — nút "Biên dịch" gọi API sẽ báo lỗi, còn lại mọi thứ khác
của app không hề bị ảnh hưởng (giống cách `GEMINI_API_KEY`/`VAPID_*` để trống
thì các tính năng liên quan tự tắt, không crash gì).

`PDF_TRANSLATOR_TIMEOUT_SECONDS` **cùng 1 file `.env` này** quyết định cả
2 phía (`docker-compose.yml` và backend Node đều đọc đúng biến này, đúng
file này) — chỉ cần sửa ở đây, không phải sửa 2 chỗ. Gặp sách siêu dài vẫn
timeout ở 10800s thì tăng số này lên, không cần sửa code.

### 7.3. Backend

```bash
git pull origin master
npm install
npm run build
pm2 restart all --update-env   # --update-env BẮT BUỘC lần này — có biến .env mới
pm2 logs --lines 60
```

Kiểm tra: log sạch, không lỗi `TypeOrmModule`. Cột mới tự tạo trong bảng
`books` nhờ `synchronize: true` — không cần migration tay. Thử: thêm 1 cuốn
sách nước ngoài, xác nhận biên dịch ngay khi được hỏi, đợi ít phút, xem chuông
thông báo có báo "Đã biên dịch xong..." không.

### 7.4. Frontend

Deploy lại 3 file `.html` như thường lệ — không có gì đổi ở quy trình.

### Giới hạn cần biết

- Xử lý **1 cuốn 1 lúc**, giả định backend chạy **1 instance duy nhất** (pm2
  chế độ thường, không phải cluster mode nhiều worker). Nếu sau này chạy
  cluster mode nhiều instance, cần thêm khoá phân tán cho
  `TranslationWorkerService` — chưa cần thiết ở quy mô hiện tại.
- `pdf-translator` build lần đầu tốn thời gian và băng thông (tải model +
  cài đặt ML stack) — bù lại các lần sau chỉ `docker compose up -d` là chạy
  ngay, không phải build lại trừ khi đổi Dockerfile.
- Engine `google` không hỗ trợ sách cần OCR (bản scan) — nếu 1 cuốn báo lỗi
  vì lý do này, dịch tay theo mục 6 với cờ OCR thay vì trông cậy vào luồng
  tự động.

### Sự cố từng gặp (đã sửa, để nhớ lý do)

- **`Biên dịch lỗi: fetch failed`** — Node's `fetch()` báo lỗi kết nối
  chung chung, nguyên nhân thật nằm ở `err.cause` mà `.message` một mình bỏ
  qua. Đã sửa để lấy luôn `.cause` vào thông báo lỗi hiện trong admin.
- **`Biên dịch lỗi: fetch failed: Headers Timeout Error`** — `fetch()` của
  Node (chạy trên undici) có **timeout mặc định 5 phút** chờ header phản
  hồi, ngắn hơn nhiều so với ceiling phía Python. Đã đổi từ `fetch()` sang
  `http`/`https.request()` thuần (không phụ thuộc thêm gói nào) — không có
  ceiling 5 phút mặc định đó nữa.
- **Vẫn lỗi timeout, đúng ở giây thứ 1800 hoặc 1860, dù đã sửa 2 lỗi trên**
  — 2 nguyên nhân cộng lại:
  1. **30 phút chưa bao giờ đủ cho sách thật.** Comment ngay trong code gốc
     của VI-Translate (`pdf2zh/converter.py`) nói thẳng: *"A book is
     thousands of segments over tens of minutes"* là **bình thường**, chưa
     kể nếu Google chặn (throttle) thì mỗi đoạn bị retry tới 8 lần, mỗi lần
     backoff tới 60s — 1 cuốn bị throttle nhiều có thể mất hơn 1 giờ, không
     phải bug, đúng thiết kế của chính công cụ.
  2. **2 nơi set cùng biến `PDF_TRANSLATOR_TIMEOUT_SECONDS` không đồng
     bộ**: `docker-compose.yml` hardcode 1 giá trị cho container Python,
     còn backend Node đọc `.env` **riêng** của nó — chưa từng được set nên
     rơi về mặc định cũ (1800s), một bên đã nâng lên nhưng bên kia thì
     chưa, bên nào ngắn hơn thắng.

  Sửa cả 2: nâng mặc định lên **3 giờ** (10800s) ở cả 3 chỗ
  (`pdf-translator/server.py`, `TranslationWorkerService`,
  `docker-compose.yml`), và `docker-compose.yml` giờ đọc
  `${PDF_TRANSLATOR_TIMEOUT_SECONDS:-10800}` từ đúng `.env` mà backend
  cũng đọc — **1 biến, 1 chỗ set, cả 2 bên luôn khớp nhau**, không còn
  cảnh chỉnh 1 nơi tưởng xong nhưng nơi kia không hay biết.
- **`curl http://127.0.0.1:8787/health` bị treo trong lúc có job đang
  chạy** — `server.py` trước đó dùng `HTTPServer` (xử lý đúng 1 kết nối 1
  lúc, không phải chỉ 1 `/translate` 1 lúc mà là **toàn bộ server**), nên 1
  job `/translate` đang chạy làm treo luôn cả `/health`. Đã đổi sang
  `ThreadingHTTPServer` — mỗi kết nối 1 thread riêng, `/health` phản hồi
  ngay cả khi có job nặng đang chạy. Giới hạn "1 cuốn 1 lúc" thật ra do
  Node (`TranslationWorkerService`) tự kiểm soát, không cần server Python
  đơn luồng để ép điều đó.
- **Vẫn timeout dù đã nâng lên 3 giờ (10800s)** — nâng số lên không giải
  quyết được gốc rễ nếu bản thân request tới Google đang bị chặn/throttle
  gần như toàn bộ (VPS IP dễ bị Google để ý hơn IP nhà riêng). Vấn đề thật
  sự trước đó là **không nhìn thấy gì để biết đúng nguyên nhân** —
  `subprocess.run(capture_output=True)` giữ toàn bộ output trong bộ đệm,
  không in ra `docker logs` cho tới khi tiến trình kết thúc hoặc bị kill,
  nên 1 job đang chạy thật và 1 job đã treo chết nhìn **giống hệt nhau**
  từ ngoài nhìn vào. Đã đổi sang `Popen` + 2 thread bơm `stdout`/`stderr`
  ra `docker compose logs -f pdf-translator` **ngay khi có dòng mới**, và
  nếu timeout thì phản hồi lỗi kèm luôn 4000 ký tự cuối của cả
  `stdout`/`stderr` đã in được tới lúc đó — giờ xem log lúc job đang chạy
  sẽ biết ngay là đang tiến triển hay đã treo.

  Cách kiểm tra nhanh nhất, không cần đợi hàng giờ mới biết: gọi thẳng 1
  đoạn dịch ngắn qua Google từ trong container, xem có phản hồi trong vài
  giây không —
  ```bash
  docker compose exec pdf-translator python3 -c "
  import sys, time
  sys.path.insert(0, '/app/vi-translate')
  from pdf2zh.translator import GoogleTranslator
  t = GoogleTranslator('auto', 'vi')
  start = time.time()
  try:
      print('KET QUA:', t.translate('Hello, this is a short test sentence.'))
      print('MAT:', round(time.time() - start, 1), 's')
  except Exception as e:
      print('LOI:', type(e).__name__, e)
  "
  ```
  Không thấy gì sau ~30-60s, hoặc báo lỗi kết nối — Google đang chặn.

  **Kết quả kiểm tra thật (đã chạy)**: cả `translate.google.com/m` (engine
  `google` đang dùng) lẫn endpoint thay thế `translate.googleapis.com
  ?client=gtx` đều bị Google trả về **HTTP 429 kèm trang CAPTCHA ngay lập
  tức, 100% số lần thử**, kể cả gắn header trình duyệt chuẩn — không phải
  "thỉnh thoảng chậm", mà chặn thẳng. Đây là hành vi phổ biến của Google
  với IP kiểu server/datacenter/VPS cho các endpoint dịch không chính thức
  này, không riêng gì VPS của dự án.

  **Đã vá trực tiếp vào fork VI-Translate** (`DANG-PH/translate-vi-language`,
  file `pdf2zh/translator.py`): `GoogleTranslator` giờ tự động rơi xuống
  **MyMemory** (dịch vụ dịch miễn phí khác, không cần key, đã xác nhận gọi
  được bình thường từ cùng mạng bị Google chặn) ngay khi Google thất bại
  lần đầu — không retry 8 lần vào 1 endpoint đã chết hẳn (tốn thời gian vô
  ích), mà chuyển hẳn sang MyMemory cho toàn bộ phần còn lại của lượt chạy
  đó. Cùng ý tưởng "circuit breaker + fallback" đã dùng thành công ở 1 dự
  án khác của chính bạn (`hanni-server`'s `translate.util.ts`).

  Đánh đổi cần biết: **chất lượng MyMemory không đều bằng Google** — nó là
  dịch vụ "translation memory" (khớp bản dịch có sẵn trong kho dữ liệu),
  câu quen thuộc/phổ biến đôi khi trả về gần như nguyên văn tiếng Anh thay
  vì dịch máy thật. Nhưng ít nhất **luôn chạy được**, không còn treo/timeout
  vô thời hạn như trước.

  `docker-compose.yml`'s `ARG VI_TRANSLATE_REF=main` đã trỏ sẵn tới fork
  này, nên chỉ cần `docker compose build pdf-translator` lại là code mới
  (bản vá MyMemory) tự động được kéo vào, không cần sửa gì thêm.
