# Code maps: cách dùng và duy trì

Code map giúp agent (và người) đi thẳng tới đúng file thay vì tìm khắp repo. Tài liệu này hướng dẫn thiết lập, dùng hằng ngày và giữ map luôn đúng với code.

Trong tài liệu, `<stack>` là đường dẫn tới thư mục `stack/` trên máy bạn.

## Hai loại map

| | Project map | Repo map |
|---|---|---|
| Trả lời | "Tính năng X nằm đâu, ai gọi nó?" | "Đổi X thì vỡ gì?" |
| File index | `PROJECT_MAP.md`: mỗi module một mục (đường dẫn, entry point, từ khóa) + mục "Not mapped" | `REPO_MAP.md`: mỗi module một mục (entry point, số lời gọi từ module khác) |
| File theo module | `<module>.MAP.md` | `<module>.REPO.MAP.md` |
| Nội dung | Theo tính năng: UI, state, các layer, text, **được gọi từ**, **phụ thuộc**, bẫy; bảng public API; bảng triệu chứng | Tổng quan và quy ước; luồng `Page → State → UseCase → Repository` kèm symbol; bảng **INBOUND / OUTBOUND** có cột rủi ro (⛔ = import vượt ranh giới); DI, router, vòng đời; file generated và lệnh sinh |
| Đường dẫn | Ngắn, tính từ module | Đầy đủ, tính từ gốc repo |

Ví dụ cấu trúc:

```
maps/
├── PROJECT_MAP.md
├── REPO_MAP.md
├── cloud_storage.MAP.md
├── cloud_storage.REPO.MAP.md
├── im.MAP.md
└── im.REPO.MAP.md
```

Chỉ role `ai-cartographer` ghi vào thư mục này, qua hai lệnh `/ai-map-init` và `/ai-map-update`.

## 1. Thiết lập (một lần)

### Trên máy

Sau khi lấy bản stack có maps, cài lại skill:

```bash
cd <stack>/kernel/cli
node stack.mjs install
```

### Trên mỗi dự án

**Bước 1.** Thêm vào `.claude/project.yaml`:

```yaml
maps: maps
```

**Bước 2.** Build và kiểm tra:

```bash
node <stack>/kernel/cli/stack.mjs build  --project .
node <stack>/kernel/cli/stack.mjs doctor --project .   # phải là 0 error(s)
```

**Bước 3.** Mở phiên Claude Code mới (để nhận lệnh mới), rồi tạo map.

*Dự án mới (chưa có code):* mô tả các module dự kiến. Cartographer chỉ tạo hai file index, ghi module dự kiến vào mục `Planned` (đánh dấu `[?]`) cùng quy ước đặt tên.

```
/ai-map-init App đặt lịch salon: booking (lib/features/booking), salon (lib/features/salon), payment (lib/features/payment), auth dùng chung ở lib/core/auth
```

*Dự án có sẵn:* nêu module muốn map trước. Hai file index luôn liệt kê **mọi** module; module chưa map nằm ở "Not mapped".

```
/ai-map-init lib/features/cloud_storage
/ai-map-init
```

Để trống thì cartographer map vùng `scope`; repo nhỏ (khoảng 150 file nguồn trở xuống) thì map hết; repo lớn mà không có scope thì nó hỏi nên map module nào trước.

Nếu dự án đã có `maps/PROJECT_MAP.md`, `map-init` không ghi đè mà chuyển sang cập nhật, và giữ ngôn ngữ nhãn của map đang có.

**Bước 4.** Cuối flow, đồng ý thêm khối `# Code maps` vào `CLAUDE.md`. Nhờ khối này, phiên thường (không gọi agent `ai-*`) cũng đọc map.

**Bước 5.** Đọc lại map, sửa các mục `[?]` nếu bạn biết câu trả lời, rồi **commit thư mục `maps/`** để cả team dùng chung. Chỉ map vùng của riêng bạn thì đưa `maps/` vào `.git/info/exclude` (không dùng `.gitignore`).

## 2. Dùng hằng ngày

Thường thì bạn không cần làm gì thêm:

- Mọi agent `ai-*` (`/ai-feature`, `/ai-bugfix`, `/ai-explain`, `/ai-review`…) tự đọc `PROJECT_MAP.md` trước khi tìm code, và đọc `<module>.REPO.MAP.md` trước khi đổi thứ mà module khác gọi tới.
- Phiên thường cũng đọc map nhờ khối trong `CLAUDE.md`.
- Module nằm ở "Not mapped" thì agent tự tìm như bình thường, không bị kẹt.

Bạn tự mở map khi cần:

| Bạn cần | Mở |
|---|---|
| Tìm tính năng nằm ở đâu | `PROJECT_MAP.md`, tìm theo từ khóa, rồi mở `<module>.MAP.md` |
| Có bug, chưa biết bắt đầu từ đâu | Bảng "Common symptoms" cuối `<module>.MAP.md` |
| Sắp đổi signature hoặc model dùng chung | Mục 3.1 INBOUND trong `<module>.REPO.MAP.md`: ai đang gọi, rủi ro bao nhiêu |
| Muốn biết module này gọi ra module nào | Mục 3.2 OUTBOUND trong `<module>.REPO.MAP.md` |
| Không chắc file nào là file sinh tự động, sinh bằng lệnh gì | Mục 4 trong `<module>.REPO.MAP.md` |

## 3. Duy trì

### Khi nào cập nhật

| Tình huống | Lệnh |
|---|---|
| Agent ghi trong summary rằng map cần `/ai-map-update` | `/ai-map-update` |
| Xong một tính năng hoặc fix lớn (thêm, xóa, chuyển file; đổi bridge hay public API) | `/ai-map-update` hoặc `/ai-map-update .ai-runs/<run>` |
| Muốn map thêm một module | `/ai-map-update lib/features/<module>` |
| Module bị refactor mạnh, map sai nhiều | `/ai-map-update <module>` (map lại toàn bộ module) |
| Định kỳ, ví dụ trước mỗi release hoặc mỗi sprint | `/ai-map-update` |

`/ai-map-update` không kèm tham số: với mỗi map, cartographer đọc commit ghi ở đầu map, xem `git diff` từ commit đó tới nay, cập nhật đúng các mục bị ảnh hưởng, tìm lại nơi gọi khi public API đổi, rồi ghi commit và ngày mới vào đầu map.

### Biết map lỗi thời đến đâu

Đầu mỗi map có dòng `Last updated: commit <hash> (<ngày>)`. Xem module đã đổi gì kể từ đó:

```bash
git log --oneline <hash>..HEAD -- <đường dẫn module>
```

Lệnh này ra nhiều dòng là đến lúc chạy `/ai-map-update`.

### Duyệt trước khi commit

- Mỗi lần update, flow hiện diff của `maps/`. Xem kỹ phần "Called from" và bảng INBOUND, vì đây là chỗ dễ sai nhất.
- Commit map **cùng PR** với thay đổi code, để map khớp với code của branch đó.
- Flow không bao giờ tự stage hay commit.

### Sửa tay

Được. `maps/` không phải file do `stack build` sinh ra, nên build không ghi đè. Những gì bạn biết mà code không thể hiện thì nên tự thêm, nhất là:

- mục **Pitfalls** của từng tính năng;
- bảng **Common symptoms** (triệu chứng → nguyên nhân hay gặp → chỗ xem);
- **từ khóa** mà team và tester hay dùng khi báo lỗi.

Cartographer giữ lại những điều này khi update nếu chúng vẫn còn đúng với code.

## 4. Mẹo

- **Map dần từng module**, bắt đầu từ module hay sửa nhất. Không cần map cả repo ngay.
- **Từ khóa** nên có cả tiếng Việt lẫn tiếng Anh, đúng những từ người ta gõ khi tìm.
- **Map quá khoảng 400 dòng:** chạy `/ai-map-update <module>`, cartographer sẽ tách theo vùng (`<module>.<vùng>.MAP.md`).
- **Agent làm sai vì map sai:** chạy `/ai-map-update <module>` ngay. Map sai còn hại hơn không có map, dù agent được dặn tin code hơn map.
- **Mục `[?]`** là điều cartographer chưa xác nhận được. Xác nhận hoặc sửa chúng khi duyệt.

## 5. Map, memory bank hay knowledge?

| | Trả lời | Lệnh |
|---|---|---|
| Maps | Code *ở đâu*, *đụng tới gì* | `/ai-map-init`, `/ai-map-update` |
| Memory bank | Dự án *đang ở đâu*: mục tiêu, trạng thái, quyết định | `/ai-memory-init`, `/ai-memory-update` |
| Knowledge | *Vì sao* và *cạm bẫy*, theo chủ đề | `/ai-learn` |

Ba thứ bổ sung cho nhau; dùng cái nào cũng được, hoặc cả ba.

## 6. Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| Không có lệnh `/ai-map-init` | Chưa build lại dự án sau khi thêm `maps:`, hoặc chưa mở phiên mới |
| Cartographer báo `blocked`, đòi khai `maps:` | Thêm `maps: maps` vào `.claude/project.yaml` rồi build |
| Có `scope`, sợ cartographer không ghi được `maps/` | Không sao: thư mục maps luôn được phép ghi dù có `scope` |
| Map nhắc tới file không còn tồn tại | Chạy `/ai-map-update`; cartographer xóa mọi đường dẫn không còn có thật |
| Phiên thường không đọc map | Thiếu khối `# Code maps` trong `CLAUDE.md`; thêm khối đó (xem bước 4) |
