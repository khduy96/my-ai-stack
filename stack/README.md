# ai-stack

Bộ agent, skill, rule… dùng chung cho mọi dự án. Thiết kế theo kiểu **lõi nhỏ + module**: mọi thứ được khai báo, ghép theo tầng, rồi build ra cấu hình Claude Code cho từng dự án.

## Bắt đầu nhanh

- Cài trên máy mới, cấp quyền và xử lý lỗi thường gặp: [INSTALL.md](INSTALL.md).
- Đưa vào một dự án có sẵn, điều chỉnh riêng, commit gì và gỡ ra: [INTEGRATE.md](INTEGRATE.md).
- Dùng theo từng tình huống (review, làm tính năng, sửa lỗi…): [USAGE.md](USAGE.md).
- Dự án đã có bộ agent, skill riêng: [EXTEND.md](EXTEND.md).
- Chỉ phụ trách một phần của repo dùng chung: [PARTIAL.md](PARTIAL.md).

```bash
# 1. cài CLI (một lần)
cd .claude/stack/kernel/cli && npm install

# 2. khai báo dự án
cp .claude/stack/templates/project.yaml <project>/.claude/project.yaml   # rồi sửa

# 3. build và kiểm tra
node .claude/stack/kernel/cli/stack.mjs build  --project <project>
node .claude/stack/kernel/cli/stack.mjs doctor --project <project>
```

`build --dry-run` cho xem trước, không ghi gì. Chạy `doctor` mà không có `--project` (và thư mục hiện tại không có `project.yaml`) thì chỉ kiểm tra bản thân stack.

## Cấu trúc

```
stack/
├── stack.yaml              manifest gốc + giá trị mặc định
├── kernel/
│   ├── conventions.md      luật chung: module, cascade, placeholder, build, mã lỗi
│   ├── contracts/          JSON Schema, nguồn sự thật cho cấu trúc
│   └── cli/                stack build | doctor | check (Node ≥ 18.3, deps: yaml, ajv)
├── engines/
│   └── claude-code/        flow-skill.md: protocol orchestrator cho flow
├── modules/
│   ├── roles/              ai làm
│   ├── traits/             làm theo phong cách nào
│   └── flows/              nhiều agent phối hợp ra sao
├── packs/                  gói module theo công nghệ/domain
└── templates/project.yaml
```

## Có sẵn

| Role | Quyền | Output | Variants |
|---|---|---|---|
| `analyst` | read | spec | |
| `architect` | read | plan | |
| `builder` | exec | artifacts, checks | |
| `investigator` | read + Bash | diagnosis | |
| `verifier` | read + Bash | findings | `correctness`, `security`, `conventions`, `adversarial` |

| Trait | Dùng cho |
|---|---|
| `cite-evidence`, `report-handoff` | mọi role |
| `clarify-first` | analyst, architect |
| `options-tradeoffs` | architect |
| `adversarial`, `lens-correctness`, `lens-security`, `lens-conventions` | verifier |

| Flow | Lệnh | Các bước |
|---|---|---|
| `review` | `/ai-review [target]` | 3 verifier song song (correctness · security · conventions), sau đó adversarial lọc false positive |
| `feature` | `/ai-feature <yêu cầu>` | spec → plan (bạn duyệt) → builder theo từng unit, chia đợt → review ×3 → confirm → tối đa 2 vòng sửa |
| `bugfix` | `/ai-bugfix <triệu chứng>` | investigate (hỏi khi chưa chắc) → fix → verifier-correctness → tối đa 1 vòng sửa |

Build mặc định sinh ra 9 agent (`ai-analyst`, `ai-architect`, `ai-builder`, `ai-investigator`, `ai-verifier` và 4 `ai-verifier-*`), cộng 3 skill `/ai-review`, `/ai-feature`, `/ai-bugfix`.

## Mô hình

| Thành phần | Trạng thái |
|---|---|
| Role, Trait, Variants, output contract | ✔ kernel 0.2 |
| Flow (`agent`, `fanout`, `when`, `gate`) + skill engine + `stack check` | ✔ kernel 0.3 |
| Flow `foreach`, `loop`, input "mới nhất trong các nguồn" | ✔ kernel 0.4 |
| Pack (modules + override) | ✔ có cơ chế, chưa có pack nào |
| Skill `/stack`, Knowledge (RAG), Policy (rule/guard), Integration (MCP), Workflow/SDK engine | lộ trình P1–P5 |

## Lộ trình

Chi tiết, việc còn lại và các quyết định đã chốt: [ROADMAP.md](ROADMAP.md).

| Giai đoạn | Nội dung |
|---|---|
| **P0 – Lõi** ✔ | contracts, conventions, CLI build/doctor, 1 role + 2 trait mẫu |
| P1 – Bộ tối thiểu | ✔ 5 role, 8 trait, variants, output contract · ✔ flow `review`, `feature`, `bugfix` + skill engine · ☐ skill `/stack` |
| P2 – Tri thức & chính sách | retriever grep, scribe, guard (hook) |
| P3 – Pack & integration | pack đầu tiên, MCP adapter; dự án thứ 2 chạy không cần sửa core |
| P4 – Ổn định | evals, semver từng module |
| P5 – Mở rộng | engine Agent SDK, retriever vector |

## Phát triển kernel

```bash
cd kernel/cli && npm test
```
