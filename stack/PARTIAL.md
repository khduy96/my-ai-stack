# Dùng ai-stack khi chỉ phụ trách một phần dự án

Dành cho trường hợp repo là của chung, còn bạn chỉ phụ trách một phần, ví dụ `lib/features/orders/` hay một package trong monorepo. Thường có **hai ràng buộc**:

| Ràng buộc | Ví dụ | Xử lý ở |
|---|---|---|
| **Chỉ được sửa một vùng code** | Không được đụng `lib/core/` của team khác | Bước 2 (`scope`) |
| **Không được đụng cấu hình chung** | Không sửa `.claude/settings.json`, `CLAUDE.md`, `.gitignore` của team; không commit file cá nhân | Bước 1 và `settings: local` |

Mọi thứ dưới đây **chỉ có hiệu lực trên máy bạn**; người khác trong team không thấy gì thay đổi.

**Cách nhanh:** gõ `/stack` trong Claude Code, chọn **cá nhân** và **một phần**, khai các đường dẫn. Skill làm thay bạn các bước dưới đây.

Máy chưa cài stack thì làm theo [INSTALL.md](INSTALL.md) trước. Trong tài liệu này:
- `<stack>`: thư mục `stack/`;
- `<repo>`: thư mục gốc của repo (nơi mở Claude Code);
- `lib/features/orders/`: vùng bạn phụ trách. Thay bằng vùng của bạn.

---

## Bước 1: Ẩn file cá nhân khỏi git, làm trước tiên

Dùng **`.git/info/exclude`**. File này hoạt động giống `.gitignore`, nhưng chỉ nằm trên máy bạn và không bao giờ được commit. Thêm vào `<repo>/.git/info/exclude`:

```gitignore
# ai-stack (personal)
.claude/project.yaml
.claude/project.local.yaml
.claude/.stack-lock.json
.claude/agents/ai-*
.claude/skills/ai-*
.claude/hooks/ai-*
.claude/settings.local.json
.ai-runs/
```

Làm bước này **trước khi tạo file**, để không lỡ `git add` nhầm.

> `exclude` không có tác dụng với file **đã được track**. Nếu team đã commit một file trùng tên (hiếm gặp, ví dụ `settings.local.json`), đừng sửa file đó; hỏi team trước.

---

## Bước 2: Khai báo dự án và phạm vi

Tạo `<repo>/.claude/project.yaml`:

```yaml
stack: ^0.5
name: orders

context: |
  Shared repository. I own lib/features/orders/; the rest is read-only for me.

read_first:
  - CLAUDE.md                          # tài liệu chung của repo (chỉ đọc)
  - lib/features/orders/README.md      # tài liệu của vùng bạn phụ trách, nếu có

scope: [lib/features/orders]           # vùng được sửa

roles:
  architect:
    body: |
      ## Scope
      Plan work units only inside lib/features/orders/. List changes needed elsewhere
      as risks, with the owner to ask, not as units.
    body_mode: append
```

Chỉ một dòng `scope:` là build tự làm 3 việc:

| Việc | Kết quả |
|---|---|
| **Dặn mọi agent** | Mục "Project rules" trong prompt: chỉ sửa trong vùng; thay đổi cần làm ở nơi khác thì ghi vào `next` để báo lại |
| **Chặn cứng** | Hook `.claude/hooks/ai-scope.mjs` từ chối mọi lần sửa file ngoài vùng, kể cả của agent con. Thư mục `.ai-runs/` (và thư mục knowledge nếu có) luôn được phép |
| **Review đúng vùng** | `/ai-review` không truyền tham số thì chỉ soát thay đổi trong vùng của bạn |

Hook và các quyền flow cần được build ghi vào **`settings.local.json`** (mặc định `settings: local`), **không** đụng `settings.json` chung. Build chỉ thêm và gỡ những mục nó tự tạo; những gì bạn đã có trong file được giữ nguyên.

Phần `architect` là tùy chọn: dặn architect chỉ chia việc trong vùng. Không sửa `CLAUDE.md` chung; ghi chú riêng của bạn để trong `context`, vì `project.yaml` đã được ẩn ở bước 1.

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

Thử: yêu cầu Claude sửa một file ngoài vùng. Lần sửa phải bị từ chối với thông báo kiểu:

```
Blocked by ai-stack policy "scope": lib/core/x.dart is outside lib/features/orders/, .ai-runs/.
Describe the needed change under next instead of making it.
```

> **Giới hạn:** hook chỉ bắt các công cụ sửa file (Edit, Write…). Lệnh shell vẫn có thể ghi file, ví dụ `sed -i` hay `echo >`; `ai-builder` có Bash. Phần này dựa vào chỉ dẫn trong prompt và việc bạn duyệt từng lệnh Bash chưa được cho phép trước.

---

## Thêm guard khác (tùy chọn)

```yaml
enable:
  policies: [protect-generated, no-secrets]
```

- `protect-generated`: chặn sửa file sinh tự động (`*.g.dart`, `*.freezed.dart`, `generated/`…). Đổi mẫu bằng `policies: { protect-generated: { config: { patterns: [...] } } }`.
- `no-secrets`: chặn ghi key, token, private key, mật khẩu dạng chuỗi dài vào file.

---

## Dùng hằng ngày

| Việc | Lệnh |
|---|---|
| Review thay đổi của bạn | `/ai-review` (mặc định chỉ soát vùng của bạn) |
| Review branch của bạn | `/ai-review main..feat/orders-filter -- lib/features/orders/` |
| Soát toàn bộ vùng của bạn | `/ai-review lib/features/orders` |
| Làm tính năng, sửa lỗi | Như [USAGE.md](USAGE.md), mục C và D. Agent đã biết phạm vi |

**Khi một việc cần sửa ngoài vùng:** agent sẽ không sửa (và hook cũng không cho), mà ghi vào `next` trong handoff. Gom các mục đó lại gửi cho người phụ trách vùng kia.

---

## Phần của bạn là một package trong monorepo

Có thể coi package đó như một dự án riêng:

```bash
node <stack>/kernel/cli/stack.mjs build --project packages/orders
cd packages/orders && claude
```

- Ưu: context gọn, đường dẫn trong `project.yaml` tính từ thư mục package; không cần `scope` nếu bạn sở hữu cả package.
- Lưu ý: `.git/info/exclude` vẫn nằm ở gốc repo, nên các dòng ở bước 1 phải thêm tiền tố `packages/orders/`. `git diff` vẫn nhìn thấy cả repo, nên đặt mặc định cho review:
  ```yaml
  flows:
    review:
      input:
        default: uncommitted changes under packages/orders/ only.
  ```

---

## Gỡ ra

1. Đặt `enable: { roles: [], flows: [] }` và bỏ `scope` trong `project.yaml`, rồi chạy `build`: stack xóa agent, skill, hook đã tạo và gỡ các mục nó đã thêm vào `settings.local.json`.
2. Xóa `.claude/project.yaml`, `.claude/.stack-lock.json` và `.ai-runs/`.
3. Xóa các dòng đã thêm vào `.git/info/exclude`.

Team không bị ảnh hưởng ở bất kỳ bước nào, vì không có file nào đã được commit.

---

## Checklist

- [ ] Bước 1: thêm các dòng vào `.git/info/exclude`
- [ ] Bước 2: `project.yaml` có `context` và `scope`
- [ ] Bước 3: `build` xong, `doctor` báo `0 error(s)`, `git status` sạch
- [ ] Thử: yêu cầu sửa một file ngoài vùng, phải bị chặn
