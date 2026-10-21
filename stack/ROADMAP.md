# Lộ trình ai-stack

Cập nhật: 2026-10-21 · kernel 0.6.1

## Trạng thái

| Giai đoạn | Trạng thái | Còn lại |
|---|---|---|
| **P0 – Lõi** | ✔ xong | Không còn gì |
| **P1 – Bộ tối thiểu** | ✔ xong | Không còn gì |
| **P2 – Tri thức & chính sách** | ✔ xong | Không còn gì |
| **P3 – Pack & integration** | Phần lớn xong | Ghi ngược lên Zentao, Figma, loại module `skill` |
| **P4 – Ổn định** | Mới có test cho kernel | Eval cho agent và flow, lên 1.0 |
| **P5 – Mở rộng** | Chưa làm | Engine khác, vector RAG |

## Đã xong

- **P0:** contracts, conventions, CLI `build` / `doctor`, lock file chống ghi đè, cascade core → pack → project → local.
- **P1 – role/trait (0.2):** 5 role (`analyst`, `architect`, `builder`, `investigator`, `verifier`), 8 trait, variants, `produces` kèm các contract `spec`, `plan` và `diagnosis`.
- **P1 – flow `review` (0.3):** loại module `flow` (`agent`, `fanout`, `when`, `gate`), skill engine, lệnh `stack check`, run state ở `.ai-runs/`.
  - Đã chạy end-to-end trên repo demo: tìm ra đủ 4 lỗi cài sẵn và thêm 1 lỗi thật; cả 4 handoff đều hợp lệ.
- **P1 – flow `feature` và `bugfix` (0.4):** bước `foreach` (chia đợt theo `depends_on`, song song khi không chung file), `loop` (`max`, `until`), input dạng list "mới nhất đang có", quy tắc tham chiếu giữa các vòng lặp.
  - Đã chạy end-to-end trên repo demo:
    - `/ai-feature` với plan 3 unit, có phụ thuộc: cả 3 unit xong, 9 handoff hợp lệ; cơ chế sửa handoff hỏng (YAML sai) đã chạy thật.
    - `/ai-bugfix`: chạy được cả vòng loop `retry/1/…`; `--resume` tiếp tục được một run đang chờ câu trả lời.
  - Chạy thật phát hiện verifier gắn `major` cho lỗi có sẵn từ trước, khiến vòng sửa đụng code ngoài phạm vi. Đã sửa (verifier 0.2.0): lỗi có sẵn chỉ ở mức `info` "Pre-existing:". Chạy lại thì diff chỉ còn đúng chỗ cần sửa.
  - Chưa kiểm chứng riêng được thứ tự chạy song song trong một đợt của `foreach` (run state không ghi thời điểm từng agent bắt đầu).
- **P1 – skill `/stack` (0.4.1):** `stack install` cài skill vào `~/.claude/` (lock riêng). Skill khảo sát repo, hỏi những gì còn thiếu, chờ duyệt, rồi ghi file, build và chạy doctor; tự áp dụng cách làm của PARTIAL.md khi chọn "cá nhân" hoặc "một phần".
  - Đã chạy end-to-end trên một repo Node mới: `project.yaml` đúng, `npm test` vào builder và verifier, `git status` sạch, doctor 0 lỗi.
  - Chạy headless thì việc ghi vào `.claude/` và `.git/` bị từ chối (thư mục được bảo vệ); skill dừng lại và báo rõ, không tìm đường vòng.
- **P2 – tri thức và chính sách (0.5):** loại module `policy` (rule, guard hook, override, permissions), `scope: [paths]`, settings do build quản lý (lock ghi đúng các mục build thêm), `knowledge: <dir>`, role `scribe` và `explainer`, flow `/ai-learn` và `/ai-explain`, trait `test-first`, `test-author`, `lens-performance` (variant `ai-builder-tests`, `ai-verifier-performance`).
  - Đã chạy thật trong Claude Code: 3 guard chặn đúng (file generated, AWS key, ngoài scope); `/ai-explain` trả lời có `path:line` và không sửa file; `/ai-learn` tạo `INDEX.md` cùng 2 file tri thức đã đối chiếu với code.
  - Chạy thật lộ ra 2 quy tắc quyền sai (`Write(...)` bị Claude Code bỏ qua khi kiểm tra ghi file; `Bash(node *…)` khớp quá rộng). Đã sửa sang `Edit(...)` và đúng lệnh CLI, rồi kiểm chứng lại không cần cấp thêm quyền.
  - Test phát hiện `test-first` của dự án xung đột với variant `tests`; variant giờ tự bỏ `test-first`.
- **P3 – pack và integration (0.6):** `defaults` cho pack, pack `flutter`, loại module `integration` với `zentao` (chỉ đọc), role `researcher`, step `external`, khóa `permissions`.
  - Chạy `/ai-review` với pack `flutter` trên commit thật `b6a9e53` của `kho` (bản clone, repo thật không bị đụng): 5 handoff hợp lệ, 7 finding minor có giá trị, adversarial hạ 2 mức và bác 4 finding sai (kể cả số dòng không tồn tại).
  - Lần chạy đó lộ ra `git show`/`flutter test` bị từ chối → thêm vào quyền do build quản lý. Lần thử Zentao lộ ra tool MCP cần được cho phép trước → thêm `allow` cho integration (chỉ nhóm đọc).
- **`/stack` hỏi công cụ team dùng (0.6.1):** bước 4 và mode `/stack tools`; danh mục 6 loại (tracker, thiết kế UI, chat, tài liệu, code/CI, theo dõi lỗi) trong `tools-catalog.yaml`. Không tự suy ra công cụ từ những gì đang kết nối, không gọi tool ngoài khi setup.
  - Đã chạy thật với một team giả định (GitHub Issues qua gh, Figma, Slack, docs trong repo, GitHub Actions): 0 lệnh gọi MCP; không bật Zentao dù đang kết nối; sinh `.ai/integrations/figma.yaml` (12 tool đọc, 8 tool ghi không cấp cho ai); `gh` chỉ đọc được cho phép sẵn; Slack ghi vào context kèm hướng dẫn kết nối.
- **Tài liệu:** INSTALL (máy mới), INTEGRATE (dự án có sẵn), USAGE (theo tình huống), EXTEND (bộ agent/skill riêng), PARTIAL (chỉ phụ trách một phần repo, kèm hook mẫu `templates/hooks/scope-guard.mjs`, đã chạy thử trong Claude Code).

## Còn lại

### P1 – Bộ tối thiểu
- [x] Flow `feature`, cùng kernel `foreach` và `loop`
- [x] Flow `bugfix`
- [x] Skill `/stack`: hỏi đáp về dự án → viết `project.yaml` → `stack build` (cài bằng `stack install`)

### P2 – Tri thức & chính sách
- [x] Knowledge: `knowledge: <dir>` + `INDEX.md`, tra cứu bằng grep
- [x] Role `scribe` và `explainer`, flow `/ai-learn` và `/ai-explain`
- [x] Policy: rule (gợi ý) và guard (hook bắt buộc); `scope`, `protect-generated`, `no-secrets`; settings do build quản lý
- [x] Khóa `scope: [paths]`
- [x] Trait: `test-first`, `test-author`, `lens-performance`

### P3 – Pack & integration
- [x] Pack đầu tiên: `flutter` (đã chạy thật trên bản clone của `kho/`)
- [x] Integration `zentao` (đọc ticket); [ ] ghi ngược lên Zentao (comment, trạng thái): **chờ quyết định** vì là hành động ra bên ngoài
- [ ] Integration Figma (cần skill của Figma MCP được nạp trước khi dùng tool)
- [x] Role `researcher`
- [x] Flow gọi được agent viết tay: `external: true`
- [ ] Loại module `skill` (skill một bước, không phải flow)
- [x] **Mốc nghiệm thu:** `kho` (dự án thứ hai, Flutter) chạy được chỉ bằng `project.yaml` + pack, không sửa core cho riêng nó

### P4 – Ổn định
- [ ] `stack eval`: bộ tình huống mẫu (kiểu repo demo có lỗi cài sẵn) để phát hiện khi prompt làm agent kém đi
- [ ] Semver cho từng module
- [ ] Run state ghi thời điểm bắt đầu và kết thúc của từng agent, để kiểm chứng được thứ tự và mức song song
- [ ] Lên 1.0, để `^1` nhận được các bản thêm tính năng mà không phải sửa `kernel:` ở mọi module

### P5 – Mở rộng
- [ ] Engine Workflow (chạy tất định, không cần người) và engine Agent SDK (CI, cron)
- [ ] `isolation: worktree` cho builder chạy song song
- [ ] Retriever vector (MCP)

## Nợ kỹ thuật

- [ ] Đường dẫn CLI trong skill sinh ra là đường dẫn tuyệt đối, nên mỗi máy build ra file khác nhau. Có khóa `cli` để ghi đè; nếu team dùng chung thì cần phân phối CLI qua npm hoặc plugin.
- [ ] Chưa áp dụng vào dự án thật nào.
- [ ] Chưa commit.

## Thứ tự đề xuất tiếp theo

1. Áp ai-stack lên `kho/` thật (kế hoạch đã soạn, giờ thêm `packs: [flutter]`), chờ duyệt
2. Quyết thiết kế ghi ngược lên Zentao; sau đó Figma, loại module `skill`
3. P4: eval, semver từng module, lên 1.0

## Các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Hướng đi | Xây mới từ đầu, không kế thừa các bộ `ms-*` / `cs-*` cũ |
| Nguyên tắc | Lõi nhỏ + module; hợp đồng ổn định, phần cài đặt thay được; khai báo thay vì lệnh; cascade; chỉ xây khi cần |
| Công cụ | Phương án C: CLI Node làm phần tất định, skill bọc ngoài để hỏi đáp |
| Định dạng | Module dạng prompt là `.md` + frontmatter; module dạng cấu hình là `.yaml` |
| Tên agent | Prefix `ai-` |
| Role P1 | analyst, architect, builder, verifier, investigator |
| Chuyên biệt hóa | Variants (role + trait thành agent riêng), không truyền lens lúc chạy |
| Output | Role khai `produces`; kết quả đặt trong `handoff.output` theo contract |
| Engine flow | A: skill engine, kiểm tra handoff bằng `stack check` |
| Run state | `.ai-runs/` ở gốc dự án, gitignore; nằm ngoài `.claude/` vì Claude Code hỏi quyền mỗi lần ghi vào đó |
| Cổng mặc định | spec: `on-questions` · plan: `human` · investigate: `on-questions` · fix loop tối đa 2 vòng |
| Song song | `isolation: none` có kiểm tra trùng file; `worktree` để sau |
| Flow đầu tiên | `review` trước, `feature` và `bugfix` sau |
