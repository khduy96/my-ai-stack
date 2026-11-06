# Hướng dẫn sử dụng theo tình huống

Áp dụng cho stack 1.3. Dự án phải đã được tích hợp (xem [INTEGRATE.md](INTEGRATE.md)).

Hiện có:
- **11 flow chạy tự động:** `/ai-review`, `/ai-feature`, `/ai-bugfix`, `/ai-fix`, `/ai-explain`, `/ai-learn`, `/ai-knowledge-audit`, `/ai-memory-init`, `/ai-memory-update`, `/ai-map-init`, `/ai-map-update`.
- **16 agent gọi riêng lẻ:** `ai-analyst`, `ai-architect`, `ai-builder`, `ai-builder-tests`, `ai-investigator`, `ai-explainer`, `ai-scribe`, `ai-archivist`, `ai-cartographer`, `ai-researcher`, `ai-verifier` và 5 `ai-verifier-*`. Pack có thể thêm, ví dụ `ai-verifier-flutter`.
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
| Sửa nốt vài finding còn mở sau một run | `/ai-fix <thư mục run> [F2 F3]` | D4 |
| Hiểu một đoạn code hoạt động thế nào | `/ai-explain <câu hỏi>` | F1 |
| Ghi lại tri thức dự án sau một lần chạy | `/ai-learn <thư mục run>` | F2 |
| Rà tri thức dự án với code hiện tại | `/ai-knowledge-audit [vùng]` | F2 |
| Tạo memory bank cho dự án mới hoặc dự án có sẵn | `/ai-memory-init` | F4 |
| Cập nhật memory bank sau khi làm xong việc | `/ai-memory-update` | F4 |
| Tạo code map (project map + repo map) | `/ai-map-init [module]` | F5 |
| Map thêm một module, hoặc làm mới map sau khi code đổi | `/ai-map-update [module]` | F5 |
| Chặn sửa ngoài vùng, file generated, lộ secret | `scope`, `enable.policies` | F3 |
| Tra tài liệu thư viện, changelog, lỗi đã biết | `ai-researcher` | G1 |
| Cho agent đọc ticket, thiết kế, tài liệu của team | `/stack tools`, rồi `/ai-feature SHOP-123` | G2 |
| Dự án Flutter | `packs: [flutter]` | G3 |
| Chạy tiếp một lần review bị dừng | `/ai-review --resume …` | E1 |
| Chạy review không cần người (script, CI) | `stack run review …` | E3 |
| Chạy tất định, không hỏi giữa chừng | `/ai-<flow> --workflow` | E5 |
| Đo stack trên dự án thật: dùng gì, tốn bao nhiêu, có ích không | `stack stats` | E6 |

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

**Cho builder chạy trên worktree riêng** (các unit song song có thể sửa cùng file):

```yaml
flows:
  feature:
    steps:
      build: { isolation: worktree }
```

Mỗi unit chạy trên một git worktree riêng; xong đợt thì các thay đổi được áp về cây làm việc (`git apply --3way`), **không commit**, và dừng lại báo bạn nếu có xung đột. Worktree tạo từ commit hiện tại, nên chỉ dùng được khi **không unit nào phụ thuộc unit khác**; có phụ thuộc thì tự chạy như bình thường.

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

### D4. Sửa nốt finding còn mở với `/ai-fix`

Sau `/ai-feature`, `/ai-bugfix` hay `/ai-review`, báo cáo đánh số các finding `F1`, `F2`… (lưu ở `<run>/report.md`). Muốn sửa luôn vài cái mà không mở một run `feature` mới:

```
/ai-fix .ai-runs/20261024-1759-feature-deadline-done-action            # mọi finding critical, major, minor đã xác nhận
/ai-fix .ai-runs/20261024-1759-feature-deadline-done-action F2 F5      # chỉ F2 và F5
/ai-fix .ai-runs/20261024-1759-feature-deadline-done-action major      # chỉ critical và major
/ai-fix giờ hệ thống lùi thì nút "Đồng bộ ngay" khoá quá 30 giây, sync_controller.dart:197
```

| Bước | Agent | Làm gì |
|---|---|---|
| 1. `fix` | `ai-builder` | Đọc finding (evidence, detail) từ run, sửa từng cái bằng thay đổi nhỏ nhất, thêm test nếu dự án có sẵn bộ test |
| 2. `verify` | `ai-verifier-correctness` | Kiểm từng finding đã hết chưa và thay đổi có làm hỏng gì khác không |

Finding `Rejected:` hoặc `Pre-existing:` chỉ được sửa khi bạn gọi tên.

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

### E3. Chạy không cần người (script, CI, trước khi push) với `stack run`

```bash
node <stack>/kernel/cli/stack.mjs run review "origin/main...HEAD" --project . --fail-on major --summary review.md
```

| Exit code | Nghĩa |
|---|---|
| 0 | Xong, không có finding ở mức `--fail-on` trở lên |
| 1 | Có finding ở mức `--fail-on` trở lên (`critical` · `major` mặc định · `minor` · `none`) |
| 2 | Run không xong (lỗi, hoặc bị chặn quyền) |
| 3 | Đang chờ người (flow có cổng duyệt) |

- `stack run` chạy với **chỉ các quyền trong settings của dự án** (permission mode mặc định): những gì không được cho phép sẽ bị từ chối, không ai được hỏi. Lệnh kiểm tra của dự án mà verifier cần chạy thì khai trong `permissions` của `project.yaml`, ví dụ `['+Bash(npm test)']`.
- `--summary` ghi thêm bản tóm tắt Markdown (bảng finding, chi phí, báo cáo), dùng thẳng được cho `$GITHUB_STEP_SUMMARY`.
- **GitHub Actions:** copy `<stack>/templates/ci/github-actions-review.yml` vào `.github/workflows/`, sửa 3 chỗ đánh dấu, thêm secret `ANTHROPIC_API_KEY`.

### E5. Chạy tất định với `--workflow`

Bật engine Workflow trong `project.yaml`, rồi `build`:

```yaml
engines: [skill, workflow]
```

Từ đó mỗi flow có thêm một workflow (`.claude/workflows/ai-<flow>.js`). Gọi bằng:

```
/ai-review --workflow
/ai-feature --workflow thêm lọc đơn hàng theo trạng thái
```

| | Engine skill (mặc định) | Engine Workflow (`--workflow`) |
|---|---|---|
| Ai điều phối | Phiên chính, làm theo hướng dẫn | Script, chạy tất định |
| Dữ liệu giữa các bước | File trong `.ai-runs/` | Trong bộ nhớ; handoff kiểm tra bằng schema |
| Cổng duyệt | Dừng giữa chừng, hỏi bạn | Kết thúc với `waiting`; trả lời rồi chạy lại (agent đã xong được dùng lại) |
| Phù hợp | Làm việc hằng ngày, cần tương tác | Chạy dài, nhiều agent, ít cần hỏi |

Trên tình huống `review-planted`, engine Workflow tìm đủ lỗi với chi phí khoảng US$0.30, so với khoảng US$0.42 của engine skill.

### E4. Dọn run cũ

`.ai-runs/` không vào git và có thể xóa bất cứ lúc nào. Chỉ giữ lại những run bạn còn muốn đối chiếu. Run đã xóa thì `stack stats` (E6) không đếm được nữa, nên muốn đo lâu dài thì đừng xóa.

### E6. Đo stack trên dự án thật với `stack stats`

```bash
node <stack>/kernel/cli/stack.mjs stats                                   # dự án ở thư mục hiện tại
node <stack>/kernel/cli/stack.mjs stats D:/du-an-a D:/du-an-b --since 2026-11-01
node <stack>/kernel/cli/stack.mjs stats D:/du-an-a --json > stats.json    # từng run, để tự phân tích
```

Chỉ đọc, không gọi model, không sửa gì. Lấy dữ liệu từ ba nguồn:

| Nguồn | Cho biết |
|---|---|
| `.ai-runs/*/` (`run.yaml`, handoff, `report.md`, `feedback.yaml`) | Flow nào chạy, xong hay đang chờ (kèm lý do và lệnh `--resume`), thời gian agent, finding trước và sau bước adversarial, số câu hỏi |
| git của dự án (cả submodule) | File agent sửa đã được commit, vẫn chưa commit, hay bị bỏ |
| Transcript của Claude Code (`~/.claude/projects/`) | Token của từng subagent theo loại agent, gọi trong flow hay gọi thẳng; phiên điều phối không được tính |

**Chấm kết quả.** Cuối mỗi báo cáo, flow hỏi một dòng; trả lời ngay trong phiên là đủ, flow ghi vào `<run>/feedback.yaml`:

```
useful
partial, wrong F2 F5: F5 là hành vi cố ý
not-useful: plan chia sai tầng
```

Bỏ qua câu hỏi thì không có gì được ghi. `stack stats` cộng các câu trả lời lại: bao nhiêu run dùng được, bao nhiêu finding sai. Đây là số liệu duy nhất cho biết stack **có ích thật**, nên trả lời càng đều càng tốt.

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

**Tra cứu xếp hạng (`retriever: index`).** Khi thư mục tri thức lớn dần, khai:

```yaml
knowledge: { dir: docs/knowledge, retriever: index }
```

Agent sẽ tra bằng `stack search "<từ khóa>"`: xếp hạng BM25 trên tiêu đề, tag và nội dung, không phân biệt dấu (`đơn hàng` = `don hang`). Bạn cũng gọi được trực tiếp:

```bash
node <stack>/kernel/cli/stack.mjs search "cache đơn hàng" --project .
```

Đây là tìm theo từ khóa: câu hỏi phải **cùng ngôn ngữ** với tri thức (scribe ghi bằng tiếng Anh). Cần tìm theo ý nghĩa, xuyên ngôn ngữ, thì kết nối một MCP server tìm kiếm vector và khai integration cho nó (`/stack tools`).

**Rà soát định kỳ với `/ai-knowledge-audit`.** Code đổi thì tri thức cũ dần. Lệnh này đối chiếu thư mục tri thức với code hiện tại:

```
/ai-knowledge-audit                          # toàn bộ, file có `updated` cũ nhất trước (tối đa ~30 file mỗi lần)
/ai-knowledge-audit lib/features/payment     # chỉ các file có sources trỏ vào vùng này, ví dụ sau refactor
/ai-knowledge-audit docs/knowledge/upload-flow.md
/ai-knowledge-audit older than 90 days
```

1. `ai-verifier` (chỉ đọc) mở từng file, đi theo `sources` và các `path:line` được trích, so với code và `git log`, rồi báo findings tại đúng dòng trong file tri thức:
   - **major:** code giờ nói khác (hành vi đổi, thứ được nhắc đã bị xóa hoặc đổi tên, quyết định bị đảo).
   - **minor:** trích dẫn lệch dòng nhưng nội dung vẫn đúng; không còn xác nhận được từ code; hai file trùng chủ đề.
   - **info:** thiếu frontmatter; `INDEX.md` lệch với các file.
2. **Bạn duyệt.** Muốn bỏ finding nào thì nói, bước này chạy lại với ý kiến của bạn.
3. `ai-scribe` sửa theo findings đã duyệt: chỉnh câu sai, sửa trích dẫn, xóa hoặc đánh dấu `[?]` điều không còn xác nhận được, gộp chủ đề trùng, cập nhật `updated` và `INDEX.md`. File bị gộp mất chỉ bị xóa khi bạn đồng ý. Không commit.

Nên chạy sau mỗi đợt refactor lớn, mỗi sprint một lần, hoặc khi agent báo tri thức mâu thuẫn với code.

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

### F4. Memory bank với `/ai-memory-init` và `/ai-memory-update`

Memory bank là 6 file cố định giúp phiên làm việc sau biết ngay dự án là gì và đang ở đâu:

| File | Chứa | Cập nhật |
|---|---|---|
| `projectbrief.md` | Dự án là gì, cho ai, phạm vi được/không được sửa, mục tiêu, thuật ngữ | hiếm |
| `activeContext.md` | Ngày cập nhật, branch, đang làm gì, thay đổi gần đây, bước tiếp, cạm bẫy | mỗi lần |
| `systemPatterns.md` | Cấu trúc repo, layer, pattern phải theo, vùng cấm | khi cấu trúc đổi |
| `techContext.md` | Stack, phiên bản, lệnh build/test/codegen, biến môi trường (chỉ tên) | khi stack đổi |
| `decisions.md` | Mỗi quyết định: ngày, bối cảnh, quyết định, phương án đã loại, bằng chứng, trạng thái | khi có quyết định kiến trúc |
| `progress.md` | Đã xong (có ngày), đang làm, còn lại (kể cả TODO trong code), nợ kỹ thuật | mỗi lần |

Khai một lần trong `project.yaml`, rồi chạy `build`:

```yaml
memory_bank: memory-bank
```

Từ đó **mọi agent** được dặn đọc `projectbrief.md` và `activeContext.md` trước, các file còn lại khi task chạm tới.

**Dự án mới** (chưa có code): mô tả dự án ngay trong lệnh. `ai-archivist` viết `projectbrief.md` từ mô tả, ghi stack và cấu trúc dự kiến vào mục `Planned` (đánh dấu `[?]`), các lựa chọn đã chốt vào `decisions.md`, và hỏi lại những gì còn thiếu (mục đích, người dùng, stack):

```
/ai-memory-init App đặt lịch cắt tóc cho chuỗi salon nhỏ. Khách đặt qua app Flutter, chủ tiệm quản lý trên web Next.js, backend Supabase. Mục tiêu: ra MVP trong 6 tuần.
```

**Dự án có sẵn:** gọi không cần tham số, hoặc nêu vùng bạn phụ trách. Archivist khảo sát (chỉ đọc) README, CLAUDE.md, tài liệu, rule của công cụ AI khác, manifest, CI, cây thư mục, vài file tiêu biểu mỗi layer, `git log`, TODO trong code, rồi viết đủ 6 file, mỗi điều kèm nguồn; điều suy ra từ commit message mà chưa ai xác nhận thì đánh dấu `[?]`:

```
/ai-memory-init
/ai-memory-init chỉ tập trung vào lib/features/cloud_storage và lib/module_bridge, phần còn lại thuộc team khác
```

Nếu memory bank đã có, `memory-init` không ghi đè mà chuyển sang cập nhật. Cuối flow, nếu `CLAUDE.md` chưa nạp memory bank, bạn được đề nghị thêm khối `# Memory Bank` (dùng `@memory-bank/projectbrief.md`, `@memory-bank/activeContext.md`) để cả phiên thường, không qua agent `ai-*`, cũng đọc nó; và được hỏi memory bank dùng chung (commit) hay cá nhân (`.git/info/exclude`).

**Sau mỗi việc đáng kể:**

```
/ai-memory-update
/ai-memory-update .ai-runs/20261021-1520-feature-money-receipt
/ai-memory-update quyết định: không thêm gói DAY, chỉ MONTH và YEAR
```

Archivist đọc git từ ngày cập nhật trước, làm mới `activeContext.md` và `progress.md`, chỉ thêm vào `decisions.md` khi có lựa chọn kiến trúc, chỉ đụng tới 3 file còn lại khi cấu trúc hay stack thực sự đổi, rồi cho bạn xem diff. Không bao giờ commit.

Quy tắc chung: tiếng Anh (dành cho agent; đổi bằng `context`), mỗi file dưới 150 dòng, không ghi điều code đã nói rõ, không ghi giá trị secret.

**Memory bank hay knowledge?** Knowledge (F2) là tri thức lâu dài theo chủ đề, mỗi chủ đề một file. Memory bank là ảnh chụp toàn dự án với cấu trúc cố định, gồm cả trạng thái hiện tại. Dùng cả hai được: điều đáng giữ lâu trong `activeContext.md` thì đưa sang knowledge bằng `/ai-learn`.

### F5. Code map với `/ai-map-init` và `/ai-map-update`

Code map giúp agent (và người) đi thẳng tới đúng file thay vì tìm khắp repo. Có hai loại, mỗi loại một file index và một file cho mỗi module:

| | Project map | Repo map |
|---|---|---|
| Trả lời | "Tính năng X nằm đâu, ai gọi nó?" | "Đổi X thì vỡ gì?" |
| Index | `PROJECT_MAP.md`: mỗi module một mục với từ khóa (tiếng Việt + tiếng Anh), cộng mục "Not mapped" | `REPO_MAP.md`: mỗi module một mục với entry point và số lời gọi từ module khác |
| Theo module | `<module>.MAP.md`: theo tính năng: UI, state, repository, API, DB, text, **được gọi từ**, **phụ thuộc**, bẫy; bảng public API; bảng triệu chứng → chỗ xem | `<module>.REPO.MAP.md`: tổng quan và quy ước, luồng `Page → State → UseCase → Repository` kèm symbol, bảng **INBOUND / OUTBOUND** có cột rủi ro (⛔ = import vượt ranh giới), DI/router/vòng đời, file generated và lệnh sinh |
| Đường dẫn | ngắn, tính từ module | đầy đủ, tính từ gốc repo |

Khai một lần trong `project.yaml`, rồi chạy `build`:

```yaml
maps: maps
```

Từ đó **mọi agent** được dặn đọc `maps/PROJECT_MAP.md` trước khi tìm code, đọc repo map của module trước khi đổi signature hay thứ module khác gọi tới, và báo khi thay đổi của nó cần làm mới map.

**Dự án mới** (chưa có code): mô tả các module dự kiến ngay trong lệnh. `ai-cartographer` chỉ tạo hai file index, ghi module dự kiến vào mục `Planned` (đánh dấu `[?]`) cùng quy ước đặt tên, chưa tạo map chi tiết:

```
/ai-map-init App đặt lịch salon: module booking (lib/features/booking), salon (lib/features/salon), payment (lib/features/payment), auth dùng chung ở lib/core/auth
```

**Dự án có sẵn:** nêu module muốn map trước, hoặc để trống (khi đó map vùng `scope`; repo nhỏ thì map hết; repo lớn mà không có scope thì cartographer hỏi nên map module nào trước). Hai file index luôn liệt kê **mọi** module, module chưa map nằm ở "Not mapped":

```
/ai-map-init lib/features/cloud_storage
/ai-map-init
```

**Mở rộng dần từng module và giữ map đúng với code:**

```
/ai-map-update lib/features/im          # map thêm một module (rút khỏi "Not mapped")
/ai-map-update cloud_storage            # map lại toàn bộ một module
/ai-map-update                          # làm mới mọi map từ git diff kể từ commit ghi ở đầu map
/ai-map-update .ai-runs/20261021-1520-feature-money-receipt
```

Cách cartographer làm: mọi đường dẫn đều được kiểm tra là có thật; "được gọi từ", số lời gọi và bảng INBOUND lấy từ tìm kiếm toàn repo, không đoán; ⛔ chỉ đánh khi rule của dự án cấm; điều chưa xác nhận đánh `[?]`; ngày và commit lấy từ shell. Map lớn quá ~400 dòng thì tách theo vùng (`<module>.<vùng>.MAP.md`). Ngôn ngữ nhãn giữ theo map đang có, map mới theo `context` của dự án; từ khóa luôn có cả hai thứ tiếng. Cuối `map-init`, nếu `CLAUDE.md` chưa nhắc tới maps, bạn được đề nghị thêm khối `# Code maps` (dùng `@maps/PROJECT_MAP.md`) để phiên thường cũng đọc map, và được hỏi map dùng chung (commit, nên chọn) hay cá nhân.

**Map, memory bank hay knowledge?** Map trả lời *ở đâu* và *đụng tới gì* trong code. Memory bank trả lời *dự án đang ở đâu*. Knowledge trả lời *vì sao* và *cạm bẫy* theo chủ đề. Ba thứ bổ sung cho nhau.

Hướng dẫn đầy đủ (thiết lập, dùng hằng ngày, khi nào cập nhật, sửa tay, lỗi thường gặp): [MAPS.md](MAPS.md).

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
