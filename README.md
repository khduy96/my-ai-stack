# my-ai-stack

**ai-stack** là bộ agent, skill, rule… cho Claude Code, viết một lần và dùng chung cho nhiều dự án. Mỗi dự án chỉ cần khai báo vài dòng, stack sẽ build ra đúng cấu hình Claude Code cho dự án đó.

Mã nguồn và tài liệu chi tiết nằm trong [stack/](stack/).

## Cách hoạt động

```
  stack/  (đặt ở đâu trên máy cũng được)         <dự án>/
  ├── modules/  role, trait, flow, policy  ─┐     ├── .claude/project.yaml   bạn khai báo
  └── packs/    gói theo công nghệ          ├──►  └── .claude/
                                            │         ├── agents/ai-*.md     build sinh ra
               stack build ─────────────────┘         ├── skills/ai-*/
                                                      └── settings.local.json (quyền cần thiết)
```

- **Stack** chứa toàn bộ module dùng chung: *role* (ai làm), *trait* (làm theo phong cách nào), *flow* (nhiều agent phối hợp ra sao), *policy* (được làm gì), *integration* (hệ thống ngoài qua MCP), và *pack* theo công nghệ (ví dụ `flutter`).
- **Dự án** chỉ có một file `.claude/project.yaml`: dự án là gì, file nào cần đọc trước, bật những gì.
- **`stack build`** ghép hai phần trên thành agent, skill và quyền trong `.claude/` của dự án. Mọi thứ build tạo ra đều có prefix `ai-` và được ghi vào lock file, nên không đụng tới agent, skill có sẵn của dự án.

## Bắt đầu

Cần **Node.js ≥ 18.3**, **Git** và **Claude Code** đã đăng nhập.

**1. Đưa stack lên máy** (một lần mỗi máy). Clone repo hoặc copy thư mục `stack/` vào bất kỳ đâu. CLI tự tính đường dẫn từ vị trí của chính nó.

```bash
git clone https://github.com/khduy96/my-ai-stack.git
```

**2. Cài CLI và skill `/stack`** (một lần mỗi máy, và chạy lại mỗi khi chuyển chỗ hoặc cập nhật stack):

```bash
cd my-ai-stack/stack/kernel/cli
npm ci
node stack.mjs install    # ghi skill /stack vào ~/.claude/skills/stack/
```

**3. Gắn stack vào từng dự án.** Mở Claude Code trong thư mục dự án và gõ:

```
/stack
```

Skill khảo sát repo, hỏi những gì chưa rõ (dùng chung hay cá nhân, toàn repo hay một phần, lệnh test, công cụ team dùng…), cho bạn xem trước `project.yaml` cùng các file sẽ tạo, chờ bạn duyệt rồi mới build.

Muốn làm tay thì xem [stack/INTEGRATE.md](stack/INTEGRATE.md#các-bước-làm-tay).

## Dùng hằng ngày

Sau khi build, dự án có các lệnh sau trong Claude Code:

| Lệnh | Dùng khi |
|---|---|
| `/ai-review [target]` | Review thay đổi chưa commit, một branch, một PR hoặc một thư mục |
| `/ai-feature <yêu cầu>` | Làm tính năng từ đầu đến cuối: spec → plan (bạn duyệt) → code → review |
| `/ai-bugfix <triệu chứng>` | Tìm nguyên nhân, sửa và kiểm chứng một lỗi |
| `/ai-fix <run> [F2 F3]` | Sửa nốt vài finding còn mở sau một run, không mở run `feature` mới |
| `/ai-explain <câu hỏi>` | Hiểu một đoạn code hoạt động thế nào |
| `/ai-memory-init [mô tả dự án mới]` | Tạo memory bank: dự án mới (từ mô tả) hoặc dự án có sẵn (khảo sát repo và git) |
| `/ai-memory-update [run \| ghi chú]` | Cập nhật memory bank sau một thay đổi đáng kể |
| `/ai-map-init [module \| mô tả dự án mới]` | Tạo project map + repo map cho dự án mới hoặc dự án có sẵn |
| `/ai-map-update [module \| run]` | Map thêm một module, hoặc làm mới map sau khi code đổi |
| `/ai-learn <run \| ghi chú>` | Ghi tri thức dự án để các lần sau dùng lại |
| `/ai-knowledge-audit [vùng]` | Rà tri thức dự án với code hiện tại, sửa phần sai hoặc lỗi thời |

Cũng có thể gọi riêng từng agent, ví dụ *"Dùng agent `ai-investigator` để tìm nguyên nhân…"*. Danh sách đầy đủ theo tình huống: [stack/USAGE.md](stack/USAGE.md).

## Đo trên dự án thật

Cuối mỗi báo cáo, flow hỏi một dòng `useful` / `partial` / `not-useful` (kèm finding nào sai nếu có) và ghi vào `<run>/feedback.yaml`. Muốn xem tổng hợp trên nhiều dự án:

```bash
node <stack>/kernel/cli/stack.mjs stats <dự án A> <dự án B> [--since 2026-11-01] [--json]
```

Lệnh chỉ đọc và cho biết: flow nào được dùng, run nào đang treo (kèm lý do và lệnh `--resume`), finding trước và sau bước adversarial, code agent viết có được commit không, token của từng loại agent, và feedback của bạn. Chi tiết: [stack/USAGE.md](stack/USAGE.md#e6-đo-stack-trên-dự-án-thật-với-stack-stats).

## Cập nhật

- **Đổi cấu hình dự án:** gọi lại `/stack`, hoặc sửa `project.yaml` rồi chạy `build`.
- **Cập nhật stack:** `git pull`, chạy lại `node stack.mjs install`, rồi build lại từng dự án đang dùng:

```bash
node <stack>/kernel/cli/stack.mjs build  --project <dự án>
node <stack>/kernel/cli/stack.mjs doctor --project <dự án>   # phải là 0 error(s)
```

## Tài liệu

| File | Nội dung |
|---|---|
| [stack/README.md](stack/README.md) | Tổng quan kỹ thuật: cấu trúc, role, trait, flow, policy, pack có sẵn |
| [stack/INSTALL.md](stack/INSTALL.md) | Cài trên máy mới, cấp quyền, lỗi thường gặp |
| [stack/INTEGRATE.md](stack/INTEGRATE.md) | Đưa vào dự án có sẵn, commit gì, gỡ ra |
| [stack/USAGE.md](stack/USAGE.md) | Dùng theo tình huống |
| [stack/KNOWLEDGE.md](stack/KNOWLEDGE.md) | Tri thức dự án: ghi, tra, rà soát và duy trì |
| [stack/MEMORY-BANK.md](stack/MEMORY-BANK.md) | Memory bank: tạo cho dự án mới hoặc có sẵn, cập nhật và duy trì |
| [stack/EXTEND.md](stack/EXTEND.md) | Dự án đã có agent, skill riêng |
| [stack/PARTIAL.md](stack/PARTIAL.md) | Chỉ phụ trách một phần của repo dùng chung |
| [stack/MAPS.md](stack/MAPS.md) | Code maps (project map + repo map): thiết lập, dùng và duy trì |
| [stack/ROADMAP.md](stack/ROADMAP.md) | Trạng thái và kế hoạch |
| [stack/CHANGELOG.md](stack/CHANGELOG.md) | Lịch sử phiên bản |
