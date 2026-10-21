# Dùng ai-stack khi chỉ phụ trách một phần dự án

Dành cho trường hợp repo là của chung, còn bạn chỉ phụ trách một phần, ví dụ `lib/features/orders/` hay một package trong monorepo. Thường có **hai ràng buộc**:

| Ràng buộc | Ví dụ | Xử lý ở |
|---|---|---|
| **Chỉ được sửa một vùng code** | Không được đụng `lib/core/` của team khác | Bước 2, 4, 5 |
| **Không được đụng cấu hình chung** | Không sửa `.claude/`, `CLAUDE.md`, `.gitignore` của team; không commit file cá nhân | Bước 1, 4 |

Mọi thứ dưới đây **chỉ có hiệu lực trên máy bạn**; người khác trong team không thấy gì thay đổi.

Máy chưa cài stack thì làm theo [INSTALL.md](INSTALL.md) trước. Trong tài liệu này:
- `<stack>`: thư mục `stack/`;
- `<repo>`: thư mục gốc của repo (nơi mở Claude Code);
- `lib/features/orders/`: vùng bạn phụ trách. Thay bằng vùng của bạn.

---

## Bước 1: Ẩn file cá nhân khỏi git, làm trước tiên

Dùng **`.git/info/exclude`**. File này hoạt động giống `.gitignore`, nhưng chỉ nằm trên máy bạn và không bao giờ được commit. Thêm vào `<repo>/.git/info/exclude`:

```gitignore
# ai-stack (cá nhân)
.claude/project.yaml
.claude/project.local.yaml
.claude/.stack-lock.json
.claude/agents/ai-*
.claude/skills/ai-*
.claude/settings.local.json
.claude/hooks/scope-guard.mjs
.ai-runs/
```

Làm bước này **trước khi tạo file**, để không lỡ `git add` nhầm.

> `exclude` không có tác dụng với file **đã được track**. Nếu team đã commit một file trùng tên (hiếm gặp, ví dụ `settings.local.json`), đừng sửa file đó; hỏi team trước.

---

## Bước 2: Khai báo dự án và phạm vi

Tạo `<repo>/.claude/project.yaml`:

```yaml
stack: ^0.4
name: orders

context: |
  Repo dùng chung của team. Tôi chỉ phụ trách lib/features/orders/.
  Các phần khác chỉ được đọc để hiểu, không được sửa.

read_first:
  - CLAUDE.md                          # tài liệu chung của repo (chỉ đọc)
  - lib/features/orders/README.md      # tài liệu của vùng bạn phụ trách, nếu có

roles:
  builder:
    body: |
      ## Scope
      Only edit files under lib/features/orders/. If the task needs a change anywhere
      else, do not make it: describe it under `next` so the owner can do it.
    body_mode: append
  architect:
    body: |
      ## Scope
      Plan work units only inside lib/features/orders/. List changes needed elsewhere
      as risks with the owner to ask, not as units.
    body_mode: append

flows:
  review:
    input:
      default: uncommitted changes under lib/features/orders/ only.
```

Ý nghĩa của từng phần:
- **`context`**: mọi agent đều biết phạm vi của bạn.
- **`builder`**: được dặn chỉ sửa trong vùng; thay đổi cần làm ở nơi khác thì ghi vào `next` để báo lại.
- **`architect`**: chỉ chia việc trong vùng; phần cần người khác làm được ghi thành rủi ro.
- **`/ai-review` không truyền tham số**: chỉ soát vùng của bạn, không soát thay đổi của người khác trong working tree.

Không sửa `CLAUDE.md` chung. Ghi chú riêng của bạn để trong `context`, vì `project.yaml` đã được ẩn ở bước 1.

---

## Bước 3: Build và kiểm tra

```bash
node <stack>/kernel/cli/stack.mjs build  --project <repo> --dry-run   # xem trước
node <stack>/kernel/cli/stack.mjs build  --project <repo>
node <stack>/kernel/cli/stack.mjs doctor --project <repo>
git -C <repo> status --short
```

`git status` **không được hiện** file nào của stack. Nếu còn thấy, kiểm tra lại bước 1.

Nếu build báo `unmanaged-file`, nghĩa là team đã có file trùng tên với file stack định tạo. Đặt `prefix` khác trong `project.yaml` (ví dụ `prefix: me-`), cập nhật các dòng `ai-*` ở bước 1 cho khớp, rồi build lại.

---

## Bước 4: Quyền: tự động trong vùng, hỏi ngoài vùng

Tạo `<repo>/.claude/settings.local.json` (dùng file `.local`, **không** sửa `settings.json` chung):

```json
{
  "permissions": {
    "allow": [
      "Edit(lib/features/orders/**)",
      "Write(lib/features/orders/**)",
      "Write(.ai-runs/**)",
      "Bash(node *stack.mjs check *)",
      "Bash(git diff *)",
      "Bash(git status *)",
      "Bash(git log *)"
    ]
  }
}
```

Sửa trong vùng của bạn thì chạy tự động. Sửa ở chỗ khác thì Claude Code dừng lại hỏi, và bạn từ chối được. Đường dẫn trong quyền tính từ thư mục bạn mở Claude Code, nên hãy mở ở `<repo>`.

---

## Bước 5 (nên làm): Chặn cứng bằng hook

Bước 4 vẫn để bạn lỡ tay bấm đồng ý. Hook `scope-guard` **từ chối mọi lần sửa file ngoài vùng**, kể cả của các agent con.

1. Copy hook mẫu:

   ```bash
   mkdir -p <repo>/.claude/hooks
   cp <stack>/templates/hooks/scope-guard.mjs <repo>/.claude/hooks/
   ```

2. Sửa dòng `SCOPE` trong file vừa copy. Giữ `.ai-runs/` để flow lưu được run state:

   ```js
   const SCOPE = ['lib/features/orders/', '.ai-runs/'];
   ```

3. Thêm khối `hooks` vào `settings.local.json` ở bước 4:

   ```json
   {
     "permissions": { "allow": ["…như bước 4…"] },
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Edit|Write|MultiEdit|NotebookEdit",
           "hooks": [{ "type": "command", "command": "node .claude/hooks/scope-guard.mjs" }]
         }
       ]
     }
   }
   ```

Khi bị chặn, agent nhận được thông báo kiểu:

```
Blocked by scope-guard: lib/core/x.dart is outside your scope (lib/features/orders/, .ai-runs/).
Report the needed change instead of making it.
```

Hook đã được thử với: đường dẫn tương đối, đường dẫn tuyệt đối Windows, đường dẫn lách bằng `../`, thư mục có tên gần giống (`orders2/`), và chạy thật trong Claude Code.

> **Giới hạn:** hook chỉ bắt các công cụ sửa file (Edit, Write…). Lệnh shell vẫn có thể ghi file, ví dụ `sed -i` hay `echo >`; `ai-builder` có Bash. Phần này dựa vào chỉ dẫn ở bước 2 và việc bạn duyệt từng lệnh Bash chưa được cho phép trước.

---

## Dùng hằng ngày

| Việc | Lệnh |
|---|---|
| Review thay đổi của bạn | `/ai-review` (mặc định chỉ soát vùng của bạn) |
| Review branch của bạn | `/ai-review main..feat/orders-filter -- lib/features/orders/` |
| Soát toàn bộ vùng của bạn | `/ai-review lib/features/orders` |
| Làm tính năng, sửa lỗi | Như [USAGE.md](USAGE.md), mục C và D. Agent đã biết phạm vi |

**Khi một việc cần sửa ngoài vùng:** builder sẽ không sửa, mà ghi vào `next` trong handoff. Gom các mục đó lại gửi cho người phụ trách vùng kia.

---

## Phần của bạn là một package trong monorepo

Có thể coi package đó như một dự án riêng:

```bash
node <stack>/kernel/cli/stack.mjs build --project packages/orders
cd packages/orders && claude
```

- Ưu: context gọn, đường dẫn trong `project.yaml` và trong quyền tính từ thư mục package.
- Lưu ý: `.git/info/exclude` vẫn nằm ở gốc repo, nên các dòng ở bước 1 phải thêm tiền tố `packages/orders/`. `git diff` vẫn nhìn thấy cả repo, nên vẫn nên đặt `input.default` cho review như ở bước 2.

---

## Gỡ ra

1. Xóa các file đã tạo: `.claude/project.yaml`, `.claude/.stack-lock.json`, `.claude/agents/ai-*`, `.claude/skills/ai-*`, `.claude/hooks/scope-guard.mjs`, `.ai-runs/`.
2. Xóa khối `hooks` và các quyền đã thêm trong `settings.local.json` (hoặc xóa cả file nếu chỉ dùng cho stack).
3. Xóa các dòng đã thêm vào `.git/info/exclude`.

Team không bị ảnh hưởng ở bất kỳ bước nào, vì không có file nào đã được commit.

---

## Checklist

- [ ] Bước 1: thêm các dòng vào `.git/info/exclude`
- [ ] Bước 2: `project.yaml` có `context`, scope cho `builder` và `architect`, `input.default` cho review
- [ ] Bước 3: `build` xong, `doctor` báo `0 error(s)`, `git status` sạch
- [ ] Bước 4: `settings.local.json` với quyền trong vùng
- [ ] Bước 5: hook `scope-guard` với `SCOPE` đúng
- [ ] Thử: yêu cầu sửa một file ngoài vùng, phải bị chặn hoặc bị hỏi
