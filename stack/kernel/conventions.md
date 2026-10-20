# Quy ước của kernel (v0.3)

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

Kernel 0.3 hiện thực **role**, **trait** và **flow**. Các kind còn lại đã có tên trong schema để giữ chỗ.

### Định dạng file

| Loại | Định dạng | Vị trí |
|---|---|---|
| Module dạng prompt (role, trait, sau này skill, rule) | `.md` + frontmatter | `modules/<kind>s/<id>.md` |
| Module dạng cấu hình (flow) | `.yaml` | `modules/flows/<id>.yaml` |
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
| `{{project.context}}` | role, trait | `context` + danh sách `read_first` của dự án |
| `{{project.name}}` | role, trait | `name` của dự án |
| `{{role.name}}` | role, trait | tên agent sinh ra, ví dụ `ai-verifier-security` |
| `{{role.output}}` | role, trait | mô tả contract mà role `produces`; để trống nếu role không khai |
| `{{contract.<name>}}` | role, trait | danh sách field của `contracts/<name>.schema.json` |

Nội dung đã thay vào thì không được quét lại, nên trait có thể chứa ký tự `{{` mà không gây lỗi.

## 3. Flow

**Flow** trả lời câu hỏi *nhiều agent phối hợp ra sao*. Flow được khai báo độc lập với engine. Kernel 0.3 có một engine: **skill engine** của Claude Code, dịch mỗi flow thành `skills/<prefix><flow>/SKILL.md`, gọi bằng lệnh `/<prefix><flow>`. Phiên chính đọc skill đó và đóng vai orchestrator.

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
| `goal` | Mục tiêu giao cho agent |
| `in` | Input: `$input`, `$<step>` hoặc `$<step>.<output\|findings\|artifacts\|questions\|summary\|checks>`. Giá trị không bắt đầu bằng `$` là chữ thường |
| `when` | Chỉ chạy nếu handoff của một bước trước thỏa điều kiện: `has-findings` · `has-major-findings` · `no-findings` · `has-questions` |
| `gate` | `auto` (mặc định) · `human` (luôn chờ duyệt) · `on-questions` (chỉ chờ khi có câu hỏi hoặc bị chặn) |

Kernel 0.3 chưa có `foreach` và `loop`; hai dạng này sẽ thêm cùng flow `feature`. Tham chiếu và điều kiện cố ý giới hạn trong một danh sách cố định, không phải ngôn ngữ biểu thức, để `doctor` kiểm tra được.

**Lúc chạy** (protocol nằm ở `engines/claude-code/flow-skill.md`, sửa được mà không đụng code):

- Mỗi lần chạy có thư mục riêng `.ai-runs/<thời gian>-<flow>-<slug>/` ở gốc dự án (đổi được bằng khóa `runs` trong project.yaml), chứa `input.md`, `run.yaml` và handoff của từng bước. Orchestrator tạo `.ai-runs/.gitignore` để run state không vào git. Run state cố ý nằm **ngoài `.claude/`**, vì Claude Code hỏi quyền mỗi lần ghi vào `.claude/`.
- Bước sau nhận **đường dẫn file**, không nhận nội dung dán vào prompt.
- Mỗi handoff được kiểm tra bằng `stack check <file> [--produces <contract>]`. Handoff sai thì agent được yêu cầu sửa 1 lần; vẫn sai thì bước đó `failed`.
- Dừng giữa chừng thì chạy lại với `--resume <run-dir>` để tiếp tục.

**Override một bước trong dự án:** `steps` viết dạng map theo id thay vì list:

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

Trong mỗi tầng: module file được áp trước, override (`roles:` / `traits:`) áp sau.

| Kiểu | Quy tắc |
|---|---|
| Giá trị đơn | Tầng sau thắng. `null` thì xóa khóa |
| Map | Gộp sâu |
| List | List thường thì **thay**. List có `'+x'`/`'-x'` thì **nối thêm phép toán**, chỉ tính ở bước cuối |
| `enable.roles` | Giống list, có thêm `'*'` nghĩa là tất cả. Ví dụ `['*', '-builder']` |
| `enable.flows` | Như `enable.roles` |
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

## 6. Phiên bản

- `stack.yaml#version`: phiên bản của bộ module. Dự án khai báo dải tương thích ở `project.yaml#stack`.
- Phiên bản kernel là `kernel/cli/package.json#version`. Module khai báo dải tương thích ở `kernel`.
- Dải hỗ trợ: `*`, `x.y.z`, `^x.y`, `~x.y`, `>=x.y.z`.
- Đổi contract theo kiểu phá vỡ tương thích thì tăng minor khi còn ở 0.x, tăng major từ 1.0 trở đi.

## 7. Mã lỗi

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
| `unsupported-key` *(warn)* | Khóa trong project.yaml mà kernel hiện tại chưa hỗ trợ |
| `generated-missing` *(warn)* | File có trong lock nhưng đã bị xóa |
