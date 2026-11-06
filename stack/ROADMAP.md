# Lộ trình ai-stack

Cập nhật: 2026-11-06 · kernel 1.3.0

## Trạng thái

| Giai đoạn | Trạng thái | Còn lại |
|---|---|---|
| **P0 – Lõi** | ✔ xong | Không còn gì |
| **P1 – Bộ tối thiểu** | ✔ xong | Không còn gì |
| **P2 – Tri thức & chính sách** | ✔ xong | Không còn gì |
| **P3 – Pack & integration** | Phần lớn xong | Ghi ngược lên Zentao, Figma, loại module `skill` |
| **P4 – Ổn định** | ✔ xong | Không còn gì |
| **P5 – Mở rộng** | ✔ xong | Retriever vector có sẵn (hiện đi qua MCP) |

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
- **P4 – ổn định (1.0.0):** `stack eval` (3 tình huống, baseline với sonnet: 3/3 pass, khoảng US$1.14), phiên bản từng module (`modules.lock.json`, `doctor` chặn khi sửa mà không tăng phiên bản), run state ghi thời điểm từng agent, lên 1.0.
- **P5 – mở rộng (1.1.0):** engine Workflow (`--workflow`), `stack run` + template GitHub Actions, `isolation: worktree`, retriever `index` (`stack search`).
  - Đã chạy thật: `/ai-review --workflow` headless (đủ lỗi, rẻ hơn engine skill); `stack run review` với quyền mặc định trả exit 1 kèm bảng finding.
  - Eval chạy lại sau P5 bắt được 2 vấn đề: `run.yaml` nhiều cấp bị ghi sai YAML (đã sửa protocol, trình chấm không crash nữa), và kỳ vọng regex chỉ tiếng Anh bỏ sót một finding đúng viết bằng tiếng Việt (thêm kỳ vọng `line:`). Chạy lại: 3/3 pass, ghi làm baseline mới.
  - Chạy thật lộ ra: đường dẫn 8.3 trên Windows làm Claude Code chặn mọi lệnh ghi (đã dùng đường dẫn đầy đủ); `date` bị từ chối nên timestamp bị đoán (đã cho phép).
- **Tài liệu:** INSTALL (máy mới), INTEGRATE (dự án có sẵn), USAGE (theo tình huống), EXTEND (bộ agent/skill riêng), PARTIAL (chỉ phụ trách một phần repo, kèm hook mẫu `templates/hooks/scope-guard.mjs`, đã chạy thử trong Claude Code).

- **Dùng thật và đo (1.3.0):** `stack stats` trên 5 dự án (`anhDung`, `event_notice`, `git_tools`, `assistant`, `tbchat_CS_Fav`), 32 run từ 2026-10-20 đến 2026-11-05:
  - Dùng: `feature` 13 run, `explain` 10, `bugfix` 4, `learn` 1, `review` riêng chỉ 1 (review chủ yếu chạy bên trong `feature`), memory bank và maps chưa dùng. 3 run "adhoc-builders" tự dựng để sửa nốt minor → thêm flow `fix`.
  - Tin cậy: 259 handoff, 0 handoff hỏng. 4 run treo ở `waiting`: một plan 98 unit có unit `agent: human` (UAT) giữa các giai đoạn (→ architect 0.2.0 chia theo giai đoạn), một run mở khi agent chưa được nạp vào phiên (→ protocol), hai run không có ghi chú (→ bắt buộc `note`).
  - Review (14 run): 226 finding thô, chỉ 6 critical/major (4 critical bắt được ở `tbchat … select-folder-sheet-ui`, vòng sửa xử lý hết); adversarial bác 14; 25 giữ ở `Pre-existing`. Phần lớn còn lại là minor/info.
  - Chi phí (mọi run chạy Opus vì `model: inherit`): builder chiếm 56% output token của subagent, investigator 15%, architect 8%; mỗi verifier chỉ 2–4%. `feature` khoảng 550k output token mỗi run, `explain` khoảng 14k. Investigator được gọi thẳng 28/33 lần, ngoài flow.
  - Code: run có sửa file thì file đều đã được commit (17 run, tính cả submodule) hoặc còn chưa commit (2 run của `assistant`), không run nào bị bỏ.
  - Còn thiếu: chưa có feedback của người dùng (0/32 run được chấm) → từ 1.3.0 flow tự hỏi cuối báo cáo.

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
- [x] `stack eval`: bộ tình huống mẫu, chấm điểm, so với baseline
- [x] Semver cho từng module (`modules.lock.json`, `stack versions`)
- [x] Run state ghi thời điểm bắt đầu và kết thúc của từng bước và từng agent
- [x] Lên 1.0

### P5 – Mở rộng
- [x] Engine Workflow (`--workflow`) và `stack run` cho CI (Agent SDK không cần: `claude -p` đã đủ cho chạy không người)
- [x] `isolation: worktree` cho builder chạy song song (giới hạn: chỉ khi các unit không phụ thuộc nhau)
- [x] Retriever `index` (BM25, `stack search`); [ ] retriever vector có sẵn (hiện dùng MCP server qua integration)

## Nợ kỹ thuật

- [ ] Đường dẫn CLI trong skill sinh ra là đường dẫn tuyệt đối, nên mỗi máy build ra file khác nhau. Có khóa `cli` để ghi đè; nếu team dùng chung thì cần phân phối CLI qua npm hoặc plugin.
- [x] ~~Chưa áp dụng vào dự án thật nào.~~ Đã dùng trên 5 dự án, đo bằng `stack stats` (1.3.0).
- [x] ~~Chưa commit.~~
- [ ] Chưa có feedback của người dùng: cần vài tuần trả lời câu hỏi cuối báo cáo để biết tỉ lệ run dùng được và finding sai.
- [ ] `stack stats` chưa tính token của phiên điều phối (chỉ subagent) và chưa quy ra tiền.

## Thứ tự đề xuất tiếp theo

1. Thu feedback 2–4 tuần trên các dự án đang dùng, rồi chạy `stack stats` để quyết: flow nào giữ, flow nào bỏ, finding loại nào nhiễu
2. Thử `model` riêng cho builder (ví dụ `sonnet` cho unit đơn giản) và so token/chất lượng bằng `stack stats` + feedback
3. Áp ai-stack lên `kho/` thật bằng `/stack` (giờ có bước hỏi công cụ team dùng), chờ duyệt
4. Phần P3 còn lại: ghi ngược lên tracker (chờ quyết thiết kế), loại module `skill`
5. Thêm tình huống eval cho `feature` (foreach + loop), pack `flutter` và `fix`

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
