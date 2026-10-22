# ai-stack

Bộ agent, skill, rule… dùng chung cho mọi dự án. Thiết kế theo kiểu **lõi nhỏ + module**: mọi thứ được khai báo, ghép theo tầng, rồi build ra cấu hình Claude Code cho từng dự án.

## Bắt đầu nhanh

- Cài trên máy mới, cấp quyền và xử lý lỗi thường gặp: [INSTALL.md](INSTALL.md).
- Đưa vào một dự án có sẵn, điều chỉnh riêng, commit gì và gỡ ra: [INTEGRATE.md](INTEGRATE.md).
- Dùng theo từng tình huống (review, làm tính năng, sửa lỗi…): [USAGE.md](USAGE.md).
- Dự án đã có bộ agent, skill riêng: [EXTEND.md](EXTEND.md).
- Chỉ phụ trách một phần của repo dùng chung: [PARTIAL.md](PARTIAL.md).

```bash
# 1. cài CLI và skill /stack (một lần mỗi máy)
cd .claude/stack/kernel/cli && npm ci && node stack.mjs install

# 2. trong Claude Code, ở dự án muốn dùng:
/stack
```

Hoặc làm tay:

```bash
cp .claude/stack/templates/project.yaml <project>/.claude/project.yaml   # rồi sửa
node .claude/stack/kernel/cli/stack.mjs build  --project <project>
node .claude/stack/kernel/cli/stack.mjs doctor --project <project>
```

`build --dry-run` cho xem trước, không ghi gì. Chạy `doctor` mà không có `--project` (và thư mục hiện tại không có `project.yaml`) thì chỉ kiểm tra bản thân stack.

## Cấu trúc

```
stack/
├── stack.yaml              manifest gốc + giá trị mặc định
├── kernel/
│   ├── conventions.md      luật chung: module, cascade, placeholder, build, settings, policy, mã lỗi
│   ├── contracts/          JSON Schema, nguồn sự thật cho cấu trúc
│   └── cli/                stack build | doctor | check | install (Node ≥ 18.3, deps: yaml, ajv)
├── engines/
│   └── claude-code/        flow-skill.md: protocol orchestrator cho flow
│                           stack-skill.md: protocol hỏi đáp của skill /stack
├── modules/
│   ├── roles/              ai làm
│   ├── traits/             làm theo phong cách nào
│   ├── flows/              nhiều agent phối hợp ra sao
│   ├── policies/           được làm gì: rule, guard (hook), override
│   └── integrations/       hệ thống ngoài qua MCP: tool nào cho role nào
├── packs/                  gói module + override + defaults theo công nghệ
│   └── flutter/
└── templates/project.yaml
```

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
| `learn` | `/ai-learn <run | ghi chú>` | scribe ghi tri thức lâu dài vào thư mục knowledge |

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
| Workflow/SDK engine, retriever vector, loại module `skill` | lộ trình P4–P5 |

## Lộ trình

Chi tiết, việc còn lại và các quyết định đã chốt: [ROADMAP.md](ROADMAP.md).

| Giai đoạn | Nội dung |
|---|---|
| **P0 – Lõi** ✔ | contracts, conventions, CLI build/doctor, 1 role + 2 trait mẫu |
| **P1 – Bộ tối thiểu** ✔ | 5 role, 8 trait, variants, output contract · flow `review`, `feature`, `bugfix` + skill engine · skill `/stack` |
| **P2 – Tri thức & chính sách** ✔ | policy + guard + `scope`, settings do build quản lý · knowledge, `scribe`, `explainer`, `/ai-learn`, `/ai-explain` · trait test và performance |
| **P3 – Pack & integration** (phần lớn ✔) | pack `flutter` (đã chạy thật trên commit của `kho`), integration `zentao`, `researcher`, `external` · còn: ghi ngược lên Zentao, Figma, loại module `skill` |
| **P4 – Ổn định** ✔ | `stack eval` + baseline, phiên bản từng module, run state có thời điểm, 1.0.0 |
| P5 – Mở rộng | engine Workflow/Agent SDK, retriever vector |

## Phát triển stack

```bash
cd kernel/cli
npm test                          # kernel + kiểm tra phiên bản module của chính stack
node stack.mjs doctor             # module của stack hợp lệ, phiên bản đã được tăng khi đổi
node stack.mjs versions --update  # sau khi tăng version của module đã sửa
node stack.mjs eval               # chạy flow thật trên repo mẫu và chấm điểm (tốn chi phí model)
```

Quy tắc phiên bản: [kernel/conventions.md](kernel/conventions.md), mục 8. Eval: [evals/README.md](evals/README.md).
