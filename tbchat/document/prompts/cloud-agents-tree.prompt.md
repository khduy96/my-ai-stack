# Xây cây subagent cho cloud_storage + module_bridge

## Mục tiêu
Tạo một **cây subagent Claude Code** cho dự án: một lệnh điều phối `/team <việc>` ở gốc, giao việc
cho 9 agent chuyên môn trong `.claude/agents/`, dùng được cho cả 4 loại việc — **code tính năng
mới, fix bug, review code, giải thích code**.

## Bối cảnh
- App Flutter, repo `D:\nexsoft\tbchat_CS_Fav`. Chỉ làm trong 2 module:
  - `lib/features/cloud_storage` (CS) — chia lớp `domain/` · `data/` · `application/` ·
    `model_view/` · `pages/` + `transponder/` · `shared/`.
  - `lib/module_bridge` (MB) — cầu nối giữa các feature (vd `lib/module_bridge/cloud_storage/`).
- Luật lớp: `.claude/_rule/cloud/layer-rules.md` (nguồn gốc: `lib/features/cloud_storage/tool/check_layers.dart`
  — khác nhau thì **script đúng**). Kiểm tra bằng `dart lib/features/cloud_storage/tool/check_layers.dart --summary`.
- Data layer có 2 nhánh backend: `data/_grpc` = **BE VN**, `data/native_handle` = **BE HK**.
- Đã có sẵn các skill trong `.claude/skills/` (`/task`, `/agents-plan`, `/agents-ba`, `/add-l10n`,
  `/build`, `/analyze-cloud`, `/check-layers`, `/create-usecase`…). Đọc chúng để học quy ước,
  nhưng **không sửa** — cây agent này đứng riêng.
- Chưa có `.claude/agents/` và chưa có `CLAUDE.md` ở gốc repo.
- Giới hạn kỹ thuật của Claude Code: **subagent không gọi được subagent khác** → việc điều phối
  phải chạy ở phiên chính, qua skill `/team`.

## Yêu cầu

### 1. Skill điều phối — `.claude/skills/team/SKILL.md` (+ `USAGE.md` tiếng Việt)
`/team <việc>` chạy ở phiên chính:
1. **Phân loại** việc: `feature` · `bug` · `review` · `explain` (không chắc → hỏi người dùng).
2. **Định tuyến:**
   - `explain` → `cs-explainer` → trả lời.
   - `review` → `cs-reviewer` → báo cáo phát hiện.
   - `bug` → `cs-debugger` tìm nguyên nhân + đề xuất cách sửa → trình kế hoạch → **chờ "code đi"**
     → agent code theo lớp → `cs-reviewer`.
   - `feature` → `cs-planner` lập kế hoạch (wave, agent nào, file nào) → trình kế hoạch →
     **chờ "code đi"** → chạy agent code theo wave → `cs-reviewer`.
3. **Thứ tự wave mặc định khi code:** `cs-domain` → (`cs-data` ∥ `cs-bridge`) →
   `cs-presentation`; `cs-l10n` chạy song song bất kỳ lúc nào. Agent cùng wave chạy song song,
   **mỗi file chỉ thuộc đúng 1 agent** trong một wave.
4. **Bước tích hợp** (phiên chính làm, không giao subagent): `/add-l10n` nếu có chuỗi mới,
   `/build -get` / `/build -obj` nếu đổi DI / entity, `/analyze-cloud`, `check_layers.dart --summary`.
   Lỗi analyzer chặn build → sửa bằng giá trị mặc định an toàn + `// TODO`, không hỏi.
5. **Báo cáo cuối** bằng tiếng Việt: file đã đổi, TODO, kết quả analyze + layer check.

### 2. Chín agent — mỗi agent một file `.claude/agents/<name>.md`

| Agent | Vai trò | Được sửa | Tools |
|---|---|---|---|
| `cs-planner` | Phân tích yêu cầu → kế hoạch: wave, agent, file sở hữu, rủi ro | không | Read, Grep, Glob |
| `cs-debugger` | Truy bug qua các lớp → nguyên nhân gốc + đề xuất sửa (file:line) | không | Read, Grep, Glob, Bash |
| `cs-reviewer` | Review diff: layer rules, bug, null-safety, quy ước dự án; chạy analyze/layer check | không | Read, Grep, Glob, Bash |
| `cs-explainer` | Giải thích luồng (upload, download, favorite…), API, kiến trúc; trích `file:line` | không | Read, Grep, Glob |
| `cs-domain` | `domain/` (entities, `repositories/` interface, use cases) + `application/` | có | Read, Grep, Glob, Edit, Write |
| `cs-data` | `data/` — repository impl, datasource, mapper, cả `_grpc` (VN) và `native_handle` (HK) | có | Read, Grep, Glob, Edit, Write, Bash |
| `cs-presentation` | `pages/`, `transponder/`, `model_view/`, `shared/widgets`, `shared/presentation`, routes | có | Read, Grep, Glob, Edit, Write |
| `cs-bridge` | `lib/module_bridge/**` — giao tiếp giữa cloud_storage và feature khác | có | Read, Grep, Glob, Edit, Write |
| `cs-l10n` | Chuỗi trong ARB cloud (12 locale), theo quy ước của `/add-l10n` | có | Read, Grep, Glob, Edit, Write, Bash |

Mỗi file agent gồm:
- Frontmatter: `name`, `description` (tiếng Anh, nói rõ **khi nào** nên giao việc cho agent này),
  `tools` (đúng danh sách trên — tối thiểu cần thiết). **Không** đặt `model`.
- Body (tiếng Anh): vai trò · thư mục được đọc / được sửa · luật bắt buộc · cách làm từng bước ·
  **định dạng kết quả trả về** cho phiên chính (ngắn, có `file:line`, danh sách file đã đổi).
- Luật riêng theo lớp lấy từ `layer-rules.md` (vd domain là Dart thuần, không import Flutter/proto;
  repository interface nằm ở `domain/repositories`; inject qua constructor thay vì `getIt`;
  gọi feature khác qua `module_bridge`).

### 3. Sơ đồ cây
Trong `USAGE.md` của `/team`: sơ đồ (mermaid hoặc ASCII) gốc `/team` → 9 agent, bảng "loại việc →
chuỗi agent", và 4 ví dụ lệnh (mỗi loại việc 1 ví dụ).

## Ràng buộc
- **Chỉ** sửa/tạo code trong `lib/features/cloud_storage` và `lib/module_bridge`. **Không bao giờ**
  sửa `lib/features/socialfi` — gặp thì dừng, báo người dùng. Module khác: chỉ đọc.
- Ưu tiên **thêm code mới** thay vì sửa code đang ổn định.
- **Không sửa file khi chưa có "code đi"** của người dùng.
- Không commit, push, tạo branch/MR.
- Không sửa các skill có sẵn; không thêm dòng vào `tool/layer_baseline.txt` để né luật.
- **Không** đặt file `.md` nào khác ngoài agent trong `.claude/agents/` (Claude Code coi mọi `.md`
  ở đó là agent) — tài liệu đặt trong `.claude/skills/team/`.
- Không cố định model cho agent nào.
- Mọi output cho người dùng bằng tiếng Việt; code, path, identifier, nội dung file agent bằng tiếng Anh.

## Đầu ra mong muốn
```
.claude/
├── agents/
│   ├── cs-planner.md      ├── cs-domain.md
│   ├── cs-debugger.md     ├── cs-data.md
│   ├── cs-reviewer.md     ├── cs-presentation.md
│   ├── cs-explainer.md    ├── cs-bridge.md
│   └── cs-l10n.md
└── skills/team/
    ├── SKILL.md
    └── USAGE.md
```
Kèm một báo cáo ngắn (tiếng Việt): danh sách file đã tạo, chỗ nào đã tự quyết định (giả định).

## Tiêu chí hoàn thành
- [ ] 9 file agent có frontmatter hợp lệ (`name`, `description`, `tools`), không có `model`.
- [ ] Phạm vi "được sửa" của các agent code **không chồng nhau**.
- [ ] `/team` xuất hiện trong danh sách skill; 9 agent xuất hiện trong `/agents`.
- [ ] Chạy thử khô 4 câu (1 mỗi loại) → `/team` phân loại và định tuyến đúng chuỗi agent.
- [ ] Luồng `feature` và `bug` dừng chờ "code đi" trước khi sửa file.
- [ ] Không có thay đổi nào ngoài `.claude/agents/` và `.claude/skills/team/`.

## Giả định
- `application/` giao cho `cs-domain` (vì lớp này điều phối domain).
- `lib/database/tables/cloud_storage/` (ObjectBox `CloudFile`/`CloudFolder`, ngoài module) giao cho
  `cs-data`, chỉ sửa khi kế hoạch nêu rõ và người dùng đồng ý; sau khi sửa phải chạy `/build -obj`.
- Bước tích hợp (`/add-l10n`, `/build`, `/analyze-cloud`) do phiên chính chạy, không giao subagent.
- `cs-l10n` chỉ sửa ARB của module cloud.
