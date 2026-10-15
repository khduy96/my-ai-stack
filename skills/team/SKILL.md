---
name: team
description: Điều phối cây subagent ms-* cho app Flutter my_store (kho + đơn hàng). Dùng khi người dùng gõ /team <việc> để code tính năng mới, fix bug, review code hoặc giải thích code - skill phân loại việc, giao cho ms-planner/ms-debugger/ms-reviewer/ms-explainer và các agent code ms-domain/ms-data/ms-presentation/ms-seed/ms-test theo wave, chờ "code đi" trước khi sửa file, rồi tích hợp (build_runner, flutter analyze, flutter test).
---

# /team - orchestrator for the ms-* agent tree

Runs in the MAIN session (subagents cannot spawn subagents). Input: `$ARGUMENTS` = the task.
All messages to the user are in **Vietnamese**; prompts to subagents are in English.
See `USAGE.md` in this folder for the tree diagram and examples.

## 0. Hard rules (apply to every step)
- No file edits until the user says **"code đi"** (or an unambiguous equivalent: "ok code", "làm đi").
  Questions, tweaks to the plan, "ok" alone → revise/ask, do not code.
- Editable areas: `lib/`, `test/`, `scripts/seed/`. Never: platform folders (`android/ ios/ linux/
  macos/ web/ windows/`), `.env*`, `pubspec.lock`, generated files (`lib/core/di/injector.config.dart`,
  `*.freezed.dart`, `lib/features/warehouse/presentation/presentation.dart`) - those are regenerated
  only by build_runner. `pubspec.yaml` dependency changes → ask the user first.
- Never commit, push, create branches/MRs. Never run `scripts/seed/*` (writes to real Back4App).
- Do not modify other skills in `.claude/skills/`.
- Prefer adding code over rewriting stable code.

## 1. Classify
Classify `$ARGUMENTS` into exactly one type:
| Type | Signals |
|---|---|
| `explain` | "giải thích", "tại sao", "hoạt động thế nào", "luồng", "là gì", "explain" |
| `review` | "review", "xem giúp diff", "kiểm tra code", a branch/commit/PR reference |
| `bug` | "lỗi", "bug", "sai", "không hiện", "crash", "vẫn hiện số cũ", observed vs expected behaviour |
| `feature` | "thêm", "làm", "tạo", "cho phép", "hiển thị thêm", a new capability |

Precedence: `explain` > `review` > `bug` > `feature`. A sentence describing observed wrong behaviour
is a `bug` even if it contains "thêm" (e.g. "thêm hàng xong tab Kho vẫn hiện số cũ" → `bug`).
If still ambiguous (e.g. "sửa màn hình đơn hàng" could be bug or feature) → ask the user with
AskUserQuestion, offering the candidate types. Tell the user the chosen type in one line.

## 2. Route
### explain
1. Agent `ms-explainer` with the question + any files the user mentioned.
2. Relay its answer (already Vietnamese) - trim, keep `file:line` links as markdown links.

### review
1. Determine the target: default = `git diff dev...HEAD` + uncommitted changes; or what the user named.
2. Agent `ms-reviewer` with the target.
3. Report findings grouped by severity in Vietnamese. Do NOT fix anything unless the user then asks
   (a fix request becomes a new `bug`/`feature` flow).

### bug
1. Agent `ms-debugger` with symptom, steps, expected behaviour, any logs.
2. Present to the user (Vietnamese): root cause with `file:line`, confidence, proposed fix as a
   wave plan (agent → files), risks. End with: **"Trả lời `code đi` để sửa."**
3. STOP. Wait for "code đi".
4. Execute waves (section 3) using the fix plan, then section 4 and 5.

### feature
1. Agent `ms-planner` with the request + any constraints from the user.
2. If the plan has open questions → ask the user first and re-plan if needed.
3. Present the plan (Vietnamese): waves, files per agent, cache keys, Parse schema changes,
   build_runner yes/no, manual steps, risks. End with: **"Trả lời `code đi` để bắt đầu code."**
4. STOP. Wait for "code đi".
5. Execute waves (section 3), then section 4 and 5.

## 3. Execute waves (after "code đi")
Default order - skip empty waves:
1. `ms-domain`
2. `ms-data`
3. `ms-presentation` ∥ `ms-seed` (several `ms-presentation` instances allowed if file sets are disjoint, e.g. per feature folder)
4. `ms-test`

Ownership (each file has exactly one owner per wave - verify before launching):
| Path | Agent |
|---|---|
| `lib/core/domain/**`, `lib/core/enum/**`, `lib/core/error/**` | ms-domain |
| `lib/core/data/**`, `lib/core/{cache,sync,network,parse,services,config}/**`, `lib/core/di/injector.dart` | ms-data |
| `lib/features/**`, `lib/core/{router,theme,utils}/**`, `lib/main.dart` | ms-presentation |
| `scripts/seed/**` | ms-seed |
| `test/**` | ms-test |

Launching rules:
- Agents in the same wave → launch in ONE message (parallel), `run_in_background: false` is fine
  since the next wave depends on them.
- Each prompt contains: the user's task, the approved plan items for THAT agent only (exact file
  paths), contracts produced by earlier waves (signatures, cache keys), and "Edit only these files:
  ...; report anything else you need".
- After each wave: read the agents' outputs, check no file outside its list changed
  (`git status --porcelain`), and pass contracts forward. If an agent reports a blocker or needs a
  file it doesn't own, decide: route it to the owner in the next wave, or ask the user if it changes scope.
- If anything requires `lib/features/...` from a domain/data agent or similar cross-layer need, do NOT
  let the agent edit it - route it.

After the last coding wave → agent `ms-reviewer` on the changed files. Blockers/majors → one fix round
with the owning agent(s), then re-review once. Remaining issues go into the final report.

## 4. Integration (main session does this itself - never delegated)
1. build_runner if any agent reported `build_runner: yes` (new/changed `@injectable`, `@LazySingleton`,
   `@freezed`, or constructors of registered classes):
   `dart run build_runner build --delete-conflicting-outputs`
2. `flutter analyze`
3. `flutter test` (all tests; at least the changed ones if the suite is slow).
4. Analyzer errors that block the build → fix directly with a safe default value + `// TODO(team): ...`
   comment, without asking. Never add `// ignore:` to silence issues; never edit generated files by hand.
5. Do not run seed scripts; list them as manual steps instead.

## 5. Final report (Vietnamese)
```
## Kết quả
<1-2 câu: đã làm gì>
## File đã đổi
- [path](path) - mô tả ngắn (agent)
## TODO còn lại
- [path:line](path#Lline) - ...
## Kiểm tra
- build_runner: đã chạy / không cần
- flutter analyze: N issue (liệt kê lỗi/warning liên quan)
- flutter test: X passed, Y failed
- ms-reviewer: approve / còn vấn đề ...
## Việc bạn cần làm thủ công
- vd thêm cột trên Back4App, chạy `dart run scripts/seed/seed.dart`, kiểm tra màn hình ...
```
Report outcomes truthfully - failing tests or skipped steps must be stated as such.
