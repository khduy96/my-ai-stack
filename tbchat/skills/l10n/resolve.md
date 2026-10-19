# /l10n resolve

Resolve ARB conflicts **per key** (key + its `@key` block) instead of per conflict hunk while a
merge / rebase / cherry-pick is stopped. Git is only used to read the three versions of every
file; the merge, the rules and the rendering are done by
[scripts/merge_arb.dart](scripts/merge_arb.dart), which writes **only ARB files**, keeps every
entry's original text (no diff noise from format, commas, CRLF or the final newline) and never
touches Dart code. Talk to the user in **Vietnamese** throughout.
Safety: [SKILL.md §5](./SKILL.md#5-safety-rules).

## Syntax

```
/l10n resolve [module[,module…]|all] [-m …] [-s] [-n] [-y] [--include-social-fi] [--no-build]
```

Also reached by auto-detect (no subcommand) when the target module has a conflicted ARB file.

| Argument / flag | Meaning | Default |
|---|---|---|
| `module` (positional) or `-m` | Folder under `lib/app/global/languages/modules` (`cloud`, `im`, `main`, `miner`, `wallet`, `social_fi`); comma-separated for several. `all` = every module that currently has a conflicted ARB | `cloud` |
| `-s`, `--single` | Multi-agent mode off: one agent does everything (step 3) | multi-agent on |
| `-n`, `--dry-run` | Run `plan`, show the report, then `abort` — write nothing | off |
| `-y`, `--yes` | Skip the C1 question in step 6: keep the script's choice, still print the C1 table | off |
| `--include-social-fi` | With `all`, also process `social_fi` | off |
| `--no-build` | Skip step 5 (build + analyze); print the reminder | off |
| `-l` | Ignored with a warning — decisions are per key for every locale | — |

**social_fi** belongs to another team: process it only when the user named it explicitly — and
ask to confirm before `apply` (global rule). With `all` the script skips it; ask the user once
whether to include it, and if yes re-run `plan` with `--include-social-fi`.

## The script

Run every command from the repo root:

```
S=.claude/skills/l10n/scripts/merge_arb.dart
dart $S plan    --modules <m> [--include-social-fi] [--force]  # read versions, classify, save state, print JSON report
dart $S apply   [--decide m:key=…] [--flip m:key,…]              # write the ARB files / flip C1 keys
dart $S check   [--modules …]                                     # markers / JSON / duplicates / locale parity
dart $S summary                                                   # markdown summary of the last apply (C1 table, ⚠ list)
dart $S done                                                      # git add the written ARB files, drop the state/lock
dart $S abort   [--restore]                                       # drop the state/lock; --restore puts the conflict markers back
```

Exit codes: `0` ok · `1` error · `2` C2/C3 decisions missing · `3` another session holds the
lock · `4` `check` found new problems.

State (snapshots of base/mine/upstream for every file, key dates, decisions, flips, files written)
lives in `<git-dir>/l10n-resolve/state.json`. It doubles as the **lock** (30-minute TTL; an older
lock is overwritten with a warning). It is needed for flips because `git add` erases the conflict
stages. Never edit it by hand. (The previous standalone resolve skill kept its state in a `resolve-l10n` folder inside the
git dir — a session started there must be finished or aborted with that old script first; if
that folder exists, tell the user.)

### How mine / upstream are mapped

| Mode | mine | upstream |
|---|---|---|
| merge | `HEAD` (stage 2) | `MERGE_HEAD` (stage 3) |
| rebase | `REBASE_HEAD` (stage 3) | `HEAD` (stage 2) |
| cherry-pick | `HEAD` | `CHERRY_PICK_HEAD` |

### Rules the script applies

The unit is a key **plus its `@key` block**. The reference file is the module's `*_en.arb` (or the
`l10n.yaml` template when there is no `en`). Every decision is taken once per key and applied to
**every locale of the module**.

| Code | Condition | Result |
|---|---|---|
| A1 | mine == upstream | take it |
| A2 | only one side differs from base (add / modify / delete) | take the changed side |
| A3 | both added the same key with the same content | one copy |
| A4 | en agrees, a locale differs on both sides | newer change for that locale (author date), tie → upstream |
| C1 | en value differs on both sides, same placeholders | newer change of the en value wins for **all locales**, tie → upstream. **Listed for user confirmation** |
| C4 | only one side X changed en, the other side changed a locale | locale follows X; ⚠ "chưa dịch" when X did not re-translate it |
| C2 | placeholders differ on both sides | **pending** → you decide `mine` / `upstream` |
| C3 | modified on one side, deleted on the other | **pending** → you decide `keep` / `delete` |
| X | a version is invalid JSON or the file was deleted on one side | module stops, report to the user |

Also automatic:
- Duplicate keys that git's text merge produced silently are merged.
- Pre-existing duplicates nobody touched stay byte-for-byte.
- Files git merged cleanly are patched only when the key-level result differs (C4, a silent
  duplicate).

The date of a change is the author date of the newest commit after the merge-base that really
changed that key's line. Lines that only gained or lost a trailing comma do not count.
`bulk: true` marks a commit that rewrote more than half the file (reformat / sort), so its date is
not trustworthy.

## Flow

### 1. Plan
```
dart $S plan --modules <m>
```
- Exit `3`: another session holds the lock. Tell the user how old it is, ask whether to `abort`
  it. Use `plan --force` only for a lock this conversation created itself.
- Not in a merge, rebase or cherry-pick (exit 1): tell the user and stop.
- Read the JSON report. Per module: `counts`, `pending` (C2/C3), `c1`, `c4`, `a4`, `errors`,
  `droppedDups` / `gitDups`. Top level: `mineChangedDart` (Dart files changed on the mine side).
- Any `errors` (code X): show them and stop — they need a human decision.
- `-n`: present the report in Vietnamese (counts, pending items, the C1 list with the side that
  would win), run `dart $S abort`, stop.

### 2. Decide C2 / C3
Search the merged working tree for each pending item. Exclude
`lib/app/global/languages/generated/**` and `*.arb`. Generated methods are named exactly like
the key.

**C3 (modify/delete)** — search `\b<key>\b` under `lib/`: any real use → `keep`; none → `delete`.

**C2 (placeholders)** — generated methods take the placeholders **positionally**, in declaration
order. Find every call `\.<key>\(` and count its arguments:
1. The sides have different placeholder counts → pick the side whose count matches **every** call
   site.
2. Call sites use both counts → ask the user.
3. The counts are equal → pick the side whose branch also changed the call sites (compare
   `git diff <merge-base> <side-ref>` for the files that call the key; `mineChangedDart` helps for
   the mine side). Both sides or neither changed them → ask the user.

Collect every "ask" item and ask **once** with AskUserQuestion, showing base, mine and upstream
values and placeholders plus the call sites found.

### 3. Multi-agent mode (default; `-s` turns it off)
With `-s`, skip this step and decide everything inline as in step 2. Otherwise:
- **3 or more pending C2/C3 keys**: split them over at most **5** `Explore` subagents, spawned **in
  one message** so they run in parallel; group keys when there are more than 5. Give each agent its
  keys (each with the pending JSON item), the rules of step 2 verbatim, the merge-base and both
  refs (`git merge-base`; refs per the mapping table) and `mineChangedDart`. Each returns exactly
  this JSON, one object per key:
  `{"id": "<module:key>", "code": "C2|C3", "decision": "mine|upstream|keep|delete|ask", "evidence": ["path:line", …], "reason": "…"}`
- **Several modules**: run each module's C2/C3 investigation in its own agent. The `plan` for every
  module still goes through **one** `plan --modules a,b` call in the main agent (the state is a
  single file).

Fewer than 3 keys → decide inline (agents would cost more than the greps). Whatever the mode,
**only the main agent runs `apply`, `check`, build, `done`** — subagents are read-only.

### 4. Apply and validate
```
dart $S apply --decide cloud:usedOf=mine,cloud:music=keep
dart $S check
```
- `apply` exit `2`: a decision is missing. Exit `1` with "đã bị thay đổi bởi phiên khác": someone
  touched the files — show the user, then `plan --force` and start again. With several modules, a
  bare key in `--decide`/`--flip` is rejected — always write `module:key`.
- `check` exit `4`: a new problem (marker, invalid JSON, a new duplicate, a key lost that both sides
  had). Report it and stop. **Do not hand-patch the ARB files.**
- `⚠️` lines in `check` are pre-existing issues (duplicates, locales missing keys) — mention them
  briefly; they are not caused by this merge.

### 5. Regenerate and analyze (skipped by `--no-build`)
```
dart run scripts/build_modular_l10n.dart      # `fvm dart run …` if the repo has .fvmrc
```
- Then analyze — **cloud**: `dart analyze lib/features/cloud_storage`; **other modules**: only the
  Dart files that reference a C2/C3 key.
- The generated folder is git-ignored, so this only refreshes the local build.
- Report analyzer issues related to the resolved keys. **Do not edit Dart code** — if a call site
  broke, tell the user which key and which side was chosen.

### 6. Confirm C1 (whenever there is at least one C1 key)
Run `dart $S summary` and show it: the C1 table (key, mine / upstream values with date, author,
commit, chosen side), the ⚠ C4 "chưa dịch" list, A4 picks and duplicate notes.

- **`-y`**: show the table, say `-y: giữ lựa chọn của script`, skip the question.
- Otherwise ask **once** with AskUserQuestion (multiSelect):
  - **≤ 3 C1 keys**: `Giữ nguyên tất cả (Recommended)` + one option per key
    `Đảo <key> → <bên kia>`.
  - **More than 3**: `Giữ nguyên tất cả (Recommended)` and `Đảo một số key`; for the second, ask
    the user to type the keys (the table's `#` numbers or names).

For the keys to flip:
```
dart $S apply --flip cloud:video,cloud:record
dart $S check
```
Re-run the build, show `summary` again (flipped rows marked `(đã đảo)`). Flipping the same key
again flips it back. Skip this step when there is no C1 key.

### 7. Stage
```
dart $S done
```
Stages only the ARB files the skill wrote and removes the state/lock. It refuses when a conflicted
file was not applied or a written file changed after `apply`.

**Never** run `git merge --continue`, `git rebase --continue`, `git cherry-pick --continue`, or
commit. Tell the user the ARB files are staged and that they should review, then run
`git <mode> --continue` themselves. In a rebase a later commit may stop again → run
`/l10n resolve` again for that stop.

To put the files back to their conflicted state: `dart $S abort --restore` (a file edited after
`apply` is kept and reported).

## Final report (Vietnamese)

First line `▶ /l10n resolve · <mode> · module …`, then:
- Mode (merge / rebase / cherry-pick), modules, files written.
- Counts per rule code.
- C2/C3 decisions with their evidence.
- The final C1 table after flips (or `-y`).
- ⚠ C4 "chưa dịch" keys — they need a translation follow-up (`/l10n update -f …`).
- `check` warnings, the build result, analyzer issues.
- Next step: `git <mode> --continue`.
