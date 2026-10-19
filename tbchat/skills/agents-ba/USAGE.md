# agents-ba — Hướng dẫn sử dụng

Skill **phân tích nghiệp vụ**: từ 1 yêu cầu ngắn, Claude chia việc phân tích thành nhiều
**lane** chạy song song (subagent nền), hỏi bạn mọi chỗ chưa rõ, và chỉ dừng đúng những lane bị
ảnh hưởng bởi câu hỏi. Kết quả cuối là file spec trong `.claude/document/upgrade/docs/ba/`. Skill **không sửa code**.

## Luồng dùng

```
1. /agents-ba <yêu cầu>          → Claude diễn đạt lại, đọc code liên quan, đưa kế hoạch lane
                            và chạy ngay các lane không phụ thuộc câu hỏi nào
2. Trả lời câu hỏi        → "Q1: a, Q3: b" hoặc "đồng ý hết đề xuất"
                            (trả lời lúc nào cũng được, các lane khác vẫn chạy)
3. Lặp lại bước 2         → câu trả lời có thể sinh câu hỏi mới
4. chốt                   → Claude gộp tất cả thành spec .claude/document/upgrade/docs/ba/<tên>.md
5. /agents-plan           → (tuỳ chọn) chia việc để code theo spec
```

Ví dụ:

```
/agents-ba cho phép chia sẻ thư mục cloud cho bạn bè
/agents-ba thêm nút gia hạn gói khi còn 3 ngày hết hạn  https://figma.com/...
```

## Các lane mặc định

| Lane | Phân tích | Chờ |
|---|---|---|
| L0 | Phạm vi, actor, thuật ngữ | — |
| L1 | Luồng chính + luồng phụ | L0 |
| L2 | Quy tắc nghiệp vụ (quyền, gói, giới hạn) | L0 |
| L3 | Dữ liệu & API (BE VN `_grpc` / HK `native_handle`) | L0 |
| L4 | Trạng thái UI + l10n | L1 |
| L5 | Edge case & lỗi | L1, L2, L3 |
| FINAL | Gộp thành spec | tất cả |

Yêu cầu nhỏ → Claude bỏ qua lane, tự phân tích một mạch.

## Câu hỏi dừng ai?

| Tình huống | Hành vi |
|---|---|
| Lane hỏi câu nằm trên luồng chính của nó | Lane đó **dừng** (⏸), làm xong phần độc lập trước |
| Câu hỏi làm thay đổi luồng của lane khác | Lane kia cũng dừng tại điểm phụ thuộc |
| Câu hỏi chỉ ảnh hưởng nhỏ | Lane chạy tiếp với **giả định** ⚠️, sửa lại khi có đáp án |
| Lane không liên quan | Chạy bình thường |
| Lane đã xong nhưng dùng giả định sai | Nhận đáp án và tự sửa phần liên quan |

Mức câu hỏi: 🔴 chặn (hỏi bằng popup) · 🟡 quan trọng · 🟢 phụ (danh sách đánh số, có đề xuất).

## Bảng trạng thái

Sau mỗi sự kiện Claude hiện bảng ngắn: ▶ đang chạy · ⏸ chờ câu hỏi · ⏳ chờ lane khác · ✅ xong.
Trạng thái đầy đủ được lưu ở scratchpad (`ba-<tên>.md`) để không mất khi hội thoại dài.

## Spec cuối gồm

Mục tiêu & phạm vi · actor · user stories · luồng (mermaid) · quy tắc BR-xx · dữ liệu & API ·
màn hình/trạng thái UI/l10n · edge case · acceptance criteria Given/When/Then · test case ·
quyết định đã chốt · việc còn mở cho BE/design.

## Lưu ý

- Nói "chốt" khi còn câu hỏi mở → Claude liệt kê lại và hỏi có dùng phương án đề xuất không.
- Claude được phép **phản biện** yêu cầu (mâu thuẫn với code hiện có, có cách đơn giản hơn).
- Đụng tới `socialfi` → Claude báo ngoài phạm vi và hỏi bạn.
