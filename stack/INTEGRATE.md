# Tích hợp ai-stack vào một dự án có sẵn

Hướng dẫn này dành cho dự án đã có code, và có thể đã có sẵn `.claude/`. Stack được thiết kế để **chỉ thêm vào, không đụng tới những gì đang có**: mọi file nó tạo ra đều mang prefix (`ai-`) và được ghi lại trong lock file.

Máy chưa cài stack thì làm theo [INSTALL.md](INSTALL.md) trước.

Trong tài liệu này, `<stack>` là đường dẫn tới thư mục `stack/`, còn `<dự án>` là thư mục gốc của dự án, tức nơi bạn mở Claude Code.

## Các bước

### 1. Tạo file khai báo dự án

```bash
cp <stack>/templates/project.yaml <dự án>/.claude/project.yaml
```

### 2. Sửa `project.yaml` cho đúng dự án

Phần quan trọng nhất là `context` và `read_first`, vì agent dựa vào đó để hiểu dự án:

```yaml
stack: ^0.3
name: kho
context: |
  App Flutter quản lý kho + đơn hàng (Android/iOS), backend Back4App (Parse),
  local-first sync. Code chính ở lib/, chia theo feature.
read_first:
  - CLAUDE.md
  - docs/architecture.md
```

- `context`: vài câu về dự án là gì, dùng công nghệ gì, code chính nằm ở đâu.
- `read_first`: các file agent phải đọc trước khi làm việc. Tài liệu đã có sẵn trong dự án thì **đưa đường dẫn vào đây, không chép lại** nội dung vào `context`.

### 3. Xem trước, chưa ghi gì

```bash
node <stack>/kernel/cli/stack.mjs build --project <dự án> --dry-run
```

Kiểm tra danh sách file sẽ được tạo. Nếu báo `unmanaged-file`, nghĩa là dự án đã có file trùng tên. Khi đó đổi `prefix` trong `project.yaml` hoặc đổi tên file cũ. **Không dùng `--force`** nếu chưa xem file đó là gì, vì nó sẽ ghi đè file đang có.

### 4. Build thật, rồi kiểm tra

```bash
node <stack>/kernel/cli/stack.mjs build  --project <dự án>
node <stack>/kernel/cli/stack.mjs doctor --project <dự án>
```

`doctor` phải báo `0 error(s)`.

### 5. Cho phép trước các quyền cần thiết

Thêm vào `<dự án>/.claude/settings.json`; xem mục 5 của [INSTALL.md](INSTALL.md):

```json
{
  "permissions": {
    "allow": [
      "Bash(node *stack.mjs check *)",
      "Bash(git diff *)",
      "Bash(git status *)",
      "Bash(git log *)",
      "Write(.ai-runs/**)"
    ]
  }
}
```

### 6. Thêm `.ai-runs/` vào `.gitignore` của dự án

```gitignore
.ai-runs/
```

Orchestrator vẫn tự tạo `.gitignore` bên trong `.ai-runs/`, nhưng khai rõ ở gốc dự án thì an toàn hơn.

### 7. Chạy thử

Mở Claude Code trong `<dự án>`, tạo một thay đổi nhỏ rồi gõ:

```
/ai-review
```

## Chung sống với `.claude/` đã có sẵn

| Thứ đang có | Stack xử lý thế nào |
|---|---|
| Agent hoặc skill tự viết | Không đụng tới. File của stack có prefix `ai-` và được ghi trong `.claude/.stack-lock.json` |
| `CLAUDE.md` | Không đụng tới. Agent đọc nó qua `read_first` |
| `settings.json` | Không đụng tới. Bạn tự thêm quyền (bước 5) |
| File trùng tên với file stack định tạo | Build dừng lại với lỗi `unmanaged-file`, không ghi gì |

## Điều chỉnh cho riêng dự án

Mọi điều chỉnh nằm trong `project.yaml`, **không sửa trực tiếp file sinh ra** (build sẽ báo `generated-drift`).

**Chỉ bật một phần:**

```yaml
enable:
  roles: [verifier]        # chỉ build verifier và các variant của nó
  flows: [review]
```

**Thêm chỉ dẫn riêng cho một role:**

```yaml
roles:
  verifier:
    body: Run `flutter analyze` and `flutter test` as your checks.
    body_mode: append
  builder:
    model: sonnet
```

**Bỏ hoặc thêm variant:**

```yaml
roles:
  verifier:
    variants:
      conventions: null                              # bỏ
      perf: { traits: ['+lens-performance'] }        # thêm (khi đã có trait này)
```

**Đổi cổng duyệt của một bước trong flow:**

```yaml
flows:
  review:
    steps:
      confirm: { gate: human }
```

**Chỉnh riêng cho máy của bạn** thì dùng `<dự án>/.claude/project.local.yaml` (cùng định dạng, không commit).

Sửa `project.yaml` xong thì chạy lại `build`.

## Commit những gì

| File | Commit? |
|---|---|
| `.claude/project.yaml` | ✔ |
| `.claude/agents/ai-*`, `.claude/skills/ai-*`, `.claude/.stack-lock.json` | ✔, để cả team dùng chung. Xem lưu ý về `cli` bên dưới |
| `.claude/project.local.yaml` | ✘, chỉ là chỉnh sửa cá nhân |
| `.ai-runs/` | ✘ |

**Lưu ý khi dùng chung trong team:** skill sinh ra chứa đường dẫn tuyệt đối tới CLI của máy đã build nó. Để mọi máy build ra cùng một kết quả, đặt khóa `cli` trong `project.yaml` thành một lệnh chạy được trên mọi máy. Ví dụ, nếu stack nằm trong repo của dự án:

```yaml
cli: node .claude/stack/kernel/cli/stack.mjs
```

## Workspace chứa nhiều app

Claude Code đọc `.claude/` ở thư mục bạn mở. Với workspace chứa nhiều app (ví dụ `workspace/app-a/`, `workspace/app-b/`), có hai cách:

| Cách | Ưu | Nhược |
|---|---|---|
| **Build vào gốc workspace** (`workspace/.claude/`) | Một bộ agent dùng chung cho mọi app; mở workspace là có | `context` phải mô tả tất cả các app nên kém chính xác hơn |
| **Build riêng từng app** (`app-a/.claude/`, `app-b/.claude/`) | Context đúng cho từng app; mỗi app chỉnh riêng được | Chỉ có hiệu lực khi mở Claude Code trong thư mục app đó |

Chọn cách thứ hai khi các app khác nhau nhiều (công nghệ, quy ước). Chọn cách thứ nhất khi chúng giống nhau và bạn thường mở cả workspace.

## Gỡ ra

1. Đặt `enable: { roles: [], flows: [] }` trong `project.yaml`, rồi chạy `build`. Stack sẽ xóa mọi file nó đã tạo. Nếu có file sinh ra đã bị sửa tay, build dừng lại với lỗi `generated-drift` và không xóa gì; khi đó tự xử lý file đó (giữ phần sửa ở chỗ khác, hoặc chấp nhận bỏ đi bằng `--force`) rồi chạy lại.
2. Xóa `project.yaml`, `.stack-lock.json` và `.ai-runs/`.
