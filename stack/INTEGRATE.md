# Tích hợp ai-stack vào một dự án có sẵn

Hướng dẫn này dành cho dự án đã có code, và có thể đã có sẵn `.claude/`. Stack được thiết kế để **chỉ thêm vào, không đụng tới những gì đang có**: mọi file nó tạo ra đều mang prefix (`ai-`) và được ghi lại trong lock file.

Máy chưa cài stack thì làm theo [INSTALL.md](INSTALL.md) trước.

Trong tài liệu này, `<stack>` là đường dẫn tới thư mục `stack/`, còn `<dự án>` là thư mục gốc của dự án, tức nơi bạn mở Claude Code.

## Cách nhanh: `/stack`

Đã chạy `stack install` (xem [INSTALL.md](INSTALL.md), bước 3) thì mở Claude Code trong `<dự án>` và gõ:

```
/stack
```

Skill sẽ:
1. Khảo sát repo, chỉ đọc: công nghệ, lệnh test/lint, tài liệu, `.claude/` đang có.
2. Hỏi những gì khảo sát chưa trả lời được: context, file cần đọc trước, **dùng chung hay cá nhân**, **toàn repo hay một phần**, lệnh kiểm tra, guard, pack, bật những gì.
3. Hỏi **công cụ team đang dùng**: tracker, thiết kế UI, kênh chat, nơi để tài liệu, nơi chứa code và CI, theo dõi lỗi. Với từng công cụ, skill kiểm tra (chỉ đọc, không gọi thử) xem đã kết nối MCP chưa:
   - có integration sẵn thì đề xuất bật;
   - đã kết nối mà chưa có integration thì sinh file `.ai/integrations/<id>.yaml` để bạn duyệt: chia tool đọc/ghi, bỏ hẳn tool xóa, chỉ cấp quyền đọc;
   - chưa kết nối thì hướng dẫn cách kết nối, hoặc cho phép sẵn lệnh CLI chỉ đọc (ví dụ `gh issue view`).

   Kết quả được ghi thành đoạn "Tools" trong `context`, để mọi agent biết ticket nằm đâu, thiết kế nằm đâu, và **không bao giờ tự đăng tin lên kênh chat**.
4. Cho bạn xem toàn bộ `project.yaml` và mọi file sẽ tạo hoặc sửa, rồi **chờ bạn duyệt**.
5. Ghi file, `build`, `doctor`, và báo cáo kết quả.

Chọn "cá nhân" hoặc "một phần" thì skill tự làm các bước trong [PARTIAL.md](PARTIAL.md) (`.git/info/exclude`, khóa `scope`).

Ở bước 4, Claude Code sẽ **hỏi quyền** cho từng file ghi vào `.claude/` và `.git/`, vì đây là các thư mục được bảo vệ. Điều này là bình thường; đồng ý để tiếp tục. Khi chạy headless (`claude -p`) thì không có ai để hỏi, nên các lần ghi đó bị từ chối và skill dừng lại, báo những file chưa ghi được.

Gọi lại `/stack` sau này để **cập nhật** cấu hình, **khai lại công cụ** (`/stack tools`), **build lại**, hoặc chỉ **kiểm tra**. Có thể trả lời trước ngay trong lệnh, ví dụ `/stack cá nhân, toàn repo, kiểm tra bằng npm test`.

Các bước dưới đây là cách **làm tay**, cũng là những gì `/stack` làm thay bạn.

## Các bước (làm tay)

### 1. Tạo file khai báo dự án

```bash
cp <stack>/templates/project.yaml <dự án>/.claude/project.yaml
```

### 2. Sửa `project.yaml` cho đúng dự án

Phần quan trọng nhất là `context` và `read_first`, vì agent dựa vào đó để hiểu dự án:

```yaml
stack: ^1
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

### 5. Quyền: build tự lo

Build đã thêm các quyền flow cần (và hook của guard đang bật) vào `<dự án>/.claude/settings.local.json`. Chỉ những mục nó tự tạo mới bị thay đổi hay gỡ đi; mục của bạn giữ nguyên. Muốn dùng `settings.json` cho cả team thì khai `settings: shared`. Xem mục 5 của [INSTALL.md](INSTALL.md).

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
| `settings.json` | Không đụng tới, trừ khi bạn khai `settings: shared` |
| `settings.local.json` | Build thêm quyền flow và hook guard vào đây; chỉ thay đổi hay gỡ những mục chính nó đã thêm (ghi trong lock) |
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
      a11y: { traits: ['+lens-a11y'] }               # thêm (khi đã có trait này)
```

**Bật pack, integration, guard và tri thức dự án:**

```yaml
packs: [flutter]                                     # bộ thêm theo công nghệ (USAGE.md, mục G3)
scope: [lib/features/orders]                         # chỉ được sửa trong vùng này (xem PARTIAL.md)
knowledge: docs/knowledge                            # agent tra cứu; /ai-learn ghi vào
enable:
  policies: [protect-generated, no-secrets]
  integrations: [zentao]                             # đọc ticket Zentao (USAGE.md, mục G2)
policies:
  protect-generated:
    config:
      patterns: ['**/*.g.dart', '**/*.freezed.dart']
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
| `.claude/agents/ai-*`, `.claude/skills/ai-*`, `.claude/hooks/ai-*`, `.claude/.stack-lock.json` | ✔, để cả team dùng chung. Xem lưu ý về `cli` bên dưới |
| `.claude/settings.json` (khi `settings: shared`) | ✔ |
| `.claude/project.local.yaml`, `.claude/settings.local.json` | ✘, chỉ là chỉnh sửa cá nhân |
| Thư mục knowledge | ✔ nếu muốn cả team dùng chung tri thức |
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

1. Đặt `enable: { roles: [], flows: [], policies: [] }` và bỏ `scope` trong `project.yaml`, rồi chạy `build`. Stack sẽ xóa mọi file nó đã tạo và gỡ các mục nó đã thêm vào settings. Nếu có file sinh ra đã bị sửa tay, build dừng lại với lỗi `generated-drift` và không xóa gì; khi đó tự xử lý file đó (giữ phần sửa ở chỗ khác, hoặc chấp nhận bỏ đi bằng `--force`) rồi chạy lại.
2. Xóa `project.yaml`, `.stack-lock.json` và `.ai-runs/`.
