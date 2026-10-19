# prompt-master — Hướng dẫn sử dụng

Gom **ý tưởng lộn xộn → prompt dùng được ngay** bằng **một lệnh**. Bên trong chạy 7 bước,
không gắn với model cụ thể nào. Skill chỉ viết prompt, **không tự làm việc** mà prompt mô tả.

## Luồng

```
/prompt-master <ý tưởng...>
 ├─ 01 Prompt Maker : ý tưởng → bản mô tả việc gọn
 ├─ 02 Grill Me     : hỏi tới khi hết mơ hồ                  ← BẠN TRẢ LỜI   (-q: bỏ qua)
 ├─ 03 How To       : vạch các bước dễ quên
 ├─ 04 Optimizer    : rà mục tiêu, ngữ cảnh, ràng buộc, tiêu chí hoàn thành
 ├─ 05 Prompter     : in prompt cuối + lưu file               ← BẠN DUYỆT ("ok" / sửa)
 │                    → .claude/document/prompts/<slug>.prompt.md
 ├─ 06 Write a Skill: hỏi có lưu thành skill không            (-s: tự lưu)
 │                    → .claude/skills/<tên>/SKILL.md
 └─ 07 Hand Off     : hỏi có cần file bàn giao không          (-h: tự tạo)
                      → .claude/document/prompts/<slug>.handoff.md
```

## Kết quả nhận được

| Thứ | Khi nào | Dùng để |
|---|---|---|
| **Prompt hoàn chỉnh** (`<slug>.prompt.md`) | luôn có | copy dán vào chat AI, hoặc `/task <file>` nếu là task code |
| **Skill mới** (`/<tên>`) | nếu bạn đồng ý / `-s` | lần sau gặp việc tương tự chỉ gõ `/<tên>` |
| **File bàn giao** (`<slug>.handoff.md`) | nếu bạn đồng ý / `-h` | mở chat mới làm tiếp, không phải giải thích lại |

## Ví dụ

```
/prompt-master màn my subscription thêm nút hủy gói, gọi api hủy, hiện dialog confirm
/prompt-master viết mô tả MR cho nhánh hiện tại -q -vi
/prompt-master spec màn gia hạn gói cho team BA -doc
/prompt-master review code module recycle bin rồi đề xuất refactor -s -h
/prompt-master D:\spec\renew.pdf  tóm thành prompt cho agent
```

## Chế độ đầu ra

| Lệnh | Chế độ | Ngôn ngữ |
|---|---|---|
| `/prompt-master <ý tưởng>` | **Prompt cho AI** (mặc định) — câu ra lệnh có cấu trúc, rõ ràng, không mơ hồ | Tiếng Anh |
| `... -vi` | Prompt cho AI | Tiếng Việt |
| `... -doc` | Tài liệu/spec cho người đọc (Mục tiêu, Bối cảnh, Yêu cầu…) | Tiếng Việt |
| `... -doc -en` | Tài liệu/spec | Tiếng Anh |

Prompt cho AI có dạng:
```
You are <role>.
## Task        — 1 câu: làm gì, ra kết quả gì
## Context     — sự kiện AI cần biết
## Steps       — mỗi dòng 1 lệnh
## Rules       — MUST / MUST NOT / If … → stop and ask
## Output      — định dạng chính xác + ví dụ
## Done when   — điều kiện kiểm tra được
## Assumptions — mặc định đã tự chọn
```

## Flag

| Flag | Ý nghĩa |
|---|---|
| `-vi` | Prompt cho AI viết bằng tiếng Việt |
| `-doc` | Viết dạng tài liệu/spec thay vì prompt cho AI (thêm `-en` để viết tiếng Anh) |
| `-q` | Bỏ bước Grill Me — ý tưởng đã rõ; chỗ mơ hồ được điền mặc định và ghi ở mục "Giả định" |
| `-s` | Luôn lưu thành skill, không hỏi |
| `-h` | Luôn tạo file bàn giao, không hỏi |

## Mẹo

- Trả lời "tùy bạn" ở Grill Me → skill chọn mặc định và ghi vào "Giả định" để bạn xem lại.
- Prompt cho task code trong dự án đã kèm sẵn rule phạm vi (cloud_storage + module_bridge,
  không đụng socialfi, chờ "code đi").
