You are a senior Flutter engineer working in the `tbchat_main` repository, on the `cloud_storage` feature.

## Task
Fix the bug where the "My Subscription" screen keeps showing the paid (Standard) plan UI after the plan expires while the screen is open, so that it switches to the "Free – Subscriptions Expired" UI without the user having to leave the screen or pull to refresh.

## Context
- Bug repro:
  1. Log in with an account on a paid plan (Standard) whose `endTime` is a few minutes away.
  2. Open My Subscription and stay on the screen.
  3. Wait until `endTime` has passed.
  - Actual: the screen still shows the Standard UI (header, standard card, Started / Expired on / Days left, `Upgrade` button).
  - Expected: the screen shows the "Free – Subscriptions Expired" frame.
- "Free – Subscriptions Expired" already exists: it is rule 1 of `MySubscriptionMapper.map` → `_expired(...)` in `lib/features/cloud_storage/pages/new_upgrade/my_subscription/mappers/my_subscription_mapper.dart`: `cardStyle: free`, no `planName` (shows "Free"), `latestSubscription` with badge `expired`, `PlanOverLimitAlert` only when used > free quota, actions `viewAllPlans` + `renew`. It is chosen when the server returns `displayStatus == expired` with a `plan`.
- Spec: `.claude/document/upgrade/docs/ui/my-subscription.md` (frame table at line ~212, mapping rules at line ~434).
- Files involved:
  - `pages/new_upgrade/my_subscription/cubit/my_subscription_cubit.dart` — `load()`, `refresh()`, `_reload()`, `_followUsage()`, `_remap()`.
  - `pages/new_upgrade/my_subscription/cubit/my_subscription_state.dart`
  - `pages/new_upgrade/my_subscription/my_subscription_page.dart` — reloads only on `didPopNext` (RouteAware).
  - `domain/entities/subscription/storage_subscription.dart` — `displayStatus`, `endTime`, `isExpiringSoon`.
- Likely root cause (verify it, do not take it as given): the screen is re-decided only on `load`, pull-to-refresh, `didPopNext`, and usage changes. `_remap` reuses the cached `_subscription`, whose `displayStatus` is still `active`, so nothing re-fetches the subscription when `endTime` passes.
- `displayStatus` comes from the VN BE subscription service (`_grpc`). It may still return `ACTIVE` for a short time after `endTime`.
- Existing lifecycle pattern to copy: `AppLifecycleListener` in `pages/home/cloud_home_page.dart` (~line 260).
- Other screens that read the subscription: `pages/home/cubit/storage_session_popup_cubit.dart` and `shared/utils/storage_limit_guard.dart` (the "Plan expired" session popup on Cloud home); `pages/storage_management/` (quota / usage).

## Steps
1. Read the files listed under Context and confirm the root cause. Write it down as `file:line` + one sentence before changing anything.
2. Present a short fix plan (files, what changes in each) and wait for the user to reply "code đi" before editing any file.
3. In `MySubscriptionCubit`, after every successful load, schedule a single expiry check when the loaded subscription is `active` or `pending` and has an `endTime`:
   - Fire at `endTime` (immediately if `endTime` is already in the past).
   - Cancel and reschedule the timer on every successful load (the user may have renewed and `endTime` changed).
   - Cancel the timer in `close()`.
4. When the expiry check fires, re-fetch from the server silently (no skeleton, no error toast). The server is the source of truth: MUST NOT mark the plan expired locally from `now >= endTime`.
5. If the re-fetch still returns `active` / `pending` with `endTime <= now`, retry with backoff: 5s, 15s, 30s. Stop retrying as soon as the status is no longer `active` / `pending`, or after the last retry; then keep the last content on screen.
6. Handle app background → resume: when the app resumes while My Subscription is open and the loaded subscription's `endTime <= now`, run the same expiry check (step 4–5). Do not double-fetch if a check is already in flight; reuse the existing `_requestId` / `_isStale` guard.
7. Verify the "Expired Soon → Expired" path: a subscription with `isExpiringSoon == true` (orange `expiredSoon` badge, `PlanExpiringSoonAlert`) must switch to the expired frame through the same mechanism. Add no separate code path unless the check shows one is needed.
8. Check whether the other screens (Cloud home session popup via `StorageLimitGuard.maybeShowSessionPopup`, Storage Management) have the same stale-state problem when a plan expires while they are open. Report the findings as `file:line` + one sentence each. Do not fix them in this task; propose the fix and ask.
9. Add unit tests for `MySubscriptionCubit` using fake use cases and a controllable clock / `fakeAsync`:
   - active → server returns expired at `endTime` → state shows the expired view model (`latestSubscription.badge == PlanBadge.expired`, `cardStyle == PlanCardStyle.free`, actions `[viewAllPlans, renew]`).
   - server returns `ACTIVE` at `endTime`, then `EXPIRED` on the 2nd retry → expired view model.
   - all retries return `ACTIVE` → content unchanged, no error toast (`errorToastCount` unchanged), no more fetches.
   - renewal reload with a new `endTime` → timer rescheduled to the new `endTime`.
   - cubit closed before `endTime` → no fetch, no emit after close.
10. Run `dart analyze lib/features/cloud_storage` and `dart run tool/check_layers.dart --summary`; fix every new issue.

## Rules
- MUST edit only `lib/features/cloud_storage` (and `lib/module_bridge` only if strictly needed). MUST NOT edit `lib/features/socialfi`.
- MUST follow `.claude/_rule/cloud/layer-rules.md`: the cubit gets dependencies through its constructor, no `getIt` inside the cubit, no proto / Flutter types in domain contracts.
- MUST NOT edit any file before the user says "code đi".
- MUST keep the mapper the single place that decides the frame; do not add status logic to widgets.
- MUST NOT change the existing behaviour of `load()`, pull-to-refresh, `didPopNext`, or the usage stream, except where the fix needs it.
- MUST NOT show the skeleton or an error toast for the automatic expiry check.
- Prefer adding new private methods / small new code over rewriting stable code.
- If an analyzer error blocks you, fix it with a safe default plus a `// TODO(cloud):` comment and keep going.
- If the root cause turns out to be different from the one in Context (e.g. the server never returns `EXPIRED`, or `endTime` arrives in a wrong timezone) → stop and report before fixing.
- If the fix needs a change in the domain/data layer, a new use case, or a backend change → stop and ask the user.
- If an analyzer or layer check fails and you cannot fix it inside the scope above → stop and ask the user.

## Output
Reply in Vietnamese; keep code, identifiers, and paths in English. Use this structure:
1. **Root cause** — `file:line` + 1–3 sentences.
2. **Fix plan** — a table: file | change. Then wait for "code đi".
3. After coding: **Changes** — bullet per file with `file:line` links.
4. **Other screens** — findings from step 8, `file:line` + one sentence each, plus a proposed fix per screen.
5. **Verification** — analyzer result, layer check summary, test results (pass/fail counts).

## Done when
- With the screen open, a plan that expires switches to the "Free – Subscriptions Expired" frame within 30s after the server starts returning `EXPIRED`, with no user action.
- Same result when the app was in background during `endTime` and is resumed with the screen open.
- An `expiredSoon` plan transitions to the expired frame the same way.
- No skeleton and no error toast appear during the automatic check; no fetch or emit happens after the cubit is closed.
- The new unit tests from step 9 pass.
- `dart analyze lib/features/cloud_storage` reports no new issues and `check_layers.dart --summary` reports no new violations.
- The other screens' findings are reported (not fixed).

## Assumptions
- Retry backoff is 5s / 15s / 30s (3 retries); after that the screen keeps the last content until the next manual refresh or `didPopNext`.
- The automatic check is silent: a failed fetch shows no toast.
- The expiry check also runs for `pending` subscriptions that have an `endTime`.
- Other screens are investigated and reported only, not fixed in this task.
