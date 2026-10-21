# Hướng dẫn sử dụng theo tình huống

Áp dụng cho stack 0.6. Dự án phải đã được tích hợp (xem [INTEGRATE.md](INTEGRATE.md)).

Hiện có:
- **5 flow chạy tự động:** `/ai-review`, `/ai-feature`, `/ai-bugfix`, `/ai-explain`, `/ai-learn`.
- **14 agent gọi riêng lẻ:** `ai-analyst`, `ai-architect`, `ai-builder`, `ai-builder-tests`, `ai-investigator`, `ai-explainer`, `ai-scribe`, `ai-researcher`, `ai-verifier` và 5 `ai-verifier-*`. Pack có thể thêm, ví dụ `ai-verifier-flutter`.
- **3 guard tùy chọn:** `scope`, `protect-generated`, `no-secrets`.

## Tra nhanh

| Tôi muốn… | Dùng | Mục |
|---|---|---|
| Review thay đổi trước khi commit | `/ai-review` | A1 |
| Review một branch trước khi merge | `/ai-review main..<branch>` | A2 |
| Review một PR | `/ai-review <số PR>` | A3 |
| Soát một thư mục hoặc file đang có | `/ai-review <đường dẫn>` | A4 |
| Chỉ soát bảo mật, hoặc chỉ một góc nhìn | `ai-verifier-<lens>` | B1 |
| Kiểm chứng lại kết luận của người khác hoặc AI khác | `ai-verifier-adversarial` | B2 |
| Làm một tính năng từ đầu đến cuối | `/ai-feature <yêu cầu>` | C1 |
| Chỉ làm rõ một yêu cầu còn mơ hồ | `ai-analyst` | C2 |
| Chỉ chọn cách làm, chia việc | `ai-architect` | C3 |
| Sửa một lỗi có kiểm chứng | `/ai-bugfix <triệu chứng>` | D1 |
| Chỉ tìm nguyên nhân lỗi, chưa sửa | `ai-investigator` | D2 |
| Chỉ viết test, không sửa code chính | `ai-builder-tests` | D3 |
| Hiểu một đoạn code hoạt động thế nào | `/ai-explain <câu hỏi>` | F1 |
| Ghi lại tri thức dự án sau một lần chạy | `/ai-learn <thư mục run>` | F2 |
| Chặn sửa ngoài vùng, file generated, lộ secret | `scope`, `enable.policies` | F3 |
| Tra tài liệu thư viện, changelog, lỗi đã biết | `ai-researcher` | G1 |
| Cho agent đọc ticket, thiết kế, tài liệu của team | `/stack tools`, rồi `/ai-feature SHOP-123` | G2 |
| Dự án Flutter | `packs: [flutter]` | G3 |
| Chạy tiếp một lần review bị dừng | `/ai-review --resume …` | E1 |
| Chạy review không cần người (script, CI) | `claude -p "/ai-review …"` | E3 |

## Cách gọi chung

- **Gọi flow:** gõ lệnh, ví dụ `/ai-review`. Phiên chính sẽ tự điều phối các agent.
- **Gọi một agent:** nói rõ tên agent trong câu, ví dụ *"Dùng agent `ai-investigator` để…"*. Bạn có thể viết bằng tiếng Việt.
- **Kết quả:** mỗi agent kết thúc bằng một khối `handoff` (YAML), gồm trạng thái, kết quả, phát hiện và câu hỏi. Phiên chính tóm tắt lại cho bạn.
- **Dữ liệu chuyền giữa các bước:** khi tự ghép nhiều agent, bảo phiên chính **lưu handoff ra file** và đưa đường dẫn file đó cho agent tiếp theo. Cách này đỡ tốn context và xem lại được.

---

## A. Review bằng `/ai-review`

Mỗi lần chạy gồm 3 verifier song song (correctness, security, conventions), sau đó `ai-verifier-adversarial` cố bác bỏ từng phát hiện. Báo cáo cuối chỉ giữ những gì sống sót, xếp theo mức độ. Toàn bộ dữ liệu của lần chạy nằm trong `.ai-runs/<thời gian>-review-<slug>/`.

Chi phí: mỗi lần chạy dùng 4–5 agent. Nên dành cho thay đổi đáng kể, không cần chạy cho từng dòng sửa.

### A1. Review thay đổi chưa commit

```
/ai-review
```

Không truyền gì nghĩa là review mọi thay đổi chưa commit: đã stage, chưa stage, và file mới.

### A2. Review một branch trước khi merge

```
/ai-review main..feat/order-filter
```

Hoặc diễn đạt bằng lời: `/ai-review các commit của branch feat/order-filter so với main`.

### A3. Review một PR

```
/ai-review 123
```

Cần cài và đăng nhập `gh` (GitHub CLI).

### A4. Soát code đang có (không phải diff)

```
/ai-review lib/features/orders
```

Dùng khi tiếp nhận một module lạ, hoặc trước khi refactor muốn biết chỗ nào đang có vấn đề.

### A5. Đọc kết quả

- Báo cáo hiện ngay trong phiên chat.
- Chi tiết từng agent nằm ở `.ai-runs/<run>/review/*.handoff.yaml`; kết quả sau khi lọc ở `confirm.handoff.yaml`.
- Muốn sửa luôn thì nói tiếp trong cùng phiên, ví dụ: *"Dùng `ai-builder` sửa 2 finding critical trong báo cáo vừa rồi"* (xem D2).

---

## B. Review có trọng tâm

### B1. Chỉ một góc nhìn

Khi chỉ quan tâm một khía cạnh thì gọi thẳng variant tương ứng. Cách này rẻ và nhanh hơn chạy cả flow.

```
Dùng agent ai-verifier-security review thư mục lib/core/data/, tập trung vào
chỗ lưu token và gọi API.
```

| Variant | Soát gì |
|---|---|
| `ai-verifier-correctness` | Logic, edge case, xử lý lỗi, state/concurrency |
| `ai-verifier-security` | Secret, injection, phân quyền, input không tin cậy, lộ dữ liệu |
| `ai-verifier-conventions` | Có đúng quy ước của dự án không (cấu trúc, đặt tên, tái sử dụng) |
| `ai-verifier-performance` | Việc lặp thừa (N+1), tăng theo dữ liệu, chờ chặn luồng, rò rỉ tài nguyên. Không nằm trong `/ai-review` mặc định |
| `ai-verifier` | Review chung, không có trọng tâm |

### B2. Kiểm chứng lại một kết luận

Dùng khi có một danh sách lỗi từ công cụ khác, từ người khác, hoặc khi một agent báo "đã xong" mà bạn còn nghi ngờ.

```
Dùng agent ai-verifier-adversarial kiểm chứng các nhận định sau, cái nào sai
thì chỉ ra bằng chứng:
1. OrderRepository không invalidate cache sau khi tạo đơn
2. SyncService có thể chạy 2 lần song song khi mạng chập chờn
```

Kết quả: nhận định nào đứng vững thì thành finding; nhận định bị bác thì được ghi là `Rejected: …` kèm bằng chứng.

---

## C. Làm tính năng

### C1. Từ đầu đến cuối với `/ai-feature`

```
/ai-feature thêm lọc đơn hàng theo trạng thái và khoảng ngày ở màn danh sách đơn
```

Các bước flow chạy:

| Bước | Agent | Dừng lại hỏi bạn khi |
|---|---|---|
| 1. `spec` | analyst viết spec | Có câu hỏi mở (yêu cầu mơ hồ) |
| 2. `plan` | architect lập plan, chia unit | **Luôn dừng để bạn duyệt plan** |
| 3. `build` | 1 builder cho mỗi unit, chia đợt theo `depends_on`, song song khi không chung file | Một unit bị `blocked` |
| 4. `review` | 3 verifier song song | — |
| 5. `confirm` | adversarial lọc false positive (chỉ chạy khi có finding) | — |
| 6. `fix` | Tối đa 2 vòng: builder sửa → review → confirm (chỉ chạy khi còn finding critical/major) | Hết 2 vòng mà vẫn còn lỗi nặng |

**Ở bước duyệt plan**, đọc kỹ các unit và file của từng unit. Muốn sửa thì nói thẳng, ví dụ *"gộp unit 2 và 3, bỏ phần export CSV"*; architect sẽ lập lại plan.

Muốn bỏ bước duyệt plan cho một dự án (ví dụ thay đổi nhỏ, tin tưởng architect):

```yaml
flows:
  feature:
    steps:
      plan: { gate: auto }
```

Chi phí: một lần chạy dùng khoảng 7–10 agent, nhiều hơn nếu có vòng sửa. Thay đổi nhỏ, rõ ràng thì gọi thẳng `ai-builder` sẽ rẻ hơn.

Các mục C2–C4 dưới đây là cách dùng **từng agent riêng lẻ**, khi bạn chỉ cần một phần của quy trình.

### C2. Chỉ làm rõ yêu cầu với `ai-analyst`

```
Dùng agent ai-analyst viết spec cho yêu cầu: "thêm lọc đơn hàng theo trạng
thái và khoảng ngày ở màn danh sách đơn". Lưu handoff vào .ai-runs/manual/spec.yaml.
```

Bạn nhận lại một **spec** gồm mục tiêu, tiêu chí hoàn thành, phần ngoài phạm vi, giả định và câu hỏi mở. Analyst không thiết kế và không sửa code. Nếu có câu hỏi mở thì trả lời rồi bảo nó cập nhật spec.

### C3. Chỉ thiết kế và chia việc với `ai-architect`

```
Dùng agent ai-architect lập plan từ spec ở .ai-runs/manual/spec.yaml.
Lưu handoff vào .ai-runs/manual/plan.yaml.
```

Bạn nhận lại một **plan** gồm 2–3 phương án kèm đánh đổi, phương án được chọn, và các đơn vị việc (unit). Mỗi unit có danh sách file sở hữu, thứ tự phụ thuộc và tiêu chí xong. **Đọc kỹ plan trước khi cho làm tiếp.**

### C4. Tự hiện thực từng unit với `ai-builder`, rồi review

```
Dùng agent ai-builder làm unit "filter-state" trong .ai-runs/manual/plan.yaml.
Chỉ sửa các file của unit đó.
```

- Làm lần lượt từng unit theo `depends_on`. Các unit không phụ thuộc nhau và không chung file thì có thể bảo chạy song song.
- Builder sẽ chạy các lệnh kiểm tra của dự án và báo kết quả trong `checks`.
- Xong hết các unit thì chạy `/ai-review` (A1).

Kiểm chứng spec, plan bằng CLI nếu muốn:

```bash
node <stack>/kernel/cli/stack.mjs check .ai-runs/manual/plan.yaml --produces plan
```

---

## D. Xử lý lỗi

### D1. Tìm nguyên nhân và sửa với `/ai-bugfix`

Mô tả triệu chứng càng cụ thể càng tốt: thấy gì, mong đợi gì, ở đâu, từ khi nào, cách tái hiện.

```
/ai-bugfix sau khi huỷ một đơn hàng, tồn kho của sản phẩm không được cộng lại;
thoát app vào lại thì đúng
```

| Bước | Agent | Dừng lại hỏi bạn khi |
|---|---|---|
| 1. `diagnose` | investigator tìm nguyên nhân gốc | **Chưa xác nhận được nguyên nhân** (báo `partial`): bạn bổ sung thông tin |
| 2. `fix` | builder áp dụng cách sửa nhỏ nhất, thêm test nếu dự án có test | — |
| 3. `verify` | verifier-correctness kiểm tra | — |
| 4. `retry` | 1 vòng sửa nữa nếu còn lỗi critical/major | Vẫn còn lỗi nặng sau vòng đó |

Muốn **duyệt cách sửa trước khi builder đụng vào code**:

```yaml
flows:
  bugfix:
    steps:
      diagnose: { gate: human }
```

### D2. Chỉ tìm nguyên nhân với `ai-investigator`

Dùng khi muốn hiểu lỗi trước, chưa muốn sửa.

```
Dùng agent ai-investigator tìm nguyên nhân: sau khi huỷ một đơn hàng, số tồn
kho của sản phẩm không được cộng lại, nhưng thoát app vào lại thì đúng.
```

Bạn nhận lại một **diagnosis**:
- tất cả giả thuyết đã xét, mỗi cái là xác nhận, đã loại, hay còn mở;
- nguyên nhân gốc kèm chuỗi `path:line`;
- đề xuất sửa nhỏ nhất và rủi ro của nó.

Investigator **không sửa code**. Nếu nó báo `partial` thì chưa chắc chắn; đọc các giả thuyết còn mở và cung cấp thêm thông tin.

Muốn sửa tiếp sau khi đã đọc diagnosis:

```
Dùng agent ai-builder áp dụng đề xuất sửa trong diagnosis vừa rồi.
Sau đó dùng ai-verifier-correctness kiểm tra lại thay đổi.
```

### D3. Chỉ viết test với `ai-builder-tests`

Dùng để thêm test hồi quy sau khi sửa lỗi, hoặc tăng độ phủ cho một phần code, mà **không đụng code chính**.

```
Dùng agent ai-builder-tests viết test hồi quy cho lỗi total() bỏ sót phần tử đầu
trong src/cart.js.
```

Nếu một test chỉ pass được khi sửa code chính, agent đánh dấu test đó là skip hoặc expected-fail, rồi báo phần cần sửa ở mức `major`.

Muốn builder thường **luôn viết test trước** khi sửa:

```yaml
roles:
  builder:
    traits: ['+test-first']
```

---

## E. Vận hành

### E1. Chạy tiếp một flow bị dừng

```
/ai-review  --resume .ai-runs/20261019-1745-review-uncommitted-changes
/ai-feature --resume .ai-runs/20261021-0930-feature-order-filter
```

Orchestrator đọc `run.yaml` và chạy tiếp từ bước chưa xong, kể cả đang giữa một vòng sửa.

### E2. Đổi hành vi của flow cho dự án

Mọi thay đổi nằm trong `.claude/project.yaml`, sau đó chạy lại `build`. Xem chi tiết trong [INTEGRATE.md](INTEGRATE.md#điều-chỉnh-cho-riêng-dự-án). Ví dụ muốn duyệt kết quả review trước khi bước adversarial chạy:

```yaml
flows:
  review:
    steps:
      confirm: { gate: human }
```

### E3. Chạy không cần người (script, CI, trước khi push)

```bash
claude -p "/ai-review main..HEAD" --allowedTools "Agent" "Read" "Grep" "Glob" "Write" "Bash(git *)" "Bash(node *)"
```

Trên Windows mà chạy từ Git Bash thì thêm `MSYS_NO_PATHCONV=1` ở đầu lệnh.

### E4. Dọn run cũ

`.ai-runs/` không vào git và có thể xóa bất cứ lúc nào. Chỉ giữ lại những run bạn còn muốn đối chiếu.

---

## F. Tri thức và guard

### F1. Hiểu code với `/ai-explain`

```
/ai-explain luồng huỷ đơn hàng cộng lại tồn kho như thế nào?
```

`ai-explainer` trả lời trực tiếp trước, sau đó đi qua từng bước trong code, mỗi bước kèm `path:line`, rồi tới các điểm dễ vấp và những gì nó **chưa kiểm tra**. Agent này không sửa file nào.

### F2. Ghi tri thức dự án với `/ai-learn`

Cần khai thư mục tri thức một lần trong `project.yaml`, rồi chạy `build`:

```yaml
knowledge: docs/knowledge
```

Từ đó **mọi agent** được dặn đọc `docs/knowledge/INDEX.md` trước khi làm việc. Sau một lần chạy đáng nhớ, gọi:

```
/ai-learn .ai-runs/20261021-1520-feature-money-receipt
/ai-learn cache đơn hàng phải xoá sau mỗi lần ghi, nếu không màn danh sách hiển thị dữ liệu cũ
```

`ai-scribe` cách làm việc:
- Chỉ giữ những gì còn đúng và còn có ích lâu dài: cách hệ thống hoạt động, lý do của một quyết định, quy ước không hiển nhiên từ code, cạm bẫy.
- Đối chiếu từng điều với code trước khi ghi.
- Mỗi chủ đề một file. Cập nhật file cũ thay vì tạo file trùng, và giữ `INDEX.md` luôn khớp.
- Chỉ sửa trong thư mục tri thức.

Báo cáo của `/ai-feature`, `/ai-bugfix` và `/ai-explain` sẽ gợi ý `/ai-learn` khi có điều đáng ghi lại.

### F3. Guard: chặn cứng những việc không được làm

Guard là **hook** của Claude Code: nó từ chối lệnh sửa file **trước khi** lệnh chạy, kể cả khi lệnh đó đến từ agent con. Guard mặc định tắt, bật trong `project.yaml`:

```yaml
scope: [lib/features/orders]                 # chỉ được sửa trong vùng này
enable:
  policies: [protect-generated, no-secrets]
```

| Guard | Chặn | Tùy chỉnh |
|---|---|---|
| `scope` | Sửa file ngoài các đường dẫn trong `scope`. `.ai-runs/` và thư mục tri thức luôn được phép. `/ai-review` mặc định chỉ soát vùng này | Khai bằng `scope:` (xem [PARTIAL.md](PARTIAL.md)) |
| `protect-generated` | Sửa file sinh tự động: `*.g.dart`, `*.freezed.dart`, `*.pb.go`, `generated/`… | `policies.protect-generated.config.patterns` |
| `no-secrets` | Ghi AWS/GitHub/Slack/Google/Stripe key, private key, chuỗi dài gán cho `password`/`api_key`… vào file. Placeholder như `your-key` hay `process.env.X` vẫn được phép | `policies.no-secrets.config.ignore` |

Ngoài việc chặn, mỗi guard còn thêm một dòng vào mục "Project rules" trong prompt của mọi agent, để agent tránh từ đầu chứ không đợi tới lúc bị chặn. Hook và quyền do build tự đăng ký trong `settings.local.json`.

> Guard chỉ bắt các công cụ sửa file. Lệnh shell (`sed -i`, `echo >`) không đi qua guard.

---

## G. Hệ thống ngoài và pack

### G1. Tra cứu bên ngoài với `ai-researcher`

```
Dùng agent ai-researcher kiểm tra: bản mobile_scanner dự án đang dùng có lỗi camera
đen trên Android 14 không, và cách sửa được khuyến nghị.
```

Researcher trước hết xem dự án đang dùng **phiên bản nào** (đọc file manifest và lock), rồi ưu tiên nguồn gốc: tài liệu chính thức, changelog, issue tracker. Mỗi kết luận đều kèm nguồn và ngày; chỗ nào các nguồn mâu thuẫn thì nó báo ra. Nội dung tải về được coi là **dữ liệu**, nó không làm theo bất kỳ chỉ dẫn nào nằm trong đó.

### G2. Làm từ ticket, thiết kế, tài liệu của team

Cách nhanh nhất là gõ **`/stack tools`**. Skill hỏi team bạn dùng tracker, công cụ thiết kế, kênh chat, nơi để tài liệu, nơi chứa code/CI và theo dõi lỗi nào. Sau đó nó bật integration có sẵn, sinh integration mới từ MCP server đang kết nối (chỉ quyền đọc, bạn duyệt từng tool), hoặc cho phép sẵn lệnh CLI chỉ đọc. Nó **không gọi thử** hệ thống nào của bạn.

Ví dụ làm tay với tracker Zentao (integration có sẵn trong stack). Bật một lần trong `project.yaml`, rồi `build`:

```yaml
enable:
  integrations: [zentao]
```

Từ đó analyst, architect, investigator, researcher và explainer **đọc được** ticket (đã cho phép sẵn, không bị hỏi quyền). Chỉ cần nhắc ticket trong lệnh:

```
/ai-feature task #45
/ai-bugfix bug #123
```

Analyst đọc task (kèm comment và file đính kèm) để viết spec; investigator đọc bug để tìm nguyên nhân. Mặc định **không agent nào được ghi** lên Zentao. Muốn cấp quyền ghi cho một role:

```yaml
integrations:
  zentao:
    grants:
      builder: [read, write]
```

Tool ghi không bao giờ được cho phép sẵn, nên mỗi lần ghi Claude Code vẫn hỏi bạn. Tool xóa thì không có trong danh sách.

### G3. Dự án Flutter: `packs: [flutter]`

```yaml
packs: [flutter]
```

| Thêm gì | Chi tiết |
|---|---|
| `ai-verifier-flutter` | Soát lifecycle (dispose, `mounted` sau `await`), rebuild, state (emit sau close), lỗi async, platform, layout. Chạy cùng 3 verifier kia trong `/ai-review` và `/ai-feature` |
| Builder | `flutter-practices` (tránh lỗi từ lúc viết) và `flutter-checks` (`build_runner` → `flutter analyze` → `flutter test`) |
| Guard | Bật sẵn `protect-generated` (`*.g.dart`, `*.freezed.dart`…) |
| Quyền | Cho phép sẵn `flutter analyze`, `flutter test`, `dart run build_runner build` |

Muốn bỏ một phần thì khai trong `project.yaml`, ví dụ `enable: { policies: ['-protect-generated'] }` hay `roles: { builder: { traits: ['-flutter-checks'] } }`. Dự án dùng fvm/melos thì trait `flutter-checks` tự dùng lệnh bọc ngoài đó.

---

## Mẹo

- **Context tốt thì kết quả tốt.** Agent đọc `context` và các file trong `read_first` của `project.yaml`. Review hay báo sai quy ước thì kiểm tra lại hai chỗ đó trước.
- **Dùng đúng agent.** Analyst và architect không sửa code; investigator và verifier chỉ đọc và chạy lệnh kiểm tra. Muốn sửa code thì luôn đi qua `ai-builder`.
- **Phạm vi nhỏ, rõ ràng.** Builder chỉ sửa file trong phạm vi được giao; phạm vi mơ hồ thì nó sẽ dừng lại hỏi (`blocked`). Đó là cách nó được thiết kế, không phải lỗi.
- **Không tin "done" một cách mù quáng.** Với thay đổi quan trọng, luôn kết thúc bằng `/ai-review` hoặc ít nhất một verifier.
