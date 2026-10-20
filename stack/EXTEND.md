# Dùng chung bộ agent, skill riêng của dự án với ai-stack

Dự án đã có sẵn agent hoặc skill tự viết trong `.claude/` vẫn dùng ai-stack được. Có 4 mức tích hợp, từ không cần làm gì đến chuyển hẳn sang stack. Chọn mức theo việc bạn muốn bộ riêng **được hưởng gì** từ stack.

| Mức | Làm gì | Được gì | Công sức |
|---|---|---|---|
| **0. Song song** | Không làm gì | Cả hai bộ cùng chạy, không đụng nhau | Không |
| **1. Bổ sung tri thức dự án** | Override role của stack trong `project.yaml` | Agent của stack hiểu quy ước của dự án | Thấp |
| **2. Viết module riêng** | Role, trait, flow đặt trong thư mục của dự án | Được trait, contract, variant, và dùng được trong flow | Trung bình |
| **3. Chuyển agent cũ sang role** | Viết lại agent cũ thành role, rồi bỏ bản cũ | Một bộ thống nhất, quản lý bằng một file khai báo | Cao hơn, làm dần được |

Dự án phải đã được tích hợp stack trước (xem [INTEGRATE.md](INTEGRATE.md)).

---

## Mức 0: Song song

Stack **không đụng tới** file nó không tạo ra:
- File của stack mang prefix `ai-` và được ghi trong `.claude/.stack-lock.json`.
- Agent và skill tự viết (ví dụ `.claude/agents/ms-data.md`, `.claude/skills/my-skill/`) được giữ nguyên.
- Nếu trùng tên với file stack định tạo, build dừng lại với lỗi `unmanaged-file` và không ghi gì.

**Skill riêng gọi được agent của stack.** Chỉ cần nêu tên agent trong nội dung skill, ví dụ:

```markdown
## Bước 3: kiểm tra
Dùng agent `ai-verifier-security` review các file vừa sửa, rồi chạy `/ai-review`
nếu thay đổi lớn hơn 5 file.
```

Mức này phù hợp khi bộ riêng đang chạy tốt và bạn chỉ muốn thêm khả năng review của stack.

---

## Mức 1: Bổ sung tri thức dự án vào agent của stack

Không tạo module mới, chỉ thêm vào `.claude/project.yaml`:

```yaml
context: |
  App Flutter, Clean Architecture: domain / data / presentation.
read_first:
  - CLAUDE.md
  - docs/conventions.md

roles:
  builder:
    body: |
      ## Project rules
      - Run `dart run build_runner build` after changing annotated models.
      - Register new repositories in lib/injector.dart.
    body_mode: append
  verifier:
    body: Run `flutter analyze` and `flutter test` as your checks.
    body_mode: append
```

Chạy lại `build`. Mọi agent sinh ra từ role đó, kể cả các variant, đều nhận thêm phần này.

**Nguyên tắc:** quy ước chung của dự án nên để trong `CLAUDE.md` hoặc tài liệu, rồi trỏ tới qua `read_first`. `body` chỉ dành cho chỉ dẫn riêng của một role.

---

## Mức 2: Viết module riêng trong dự án

### 2.1. Khai báo thư mục module

```yaml
# .claude/project.yaml
modules: [.ai]          # đường dẫn tính từ gốc dự án, có thể khai nhiều thư mục
```

Cấu trúc bên trong giống thư mục `modules/` của stack:

```
<dự án>/.ai/
├── roles/       <id>.md     # agent riêng
├── traits/      <id>.md     # mảnh prompt riêng (lens, quy tắc…)
└── flows/       <id>.yaml   # quy trình nhiều agent riêng
```

Tên `.ai` chỉ là gợi ý. Thư mục nào cũng được, miễn khai trong `modules`. Nên đặt **ngoài `.claude/`**, vì Claude Code hỏi quyền mỗi khi ghi vào `.claude/`.

### 2.2. Role riêng

```markdown
---
id: data-engineer
kind: role
version: 0.1.0
kernel: ^0.3
description: >-
  Writes the data layer of this app (repositories, datasources, cache).
  Use for any change under lib/core/data.
permission: exec
traits: [cite-evidence, report-handoff]
---
You are the **data engineer** of this project.

{{project.context}}

## Rules
- Invalidate the cache after every write.
- Never call the backend from presentation code.

{{traits}}
```

Build ra `.claude/agents/ai-data-engineer.md`. Thêm hai trait `cite-evidence` và `report-handoff` thì agent trích dẫn bằng chứng và trả về handoff đúng chuẩn, nên dùng được trong flow.

### 2.3. Trait riêng → variant mới cho role của stack

```markdown
---
id: lens-flutter
kind: trait
version: 0.1.0
kernel: ^0.3
description: Flutter lifecycle focus.
applies_to: [verifier]
slot: lens
---
## Focus: Flutter
- setState after dispose, controllers not disposed, BuildContext used across async gaps.
```

```yaml
# .claude/project.yaml
roles:
  verifier:
    variants:
      flutter: { traits: ['+lens-flutter'] }    # → ai-verifier-flutter
```

### 2.4. Flow riêng

Flow dùng được cả agent riêng lẫn agent của stack:

```yaml
# .ai/flows/data-review.yaml
id: data-review
kind: flow
version: 0.1.0
kernel: ^0.3
description: Review data-layer changes with the project's own agent and a stack verifier.
steps:
  - id: review
    fanout: [data-engineer, verifier-flutter]
    goal: Review the data-layer changes.
    in: { target: $input }
```

Build ra skill `/ai-data-review`. Cú pháp đầy đủ của flow xem trong [kernel/conventions.md](kernel/conventions.md), mục 3.

### 2.5. Ghi đè hẳn một role của stack

Đặt file **cùng id** trong thư mục module của dự án, ví dụ `.ai/roles/builder.md`. File này áp lên role `builder` của stack theo cascade:
- frontmatter được gộp sâu;
- body thay thế hoàn toàn, hoặc thêm `body_mode: append` để nối vào sau.

### 2.6. Kiểm tra

```bash
node <stack>/kernel/cli/stack.mjs doctor --project <dự án>
node <stack>/kernel/cli/stack.mjs build  --project <dự án>
```

`doctor` bắt được: sai schema, gõ sai tên field, trait không tồn tại, trait dùng sai role, flow gọi agent không tồn tại hoặc đang tắt.

---

## Mức 3: Chuyển agent cũ sang role

### Bảng chuyển đổi

| Agent cũ (`.claude/agents/ms-data.md`) | Role mới (`.ai/roles/data-engineer.md`) |
|---|---|
| `name: ms-data` | Tên file, tức `id: data-engineer`. Prefix `ai-` được thêm tự động |
| `description` | `description`, giữ nguyên phần "khi nào dùng" |
| `tools: Read, Grep, Glob` | `permission: read` |
| `tools: …, Edit, Write` | `permission: write` |
| `tools: …, Edit, Write, Bash` | `permission: exec` |
| Tool khác (`WebFetch`, MCP…) | `tools: ['+WebFetch']` |
| Chỉ đọc nhưng cần Bash | `permission: read` + `tools: ['+Bash']` |
| `model` | `model` |
| Nội dung prompt | Body, thêm `{{project.context}}` và `{{traits}}` vào vị trí phù hợp |
| (không có) | `kind: role`, `version`, `kernel: ^0.3` |
| (không có) | `traits: [cite-evidence, report-handoff]` nếu muốn dùng trong flow |
| (không có) | `produces: spec \| plan \| diagnosis` nếu agent trả kết quả có cấu trúc |

### Quy trình chuyển dần, không gián đoạn

1. Viết role mới trong `.ai/roles/`, rồi `build`. Bản mới tên `ai-data-engineer`, **chạy song song** với `ms-data` cũ.
2. Dùng thử bản mới cho vài việc thật, đối chiếu với bản cũ.
3. Phần nào của prompt cũ là quy ước chung của dự án thì chuyển sang `CLAUDE.md` hoặc tài liệu, rồi trỏ tới qua `read_first`. Phần nào là phong cách tái dùng được thì tách thành trait.
4. Ổn rồi thì xóa `ms-data.md`, và sửa các skill riêng đang gọi `ms-data` sang gọi `ai-data-engineer`.

Muốn agent sinh ra giữ đúng tên cũ (không có `ai-`) thì đặt `prefix: ''`. Khi đó tên file sinh ra sẽ trùng với file cũ, nên phải xóa file cũ **trước** khi build.

### Skill cũ điều phối nhiều agent

Nếu skill cũ thực chất là một quy trình (gọi agent A, rồi B, rồi C), hãy viết lại thành **flow** (mức 2.4). Bạn sẽ được run state, kiểm tra handoff bằng `stack check`, cổng duyệt `gate`, và chạy tiếp được bằng `--resume`. Skill không phải quy trình thì cứ giữ nguyên.

---

## Giới hạn hiện tại (kernel 0.3)

| Giới hạn | Cách xử lý tạm |
|---|---|
| Flow chỉ gọi được agent do stack build ra, **không gọi được agent viết tay** (`ms-data`) | Chuyển agent đó thành role (mức 3), hoặc gọi nó từ skill riêng (mức 0) |
| Stack chưa có loại module **skill** | Giữ skill viết tay như cũ; quy trình nhiều bước thì viết thành flow |
| Prefix áp dụng chung cho mọi agent sinh ra trong một dự án | Không đổi được riêng cho từng role |
| Flow chưa có `foreach` và `loop` | Xem [ROADMAP.md](ROADMAP.md), P1 |

## Checklist

- [ ] Chọn mức tích hợp
- [ ] (Mức 1) Thêm `context`, `read_first` và override vào `project.yaml`
- [ ] (Mức 2–3) Tạo thư mục module, khai `modules: [...]`
- [ ] `doctor` báo `0 error(s)`
- [ ] `build`, rồi kiểm tra agent và skill sinh ra trong `.claude/`
- [ ] Dùng thử trên việc thật
- [ ] Commit `project.yaml`, thư mục module và các file sinh ra (xem [INTEGRATE.md](INTEGRATE.md#commit-những-gì))
