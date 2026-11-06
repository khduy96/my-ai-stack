# Tri thức dự án (knowledge): cách dùng và duy trì

Áp dụng cho stack 1.2. Dự án phải đã được tích hợp (xem [INTEGRATE.md](INTEGRATE.md)).

Knowledge là thư mục ghi những điều về dự án mà **đọc code không thấy ngay**: hệ thống chạy thế nào, vì sao làm vậy, quy ước ngầm, cạm bẫy. Agent `ai-*` tra nó trước khi làm việc, nên một điều ghi một lần sẽ được dùng lại ở mọi lần sau.

| Lệnh | Việc | Ai làm |
|---|---|---|
| `/ai-learn <run \| ghi chú>` | Ghi tri thức mới hoặc sửa tri thức cũ | `ai-scribe` |
| `/ai-knowledge-audit [vùng]` | Đối chiếu tri thức với code hiện tại, sửa phần sai hoặc lỗi thời | `ai-verifier` soát, bạn duyệt, `ai-scribe` sửa |
| `stack search "<từ khóa>"` | Tra tri thức theo độ liên quan (khi bật `retriever: index`) | bạn hoặc agent |

---

## 1. Bật knowledge

Khai trong `.claude/project.yaml`, rồi build lại:

```yaml
knowledge: docs/knowledge
```

```bash
node <stack>/kernel/cli/stack.mjs build --project .
```

Thư mục được tạo khi bạn ghi lần đầu. Từ đó mọi agent được dặn:
- đọc `docs/knowledge/INDEX.md` trước khi làm việc;
- tìm trong thư mục theo từ khóa của task;
- ghi rõ đã dựa vào file tri thức nào;
- **tin code** khi tri thức mâu thuẫn với code, và nói ra chỗ mâu thuẫn.

Nếu dự án bật `scope`, thư mục knowledge vẫn luôn được phép ghi.

## 2. Bên trong thư mục

```
docs/knowledge/
├── INDEX.md                  mục lục: mỗi file một dòng, nhóm theo khu vực
├── upload-chunking.md        mỗi chủ đề một file, tên kebab-case
├── payment-two-backends.md
└── ...
```

Mỗi file có dạng:

```markdown
---
title: Large uploads are split into 8 MB chunks
tags: [upload, cloud, hk-backend]
updated: 2026-11-06
sources:
  - lib/features/cloud/data/upload/chunker.dart:42
  - .ai-runs/20261106-1430-bugfix-upload-stuck
---
Files over 2 GB are uploaded in 8 MB chunks (`chunker.dart:42`).

Why: the HK SDK rejects chunks larger than 8 MB with a generic error,
which looked like a network failure in bug #7301.
```

`INDEX.md`:

```markdown
## Cloud
- [Large uploads are split into 8 MB chunks](upload-chunking.md): why the chunk size is fixed
- [Two backends for payment](payment-two-backends.md): order on VN, pay on HK
```

Nội dung viết bằng tiếng Anh (dành cho agent). Bạn không cần tự viết hay sửa các file này: scribe làm hết, còn bạn xem lại diff.

## 3. Ghi tri thức với `/ai-learn`

**Từ một lần chạy vừa xong:** sau `/ai-feature`, `/ai-bugfix` hay `/ai-explain` mà bạn học được điều gì đó. Báo cáo của các flow này thường tự gợi ý.

```
/ai-learn .ai-runs/20261106-1430-bugfix-upload-stuck
```

**Từ một ghi chú của bạn:** điều bạn biết mà code không nói ra.

```
/ai-learn upload file > 2GB phải chia chunk 8MB, HK SDK từ chối chunk lớn hơn
/ai-learn quyết định: không thêm gói DAY, chỉ MONTH và YEAR, vì backend chưa hỗ trợ gia hạn theo ngày
/ai-learn màn Favorite không được gọi thẳng sang socialfi, phải đi qua module_bridge
```

Scribe sẽ:
1. Chỉ giữ điều còn đúng và còn có ích sau một tháng.
2. Đối chiếu từng điều với code, ghi nguồn `path:line`.
3. Nếu chủ đề đã có file thì sửa file đó, không tạo file trùng, và xóa câu mà bằng chứng mới cho thấy đã sai.
4. Cập nhật `INDEX.md`.
5. Báo lại file nào được ghi, điều gì bị bỏ và vì sao.

### Nên ghi và không nên ghi

| Nên ghi | Không nên ghi |
|---|---|
| Cơ chế không hiển nhiên: luồng đi qua nhiều module, thứ tự gọi bắt buộc | Điều code đã nói rõ: tên hàm, danh sách file, chữ ký API |
| Lý do một quyết định, kèm phương án đã loại | Trạng thái công việc: đang làm gì, branch nào, việc còn lại (thuộc memory bank, mục 7) |
| Quy ước team không có trong linter | Lịch sử thay đổi (đã có trong `git log`) |
| Cạm bẫy đã gây lỗi thật, và cách tránh | Giá trị secret: key, token, mật khẩu, URL có thông tin đăng nhập |
| Ranh giới sở hữu: vùng của team khác, ai cần hỏi | Ý kiến chưa kiểm chứng (nếu cần thì đánh dấu `[?]`) |

Cách thử nhanh: *"Một người mới vào dự án, đọc code nửa ngày, có tự biết điều này không?"* Nếu có thì không cần ghi.

## 4. Tra tri thức

**Mặc định (grep):** agent tự tìm trong thư mục, phù hợp khi có vài chục file.

**Khi thư mục lớn:** chuyển sang tra theo thứ hạng.

```yaml
knowledge: { dir: docs/knowledge, retriever: index }
```

Agent sẽ dùng `stack search`, và quyền chạy lệnh này được build tự thêm. Bạn cũng tự tra được:

```bash
node <stack>/kernel/cli/stack.mjs search "upload chunk" --project .
```

- Xếp hạng BM25 trên tiêu đề, tag và nội dung, không phân biệt dấu. Mỗi lần gọi đều tính lại, nên không có chỉ mục cũ cần dựng lại.
- Đây là tìm theo **từ khóa**: tra bằng tiếng Anh vì tri thức viết bằng tiếng Anh.
- Muốn tìm theo ý nghĩa, xuyên ngôn ngữ, thì kết nối một MCP server tìm kiếm vector qua integration (`/stack tools`).

## 5. Duy trì

Code đổi thì tri thức cũ dần. Tri thức sai còn tệ hơn không có tri thức, vì agent sẽ tin nó.

### 5.1. Rà soát với `/ai-knowledge-audit`

```
/ai-knowledge-audit                          # toàn bộ, file có `updated` cũ nhất trước, khoảng 30 file mỗi lần
/ai-knowledge-audit lib/features/payment     # chỉ các file có sources trỏ vào vùng này
/ai-knowledge-audit docs/knowledge/upload-chunking.md
/ai-knowledge-audit older than 90 days
```

1. **Soát:** `ai-verifier` chỉ đọc. Nó đi theo `sources` và các `path:line` được trích, so với code và `git log` từ ngày `updated`, rồi báo lỗi tại đúng dòng trong file tri thức kèm cách sửa:

   | Mức | Nghĩa là |
   |---|---|
   | major | Code giờ nói khác: hành vi đổi, thứ được nhắc đã bị xóa hoặc đổi tên, quyết định bị đảo |
   | minor | Trích dẫn lệch dòng nhưng nội dung vẫn đúng; không còn xác nhận được từ code; hai file trùng chủ đề |
   | info | Thiếu frontmatter; `INDEX.md` lệch với các file |

2. **Bạn duyệt:** flow dừng lại chờ. Muốn bỏ lỗi nào thì nói, bước soát chạy lại theo ý bạn.
3. **Sửa:** `ai-scribe` chỉnh câu sai, sửa trích dẫn, xóa hoặc đánh dấu `[?]`, gộp chủ đề trùng, cập nhật `updated` và `INDEX.md`. File bị gộp mất chỉ bị xóa khi bạn đồng ý.
4. **Báo cáo:** số file đã soát, còn đúng và đã sửa, kèm `git diff`. Không commit.

### 5.2. Nhịp duy trì đề xuất

| Khi nào | Làm gì |
|---|---|
| Ngay sau bugfix khó, quyết định kiến trúc, hay lần mất thời gian vì một cái bẫy | `/ai-learn <run hoặc ghi chú>` |
| Agent nói tri thức mâu thuẫn với code | `/ai-learn <điều đúng>` để sửa ngay chủ đề đó |
| Sau một đợt refactor hay đổi tên lớn | `/ai-knowledge-audit <thư mục vừa refactor>` |
| Mỗi sprint (hoặc mỗi tháng) | `/ai-knowledge-audit`: rà khoảng 30 file cũ nhất. Chạy lại cho tới khi hết file bị bỏ sót |
| Trước khi onboard người mới | `/ai-knowledge-audit` toàn bộ |
| Thư mục vượt vài chục file | Chuyển sang `retriever: index` |

### 5.3. Sửa tay

Sửa tay được, nhưng nên giữ đúng định dạng: frontmatter đủ 4 trường, mỗi chủ đề một file, `INDEX.md` khớp với các file. Lần `/ai-knowledge-audit` sau sẽ bắt những chỗ lệch.

### 5.4. Xem lại trước khi giữ

Scribe không commit. Sau mỗi lần ghi hay audit:

```bash
git diff -- docs/knowledge
```

Đọc lướt: có câu nào sai, có secret nào lọt vào, có file nào bị xóa nội dung ngoài ý muốn. Ổn thì commit cùng thay đổi code liên quan.

## 6. Dùng chung hay dùng riêng

| Cách | Làm |
|---|---|
| Cả team dùng chung (khuyên dùng) | Commit `docs/knowledge/`. Review như code: thay đổi tri thức đi cùng PR của thay đổi code |
| Chỉ mình bạn | Thêm `docs/knowledge/` vào `.git/info/exclude` (không thêm vào `.gitignore`) |

Khi dùng chung, nên quy ước: ai sửa hành vi được một file tri thức mô tả thì chạy `/ai-learn` hoặc `/ai-knowledge-audit <vùng>` trong cùng PR.

## 7. Knowledge và memory bank

Hai thứ này bổ sung cho nhau, không thay thế nhau:

| | knowledge | memory bank (`memory_bank:`) |
|---|---|---|
| Trả lời | "Phần X hoạt động thế nào, vì sao?" | "Dự án là gì, đang ở đâu, làm gì tiếp?" |
| Cấu trúc | Mỗi chủ đề một file và `INDEX.md`, số file không giới hạn | Cố định 6 file, mỗi file dưới 150 dòng |
| Agent đọc | Tra khi cần | Luôn đọc đầu phiên |
| Nội dung | Chỉ tri thức lâu dài | Có cả trạng thái đang thay đổi |
| Ghi bằng | `/ai-learn` | `/ai-memory-init`, `/ai-memory-update` |

- Dự án nhỏ, ngắn hạn: memory bank là đủ.
- Dự án lớn, làm lâu: dùng cả hai. Memory bank giữ phần tổng quan và trạng thái, knowledge giữ phần chi tiết. Điều đáng giữ lâu xuất hiện trong `activeContext.md` thì chuyển sang knowledge bằng `/ai-learn`.

## 8. Sự cố thường gặp

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| `/ai-learn` báo `blocked`, đòi khai `knowledge` | Chưa có `knowledge:` trong `project.yaml`, hoặc chưa build lại sau khi thêm |
| Agent không nhắc tới tri thức đã ghi | Kiểm tra `INDEX.md` có dòng của file đó; tiêu đề và tag có chứa từ khóa của task. Với thư mục lớn, bật `retriever: index` |
| `stack search` không ra kết quả | Tra bằng tiếng Anh; kiểm tra `retriever: index` đã khai và đã build lại |
| Tri thức trùng lặp, nhiều file cùng chủ đề | `/ai-knowledge-audit` sẽ báo minor "trùng chủ đề" và gộp sau khi bạn duyệt |
| `updated` sai ngày | Scribe không có shell nên có thể đoán ngày khi chạy `/ai-learn`. `/ai-knowledge-audit` lấy ngày từ tên thư mục run. Thấy sai thì sửa tay |
| Agent tin một điều đã lỗi thời | Agent được dặn tin code khi mâu thuẫn, nhưng chỉ khi nó có kiểm tra. Chạy `/ai-knowledge-audit <vùng>` cho vùng đó |

---

Xem thêm: [USAGE.md](USAGE.md) (mục F2 và F4), [kernel/conventions.md](kernel/conventions.md) (mục Knowledge và Memory bank).
