---
name: agents-plan
description: Turn the requirements already agreed in the current conversation into a parallel-agent work plan for the cloud_storage / module_bridge modules — how many subagents, which run in parallel, which must wait for which (waves + dependency graph), and the exact files each agent exclusively owns. Produces the plan only (no source edits). After the user approves with "code đi", execute the plan end-to-end — wave by wave with background subagents, then a final integration pass (/l10n add, /build -get|-obj, /analyze-cloud) — without stopping until done. Use when the user runs /agents-plan, or asks to "phân việc / chia agent / lập bảng phân công" for a task already discussed. Optional flag "-wf" executes via the Workflow tool instead of individual subagents.
---

# agents-plan

Split an already-discussed task into a **parallel-agent plan**, show it as a table, then — after
the user says **"code đi"** — run it to completion in one go.

> 📖 Hướng dẫn dùng (tiếng Việt): xem [USAGE.md](./USAGE.md).

Two phases. **Phase 1 (this invocation) never edits source files.** Phase 2 starts only when the
user replies "code đi" (or explicitly says to run the plan).

---

## Phase 1 — Build the plan

### 1. Collect the requirements from the conversation
Re-read the conversation and extract: goal, screens/flows, APIs (and which backend:
`data/_grpc` = VN BE, `data/native_handle` = HK BE), entities, l10n strings, Figma links,
acceptance criteria, and anything the user explicitly ruled out.

Figma & video follow [media-access.md](../../_rule/media-access.md): use the cached files
(`<slug>.assets/`) when present; any Figma MCP call is asked per call and counted. Planning needs
screenshots at most — `get_design_context` is fetched only in Phase 2, right before the UI wave.

If something blocks a correct split (unknown API shape, unclear which screen, missing design,
ambiguous business rule) → output **only** the "Câu hỏi còn mở" section and stop. Do not guess.
The same applies to any decision the user didn't mention that changes the result (behaviour,
UI/UX, scope, API/contract, data, public names, error handling) — don't pick silently. Ask with
`AskUserQuestion` (2–4 options, the recommended one first, labelled "(Recommended)").

### 2. Ground it in the code (read-only)
Before assigning files, verify the paths actually exist / don't exist yet (Glob/Grep, or one
`Explore` agent for a broad sweep). Identify the closest existing example for each piece
(e.g. a sibling repository, use case, bloc, page) so each agent gets a concrete pattern to copy.

### 3. Decompose into tasks
Natural seams in this codebase (`lib/features/cloud_storage` = CS, `lib/module_bridge` = MB):

| Layer | Typical paths |
|---|---|
| Contract | `CS/domain/entities/<group>/`, `CS/domain/repositories/` (every `*Repository` interface lives here) |
| Data VN | `CS/data/_grpc/repositories/` (gRPC client wrappers / `*DataSource`), `CS/data/_grpc/mapper/` |
| Data HK | `CS/data/native_handle/`, `CS/data/models/native_call_res/` |
| Data other | `CS/data/repository/<group>/` (`*RepositoryImpl`), `CS/data/api/`, `CS/data/db/` |
| Domain | `CS/domain/use_cases/<group>/` |
| Application | `CS/application/` (orchestrates domain, no UI) |
| UI | `CS/pages/<screen>/` (+ its `cubit/` or `bloc/`), `CS/transponder/`, `CS/model_view/` |
| Bridge | `MB/` (new interface) + new impl in `CS/` |

**Layer rules** — every task must respect [layer-rules.md](../../_rule/cloud/layer-rules.md)
(`CS/tool/check_layers.dart` wins if they differ). The ones that shape the split:
- `domain/` is pure Dart: no `data/`, `application/`, `model_view/`, UI folders,
  `package:flutter/`, `package:grpc/`, `package:tbchat_main/database/` (except
  `database/tables/cloud_storage/`).
- Repository interface → `domain/repositories/`, impl → `data/`. Contract uses domain types only
  (no proto, `Map<String, dynamic>`, `GrpcError`, `ResponseFuture`, Flutter types, callbacks,
  `ValueNotifier`, `model_view/` types). Proto/JSON mapping and `GrpcError` translation live in
  the `*Impl`.
- `data/` returns `CloudFile` / `CloudFolder` / domain entities — never `model_view/` types; no
  `pages/`, `transponder/`, `shared/widgets|routes/`, `go_router`, `material`/`cupertino`.
- `pages/`, `shared/widgets/`, `shared/presentation/` never import `data/` or `package:grpc/`;
  they reach data through use cases / `domain/repositories/` injected into the cubit.
- Cubits/blocs get dependencies via the constructor (no `getIt` inside); widgets use `getIt`
  only to create a cubit; `shared/` (except `routes/`, `utils/navigators/`, `network/`) never
  calls `getIt` and never imports `pages/` / `transponder/`.
- `model_view/` never imports `pages/` / `transponder/`; nothing new in `shared/domain/` or
  `shared/data/`.
- Other features only through `lib/module_bridge/` (no `package:tbchat_main/features/...`).

So a typical vertical slice is: domain contract (W0) → data impl ∥ use case → cubit + page.
Plan the data-flow per task so no task needs a forbidden import to compile.

Rules:
- **Exclusive file ownership.** Every file to create/modify belongs to exactly one task. Two
  tasks that must touch the same file → merge them, or make one wait for the other.
- **Contract first.** Entities / repository interfaces / bridge interfaces that ≥2 tasks depend
  on go into **Wave 0** so later waves code against a fixed signature.
- **Reserved for the main agent (FINAL step), never given to subagents:**
  - the 12 `cloud_*.arb` files → subagents return a list of `key: English text`; main runs `/l10n add` once
  - `service_locator.config.dart` → main runs `/build -get` once
  - `objectbox.g.dart` / `objectbox-model.json` → main runs `/build -obj` once
  - any l10n codegen output
- **Scope:** only CS and MB. Never `lib/features/socialfi/` (ask the user instead). Prefer NEW
  files/classes; touching stable existing files only with purely additive lines — flag every
  existing file a task will modify.
- **Granularity:** don't spawn an agent for a 1–2 file trivial change — fold it into a
  neighbouring task or the FINAL step. Cap **5 agents per wave**. If the whole task is small
  (≤ ~4 files), say so and recommend a single agent instead of a split.

### 4. Build waves
Topologically sort by dependencies: Wave 0 (contracts, often done by the main agent itself if
small) → Wave 1..n (parallel groups) → FINAL (integration). A task goes in the earliest wave
whose dependencies are all in earlier waves.

### 5. Output the plan (in Vietnamese, code/paths in English)

```
## Bảng phân công — <tên task>

**Tổng quan:** <N> agent · tối đa <M> chạy song song · <K> wave
**Sơ đồ:** W0 → (A1 ∥ A2 ∥ A3) → A4 → FINAL

| ID | Wave | Việc | Sửa (độc quyền) | Chỉ đọc | Chờ | Trả về (contract) | Mẫu tham khảo |
|----|------|------|-----------------|---------|-----|-------------------|---------------|
| W0 | 0 | ... | ... | — | — | tên class / signature | ... |
| A1 | 1 | ... | ... | ... | W0 | ... | ... |
| FINAL | cuối | /l10n add → /build -get → /analyze-cloud | ARB, DI, ObjectBox | tất cả | A* | — | — |

**File hiện có sẽ bị sửa (chỉ thêm dòng):** ...
**Rủi ro / điểm cần chú ý:** ...
**Câu hỏi còn mở:** (nếu có — nếu còn câu hỏi chặn thì KHÔNG đưa bảng)

→ Nói **"code đi"** để chạy toàn bộ bảng này.
```

Also write the plan (table + full per-agent briefs from step 6 below) to
`<scratchpad>/agent-plan.md`, so Phase 2 survives context compaction. Mention the path.

If the user edits the plan in chat, update the table + file and show the new table.

---

## Phase 2 — Execute (only after "code đi")

Run continuously; do not stop to ask between waves unless a **stop condition** hits.

### 6. Brief for each subagent
Each `Agent` call (subagent_type `general-purpose`, `run_in_background: true`) gets a
self-contained prompt — the subagent has none of this conversation:
- the goal of the overall feature (2–3 lines) and **its own task**
- **files it may create/modify** (exhaustive) — "do not edit any other file"
- read-only files + the pattern file(s) to mirror
- contracts from earlier waves (exact class names, signatures, file paths)
- hard rules: no `socialfi`; don't edit ARB / `service_locator.config.dart` / ObjectBox
  generated files; don't run build_runner or l10n gen; don't commit; match surrounding code style
- **layer rules** for the folders it owns: paste the relevant bullets from "Layer rules" above
  plus the path of [layer-rules.md](../../_rule/cloud/layer-rules.md) to read; tell it to run
  `dart tool/check_layers.dart --summary` from `lib/features/cloud_storage` after editing and
  fix any new violation in its own files; never add lines to `tool/layer_baseline.txt`
- for new UI strings: use a placeholder key name and list them
- design: paths of the cached Figma files (`*.screenshot.md` / `*.context.md` / `*.png`) +
  "do not call any Figma MCP tool; use these cached files — need more → say so in your report"
- **report format** (final message): files created/modified, public symbols added (with
  signatures), l10n strings needed (`key: English text`), DI annotations added
  (@injectable/@LazySingleton → needs `/build -get`), @Entity changes (→ `/build -obj`),
  anything left undone or uncertain

### 7. Run the waves
For each wave:
0. Wave has UI tasks that need Figma details beyond the cached screenshots → fetch
   `get_design_context` for exactly those nodes, **asking per call** (media-access.md), cache it,
   bump the Figma counter, add the paths to the briefs. Refused → brief from screenshots /
   the user's description only.
1. Launch **all** its agents in **one message** (parallel). Small Wave-0 contract work may be
   done directly by the main agent instead.
2. Wait for the completion notifications (don't poll).
3. Verify each result:
   - `git -C lib/features/cloud_storage status --porcelain` (CS is its own repo) and
     `git status --porcelain -- lib/module_bridge` → every changed path must be in that agent's
     ownership list; nothing under `lib/features/socialfi`.
   - The reported contract matches what dependent tasks expect.
   - `dart tool/check_layers.dart --summary` (from `lib/features/cloud_storage`) → no new
     violation in files this wave touched.
   - Fix small deviations yourself; if a contract changed, update the briefs of later waves.
4. Accumulate: l10n strings, DI flag, ObjectBox flag.

With `-wf`: load the `workflow-authoring` skill and encode the same waves as a Workflow script
(one `phase` per wave, `parallel` within a wave), passing the briefs verbatim; then do the FINAL
step yourself.

### 8. FINAL (main agent)
1. l10n strings collected → `/l10n add` (multi-line, one entry per string), then replace
   placeholder keys in code with the generated getters.
2. DI changes → `/build -get`; @Entity changes → `/build -obj`.
3. `/analyze-cloud` (plus `dart analyze lib/module_bridge` if MB changed) — it also runs
   `dart tool/check_layers.dart --summary`. Fix analyzer errors/warnings introduced by this
   task; for new layer violations run `/check-layers -y` (the user already said "code đi");
   repeat up to **3 rounds**. Never add lines to
   `tool/layer_baseline.txt` to make the check pass.

### 9. Report (Vietnamese)
- Table: agent → what it did → files
- Generated/integration steps run and their results
- Analyzer result (remaining issues, if any, and why)
- Layer check result (`No new violations`, or which new ones remain and why)
- Follow-ups for the user (e.g. what socialfi side needs to call, manual test steps)
- Do **not** commit.

### Stop conditions (pause and ask the user)
- An agent failed or returned something that breaks a later wave's contract and can't be fixed
  in a quick local edit.
- An agent edited outside its ownership, or anything under `socialfi` changed.
- A business decision appears that the requirements didn't cover.
- Analyzer errors or new layer violations remain after 3 fix rounds.
- A task can't be done without breaking a layer rule (e.g. the needed data is only reachable
  through a `data/` type from a page) → propose the domain contract to add and ask.
