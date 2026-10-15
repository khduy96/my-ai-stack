---
name: prompt-token-count
description: Đếm số token của một prompt / đoạn văn bản cụ thể (không phải lịch sử sử dụng). Dùng khi người dùng hỏi "prompt này bao nhiêu token", "đếm token của đoạn text/file này", hoặc muốn ước lượng độ dài prompt trước khi gửi cho Claude.
---

# Đếm token cho prompt

Skill này đếm số token của **một đoạn văn bản / prompt** mà người dùng đưa vào
(truyền trực tiếp, từ file, hoặc qua stdin).

- Nếu có biến môi trường `ANTHROPIC_API_KEY` → gọi **Anthropic Token Counting API**
  (`/v1/messages/count_tokens`) để có số **chính xác**.
- Nếu không có key (hoặc dùng `--offline`) → dùng **ước lượng cục bộ** (sai số ~±10-15%).

> Khác với skill `token-usage` (thống kê token Claude Code **đã dùng** trong dự án theo
> thời gian). Skill này chỉ tính cho **một prompt bất kỳ**.

## Cách chạy

```bash
# Truyền prompt trực tiếp
node .claude/skills/prompt-token-count/count-prompt-tokens.mjs --text="Viết một bài thơ về mùa thu"

# Đếm token của một file
node .claude/skills/prompt-token-count/count-prompt-tokens.mjs --file=prompt.txt

# Qua stdin
cat prompt.txt | node .claude/skills/prompt-token-count/count-prompt-tokens.mjs
```

### Tuỳ chọn

| Tuỳ chọn | Ý nghĩa |
|----------|---------|
| `--text=<chuỗi>` | Prompt truyền trực tiếp |
| `--file=<đường dẫn>` | Đọc prompt từ file |
| `--system=<chuỗi>` | Nội dung system prompt (tính gộp vào tổng) |
| `--model=<id>` | Model dùng để đếm (mặc định `claude-opus-4-8`) |
| `--offline` | Bỏ qua API, chỉ ước lượng cục bộ |
| `--json` | Xuất kết quả dạng JSON |

## Hướng dẫn cho trợ lý

1. Xác định nguồn văn bản người dùng muốn đếm (chuỗi, file, hay nội dung trong cuộc trò chuyện).
   - Nếu nội dung dài / có ký tự đặc biệt → ghi ra file tạm rồi dùng `--file=`.
2. Chạy script bằng công cụ Bash.
3. Nếu kết quả là **ước lượng** (không có API key), nói rõ đây là con số ước lượng và
   có thể đặt `ANTHROPIC_API_KEY` để lấy số chính xác.
4. Tóm tắt kết quả bằng tiếng Việt cho gọn.

## Ghi chú

- Token Counting API **miễn phí** và không tính vào hạn mức sử dụng token thường.
- Ước lượng offline dựa trên số ký tự và số từ — chỉ mang tính tham khảo, đặc biệt kém
  chính xác với mã nguồn, JSON, hoặc ngôn ngữ không phải Latinh.
