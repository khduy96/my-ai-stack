# /l10n update

Overwrite the value of **existing** keys in one module, **in place** (never moves, reorders or
duplicates a key, never creates one), then regenerate. Shared rules:
[SKILL.md §4](./SKILL.md#4-shared-rules-add--update-check-measures-with-the-same-table).
Safety: [SKILL.md §5](./SKILL.md#5-safety-rules).

## Syntax

```
/l10n update [-m <module>] [-l <tags>] [-f] [--no-callsite] [-n] [--no-build] [--strict-width] <entry>
<entry>
…
```

Also reached by auto-detect when every entry's key already exists (or for the existing part of a
mixed batch).

| Flag | Effect here |
|---|---|
| `-m <module>` | Exactly one module (default `cloud`); `all` / a list → stop and ask. `social_fi` → confirm first |
| `-l <tags>` | Write only these groups — the same as a scoped update of each of them. An unscoped entry is translated (via English) into those groups only; the user's own-language group is written only if it is in `-l`. With `-f`, filling is limited to `-l` too |
| `-f`, `--fill` | Batch-wide, see below |
| `--no-callsite` | Placeholder-set change → list the call sites, do not edit them |
| `-n` | Show old → new values, widths and the call sites that would change — write nothing, no build |
| `--no-build` | Write, skip the build (and therefore the call-site analysis step), print the reminder |
| `--strict-width` | Generated values over the hard cap → ask once per batch instead of writing with ⚠ |

## Entry forms — a key is always required (quotes optional)

1. **All locales** — `deleteFile: "Remove file"`: the user's text is verbatim in its own group;
   resolve the new English value, re-translate every other group from it.
2. **One locale group** — `deleteFile@zh: "移除文件"`: write that group only, verbatim, no
   translation, no shortening; every other file (even English) untouched. Scopes: `@en`,
   `@zh`/`@cn`, `@tw`, `@hk`, `@ja`, `@ko`, `@id`, `@lo`, `@ru`, `@hi`, `@ur` (+ aliases `@en_US`,
   `@zh_CN`, `@zh_TW`, `@zh_HK`) — limited to the groups the module has.

#### Form 3 on an existing key
`key: en="…" | zh="…"` (only via auto-detect or explicit `update`) = one scoped entry per supplied
tag (`key@en: …`, `key@zh: …`). Without `-f` only those groups change; with `-f` the rest is filled.

**Multiple entries — one per line**; both forms can be mixed.

### `-f` / `--fill`
By default a scoped entry touches only its own group, leaving the other locales on old, now
inconsistent wording. `-f` also regenerates every group the user did **not** supply for that key,
from the text they did supply:

```
/l10n update -f
deleteFile@en: "Remove file"
deleteFile@zh: "移除文件"
deleteFile@tw: "移除檔案"
deleteFile@ru: "Удалить файл"
```
→ `en`, `zh`, `tw`, `ru` verbatim; `ja`, `ko`, `id`, `lo`, `hi`, `ur` translated from the English
value and width-checked. Nothing the user typed is altered.
- **Batch-wide**: the flag may sit on its own line or before the first entry; it applies to every
  key of the batch.
- Affects **scoped** entries only — an unscoped entry already rewrites every group (no-op).
- **Without the flag nothing changes** — scoped means scoped.

## Procedure

0. **Discover the module** (`dart $T info --modules <m>`); split into entries; detect and strip
   `-f`. Steps 1–5 per entry, step 6 per key.
1. **Parse** into `key`, optional `@scope`, `content`. No key (content only) → stop for that entry:
   "cần có key" — suggest `/l10n add` if they meant to add.
2. **Verify the key exists** in the template ARB (`dart $T detect --module <m> <key>`). Missing →
   "không tìm thấy key, bỏ qua", suggest `/l10n add`. Scoped → also confirm it exists in that
   group's file(s).
3. **Compute the new value(s):**
   - **Unscoped** → pin the content's group verbatim (§4.2), measure `W` from it, resolve English
     (verbatim if English, otherwise translated within `W`) → `en` group; translate the remaining
     groups from English and check each against `W` (§4.6–4.8). `-l` limits which groups are written.
   - **Scoped** → `content` as-is for that group only.
4. **Placeholders** (§4.9): keep them identical; keep the existing `@<key>` block. If the
   placeholder **set** changes, update the `@<key>` `placeholders` map in **every** file (add the
   block when placeholders appear, remove the entries for placeholders that are gone; never leave a
   dangling one).
5. **Replace in place.** In each target file replace only the value of the existing
   `"<key>": "<old value>"` line (match the full line with that file's own old value). Commas stay
   exactly as they were. Never move, reorder or append.

Then **once per key**:

6. **Fill — only with `-f`.** Group the batch's scoped entries by key.
   - Supplied groups stay verbatim (already written).
   - English: the `@en` value if supplied, otherwise translate the nearest supplied value (prefer
     `@zh`/`@tw` over a locale with fewer examples) — then `en`/`en_US` count as **filled**, not
     verbatim, and must respect the budget.
   - `W` = the `@en` value if given, else the **widest** supplied value.
   - Translate each missing group from English, width-check, write in place as in step 5.
7. **Leave everything else alone** — only listed keys change, and without `-f` only the listed
   groups within them.
8. **Build once** (§4.12) unless `--no-build` / `-n`.
9. **Call sites — automatic, not a question.** If a key's placeholder set changed so the generated
   accessor flipped between getter and method (or its arity changed), after the build grep
   `\.<key>\b` under `lib/` (exclude generated files and `*.arb`) and fix each call
   (`context.<accessor>.<key>` ↔ `context.<accessor>.<key>(args…)`, positional in declaration order):
   - Inside `lib/features/cloud_storage/` and `lib/module_bridge/` → edit directly.
   - Elsewhere → list `path:line` and ask before editing; `lib/features/socialfi/` → list only.
   - `--no-callsite` → list everything, edit nothing.
   Then `dart analyze` the touched files (+ `check_layers --summary` for cloud).
10. **Report** (§4.13) per key: `W`, every group touched with old → new value, width, and
    `nguyên văn` / `dịch` / `dịch (--fill)`, ⚠ over cap; skipped entries; call sites changed or
    listed; build + analyzer result. Without `-f`, list the groups of each key still on older,
    inconsistent wording — the cue to re-run with `-f`.

Renaming a key is `/l10n rename`; adding one is `/l10n add`.
