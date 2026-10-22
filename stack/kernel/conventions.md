# Quy ước của kernel (v0.6)

Tài liệu này là luật chung của `ai-stack`. Schema trong `contracts/` là nguồn sự thật cho cấu trúc. File này giải thích **ý nghĩa** và **cách các phần ghép với nhau**.

## 1. Module

Mọi thành phần đều là module, có chung các trường sau (`contracts/module.schema.json`):

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `id` | ✔ | kebab-case, **trùng tên file**, duy nhất trong cùng kind |
| `kind` | ✔ | `role` · `trait` · `skill` · `flow` · `policy` · `retriever` · `pack` · `integration` |
| `version` | ✔ | semver riêng của từng module |
| `description` | | role/trait bắt buộc có. Với role, đây là description của agent, nói rõ **khi nào nên gọi** |
| `requires` | | phụ thuộc, ghi `id` hoặc `kind:id` khi bị trùng tên |
| `kernel` | | dải phiên bản kernel tương thích, ví dụ `^0.1` |
| `tags` | | tự do |
| `body_mode` | | `replace` · `append` · `prepend`: cách ghép body với cùng module ở tầng trước |
| `x-*` | | khóa mở rộng, kernel bỏ qua. Dùng để thử nghiệm mà không phải sửa schema |

Kernel 0.6 hiện thực **role**, **trait**, **flow**, **policy** và **integration**. Các kind còn lại (`skill`, `retriever`) đã có tên trong schema để giữ chỗ.

### Định dạng file

| Loại | Định dạng | Vị trí |
|---|---|---|
| Module dạng prompt (role, trait, sau này skill, rule) | `.md` + frontmatter | `modules/<kind>s/<id>.md` |
| Module dạng cấu hình (flow) | `.yaml` | `modules/flows/<id>.yaml` |
| Policy | `.yaml` + script guard `.mjs` cùng thư mục | `modules/policies/<id>.yaml`, `<script>.mjs` |
| Pack | `.yaml` | `packs/<id>/pack.yaml` |
| Cấu hình | `.yaml` | `stack.yaml`, `<project>/.claude/project.yaml` |

## 2. Role và trait

**Role** trả lời câu hỏi *ai làm*. Role không gắn với công nghệ.

- `permission` được suy ra thành tools, theo kiểu cộng dồn:
  - `read` → Read, Grep, Glob
  - `write` → thêm Edit, Write
  - `exec` → thêm Bash
- `tools`: list thường thì **thay hẳn**, còn `'+X'` / `'-X'` chỉnh trên danh sách đã suy ra. Ví dụ một reviewer chỉ đọc nhưng cần chạy test: `permission: read`, `tools: ['+Bash']`.
- `slots`: các chỗ trait được phép chèn vào. Mặc định là `['traits']`, dùng `'+x'` để thêm slot.
- `model`: `inherit` · `sonnet` · `opus` · `haiku`…
- `produces`: tên contract của kết quả có cấu trúc mà role đặt vào `handoff.output`, ví dụ `spec`, `plan`, `diagnosis`. Nhờ trường này, bước sau trong flow đọc được output của bước trước một cách chắc chắn.
- `variants`: các biến thể có tên. Mỗi biến thể là một override của chính role đó và được build thành một agent riêng `<prefix><role>-<variant>`. Biến thể không khai `description` thì nhận description của role, thêm đuôi `Variant: <tên>.`
- `abstract: true`: chỉ build các biến thể, không build bản thân role.
- `engines.claude-code`: các field truyền thẳng vào frontmatter agent, ví dụ `color`.

### Variants

Variant dùng khi một flow cần **nhiều bản của cùng một role với góc nhìn khác nhau**, ví dụ review chạy song song nhiều lens:

```yaml
# modules/roles/verifier.md
slots: ['+lens']
variants:
  security: { traits: ['+lens-security'] }      # → ai-verifier-security
```

Dự án thêm, sửa hoặc bỏ variant qua override, vì `variants` là map nên gộp sâu:

```yaml
# project.yaml
roles:
  verifier:
    variants:
      adversarial: null                          # bỏ
      perf: { traits: ['+lens-performance'] }    # thêm
```

`applies_to` của trait được so với **id của role**, không phải tên variant. `enable.roles` cũng bật hoặc tắt theo role, kéo theo toàn bộ variant của nó.

**Trait** trả lời câu hỏi *làm theo phong cách nào*. Trait là một mảnh prompt.

- `slot`: chèn vào placeholder nào của role, mặc định `traits`.
- `applies_to`: chỉ dùng được với các role này. Để trống nghĩa là dùng cho mọi role.
- `conflicts`: các trait không được dùng chung.
- Các trait trong một slot được chèn **theo thứ tự** khai báo trong `traits` của role.

### Placeholder

| Placeholder | Dùng ở | Thay bằng |
|---|---|---|
| `{{<slot>}}` | body role | body của các trait có `slot` tương ứng |
| `{{project.context}}` | role, trait | `context`, danh sách `read_first`, chỉ dẫn tới thư mục `knowledge`, và mục "Project rules" từ các policy đang bật |
| `{{project.name}}` | role, trait | `name` của dự án |
| `{{project.knowledge}}` | role, trait | thư mục `knowledge` của dự án; để trống nếu không khai |
| `{{role.name}}` | role, trait | tên agent sinh ra, ví dụ `ai-verifier-security` |
| `{{role.output}}` | role, trait | mô tả contract mà role `produces`; để trống nếu role không khai |
| `{{contract.<name>}}` | role, trait | danh sách field của `contracts/<name>.schema.json` |

Nội dung đã thay vào thì không được quét lại, nên trait có thể chứa ký tự `{{` mà không gây lỗi.

## 3. Flow

**Flow** trả lời câu hỏi *nhiều agent phối hợp ra sao*. Flow được khai báo độc lập với engine. Kernel có hai engine, chọn bằng `engines` trong project.yaml (mặc định `[skill]`):

- **skill** (luôn có): dịch mỗi flow thành `skills/<prefix><flow>/SKILL.md`, gọi bằng `/<prefix><flow>`. Phiên chính đọc skill đó và đóng vai orchestrator; run state nằm trong `.ai-runs/`.
- **workflow** (`engines: [skill, workflow]`): sinh thêm `workflows/<prefix><flow>.js`, gồm dữ liệu của flow cộng runtime dùng chung `engines/workflow/runtime.js`, chạy tất định bằng Workflow của Claude Code. Gọi bằng `/<prefix><flow> --workflow`. Input truyền trong bộ nhớ, handoff được kiểm tra bằng `schema` của `agent()`. Bước cần người (`gate: human`, có câu hỏi, `partial`/`blocked`, hết `max` của loop) kết thúc workflow với `status: waiting`; chạy lại kèm `args.approved` / `args.answers` và `resumeFromRunId` để tiếp tục, agent đã xong được lấy từ cache.

```yaml
steps:
  - id: review
    fanout: [verifier-correctness, verifier-security]   # chạy song song
    goal: …
    in: { target: $input }
  - id: confirm
    agent: verifier-adversarial                          # chạy 1 agent
    goal: …
    in: { claims: $review.findings }
    when: { step: review, is: has-findings }
    gate: auto
```

| Field của step | Ý nghĩa |
|---|---|
| `agent` *hoặc* `fanout` | Id của role hoặc variant, không kèm prefix. Phải có đúng một trong hai |
| `foreach` | Đi kèm `agent`: chạy agent đó cho **mỗi phần tử** của một list, ví dụ `$plan.output.units` |
| `goal` | Mục tiêu giao cho agent |
| `in` | Input: `$input`, `$<step>`, `$<step>.<output[.field]\|findings\|artifacts\|questions\|summary\|checks>`, hoặc **list tham chiếu** nghĩa là "cái mới nhất đang có". Giá trị không bắt đầu bằng `$` là chữ thường |
| `isolation` | Đi kèm `foreach`: `worktree` cho mỗi phần tử chạy trên một git worktree riêng, rồi áp diff về cây làm việc (không commit, dừng khi xung đột). Chỉ dùng khi không phần tử nào có `depends_on`, vì worktree tạo từ commit hiện tại; ngược lại thì chạy như `none` |
| `external` | `true` khi agent là agent viết tay (không do stack build): dùng đúng tên, không thêm prefix, build không kiểm tra; orchestrator dặn agent trả về khối `handoff` |
| `when` | Chỉ chạy nếu handoff của một bước trước thỏa điều kiện: `has-findings` · `has-major-findings` · `no-findings` · `no-major-findings` · `has-questions` |
| `gate` | `auto` (mặc định) · `human` (luôn chờ duyệt) · `on-questions` (chỉ chờ khi có câu hỏi hoặc bị chặn) |

Có 4 dạng bước: `agent`, `fanout`, `agent` + `foreach`, và `loop`. Tham chiếu và điều kiện cố ý giới hạn trong một danh sách cố định, không phải ngôn ngữ biểu thức, để `doctor` kiểm tra được.

### `foreach`

```yaml
- id: build
  agent: builder
  foreach: $plan.output.units
  goal: Implement your unit of the plan.
```

- Mỗi phần tử được giao cho một agent qua `inputs.item`.
- Phần tử có `depends_on` thì chờ các phần tử đó `done`. Các phần tử sẵn sàng tạo thành một **đợt**, chạy song song, trừ những phần tử có `files` trùng nhau thì chạy lần lượt.
- Handoff lưu ở `<run>/<step>/<item id>.handoff.yaml`.
- `doctor` kiểm tra field có trong contract của role tạo ra nó và đúng là list. Ví dụ `$plan.output.nope` báo `unknown-ref`.

### `loop`

```yaml
- id: fix
  when: { step: confirm, is: has-major-findings }
  loop:
    max: 2                                             # 1–5
    until: { step: fix-confirm, is: no-major-findings }
    steps:
      - id: fix-build
        agent: builder
        in: { findings: [$fix-confirm.findings, $confirm.findings] }
      - id: fix-confirm
        agent: verifier-adversarial
```

- Lặp tối đa `max` lần, dừng sau vòng nào mà `until` (trên một bước **trong** loop) thỏa. Hết `max` mà chưa thỏa thì orchestrator hỏi người dùng.
- Handoff của vòng thứ `n` nằm ở `<run>/<loop>/<n>/…`. Loop không lồng nhau.
- Bước bị bỏ qua (`when` không thỏa) coi như không có finding và không có câu hỏi.

**Quy tắc tham chiếu quanh loop:**

| Bước đang đứng ở | Tham chiếu tới | Nghĩa là |
|---|---|---|
| Bất kỳ | Bước top-level đứng trước | Kết quả của bước đó |
| Trong loop | Bước đứng trước trong cùng loop | Vòng hiện tại |
| Trong loop | Bước đứng sau (hoặc chính nó) trong cùng loop | **Vòng trước**. Chỉ được dùng trong list, kèm một tham chiếu dự phòng cho vòng 1, ví dụ `[$fix-confirm.findings, $confirm.findings]` |
| Top-level, sau loop | Bước trong loop | Vòng cuối cùng đã chạy |
| (khác) | Chính bước loop, hoặc loop chưa chạy | Lỗi `unknown-ref` |

**Lúc chạy** (protocol nằm ở `engines/claude-code/flow-skill.md`, sửa được mà không đụng code):

- Mỗi lần chạy có thư mục riêng `.ai-runs/<thời gian>-<flow>-<slug>/` ở gốc dự án (đổi được bằng khóa `runs` trong project.yaml), chứa `input.md`, `run.yaml` và handoff của từng bước. Orchestrator tạo `.ai-runs/.gitignore` để run state không vào git. Run state cố ý nằm **ngoài `.claude/`**, vì Claude Code hỏi quyền mỗi lần ghi vào `.claude/`.
- Bước sau nhận **đường dẫn file**, không nhận nội dung dán vào prompt.
- Mỗi handoff được kiểm tra bằng `stack check <file> [--produces <contract>]`. Handoff sai thì agent được yêu cầu sửa 1 lần; vẫn sai thì bước đó `failed`.
- Dừng giữa chừng thì chạy lại với `--resume <run-dir>` để tiếp tục.

**Override một bước trong dự án:** `steps` viết dạng map theo id thay vì list. Áp dụng được cả cho bước nằm trong loop:

```yaml
flows:
  review:
    steps:
      confirm: { gate: human }
```

Flow dùng agent của một role đang tắt sẽ bị báo `unknown-ref`. Muốn hết lỗi thì tắt luôn flow đó (`enable.flows`) hoặc bật lại role.

## 4. Cascade (thứ tự ghi đè)

```
core (stack/modules)
  → pack theo thứ tự trong `packs` (packs/<id>/modules, rồi override trong pack.yaml)
    → project (các thư mục trong `modules`, rồi override trong project.yaml)
      → local (override trong project.local.yaml, không commit)
```

Trong mỗi tầng: module file được áp trước, override (`roles:` / `traits:` / `flows:` / `policies:` / `integrations:`) áp sau.

**`defaults` của pack.** Ngoài module và override, `pack.yaml` có thể khai `defaults`: các giá trị cấu hình dự án (như `enable.policies`, `permissions`, `context`) nằm **giữa** giá trị mặc định của stack và cấu hình của dự án. Nhờ vậy pack bật sẵn được một guard hay cho phép sẵn các lệnh kiểm tra, còn dự án vẫn ghi đè được, ví dụ `enable.policies: ['-protect-generated']`.

| Kiểu | Quy tắc |
|---|---|
| Giá trị đơn | Tầng sau thắng. `null` thì xóa khóa |
| Map | Gộp sâu |
| List | List thường thì **thay**. List có `'+x'`/`'-x'` thì **nối thêm phép toán**, chỉ tính ở bước cuối |
| `enable.roles` | Giống list, có thêm `'*'` nghĩa là tất cả. Ví dụ `['*', '-builder']` |
| `enable.flows` | Như `enable.roles` |
| `enable.policies` | Như `enable.roles`, nhưng mặc định là `[]` (opt-in). `scope:` tự bật policy `scope` |
| Body | `body_mode`: `replace` (mặc định) · `append` · `prepend` |

Ví dụ override trong `project.yaml`:

```yaml
roles:
  builder:
    model: sonnet
    traits: ['+test-first']
    body: Always run `npm test` before reporting done.
    body_mode: append
```

Override không được đổi `id`/`kind`. Kết quả sau khi gộp được kiểm tra lại bằng schema của module, nên gõ sai tên field sẽ bị bắt.

## 5. Build

- Output nằm trong `<project>/.claude/`. Agent được đặt tên `<prefix><role>`, prefix mặc định `ai-`.
- Mọi file sinh ra được ghi vào `.claude/.stack-lock.json` kèm hash sha256. Hash tính trên nội dung đã chuẩn hóa xuống dòng, nên git autocrlf không gây báo nhầm.
- Build **không bao giờ**:
  - ghi đè file mà nó không tạo ra (lỗi `unmanaged-file`);
  - ghi đè hay xóa file sinh ra đã bị sửa tay (lỗi `generated-drift`).
  Cả hai trường hợp đều cần `--force`.
- Mọi xung đột được kiểm tra **trước khi ghi**. Có lỗi thì không file nào bị đụng tới.
- Build chạy lại bao nhiêu lần cũng ra cùng kết quả: lần sau không sinh diff.

### Settings do build quản lý

Build ghi vào **một** file settings, chọn bằng khóa `settings` trong project.yaml: `local` (mặc định) là `settings.local.json`, `shared` là `settings.json`, còn `none` thì build không đụng tới settings. Build ghi hai loại mục:

- `permissions.allow`: những gì flow cần, gồm đúng lệnh `<cli> check *`, các lệnh git chỉ đọc (`diff`, `status`, `log`, `show`), `date` và `Edit(<runs>/**)`; `<cli> search *` khi dùng retriever `index`, cùng `permissions` của các policy đang bật. Claude Code chỉ áp quy tắc `Edit(…)` khi kiểm tra việc ghi file, và yêu cầu dấu `*` đặt sau lệnh con, nên build không bao giờ sinh `Write(…)` hay `Bash(node *…)`.
- `hooks.PreToolUse`: một mục cho mỗi guard đang bật, chạy `node .claude/hooks/<prefix><policy>.mjs`.

Lock ghi lại **đúng những mục build đã thêm** (`settings` trong `.stack-lock.json`). Một mục bạn đã có sẵn từ trước thì vẫn là của bạn, kể cả khi giống hệt mục build cần. Build sau chỉ gỡ hoặc thay những mục của chính nó. Đổi `settings` từ `local` sang `shared` thì các mục được chuyển từ file này sang file kia. `doctor` cảnh báo khi một mục do build quản lý bị xóa tay.

### Knowledge

`knowledge: <dir>` trong project.yaml khai thư mục tri thức của dự án, trong đó có `INDEX.md`. Mọi agent được dặn đọc `INDEX.md` trước, tìm trong thư mục theo từ khóa của task, và tin code khi tri thức mâu thuẫn với code. Role `scribe` là role duy nhất ghi vào thư mục này (qua flow `learn`). `knowledge: { dir, retriever: index }` cho agent tra bằng `stack search "<từ khóa>"`: BM25 trên tiêu đề, tag và nội dung, không phân biệt dấu, tính lại mỗi lần gọi nên không có chỉ mục cũ; quyền chạy lệnh được build thêm vào settings. Tìm theo ý nghĩa (vector) thì dùng một MCP server qua integration.

## 6. Policy

**Policy** trả lời câu hỏi *agent được làm gì trong dự án này*. Policy là **opt-in**: `enable.policies` mặc định để trống.

```yaml
# modules/policies/protect-generated.yaml
id: protect-generated
kind: policy
config: { patterns: ['**/*.g.dart'] }            # mặc định, dự án ghi đè được
rule: Never edit generated files ({{config.patterns}}); …
guard: { event: PreToolUse, matcher: Edit|Write|MultiEdit|NotebookEdit, script: protect-generated.mjs }
overrides: { roles: {…}, flows: {…} }            # tùy chọn
permissions: [ … ]                               # tùy chọn
```

| Phần | Khi policy bật |
|---|---|
| `rule` | Thêm một dòng vào mục "Project rules" trong context của **mọi agent**. Đây là gợi ý |
| `guard` | Build copy script thành `.claude/hooks/<prefix><id>.mjs`, ghi `config` ra `<prefix><id>.json` cạnh đó, và đăng ký hook. Script đọc JSON input của Claude Code từ stdin; exit code `2` nghĩa là **từ chối** lệnh, kèm thông báo gửi cho Claude. Đây là bắt buộc |
| `overrides` | Áp lên role và flow như override của dự án |
| `permissions` | Thêm vào `permissions.allow` |

- Chuỗi trong `rule`, `overrides`, `permissions` dùng được `{{config.<key>}}`; list được nối bằng dấu `, `.
- Dự án đổi config bằng `policies: { <id>: { config: {...} } }`. Config được gộp sâu, list thì thay hẳn.
- **`scope: [paths]`** trong project.yaml là cách viết tắt để bật policy `scope` với các đường dẫn đó. Thư mục run và thư mục knowledge luôn được thêm vào danh sách được phép.
- Có sẵn 3 policy: `scope`, `protect-generated`, `no-secrets`. Dự án viết policy riêng trong thư mục module của mình (`policies/<id>.yaml` cùng script đặt cạnh).
- Guard chỉ bắt các công cụ sửa file; lệnh shell không đi qua guard.

## 7. Integration

**Integration** trả lời câu hỏi *agent dùng hệ thống bên ngoài nào, qua MCP server nào*. Integration là **opt-in** (`enable.integrations`).

```yaml
# modules/integrations/zentao.yaml
id: zentao
kind: integration
mcp: zentao                          # tên MCP server trong Claude Code
tools:
  read: [zentao_get_details, zentao_get_comments, …]
  write: [zentao_add_comment, zentao_update_bug_status, …]   # không bao giờ liệt kê tool xóa
allow: [read]                        # được cho phép trước trong settings
grants:                              # role nào nhận nhóm tool nào
  analyst: [read]
  investigator: [read]
rule: When a request mentions a Zentao ticket, read it … Never change a ticket unless …
```

| Phần | Khi integration bật |
|---|---|
| `grants` | Role (và mọi variant của nó) được thêm các tool `mcp__<mcp>__<tool>` của nhóm được cấp |
| `allow` | Tool của các nhóm này được thêm vào `permissions.allow`, nên agent dùng mà không bị hỏi. **Nhóm thay đổi hệ thống bên ngoài không được đặt vào đây**: những thao tác đó luôn phải có người duyệt |
| `rule` | Thêm vào mục "Project rules" của mọi agent |

Dự án đổi quyền bằng `integrations: { zentao: { grants: { builder: [read, write] } } }`. Cấp nhóm `write` chỉ nên làm cho role mà bước của nó có `gate: human`.

Khóa `permissions` trong project.yaml (hoặc trong `defaults` của pack) thêm các mục `permissions.allow` do build quản lý, ví dụ lệnh kiểm tra của dự án.

## 8. Phiên bản

- `stack.yaml#version`: phiên bản của bộ module. Dự án khai báo dải tương thích ở `project.yaml#stack`.
- Phiên bản kernel là `kernel/cli/package.json#version`. Module khai báo dải tương thích ở `kernel`.
- Dải hỗ trợ: `*`, `x.y.z`, `^x.y`, `~x.y`, `>=x.y.z`.
- Đổi contract theo kiểu phá vỡ tương thích thì tăng minor khi còn ở 0.x, tăng major từ 1.0 trở đi.

### Phiên bản từng module

Mỗi module của stack (trong `modules/` và `packs/`, kể cả `pack.yaml`) có `version` riêng. `modules.lock.json` ở gốc stack ghi phiên bản và hash nội dung của từng module; với policy, hash tính cả script guard.

| Đổi gì | Tăng |
|---|---|
| Sửa câu chữ, không đổi hành vi | patch |
| Thêm hoặc đổi hành vi, field, variant, bước | minor |
| Bỏ hoặc đổi tên thứ dự án đang dùng (variant, slot, id bước, contract output) | major (minor khi còn 0.x) |

Quy trình: sửa module → tăng `version` → `node kernel/cli/stack.mjs versions --update`. `doctor` chạy trên stack báo lỗi `version-not-bumped` khi một module đổi nội dung mà vẫn giữ phiên bản (hoặc phiên bản đi lùi), và cảnh báo `version-unrecorded` khi lock chưa được cập nhật. `npm test` cũng kiểm tra điều này trên chính stack.

### Eval

`stack eval` chạy flow thật trên các repo mẫu trong `evals/` rồi chấm điểm, để biết một thay đổi prompt, module hay kernel làm agent tốt lên hay kém đi. Xem `evals/README.md`.

## 9. Mã lỗi

| Mã | Khi nào |
|---|---|
| `parse-error` | YAML hoặc frontmatter hỏng |
| `schema-invalid` | Sai schema: thiếu trường, sai kiểu, field lạ, dải version sai |
| `id-mismatch` / `kind-mismatch` | `id` khác tên file, hoặc `kind` khác thư mục |
| `duplicate-id` | Hai module cùng kind:id trong một tầng, hoặc hai role/variant sinh ra cùng một agent |
| `unknown-ref` | Tham chiếu trait, module, pack, contract (kể cả `produces`) hoặc role không tồn tại |
| `requires-cycle` | Phụ thuộc vòng tròn |
| `trait-conflict` / `trait-not-applicable` | Trait xung đột, hoặc trait không dành cho role này |
| `unknown-slot` | Placeholder lạ, trait nhắm vào slot không khai báo, hoặc slot có trait nhưng body không có placeholder |
| `incompatible-version` | Phiên bản kernel hoặc stack không khớp |
| `missing-file` | Thiếu `stack.yaml` hoặc `project.yaml` |
| `unmanaged-file` / `generated-drift` | Xem mục 5 |
| `version-not-bumped` | (doctor trên stack) Module đổi nội dung mà không tăng `version`, hoặc phiên bản đi lùi |
| `version-unrecorded` *(warn)* | (doctor trên stack) Phiên bản module chưa được ghi vào `modules.lock.json`; chạy `stack versions --update` |
| `unsupported-key` *(warn)* | Khóa trong project.yaml mà kernel hiện tại chưa hỗ trợ |
| `generated-missing` *(warn)* | File có trong lock nhưng đã bị xóa, hoặc mục settings do build quản lý đã bị xóa tay |
