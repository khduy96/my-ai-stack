---
name: agents-ba
description: Business analysis of a raw, short feature request — turn one line the user types into a complete, confirmed spec by splitting the analysis into parallel "lanes" (scope, main/alt flows, business rules, data & API, UI states & l10n, edge cases) that run as background subagents with a dependency graph (same wave model as /agents-plan). Never guesses — asks the user generously. When a lane hits an unclear point it stops (BLOCKED) and only the lanes whose analysis depends on that question pause; unrelated lanes keep running. Answers are routed back to the affected lanes, which resume with their context intact. Loops until no blocking question remains and the user says "chốt", then writes the final spec (user stories, Given/When/Then AC, mermaid flow, edge-case table, API/entity/l10n list, test cases) to .claude/document/upgrade/docs/ba/ and offers /agents-plan. Read-only on source code. Use when the user runs /agents-ba, or asks to "phân tích nghiệp vụ / phân tích yêu cầu / làm rõ yêu cầu / viết spec" for a feature.
---

# agents-ba — parallel business analysis

Turn a short request into a confirmed spec. Analysis runs in **parallel lanes** (background
subagents); questions pause **only the lanes they affect**.

> 📖 Hướng dẫn dùng (tiếng Việt): xem [USAGE.md](./USAGE.md).

**Hard rules (whole skill):**
- **Never edit source code.** The only files written are the state file in the scratchpad and the
  final spec under `.claude/document/upgrade/docs/ba/` (path relative to the repo root,
  i.e. `D:\nexsoft\tbchat_CS_Fav\.claude\document\upgrade\docs\ba`). Coding happens later via `/agents-plan`.
- **Never guess a business decision.** Unclear → ask. Asking too much is fine; assuming silently
  is not. Every assumption made to keep a lane moving is written down, tagged, and confirmed
  with the user before the spec is final.
- **Challenge the request** when it conflicts with existing behaviour in the code, is
  self-contradictory, or has a clearly simpler alternative — say so and ask.
- All user-facing output in Vietnamese; code, paths, identifiers in English.
- Scope for code reading: whole app allowed, but `lib/features/cloud_storage` (CS) and
  `lib/module_bridge` (MB) are the primary area. `data/_grpc` = VN backend,
  `data/native_handle` = HK backend — always state which backend a piece of data/API belongs to.
- **Figma & video** follow [media-access.md](../../_rule/media-access.md): cached files first;
  otherwise ask before **every** Figma MCP call (`get_screenshot` only — no `get_design_context`
  during BA), ask before viewing any video. Lanes (subagents) never call Figma — pass them the
  cached `*.screenshot.md` / video descriptions. Count calls in the caller's state file
  (`task-<slug>.md` / `team-plan.md`) or, standalone, in this skill's state file.

Input: `/agents-ba <raw request>`, optionally with Figma links (via the Figma MCP, per
media-access.md), a `<slug>.assets/` folder of already-cached Figma/video results, screenshots,
videos, or ticket text.

---

## Phase 0 — Understand & ground (main agent, no subagents yet)

1. **Restate** the request: goal, who benefits, what "done" looks like. Split clearly into
   *"Bạn đã nói"* vs *"Tôi đang giả định"*.
2. **Ground in code (read-only).** Find the related screens, blocs, entities, use cases,
   repositories, APIs, l10n keys, and plan/subscription rules that already exist (Glob/Grep, or
   one `Explore` agent for a broad sweep). Note conflicts between the request and current
   behaviour.
3. If Figma was given, read it and list what the design shows (screens, states, texts) — from the
   cache when the caller passed one; otherwise per media-access.md (ask per call, then cache).
   Videos → the video flow of media-access.md.
4. **Size check.** If the request is tiny (one screen, no new rules, no new API), skip lanes:
   analyse it yourself, ask, and jump to Phase 3. Say why.

## Phase 1 — Lane plan

Split the analysis into lanes. Default set (merge/split/drop to fit the request):

| Lane | Content | Depends on |
|---|---|---|
| L0 | Scope, actors, glossary, in/out of scope (main agent does it) | — |
| L1 | Main flow + alternative flows (step by step, entry points, exit points) | L0 |
| L2 | Business rules: permissions, plan/quota, limits, expiry, ownership, counting rules | L0 |
| L3 | Data & API: entities, fields, which BE (VN `_grpc` / HK `native_handle`), what exists vs needs BE, local DB/cache, sync. Name where each piece belongs per [layer-rules.md](../../_rule/cloud/layer-rules.md): entity → `domain/entities/`, repository interface → `domain/repositories/` (domain types only), Impl/mapping → `data/`, view model → `model_view/`, other features → `lib/module_bridge/` | L0 |
| L4 | UI states (loading/empty/error/success/disabled), navigation, texts → l10n list | L1 |
| L5 | Edge cases & errors: offline, BE error, timeouts, retries, double tap, concurrency, multi-device, large data, expired/locked user, permission revoked mid-flow | L1, L2, L3 |
| FINAL | Merge into spec + acceptance criteria + test cases | all |

Rules:
- A lane starts as soon as all lanes it depends on are **done or done-except-tagged-assumptions**.
- Max **5 lanes running at once**.
- Show the plan to the user:

```
## Kế hoạch phân tích — <tên tính năng>

**Hiểu yêu cầu:** <2–4 dòng>
**Bạn đã nói / Tôi giả định:** ...
**Code liên quan đã có:** <paths>
**Sơ đồ lane:** L0 → (L1 ∥ L2 ∥ L3) → (L4 ∥ L5) → FINAL

| Lane | Phân tích gì | Chờ | Trạng thái |
|---|---|---|---|

**Câu hỏi ngay từ đầu:** (nếu có — xem format ở mục "Asking")
```

- Then **start immediately** (no need to wait for "code đi" — this skill edits no code): launch
  every lane whose dependencies are satisfied, in **one message**, `run_in_background: true`.
  Questions from Phase 0 are asked in the same turn; lanes not affected by them run meanwhile.
  Lanes affected by an opening 🔴 question are not launched until it's answered.

### State file
Keep `<scratchpad>/ba-<feature-slug>.md` up to date after every event (launch, BLOCKED,
answer, done). It holds: the lane table with agent IDs/names and status, the question table,
the assumption table, and each lane's latest result. This is what survives context compaction —
re-read it if the conversation was summarized.

## Phase 2 — Run lanes, route questions

### Lane brief (each `Agent` call, subagent_type `general-purpose`, background)
Self-contained — the subagent has none of this conversation:
- the feature goal, L0 output (scope/actors/glossary), relevant code paths found in Phase 0,
  Figma notes, confirmed answers so far
- **its lane only** — what to analyse, what it must NOT analyse (other lanes own that)
- outputs of the lanes it depends on
- rules: read-only (no edits at all, no builds, no commits); never invent business rules;
  ground claims in code with `path:line` where possible
- **assumption tagging:** every conclusion that relies on something not confirmed is tagged
  `[giả định Ax: ...]`. Minor assumptions → keep going. A question on the lane's **main line**
  (the answer would change the flow/structure of what it produces) → finish everything
  independent of it, then stop.
- **report format (final message), exactly:**
  ```
  STATUS: DONE | BLOCKED
  ## Kết quả (phần đã phân tích)
  ...
  ## Giả định đã dùng
  - A1: ... — ảnh hưởng tới: <phần nào trong kết quả>
  ## Câu hỏi
  - Q?: <câu hỏi> | mức: 🔴/🟡/🟢 | lựa chọn gợi ý: (a) ... (b) ... | đề xuất: (a) vì ...
    | lane khác có thể bị ảnh hưởng: L? (vì ...)
  ## Điểm dừng (nếu BLOCKED)
  Đang chờ Q? để phân tích tiếp: ...
  ```

### Handling events (main agent)
Never poll — react to completion notifications and user replies.

**A lane returns BLOCKED or DONE-with-questions:**
1. Number its questions globally (Q1, Q2…), dedupe against existing ones (same question from two
   lanes → one question, both lanes listed).
2. For each question decide **affected lanes** — the asking lane plus every lane (running,
   waiting, or done) whose output would change with the answer. Use the lane's own hint, plus
   your judgment.
3. Classify the impact per affected lane:
   - **main line** → that lane must pause at this point:
     - not started yet → hold it (don't launch);
     - running → `SendMessage` it: "Q? pending — finish the parts independent of Q?, then return
       BLOCKED with your stop point";
     - done → mark it "needs revisit after Q?".
   - **minor** → lane continues with a tagged assumption ⚠️; revisit after the answer.
   - **unrelated** lanes → untouched, keep running.
4. Launch any lane whose dependencies just became satisfied — even while other lanes are blocked.
5. Ask the user right away (see "Asking") and show the status board.

**User answers:**
1. Record the answer in the state file (confirmed decisions list).
2. Send it via `SendMessage` to every affected lane:
   - BLOCKED lane → "Answer to Q?: … — continue from your stop point";
   - done lane that used a related assumption → "A? replaced by: … — revise only the affected
     parts and report the diff";
   - held lane → launch it now with the answer in its brief.
3. If the answer contradicts a previous answer or opens a new branch of the flow → ask the
   follow-up immediately; add lanes if a whole new area appeared.

**A lane returns DONE:** store its result, launch dependents, update the board.

### Asking
- 🔴 blocking questions: `AskUserQuestion` (≤4 per call, options with the recommended one first
  and "(Recommended)"). If the tool is unavailable, use the numbered list below.
- 🟡/🟢 questions: numbered list in chat, each with suggested options and a default
  recommendation, so the user can answer "Q3: b" or "đồng ý hết đề xuất".
- Each question shows which lanes are waiting on it.
- Don't hold questions back to batch them — ask as soon as they arrive; it's fine to ask in many
  small rounds.
- Unanswered 🟡/🟢 are carried over and re-listed; they never silently become decisions.

```
### ❓ Câu hỏi
**Q3 🟡** (từ L2, ảnh hưởng L5) <câu hỏi>
  (a) ... (b) ... → đề xuất (a): <lý do>
```

### Status board (show after every event, short)
```
| Lane | Trạng thái | Ghi chú |
|---|---|---|
| L1 | ▶ đang chạy | |
| L2 | ⏸ chờ Q3 | |
| L3 | ✅ xong | ⚠️ dùng giả định A2 |
| L5 | ⏳ chờ L1, L2 | |
```

## Phase 3 — Close & write the spec

Enter only when **no 🔴 question is open, no lane is running/blocked, every assumption is
confirmed or explicitly accepted**, and the user says **"chốt"**. If the user says "chốt" early,
list what's still open and ask whether to accept the recommended defaults for them.

Run the merge yourself (or one FINAL agent for a large result), check consistency across lanes
(a rule in L2 must appear in L1's flow, L4's error states, L5's cases and the test cases), then
write `.claude/document/upgrade/docs/ba/<feature-slug>.md` (create the folder if needed):

```
# <Tên tính năng>
## 1. Mục tiêu & phạm vi (in / out of scope)
## 2. Actor & thuật ngữ
## 3. User stories
## 4. Luồng nghiệp vụ (mermaid flowchart/sequence + mô tả từng bước, luồng phụ)
## 5. Quy tắc nghiệp vụ (BR-01…)
## 6. Dữ liệu & API (entity, field, BE VN/HK, có sẵn / cần BE làm)
## 7. Màn hình & trạng thái UI + danh sách l10n (key gợi ý: English text)
## 8. Edge case & xử lý lỗi (bảng: tình huống → hành vi mong muốn)
## 9. Acceptance criteria (Given / When / Then, gắn BR-xx)
## 10. Test case (happy / negative / edge)
## 11. Quyết định đã chốt (Q → câu trả lời) & giả định đã xác nhận
## 12. Việc còn mở / cần BE hoặc design xác nhận
```

Then reply with: path of the spec, a 5–10 line summary, the open items for BE/design, and the
suggestion: *"Muốn chia việc để code thì chạy `/agents-plan` — nó sẽ dùng spec này."*

## Stop conditions
- A lane agent errors out → relaunch once with the same brief; if it fails again, tell the user.
- The request turns out to require changing `lib/features/socialfi` → flag it as out of scope
  and ask how to proceed.
- Lanes produce contradicting conclusions that no user answer explains → stop those lanes and
  ask the user.
