# ai-stack

Bộ agent, skill, rule… cho Claude Code, viết một lần và dùng chung cho nhiều dự án. Thiết kế theo kiểu **lõi nhỏ + module**: mọi thứ được khai báo, ghép theo tầng, rồi build ra cấu hình Claude Code cho từng dự án.

Trong tài liệu này, `<stack>` là đường dẫn tới thư mục `stack/` này trên máy bạn, còn `<dự án>` là thư mục gốc của dự án muốn dùng. Stack đặt ở đâu cũng được: clone cả repo hay chỉ copy thư mục `stack/` đều chạy, vì CLI tự tính đường dẫn từ vị trí của chính nó.

## Cách hoạt động

```
  <stack>/                                      <dự án>/
  ├── modules/  role, trait, flow,      ─┐      ├── .claude/project.yaml   bạn khai báo
  │             policy, integration      │      └── .claude/
  └── packs/    gói theo công nghệ       ├──►       ├── agents/ai-*.md     build sinh ra
                                         │          ├── skills/ai-*/
              stack build ───────────────┘          └── settings.local.json (quyền cần thiết)
```

| Khái niệm | Là gì |
|---|---|
| **Role** | Ai làm: analyst, architect, builder, verifier… Mỗi role có quyền và output cố định |
| **Trait** | Làm theo phong cách nào: trích dẫn bằng chứng, hỏi trước khi làm, viết test trước… |
| **Variant** | Một role với bộ trait riêng, ví dụ `verifier-security` |
| **Flow** | Nhiều agent phối hợp ra sao, sinh ra một skill `/ai-*` |
| **Policy** | Được làm gì: rule, guard (hook) chặn sửa ngoài vùng, file generated, secret |
| **Integration** | Hệ thống ngoài qua MCP: tool nào cho role nào, đọc hay ghi |
| **Pack** | Gói module + override + giá trị mặc định theo công nghệ, ví dụ `flutter` |

Dự án chỉ cần một file `.claude/project.yaml`: dự án là gì, file nào cần đọc trước, bật những gì. `stack build` ghép module của stack với khai báo đó thành agent, skill và quyền trong `.claude/` của dự án. Mọi thứ build tạo ra đều có prefix `ai-` và được ghi vào lock file, nên không đụng tới agent, skill có sẵn của dự án.

## Bắt đầu

Cần **Node.js ≥ 18.3**, **Git** và **Claude Code** đã đăng nhập. Chi tiết và lỗi thường gặp: [INSTALL.md](INSTALL.md).

**1. Cài CLI và skill `/stack`** (một lần mỗi máy, và chạy lại mỗi khi chuyển stack sang chỗ khác hoặc cập nhật stack):

```bash
cd <stack>/kernel/cli
npm ci
node stack.mjs install    # ghi skill /stack vào ~/.claude/skills/stack/
```

**2. Gắn stack vào từng dự án.** Mở Claude Code trong `<dự án>` và gõ:

```
/stack
```

Skill khảo sát repo, hỏi những gì chưa rõ (dùng chung hay cá nhân, toàn repo hay một phần, lệnh test, công cụ team dùng…), cho bạn xem trước `project.yaml` cùng các file sẽ tạo, chờ bạn duyệt rồi mới build.

Hoặc làm tay:

```bash
cp <stack>/templates/project.yaml <dự án>/.claude/project.yaml   # rồi sửa
node <stack>/kernel/cli/stack.mjs build  --project <dự án> --dry-run   # xem trước, không ghi gì
node <stack>/kernel/cli/stack.mjs build  --project <dự án>
node <stack>/kernel/cli/stack.mjs doctor --project <dự án>             # phải là 0 error(s)
```

Chạy `doctor` mà không có `--project` (và thư mục hiện tại không có `project.yaml`) thì chỉ kiểm tra bản thân stack. Cách sửa `project.yaml`, commit gì và gỡ ra: [INTEGRATE.md](INTEGRATE.md).

## Dùng hằng ngày

| Lệnh | Dùng khi |
|---|---|
| `/ai-review [target]` | Review thay đổi chưa commit, một branch, một PR hoặc một thư mục |
| `/ai-feature <yêu cầu>` | Làm tính năng từ đầu đến cuối: spec → plan (bạn duyệt) → code → review |
| `/ai-bugfix <triệu chứng>` | Tìm nguyên nhân, sửa và kiểm chứng một lỗi |
| `/ai-explain <câu hỏi>` | Hiểu một đoạn code hoạt động thế nào |
| `/ai-learn <run \| ghi chú>` | Ghi tri thức dự án để các lần sau dùng lại |

Cũng có thể gọi riêng từng agent, ví dụ *"Dùng agent `ai-investigator` để tìm nguyên nhân…"*. Danh sách đầy đủ theo tình huống: [USAGE.md](USAGE.md).

## Cập nhật

- **Đổi cấu hình dự án:** gọi lại `/stack`, hoặc sửa `project.yaml` rồi chạy `build`.
- **Cập nhật stack:** lấy bản mới, chạy lại `node stack.mjs install`, rồi `build` và `doctor` lại **từng dự án** đang dùng. Bước build lại là bước dễ quên nhất.

## Có sẵn

| Role | Quyền | Output | Variants |
|---|---|---|---|
| `analyst` | read | spec | |
| `architect` | read | plan | |
| `builder` | exec | artifacts, checks | `tests` (chỉ viết test) |
| `investigator` | read + Bash | diagnosis | |
| `verifier` | read + Bash | findings | `correctness`, `security`, `conventions`, `performance`, `adversarial` |
| `explainer` | read | explanation | |
| `scribe` | write (chỉ thư mục knowledge) | notes | |
| `researcher` | read + WebSearch/WebFetch | research | |

| Trait | Dùng cho |
|---|---|
| `cite-evidence`, `report-handoff` | mọi role |
| `clarify-first` | analyst, architect |
| `options-tradeoffs` | architect |
| `test-first` (bật theo dự án), `test-author` | builder |
| `adversarial`, `lens-correctness`, `lens-security`, `lens-conventions`, `lens-performance` | verifier |

| Flow | Lệnh | Các bước |
|---|---|---|
| `review` | `/ai-review [target]` | 3 verifier song song (correctness · security · conventions), sau đó adversarial lọc false positive |
| `feature` | `/ai-feature <yêu cầu>` | spec → plan (bạn duyệt) → builder theo từng unit, chia đợt → review ×3 → confirm → tối đa 2 vòng sửa |
| `bugfix` | `/ai-bugfix <triệu chứng>` | investigate (hỏi khi chưa chắc) → fix → verifier-correctness → tối đa 1 vòng sửa |
| `explain` | `/ai-explain <câu hỏi>` | explainer trả lời, kèm đường đi trong code |
| `learn` | `/ai-learn <run \| ghi chú>` | scribe ghi tri thức lâu dài vào thư mục knowledge |

| Policy (opt-in) | Bật bằng | Chặn |
|---|---|---|
| `scope` | `scope: [paths]` | Sửa file ngoài vùng; review mặc định chỉ soát vùng đó |
| `protect-generated` | `enable.policies` | Sửa file sinh tự động (`*.g.dart`, `generated/`…) |
| `no-secrets` | `enable.policies` | Ghi key, token, private key, mật khẩu vào file |

| Pack | Thêm gì |
|---|---|
| `flutter` | `ai-verifier-flutter` (lifecycle, rebuild, state, platform) trong review của `/ai-review` và `/ai-feature`; builder có `flutter-practices` và `flutter-checks`; bật sẵn `protect-generated`; cho phép sẵn `flutter analyze`/`test`, `build_runner` |

| Integration (opt-in) | MCP | Mặc định |
|---|---|---|
| `zentao` | `zentao` | analyst, architect, investigator, researcher, explainer **đọc** được ticket (cho phép sẵn); nhóm **ghi** (comment, đổi trạng thái) chỉ có khi dự án tự cấp, và luôn phải có người duyệt |

Build mặc định sinh ra 14 agent và 5 skill `/ai-*`, đồng thời thêm các quyền mà flow cần vào `settings.local.json`. Build chỉ quản lý những mục nó tự thêm.

## Cấu trúc

```
stack/
├── stack.yaml              manifest gốc + giá trị mặc định
├── kernel/
│   ├── conventions.md      luật chung: module, cascade, placeholder, build, settings, policy, mã lỗi
│   ├── contracts/          JSON Schema, nguồn sự thật cho cấu trúc
│   └── cli/                stack build | doctor | check | install (Node ≥ 18.3, deps: yaml, ajv)
├── engines/
│   ├── claude-code/        flow-skill.md: protocol orchestrator cho flow
│   │                       stack-skill.md: protocol hỏi đáp của skill /stack
│   └── workflow/           runtime.js: runtime tất định cho engine Workflow
├── modules/
│   ├── roles/              ai làm
│   ├── traits/             làm theo phong cách nào
│   ├── flows/              nhiều agent phối hợp ra sao
│   ├── policies/           được làm gì: rule, guard (hook), override
│   └── integrations/       hệ thống ngoài qua MCP: tool nào cho role nào
├── packs/                  gói module + override + defaults theo công nghệ
│   └── flutter/
├── evals/                  repo mẫu + baseline cho stack eval
└── templates/              project.yaml, ci/github-actions-review.yml
```

## Mô hình

| Thành phần | Trạng thái |
|---|---|
| Role, Trait, Variants, output contract | ✔ kernel 0.2 |
| Flow (`agent`, `fanout`, `when`, `gate`) + skill engine + `stack check` | ✔ kernel 0.3 |
| Flow `foreach`, `loop`, input "mới nhất trong các nguồn" | ✔ kernel 0.4 |
| Skill `/stack` (hỏi đáp tạo `project.yaml`, cài bằng `stack install`) | ✔ kernel 0.4.1; hỏi công cụ team dùng (`/stack tools`) từ 0.6.1 |
| Policy (rule, guard hook, override), `scope`, settings do build quản lý, knowledge (grep) | ✔ kernel 0.5 |
| Pack (modules + override + defaults), pack `flutter` | ✔ kernel 0.6 |
| Integration (MCP: grants, allow, rule), `zentao`; role `researcher`; flow gọi agent viết tay (`external`) | ✔ kernel 0.6 |
| Engine Workflow (`--workflow`), `stack run` cho CI, `isolation: worktree`, retriever `index` (`stack search`) | ✔ kernel 1.1 |
| Loại module `skill`, retriever vector có sẵn | chưa làm |

## Lộ trình

Chi tiết, việc còn lại và các quyết định đã chốt: [ROADMAP.md](ROADMAP.md).

| Giai đoạn | Nội dung |
|---|---|
| **P0 – Lõi** ✔ | contracts, conventions, CLI build/doctor, 1 role + 2 trait mẫu |
| **P1 – Bộ tối thiểu** ✔ | 5 role, 8 trait, variants, output contract · flow `review`, `feature`, `bugfix` + skill engine · skill `/stack` |
| **P2 – Tri thức & chính sách** ✔ | policy + guard + `scope`, settings do build quản lý · knowledge, `scribe`, `explainer`, `/ai-learn`, `/ai-explain` · trait test và performance |
| **P3 – Pack & integration** (phần lớn ✔) | pack `flutter` (đã chạy thật trên commit của `kho`), integration `zentao`, `researcher`, `external` · còn: ghi ngược lên Zentao, Figma, loại module `skill` |
| **P4 – Ổn định** ✔ | `stack eval` + baseline, phiên bản từng module, run state có thời điểm, 1.0.0 |
| **P5 – Mở rộng** ✔ | engine Workflow, `stack run` + template GitHub Actions, worktree, retriever `index` |

## Phát triển stack

```bash
cd <stack>/kernel/cli
npm test                          # kernel + kiểm tra phiên bản module của chính stack
node stack.mjs doctor             # module của stack hợp lệ, phiên bản đã được tăng khi đổi
node stack.mjs versions --update  # sau khi tăng version của module đã sửa
node stack.mjs eval               # chạy flow thật trên repo mẫu và chấm điểm (tốn chi phí model)
node stack.mjs run review --project <dự án> --fail-on major   # chạy flow không cần người (CI)
node stack.mjs search "<từ khóa>" --project <dự án>           # tra tri thức dự án (retriever index)
```

Quy tắc phiên bản: [kernel/conventions.md](kernel/conventions.md), mục 8. Eval: [evals/README.md](evals/README.md).

## Tài liệu

| File | Nội dung |
|---|---|
| [INSTALL.md](INSTALL.md) | Cài trên máy mới, cấp quyền, lỗi thường gặp |
| [INTEGRATE.md](INTEGRATE.md) | Đưa vào dự án có sẵn, điều chỉnh riêng, commit gì, gỡ ra |
| [USAGE.md](USAGE.md) | Dùng theo tình huống: review, làm tính năng, sửa lỗi… |
| [EXTEND.md](EXTEND.md) | Dự án đã có bộ agent, skill riêng |
| [PARTIAL.md](PARTIAL.md) | Chỉ phụ trách một phần của repo dùng chung |
| [ROADMAP.md](ROADMAP.md) | Trạng thái và kế hoạch |
| [CHANGELOG.md](CHANGELOG.md) | Lịch sử phiên bản |
