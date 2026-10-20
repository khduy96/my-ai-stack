# Hướng dẫn sử dụng theo tình huống

Áp dụng cho stack 0.3. Dự án phải đã được tích hợp (xem [INTEGRATE.md](INTEGRATE.md)).

Hiện có:
- **1 flow chạy tự động:** `/ai-review`.
- **9 agent gọi riêng lẻ:** `ai-analyst`, `ai-architect`, `ai-builder`, `ai-investigator`, `ai-verifier` và 4 `ai-verifier-*`.

Flow `feature` và `bugfix` chưa có; các mục C và D bên dưới hướng dẫn tự ghép các agent lại để làm thay.

## Tra nhanh

| Tôi muốn… | Dùng | Mục |
|---|---|---|
| Review thay đổi trước khi commit | `/ai-review` | A1 |
| Review một branch trước khi merge | `/ai-review main..<branch>` | A2 |
| Review một PR | `/ai-review <số PR>` | A3 |
| Soát một thư mục hoặc file đang có | `/ai-review <đường dẫn>` | A4 |
| Chỉ soát bảo mật, hoặc chỉ một góc nhìn | `ai-verifier-<lens>` | B1 |
| Kiểm chứng lại kết luận của người khác hoặc AI khác | `ai-verifier-adversarial` | B2 |
| Làm rõ một yêu cầu còn mơ hồ | `ai-analyst` | C1 |
| Chọn cách làm, chia việc | `ai-architect` | C2 |
| Làm một tính năng từ đầu đến cuối | analyst → architect → builder → `/ai-review` | C3 |
| Tìm nguyên nhân lỗi | `ai-investigator` | D1 |
| Sửa lỗi có kiểm chứng | investigator → builder → verifier | D2 |
| Chạy tiếp một lần review bị dừng | `/ai-review --resume …` | E1 |
| Chạy review không cần người (script, CI) | `claude -p "/ai-review …"` | E3 |

## Cách gọi chung

- **Gọi flow:** gõ lệnh, ví dụ `/ai-review`. Phiên chính sẽ tự điều phối các agent.
- **Gọi một agent:** nói rõ tên agent trong câu, ví dụ *"Dùng agent `ai-investigator` để…"*. Bạn có thể viết bằng tiếng Việt.
- **Kết quả:** mỗi agent kết thúc bằng một khối `handoff` (YAML), gồm trạng thái, kết quả, phát hiện và câu hỏi. Phiên chính tóm tắt lại cho bạn.
- **Dữ liệu chuyền giữa các bước:** khi tự ghép nhiều agent, bảo phiên chính **lưu handoff ra file** và đưa đường dẫn file đó cho agent tiếp theo. Cách này đỡ tốn context và xem lại được.

---

## A. Review bằng `/ai-review`

Mỗi lần chạy gồm 3 verifier song song (correctness, security, conventions), sau đó `ai-verifier-adversarial` cố bác bỏ từng phát hiện. Báo cáo cuối chỉ giữ những gì sống sót, xếp theo mức độ. Toàn bộ dữ liệu của lần chạy nằm trong `.ai-runs/<thời gian>-review-<slug>/`.

Chi phí: mỗi lần chạy dùng 4–5 agent. Nên dành cho thay đổi đáng kể, không cần chạy cho từng dòng sửa.

### A1. Review thay đổi chưa commit

```
/ai-review
```

Không truyền gì nghĩa là review mọi thay đổi chưa commit: đã stage, chưa stage, và file mới.

### A2. Review một branch trước khi merge

```
/ai-review main..feat/order-filter
```

Hoặc diễn đạt bằng lời: `/ai-review các commit của branch feat/order-filter so với main`.

### A3. Review một PR

```
/ai-review 123
```

Cần cài và đăng nhập `gh` (GitHub CLI).

### A4. Soát code đang có (không phải diff)

```
/ai-review lib/features/orders
```

Dùng khi tiếp nhận một module lạ, hoặc trước khi refactor muốn biết chỗ nào đang có vấn đề.

### A5. Đọc kết quả

- Báo cáo hiện ngay trong phiên chat.
- Chi tiết từng agent nằm ở `.ai-runs/<run>/review/*.handoff.yaml`; kết quả sau khi lọc ở `confirm.handoff.yaml`.
- Muốn sửa luôn thì nói tiếp trong cùng phiên, ví dụ: *"Dùng `ai-builder` sửa 2 finding critical trong báo cáo vừa rồi"* (xem D2).

---

## B. Review có trọng tâm

### B1. Chỉ một góc nhìn

Khi chỉ quan tâm một khía cạnh thì gọi thẳng variant tương ứng. Cách này rẻ và nhanh hơn chạy cả flow.

```
Dùng agent ai-verifier-security review thư mục lib/core/data/, tập trung vào
chỗ lưu token và gọi API.
```

| Variant | Soát gì |
|---|---|
| `ai-verifier-correctness` | Logic, edge case, xử lý lỗi, state/concurrency |
| `ai-verifier-security` | Secret, injection, phân quyền, input không tin cậy, lộ dữ liệu |
| `ai-verifier-conventions` | Có đúng quy ước của dự án không (cấu trúc, đặt tên, tái sử dụng) |
| `ai-verifier` | Review chung, không có trọng tâm |

### B2. Kiểm chứng lại một kết luận

Dùng khi có một danh sách lỗi từ công cụ khác, từ người khác, hoặc khi một agent báo "đã xong" mà bạn còn nghi ngờ.

```
Dùng agent ai-verifier-adversarial kiểm chứng các nhận định sau, cái nào sai
thì chỉ ra bằng chứng:
1. OrderRepository không invalidate cache sau khi tạo đơn
2. SyncService có thể chạy 2 lần song song khi mạng chập chờn
```

Kết quả: nhận định nào đứng vững thì thành finding; nhận định bị bác thì được ghi là `Rejected: …` kèm bằng chứng.

---

## C. Làm tính năng (ghép tay, khi chưa có flow `feature`)

### C1. Làm rõ yêu cầu với `ai-analyst`

```
Dùng agent ai-analyst viết spec cho yêu cầu: "thêm lọc đơn hàng theo trạng
thái và khoảng ngày ở màn danh sách đơn". Lưu handoff vào .ai-runs/manual/spec.yaml.
```

Bạn nhận lại một **spec** gồm mục tiêu, tiêu chí hoàn thành, phần ngoài phạm vi, giả định và câu hỏi mở. Analyst không thiết kế và không sửa code. Nếu có câu hỏi mở thì trả lời rồi bảo nó cập nhật spec.

### C2. Thiết kế và chia việc với `ai-architect`

```
Dùng agent ai-architect lập plan từ spec ở .ai-runs/manual/spec.yaml.
Lưu handoff vào .ai-runs/manual/plan.yaml.
```

Bạn nhận lại một **plan** gồm 2–3 phương án kèm đánh đổi, phương án được chọn, và các đơn vị việc (unit). Mỗi unit có danh sách file sở hữu, thứ tự phụ thuộc và tiêu chí xong. **Đọc kỹ plan trước khi cho làm tiếp.**

### C3. Hiện thực từng unit với `ai-builder`, rồi review

```
Dùng agent ai-builder làm unit "filter-state" trong .ai-runs/manual/plan.yaml.
Chỉ sửa các file của unit đó.
```

- Làm lần lượt từng unit theo `depends_on`. Các unit không phụ thuộc nhau và không chung file thì có thể bảo chạy song song.
- Builder sẽ chạy các lệnh kiểm tra của dự án và báo kết quả trong `checks`.
- Xong hết các unit thì chạy `/ai-review` (A1).

Kiểm chứng spec, plan bằng CLI nếu muốn:

```bash
node <stack>/kernel/cli/stack.mjs check .ai-runs/manual/plan.yaml --produces plan
```

---

## D. Xử lý lỗi (ghép tay, khi chưa có flow `bugfix`)

### D1. Tìm nguyên nhân với `ai-investigator`

Mô tả triệu chứng càng cụ thể càng tốt: thấy gì, mong đợi gì, ở đâu, từ khi nào.

```
Dùng agent ai-investigator tìm nguyên nhân: sau khi huỷ một đơn hàng, số tồn
kho của sản phẩm không được cộng lại, nhưng thoát app vào lại thì đúng.
```

Bạn nhận lại một **diagnosis**:
- tất cả giả thuyết đã xét, mỗi cái là xác nhận, đã loại, hay còn mở;
- nguyên nhân gốc kèm chuỗi `path:line`;
- đề xuất sửa nhỏ nhất và rủi ro của nó.

Investigator **không sửa code**. Nếu nó báo `partial` thì chưa chắc chắn; đọc các giả thuyết còn mở và cung cấp thêm thông tin.

### D2. Sửa và kiểm chứng

```
Dùng agent ai-builder áp dụng đề xuất sửa trong diagnosis vừa rồi.
Sau đó dùng ai-verifier-correctness kiểm tra lại thay đổi.
```

Nếu verifier còn báo lỗi `critical` hoặc `major`, lặp lại builder → verifier. Thường 1–2 vòng là đủ.

---

## E. Vận hành

### E1. Chạy tiếp một lần review bị dừng

```
/ai-review --resume .ai-runs/20261019-1745-review-uncommitted-changes
```

Orchestrator đọc `run.yaml` và chạy tiếp từ bước chưa xong.

### E2. Đổi hành vi của flow cho dự án

Mọi thay đổi nằm trong `.claude/project.yaml`, sau đó chạy lại `build`. Xem chi tiết trong [INTEGRATE.md](INTEGRATE.md#điều-chỉnh-cho-riêng-dự-án). Ví dụ muốn duyệt kết quả review trước khi bước adversarial chạy:

```yaml
flows:
  review:
    steps:
      confirm: { gate: human }
```

### E3. Chạy không cần người (script, CI, trước khi push)

```bash
claude -p "/ai-review main..HEAD" --allowedTools "Agent" "Read" "Grep" "Glob" "Write" "Bash(git *)" "Bash(node *)"
```

Trên Windows mà chạy từ Git Bash thì thêm `MSYS_NO_PATHCONV=1` ở đầu lệnh.

### E4. Dọn run cũ

`.ai-runs/` không vào git và có thể xóa bất cứ lúc nào. Chỉ giữ lại những run bạn còn muốn đối chiếu.

---

## Mẹo

- **Context tốt thì kết quả tốt.** Agent đọc `context` và các file trong `read_first` của `project.yaml`. Review hay báo sai quy ước thì kiểm tra lại hai chỗ đó trước.
- **Dùng đúng agent.** Analyst và architect không sửa code; investigator và verifier chỉ đọc và chạy lệnh kiểm tra. Muốn sửa code thì luôn đi qua `ai-builder`.
- **Phạm vi nhỏ, rõ ràng.** Builder chỉ sửa file trong phạm vi được giao; phạm vi mơ hồ thì nó sẽ dừng lại hỏi (`blocked`). Đó là cách nó được thiết kế, không phải lỗi.
- **Không tin "done" một cách mù quáng.** Với thay đổi quan trọng, luôn kết thúc bằng `/ai-review` hoặc ít nhất một verifier.
