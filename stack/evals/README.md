# Eval

`stack eval` chạy flow thật trên các repo mẫu nhỏ rồi chấm điểm kết quả, để biết một thay đổi prompt, module hay kernel làm agent **tốt lên hay kém đi**.

```bash
cd <stack>/kernel/cli
node stack.mjs eval --dry-run          # chỉ dựng repo và build, không gọi Claude, không tốn tiền
node stack.mjs eval                    # chạy mọi tình huống (mặc định model sonnet)
node stack.mjs eval review-planted     # chỉ một tình huống
node stack.mjs eval --model opus       # model khác
node stack.mjs eval --keep             # giữ lại repo tạm để xem
node stack.mjs eval --baseline         # lưu lần chạy này làm mốc so sánh
```

> Mỗi tình huống gọi `claude -p` với `--permission-mode bypassPermissions` trong một **repo tạm, dùng một lần**, và **tốn chi phí model** (xem dòng `cost` trong kết quả). Chỉ chạy khi cần: trước khi phát hành một bản, sau khi sửa prompt của role hay trait, hoặc sau khi đổi kernel.

Kết quả được lưu ở `evals/results/<thời điểm>.json`, kèm transcript `*.jsonl` của từng tình huống; thư mục này không vào git. Nếu có `evals/baseline.json`, mỗi lần chạy sẽ so với mốc:

| Dòng | Nghĩa |
|---|---|
| `REGRESSED <id>: …` | Trước đây pass, giờ fail, kèm các kiểm tra hỏng |
| `fixed <id>` | Trước đây fail, giờ pass |
| `changed <id>: a -> b` | Số kiểm tra pass thay đổi |

Model không tất định: một lần fail chưa chắc là hồi quy. Chạy lại tình huống đó trước khi kết luận.

## Tình huống có sẵn

| Id | Kiểm tra |
|---|---|
| `review-planted` | `/ai-review` tìm ra đủ 4 lỗi cài sẵn: off-by-one, command injection, mutate input, tiền ra số lẻ |
| `review-preexisting` | Lỗi có từ trước (injection ở `audit`) **không bị** báo critical hoặc major khi review một thay đổi khác |
| `bugfix-total` | `/ai-bugfix` sửa đúng lỗi bằng thay đổi nhỏ (≤ 4 dòng, chỉ `src/cart.js`), không đụng `audit`/`applyDiscount`; `check.mjs` xác nhận `total()` đúng |

## Viết tình huống mới

```
evals/<id>/
├── case.yaml
├── base/        # file được commit trước
├── change/      # (tùy chọn) đè lên base: để chưa commit (mặc định) hoặc commit (change: commit)
└── check.mjs    # (tùy chọn) script kiểm tra, nằm NGOÀI repo nên agent không thấy
```

```yaml
description: Một câu: tình huống này chứng minh điều gì
flow: review                       # review | feature | bugfix | explain | learn | …
input: ''                          # tham số của lệnh /ai-<flow>
change: uncommitted                # uncommitted | commit
project: |                         # các dòng của .claude/project.yaml (stack: được thêm tự động)
  context: |
    …
expect:
  status: done                     # trạng thái cuối trong run.yaml
  findings_from:                   # handoff dùng làm "finding cuối": glob đầu tiên khớp được sẽ thắng
    - confirm.handoff.yaml
    - 'review/*.handoff.yaml'
  findings:                        # phải tìm ra (mỗi mục khớp ít nhất một finding)
    - id: off-by-one in total
      file: src/cart.js            # phải xuất hiện trong title/detail/evidence
      line: 6                      # (tùy chọn) evidence trích dòng này của file (±1), không phụ thuộc ngôn ngữ
      match: 'first|i = 1|off.by.one'   # regex, không phân biệt hoa thường
      severity: [critical, major]  # các mức chấp nhận
  forbid:                          # không finding nào được khớp
    - id: pre-existing as major
      match: 'audit|inject'
      severity: [critical, major]
  diff:                            # cho flow có sửa code; chỉ tính dòng thêm/bớt
    files: [src/cart.js]           # chỉ được sửa các file này
    max_lines: 4
    contains: ['…']
    not_contains: [execSync]
  script: check.mjs                # chạy: node check.mjs <repo>; exit 0 = pass
  mcp_calls: 0                     # số lần gọi tool MCP tối đa
```

Nguyên tắc:
- Mỗi tình huống chứng minh **một hành vi**, tốt nhất là một hành vi từng hỏng.
- Kỳ vọng phải đủ rộng để không fail vì cách diễn đạt, nhưng đủ hẹp để bắt được hồi quy thật. Agent có thể viết bằng ngôn ngữ của người dùng, nên ưu tiên `file` + `line` hơn là regex trên chữ; nếu dùng regex thì kèm từ tiếng Việt.
- Giữ repo mẫu nhỏ, để chạy nhanh và rẻ.
