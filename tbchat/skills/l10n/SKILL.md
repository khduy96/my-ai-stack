---
name: l10n
description: All l10n work on the modular ARB files (lib/app/global/languages/modules/<module>/l10n) in one command — "/l10n [subcommand] [flags] <entries…>". Subcommands - add (new keys; bare content with auto key, `key: content`, or explicit `key: en=… | zh=… | ja=…`; one entry per line), update (overwrite existing keys in place; `key: content` or `key@locale: content`; -f/--fill regenerates the locales not listed; fixes call sites when placeholders change, --no-callsite to only list them), resolve (per-key ARB merge-conflict resolution during merge/rebase/cherry-pick via scripts/merge_arb.dart; rules A1–A4, C1–C4, X; positional modules or `all`, -s/--single, --include-social-fi, -y/--yes skips the C1 question), check (report-only - invalid JSON, conflict markers, missing keys, duplicates, placeholder mismatches, @key mismatches, values over the width cap), find (search keys by name or value, any locale), rename (oldKey newKey, ARB + Dart call sites, --no-callsite), delete (key… - refuses keys still used in lib/). No subcommand = auto-detect - conflicted ARB during merge → resolve, every key already exists → update, otherwise add (mixed batch is split). Global flags - -m/--module <name[,name…]|all> (default cloud), -l/--locales <tags>, -n/--dry-run, --no-build; --strict-width for add/update. English is the meaning source, the display width of the user's text is the length budget, every locale keeps the same key set, then the l10n code is regenerated. Never touches social_fi without explicit -m social_fi + confirmation, never commits or continues a merge. Use when the user runs /l10n, or asks to add / update / fix / translate / resolve / check / find / rename / delete l10n strings or ARB keys — "thêm chuỗi l10n", "sửa chuỗi l10n", "dịch chuỗi l10n", "thêm key đa ngôn ngữ", "resolve conflict ARB", "conflict file arb", "kiểm tra l10n", "tìm key l10n", "đổi tên key", "xóa key l10n".
---

# l10n

One skill for every localization task on the modular ARB files. The shared rules live in this
file; each subcommand has its own reference file with its syntax, flags, procedure and report.

> 📖 Hướng dẫn dùng (tiếng Việt) cho người dùng: xem [USAGE.md](./USAGE.md).

| Subcommand | Reference | Writes? | Auto-detected? |
|---|---|---|---|
| `add` | [add.md](./add.md) | ARB | yes |
| `update` | [update.md](./update.md) | ARB (+ cloud/bridge call sites) | yes |
| `resolve` | [resolve.md](./resolve.md) | ARB + `git add` of those ARB files | yes |
| `check` | [check.md](./check.md) | nothing | no |
| `find` | [find.md](./find.md) | nothing | no |
| `rename` | [rename.md](./rename.md) | ARB + call sites | no |
| `delete` | [delete.md](./delete.md) | ARB | no |

Instructions here are in English; **everything `/l10n` prints to the user is in Vietnamese**.

Helper scripts (run from the repo root):
- [scripts/arb_tool.dart](scripts/arb_tool.dart) — read-only: `info` (module discovery),
  `detect` (git state + key existence), `width` (display width / hard cap), `check`, `find`.
- [scripts/merge_arb.dart](scripts/merge_arb.dart) — the per-key 3-way merge used by `resolve`.

```
T=.claude/skills/l10n/scripts/arb_tool.dart
```

---

## 1. Routing

Syntax: `/l10n [subcommand] [flags] <entries…>`

### 1.1 Parse the argument
1. **Subcommand** = the first token if it is one of `add update resolve check find rename
   delete` (case-insensitive). Otherwise there is no explicit subcommand.
2. **Flags** are whitespace-separated tokens starting with `-` that appear **before the first
   entry**, or on a line that contains **only flags**. A `-x` inside an entry's text is content,
   never a flag. Strip every flag token before parsing entries. Unknown flag → stop and list the
   valid flags of that subcommand.
3. **Entries**: the rest, split on newlines; trim; drop blank lines. Each subcommand file defines
   its entry forms.

### 1.2 Explicit subcommand → run it
Validate the flags against the tables below; a flag that does not apply to the subcommand →
warn in one line and ignore it (except where the table says "stop").

### 1.3 No subcommand → auto-detect (only `add` / `update` / `resolve`)
Resolve the target module first (`-m`, default `cloud`), then, in this order:

- **(a) resolve** — a merge / rebase / cherry-pick is in progress **and** an ARB file of the
  target module is conflicted (`dart $T detect --module <m>` → `git:` ≠ `none` and
  `conflicted_arb:` ≠ `-`). Entries given in the same call are **not** processed (writing new
  keys into conflicted files is unsafe): say so and ask the user to re-run them after the
  resolve is staged.
- **(b) update** — every entry has an explicit key (form 2 `key: …`, form 3 `key: en=…`, or
  `key@locale: …`) and every key exists in the module's **template** ARB
  (`dart $T detect --module <m> key1 key2 …`).
- **(c) add** — otherwise.
- **Mixed batch** — some keys exist, some do not: split it. Existing keys → `update`, new keys
  and key-less entries → `add`, run in that order with a **single** build at the end, and say so
  in the report. Routing details:
  - `key@locale: …` is update-only syntax → always routed to `update` (a missing key is then
    reported "không tìm thấy key, bỏ qua", as `update` does).
  - A form-3 entry with an existing key → `update`, as one scoped entry per supplied tag (see
    [update.md](./update.md#form-3-on-an-existing-key)).
  - A content-only entry is always `add` (its generated key gets a numeric suffix on clash).
- `check`, `find`, `rename`, `delete` are **never** auto-detected.
- No entries and nothing to resolve → print the subcommand table from [USAGE.md](./USAGE.md)
  and stop.

**The first line of the output is always the subcommand that will run**, e.g.
`▶ /l10n add (tự nhận diện) · module cloud` or `▶ /l10n update + add (batch hỗn hợp: 2 update, 1 add) · module cloud`.

---

## 2. Modules and locale discovery

Modules are the folders under `lib/app/global/languages/modules/` that contain an `l10n.yaml`
(`dart $T info --modules all` prints them). **Never hard-code the locale list** — discover it:

1. Read `<module>/l10n.yaml`: `arb-dir` (folder of the ARB files), `template-arb-file`,
   `output-class` (accessor = output class with a lower-case first letter, e.g. `CloudL10n` →
   `context.cloudL10n`).
2. List the `*.arb` files in `arb-dir`; the locale of each file is its `@@locale` value (fallback:
   the file-name suffix).
3. Build **locale groups**:
   - `en` + `en_US` → group `en` (mirror each other — same value always)
   - `zh` + `zh_CN` → group `zh` (mirror each other)
   - `zh_TW` → `tw`, `zh_HK` → `hk`, every other locale → its own group (`ja`, `ko`, `id`, `lo`,
     `ru`, `hi`, `ur`, …)
   - A group exists only if the module has a file for it (`im` has no `en_US` / `zh_CN`, but has
     `zh_HK`).
4. **Tags** (case-insensitive) used by `-l`, by form-3 fields and by `@locale` scopes: `en`,
   `zh`/`cn`, `tw`, `hk`, `ja`, `ko`, `id`, `lo`, `ru`, `hi`, `ur`. Full codes (`en_US`, `zh_CN`,
   `zh_TW`, `zh_HK`) are aliases of their group. A tag the module has no file for → stop for that
   entry and list the module's groups.

Known shape today (verify with `info`; the discovery wins if it differs):

| Module | Prefix | Template | Accessor | Groups |
|---|---|---|---|---|
| cloud | `cloud_` | `cloud_en.arb` | `context.cloudL10n` | en, zh, tw, ja, ko, id, lo, ru, hi, ur |
| im | `im_` | `im_en.arb` | `context.imL10n` | en, zh, tw, hk, ja, ko, id, lo, ru, hi, ur |
| main | `intl_` | **`intl_zh.arb`** | `context.mainL10n` | as cloud |
| miner | `miner_` | `miner_en.arb` | `context.minerL10n` | as cloud |
| social_fi | `intl_` | `intl_en.arb` | `context.socialFiL10n` | as cloud — **other team** |
| wallet | `wallet_` | `wallet_en.arb` | `context.walletL10n` | as cloud |

The **template** file decides whether a key exists — the generator ignores a key missing from
it. English (`*_en.arb`) is still the meaning source even where the template is another locale
(`main`).

`lib/app/global/languages/modules/new_cloud/` is a stale leftover (no `l10n.yaml`, not built):
never read from it, never write to it.

---

## 3. Flags

### 3.1 Global flags

| Flag | Meaning | Applies to | Default |
|---|---|---|---|
| `-m`, `--module <name[,name…]\|all>` | Target module(s). `add`/`update`/`rename`/`delete` take **exactly one** — `all` or a list → stop and ask which one. `resolve`/`check`/`find` accept a list and `all`. `all` always skips `social_fi` (see §5) | all | `cloud` |
| `-l`, `--locales <tags>` | Comma-separated locale groups to write/check. `update`: same as a scoped update of those groups. `add`: the key is still written to **every** locale; locales outside `-l` get the `en` value and are listed as `⚠ chưa dịch`. `check`/`find`: only those groups. `rename`/`delete`/`resolve`: ignored with a warning (the key set must stay identical) | add, update, check, find | all groups |
| `-n`, `--dry-run` | Compute and show everything (values, widths, call sites, plan) — write nothing, do not build, do not stage | all (no-op for check/find) | off |
| `--no-build` | Skip `build_modular_l10n.dart` (and the analyzer step that needs it); print a reminder to run it | add, update, resolve, rename, delete | off |

### 3.2 Per-subcommand flags

| Subcommand | Flag | Meaning |
|---|---|---|
| `update` | `-f`, `--fill` | Batch-wide: after the scoped entries, regenerate every locale group of that key that the user did not supply, from the supplied text (via English) |
| `update` | `--no-callsite` | When a placeholder-set change flips a getter ↔ method, only **list** the call sites; do not edit them |
| `rename` | `--no-callsite` | Rename in the ARB files only; list the Dart call sites instead of editing them |
| `add`, `update` | `--strict-width` | A generated value over the hard cap → collect it and **ask** (AskUserQuestion, once per batch) instead of writing it with ⚠. Body text (`W > 80`) and the user's own text stay exempt |
| `resolve` | `-s`, `--single` | Multi-agent mode off: one agent decides every C2/C3 inline |
| `resolve` | `all` / module names (positional) | Same as `-m`, e.g. `/l10n resolve im`, `/l10n resolve cloud,wallet`, `/l10n resolve all` |
| `resolve` | `--include-social-fi` | With `all`, include `social_fi` (passed to `merge_arb.dart plan`) |
| `resolve` | `-y`, `--yes` | Skip the C1 confirmation question: keep the script's choice, still print the C1 table |
| `find` | `--in key\|value` | Search only key names or only values (default both) |
| `check` | `--limit <n>` | Rows shown per problem type (default 30) |

---

## 4. Shared rules (add / update; `check` measures with the same table)

### 4.1 Apply directly
`add` and `update` carry out the whole flow without asking for confirmation of keys, wording or
translations — apply, then report. Stop to ask **only** when: the input is unusable (no
parseable content / no key for `update`), `-m` names several modules for a single-module
subcommand, `social_fi` needs confirmation (§5), `--strict-width` found values over the cap,
or a call site outside the allowed paths must be edited (§5).

### 4.2 The user's text is verbatim
Detect the language of what the user typed and write that exact string, unchanged, into its own
locale group (both files of a mirror group). Never re-word, "improve", shorten for the budget, or
round-trip it through English. The same applies to every field of a form-3 entry and every
`key@locale` value.

### 4.3 English is the meaning source — one hop
1. Resolve the **English** value: the user's string if they typed English, otherwise a
   translation of it (the shortest idiomatic UI wording that fits `W`, §4.6).
2. Translate every **remaining** locale **from the English value** — never from the user's
   original language (a Chinese source must not skew Japanese / Korean).
3. Keep terminology consistent with the module's existing keys — grep the module's `*_en.arb`
   for nearby terms ("folder", "Recycle Bin", "Cloud Drive", …) before inventing one
   (`/l10n find` does this).

English governs **meaning**; length is governed by §4.4–4.7.

### 4.4 Length = display width, NOT `String.length`
Measured in half-em units (`dart $T width [--w <W>] "<text>" …` computes it):

| Character class | Width |
|---|---|
| CJK ideographs, Kana, Hangul syllables, full-width punctuation (`，。！？：；「」（）`) | **2** |
| Latin, Cyrillic, Lao / Devanagari / Arabic base letters, digits, spaces, ASCII punctuation | **1** |
| Lao combining marks — vowels above/below and tone marks (U+0EB1, U+0EB4–U+0EBC, U+0EC8–U+0ECD) | **0** |
| Devanagari (Hindi) combining marks — matras above/below and virama (U+0900–U+0902, U+093A, U+093C, U+0941–U+0949, U+094D, U+0951–U+0957, U+0962–U+0963) | **0** |
| Arabic (Urdu) combining marks — harakat / diacritics (U+064B–U+065F, U+0670, U+06D6–U+06ED) | **0** |

**Exclude `{placeholder}` tokens** from every measurement — the substituted value is identical
across locales. (For ICU `plural`/`select`, the widest branch counts.)

Worked examples: `Delete file` → 11. `删除文件` → 8. `Удалить файл` → 12. `파일 삭제` → 9
(4 Hangul × 2 + 1 space). `{count} files selected` → 15 (`" files selected"`).

### 4.5 Reference width `W`
`W` = display width of the text **the user typed**, in whatever language — the width the design
was sized for. (Per subcommand: form 3 → the `en` field if given, else the first supplied value;
`update --fill` → the `@en` value if given, else the widest supplied value; `check` → the `en`
value.)

### 4.6 Target and hard cap
Every value **you** produce (English included) must satisfy:
- **Target:** width ≤ `W`
- **Hard cap:** width ≤ `max(1.15 × W, W + 4)` (the `W + 4` term keeps short labels workable)

This bites hardest when the source is not English — Chinese is compact, so pick the shortest
idiomatic English UI term, not the literal one:
- `删除该文件？` (W = 12) → `Delete this file?` (17) ❌ → `Delete file?` (12) ✅
- `文件将被永久删除` (W = 16) → `This file will be permanently deleted` (37) ❌ →
  `File will be deleted permanently` (32, still over — flag it) / `Deleted permanently` (19) ✅

If the user typed English, the rule reduces to "no locale may be wider than the English".

### 4.7 Shortening order (over budget)
1. Drop politeness and filler (`please`, `您`, `ぜひ`, `Пожалуйста`).
2. Use the short conventional platform term (`Settings` → `设置` / `設定` / `설정`, not `设置选项页面`).
3. Reuse the wording an existing sibling key in the same file already uses.
4. Drop a subject/object the surrounding UI already makes obvious (`Delete this file?` → `Delete file?`).

**Never** truncate mid-word, append `…`, drop a `{placeholder}`, or drop meaning that changes what
the user will do.

### 4.8 Exemptions
- Anything the **user typed** (source content, every form-3 field, every scoped value) is written
  as-is and never shortened — report its width, do not change it.
- **Body text** (a full dialog-body / empty-state sentence, roughly `W > 80`) wraps freely: the
  cap is advisory — keep it accurate and note the overflow. Labels, buttons, chips, tabs have no
  such excuse.

Re-measure every value you wrote before building; re-word anything over the hard cap; whatever is
still over is flagged ⚠ in the report (or asked about, with `--strict-width`).

### 4.9 Placeholders and `@key` blocks
- Keep every `{placeholder}` identical across all locales; word order around it may change
  (`{count} files` → `{count} 个文件` → `{count}개 파일`).
- A key with placeholders gets an `@<key>` block in **every** file:
  ```json
  "@<key>": {
    "placeholders": { "placeholderName": {} }
  }
  ```
  Keep an existing block (description, types) — only its `placeholders` map is kept in sync.
- Generated methods take the placeholders **positionally, in declaration order**. A key with
  placeholders is a method (`l10n.key(a, b)`), without them a getter (`l10n.key`).

### 4.10 JSON validity and key-set parity
- ARB is plain JSON: keep commas and quotes valid; never reorder existing keys.
- Every locale file of a module must end with the **same key set** — the generator falls back to
  the template locale for a missing key, silently shipping another language.
- Mirror groups (`en`/`en_US`, `zh`/`zh_CN`) always hold the same value.

### 4.11 Tone
Concise, matching existing UI strings; sentence case for English; no trailing period unless the
source has one.

### 4.12 Build step
After **all** entries are written (once per run, not per entry):
```
dart run scripts/build_modular_l10n.dart        # `fvm dart run …` if the repo has .fvmrc
```
Non-zero exit → show the output (usually invalid JSON — a missing/extra comma), fix the ARB file
you wrote, re-run. `--no-build` / `-n` skip it — `--no-build` prints:
`⚠ Chưa build l10n — chạy: dart run scripts/build_modular_l10n.dart`.

### 4.13 Report table (add / update)
Per key: the key, `W`, then one row per locale **group**:

| Locale | Giá trị | Rộng | Ghi chú |
|---|---|---|---|
| en | Delete file | 11 | nguyên văn |
| zh | 删除文件 | 8 | dịch |
| ja | … | … | ⚠ vượt trần 17 > 15 |

Notes: `nguyên văn` (user's text), `dịch` (generated), `dịch (--fill)`, `⚠ vượt trần`,
`⚠ chưa dịch` (filled with `en` because of `-l`), `giữ nguyên` (not touched). `update` adds an
old → new column. Then: skipped entries, call sites changed/listed, build result, usage
(`context.<accessor>.<key>`).

---

## 5. Safety rules

- **social_fi** belongs to another team. Never write to it unless the user named it explicitly
  with `-m social_fi` **and** confirmed when asked (AskUserQuestion, before any write — this also
  applies to `resolve`). `-m all` always skips it; `resolve all` keeps its rule: ask once whether
  to include it, and if yes re-run `plan` with `--include-social-fi`. Read-only `check`/`find`
  may read it when named explicitly.
- **Dart edits** (`update`, `rename` call-site fixes) only inside `lib/features/cloud_storage/`
  and `lib/module_bridge/`. Call sites anywhere else → list them (`path:line`) and ask before
  editing. **Never** edit `lib/features/socialfi/` — list only.
- Never touch `lib/app/global/languages/modules/new_cloud/` or generated files
  (`lib/app/global/languages/generated/**`, `*.g.dart`, `*.freezed.dart`) — the build script
  regenerates them.
- Never commit, push, `git merge --continue`, `git rebase --continue` or `git cherry-pick
  --continue`. Only `resolve` stages files, and only the ARB files it wrote (`merge_arb.dart done`).
- `-n` means **no writes at all**: no ARB edit, no Dart edit, no build, no `git add` (for
  `resolve`: `plan` then `abort`).
- After any Dart edit run `dart analyze` on the touched files; when files under
  `lib/features/cloud_storage` changed also run `dart tool/check_layers.dart --summary` from
  `lib/features/cloud_storage/`.

A skill created / renamed mid-session may need a Claude Code restart to show up in the `/` list.
