# /l10n rename

Rename a key (and its `@key` block) in every locale of one module, then update the Dart call
sites. Safety: [SKILL.md §5](./SKILL.md#5-safety-rules).

## Syntax

```
/l10n rename [-m <module>] [--no-callsite] [-n] [--no-build] <oldKey> <newKey>
```

| Flag | Effect |
|---|---|
| `-m` | Exactly one module (default `cloud`); `all` / a list → stop and ask. `social_fi` → confirm first |
| `--no-callsite` | Rename in the ARB files only; list the call sites, do not edit them |
| `-n` | Show the ARB lines and call sites that would change — write nothing, no build |
| `--no-build` | Skip the build and the analyzer step; print the reminder |
| `-l` | Ignored with a warning (the key set must stay identical) |

One pair per call (a batch is one `oldKey newKey` pair per line).

## Procedure

1. **Validate.**
   - `oldKey` exists in the template ARB; else stop ("không tìm thấy key").
   - `newKey` is lowerCamelCase, a valid Dart identifier, ≤ 30 characters, not a Dart keyword, and
     **absent** from every locale file of the module; else stop.
2. **Find the call sites** (before editing anything): grep `\.<oldKey>\b` under `lib/` — this
   covers `.<oldKey>` getters and `.<oldKey>(` methods — excluding
   `lib/app/global/languages/generated/**`, `*.g.dart`, `*.freezed.dart` and `*.arb`. Keep only
   real l10n uses (receiver is `context.<accessor>`, an l10n variable such as `_l10n`, or
   `<OutputClass>.of(context)!`); an unrelated member with the same name is listed separately as
   "không phải l10n — bỏ qua".
3. **Classify** the call sites:
   - `lib/features/cloud_storage/` and `lib/module_bridge/` → will be edited.
   - Anywhere else → list `path:line` and ask once whether to edit them too;
     `lib/features/socialfi/` → never edited, listed only (the rename then leaves it broken — say
     so and suggest not renaming, or coordinating with that team).
   - `--no-callsite` → nothing is edited, everything listed.
   With `-n`: show steps 2–3 plus the ARB lines, stop.
4. **Rename in every locale file** — in place, same position: replace `"<oldKey>":` with
   `"<newKey>":` and `"@<oldKey>":` with `"@<newKey>":`. Values, commas and order unchanged. JSON
   stays valid. Every file of the module, including ones where the key is missing (report those).
5. **Build** (SKILL.md §4.12) unless `--no-build`.
6. **Edit the call sites** chosen in step 3: replace the member name only (`.oldKey` → `.newKey`),
   keep arguments.
7. **Analyze**: `dart analyze <touched files>` (+ `dart tool/check_layers.dart --summary` from
   `lib/features/cloud_storage/` when cloud files changed). Report any remaining error.
8. **Report**: first line `▶ /l10n rename <oldKey> → <newKey> · module …`; ARB files changed;
   call sites edited (`path:line`); call sites listed but not edited (and why); build + analyzer
   result.
