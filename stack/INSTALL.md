# Cài đặt ai-stack trên máy mới

Làm theo 5 bước. Bước 4 (build lại từng dự án) là bước dễ quên nhất.

## 1. Cài phần mềm

| Phần mềm | Bắt buộc? | Dùng để |
|---|---|---|
| **Node.js ≥ 18.3** (đi kèm npm) | ✔ | Chạy CLI `stack`. Đã test trên Node 24 |
| **Claude Code**, đã đăng nhập | ✔ | Dùng các agent `ai-*` và skill `/ai-review` sinh ra |
| **Git** | ✔ cho flow review | Verifier dùng `git diff` / `git status` để biết thay đổi cần review |
| GitHub CLI `gh` | Tùy chọn | Chỉ cần khi review một PR theo số (`/ai-review 123`) |

Kiểm tra:

```bash
node --version      # >= 18.3
git --version
claude --version
```

## 2. Đưa stack sang máy mới

Clone repo `.claude/`, hoặc copy riêng thư mục `stack/`. Stack đặt ở đâu cũng được, vì CLI tự tính đường dẫn từ vị trí của chính nó.

Trong tài liệu này, `<stack>` là đường dẫn tới thư mục `stack/`, còn `<dự án>` là thư mục gốc của dự án muốn dùng.

## 3. Cài thư viện cho CLI (một lần)

```bash
cd <stack>/kernel/cli
npm ci
```

Lệnh này chỉ cài 2 thư viện là `yaml` và `ajv`, theo đúng phiên bản trong `package-lock.json`, nên cần có mạng.

Kiểm tra:

```bash
npm test                  # tất cả test phải pass
node stack.mjs doctor     # phải là 0 error(s)
```

Cài skill `/stack` cho mọi dự án trên máy này (ghi vào `~/.claude/skills/stack/`):

```bash
node stack.mjs install
```

Từ giờ, trong Claude Code ở bất kỳ dự án nào, gõ `/stack` để được hỏi đáp và thiết lập stack cho dự án đó (xem [INTEGRATE.md](INTEGRATE.md)). Skill chứa đường dẫn tới stack trên máy này, nên **chạy lại `install` mỗi khi chuyển stack sang chỗ khác hoặc cập nhật stack**. Lệnh này không ghi đè skill `stack` nào mà nó không tự cài.

## 4. Build lại từng dự án

```bash
node <stack>/kernel/cli/stack.mjs build --project <dự án>
```

Bước này **bắt buộc**. Skill sinh ra chứa **đường dẫn tuyệt đối** tới CLI của máy đã build nó, ví dụ `node "D:/Felix/AppDemo/.claude/stack/kernel/cli/stack.mjs"`. Sang máy mới, đường dẫn đó không còn đúng.

- **Dự án đã có file sinh ra từ máy cũ** (đã commit): chỉ cần build lại. Lock file `.claude/.stack-lock.json` nhận ra đó là file do stack tạo và tự cập nhật đường dẫn.
- **Dự án chưa dùng stack:** gõ `/stack` trong Claude Code, hoặc làm tay:
  1. Copy `<stack>/templates/project.yaml` vào `<dự án>/.claude/project.yaml`.
  2. Sửa phần `context` (vài câu mô tả dự án) và `read_first` (các file agent cần đọc trước).
  3. Chạy lệnh build ở trên.

Muốn xem trước mà không ghi gì thì thêm `--dry-run`. Muốn kiểm tra cấu hình dự án thì chạy:

```bash
node <stack>/kernel/cli/stack.mjs doctor --project <dự án>
```

## 5. Cho phép trước một số quyền (nên làm)

Khi chạy `/ai-review`, Claude Code sẽ hỏi quyền cho mỗi lệnh chưa được cho phép trước. Để đỡ bị hỏi liên tục, thêm vào `<dự án>/.claude/settings.json`:

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

Nếu file đã có sẵn khối `permissions.allow` thì chỉ thêm các dòng còn thiếu.

## Dùng thử

Mở Claude Code trong `<dự án>` rồi gõ:

```
/ai-review
```

Không truyền gì thì skill review toàn bộ thay đổi chưa commit. Có thể truyền một branch, một khoảng commit, số PR hoặc một đường dẫn. Mỗi lần chạy, trạng thái được lưu trong `<dự án>/.ai-runs/`; thư mục này tự được gitignore.

## Lưu ý riêng cho Windows

Nếu gọi headless bằng `claude -p "/ai-review"` từ **Git Bash**, đặt `MSYS_NO_PATHCONV=1` trước lệnh:

```bash
MSYS_NO_PATHCONV=1 claude -p "/ai-review"
```

Không có biến này, Git Bash sẽ đổi `/ai-review` thành đường dẫn Windows và skill không được gọi. Gõ `/ai-review` trực tiếp trong Claude Code thì không bị ảnh hưởng.

## Gặp lỗi

| Thông báo | Cách xử lý |
|---|---|
| `Cannot find package 'yaml'` / `'ajv'` | Chưa chạy bước 3 (`npm ci`) |
| `project.yaml not found` | Chưa tạo `<dự án>/.claude/project.yaml` (bước 4) |
| `incompatible-version` | `stack:` trong project.yaml không khớp phiên bản stack; sửa theo `version` trong `<stack>/stack.yaml` |
| `unmanaged-file` | Dự án đã có file trùng tên với file stack định sinh ra. Đổi tên file đó, hoặc thêm `--force` để ghi đè |
| `generated-drift` | File sinh ra đã bị sửa tay. Chuyển phần sửa vào `project.yaml`, hoặc thêm `--force` để ghi đè |
| `/ai-review` báo không chạy được `stack.mjs check` | Chưa build lại trên máy này (bước 4), nên skill vẫn trỏ tới đường dẫn của máy cũ |
