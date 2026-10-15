---
name: token-usage
description: Đếm số token Claude Code đã dùng cho dự án hiện tại, gộp theo 30 phút/ngày/tuần/tháng/năm (kèm ước tính chi phí). Dùng khi người dùng hỏi "đã dùng bao nhiêu token", "thống kê token theo 30 phút/giờ/ngày/tuần/tháng/năm", hoặc muốn xem chi phí sử dụng của dự án.
---

# Thống kê token đã sử dụng

Skill này đọc các file transcript JSONL của Claude Code cho dự án hiện tại
(`~/.claude/projects/<project-slug>/*.jsonl`), cộng dồn token từ trường `usage`
của từng tin nhắn assistant, rồi gộp theo **30 phút, ngày, tuần, tháng, năm**.

## Cách chạy

Từ thư mục gốc của dự án, chạy script bằng Node:

```bash
node .claude/skills/token-usage/count-tokens.mjs [30m|day|week|month|year|all] [tuỳ chọn]
```

- Không truyền tham số → hiển thị **cả 5 mức** (30 phút, ngày, tuần, tháng, năm) + tổng cộng.
- Truyền `30m` / `day` / `week` / `month` / `year` → chỉ mức đó (`30m` = gộp mỗi 30 phút, bucket dạng `YYYY-MM-DD HH:00` / `HH:30`).
- **Mốc `30m` mặc định chỉ tính trong NGÀY HÔM NAY** (kể cả khi chạy `all` — bảng 30 phút chỉ hiện hôm nay, còn ngày/tuần/tháng/năm vẫn đủ). Muốn xem 30 phút của ngày khác thì dùng `--since/--until`.

### Tuỳ chọn

| Tuỳ chọn | Ý nghĩa |
|----------|---------|
| `--period=30m\|day\|week\|month\|year\|all` | Chọn mức gộp (mặc định `all`) |
| `--cost` | Kèm cột **ước tính chi phí** (USD) theo bảng giá trong script |
| `--since=YYYY-MM-DD` | Chỉ tính từ ngày này trở đi |
| `--until=YYYY-MM-DD` | Chỉ tính đến hết ngày này |
| `--dir=<đường dẫn>` | Thống kê cho một dự án khác (mặc định: thư mục hiện tại) |
| `--json` | Xuất kết quả dạng JSON (để dùng cho tự động hoá) |

### Ví dụ

```bash
# Toàn bộ, kèm chi phí
node .claude/skills/token-usage/count-tokens.mjs --cost

# Chỉ theo tháng
node .claude/skills/token-usage/count-tokens.mjs month

# Theo ngày trong tháng 7/2026
node .claude/skills/token-usage/count-tokens.mjs day --since=2026-07-01 --until=2026-07-31

# Theo mỗi 30 phút, chỉ trong ngày 15/7/2026
node .claude/skills/token-usage/count-tokens.mjs 30m --since=2026-07-15 --until=2026-07-15

# Xuất JSON
node .claude/skills/token-usage/count-tokens.mjs --json
```

## Hướng dẫn cho trợ lý

1. Xác định mức gộp người dùng muốn (30 phút/ngày/tuần/tháng/năm). Nếu không rõ → chạy mặc định (`all`).
2. Nếu người dùng hỏi về chi phí → thêm `--cost`.
3. Chạy script bằng công cụ Bash, sau đó **tóm tắt lại kết quả bằng tiếng Việt** cho gọn.

## Ghi chú về dữ liệu

- Chỉ tính các tin nhắn **assistant** có `usage` với token > 0 (bỏ qua tin `<synthetic>` = 0 token).
- Token gồm 4 loại: `input`, `output`, `cache_creation` (ghi cache), `cache_read` (đọc cache).
  Cột **Tổng** là tổng cả 4 loại.
- Thời gian được gộp theo **giờ địa phương**; tuần dùng chuẩn **ISO week** (`YYYY-Www`, bắt đầu Thứ Hai).
- Chi phí là **ước tính** — bảng giá nằm trong biến `RATES` ở đầu file `count-tokens.mjs`,
  chỉnh lại cho khớp bảng giá thực tế / model của bạn nếu cần.
