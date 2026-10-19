# /l10n delete

Remove unused keys (and their `@key` blocks) from every locale of one module. A key that is still
used is never deleted. Safety: [SKILL.md §5](./SKILL.md#5-safety-rules).

## Syntax

```
/l10n delete [-m <module>] [-n] [--no-build] <key> [<key> …]
```

Keys separated by spaces, commas or newlines.

| Flag | Effect |
|---|---|
| `-m` | Exactly one module (default `cloud`); `all` / a list → stop and ask. `social_fi` → confirm first |
| `-n` | Show which keys would be removed / kept and the exact lines — write nothing, no build |
| `--no-build` | Skip the build; print the reminder |
| `-l` | Ignored with a warning (the key set must stay identical) |

## Procedure

1. **Validate** each key exists in at least one locale file of the module; otherwise report
   "không tìm thấy" for it.
2. **Usage check per key**: grep `\b<key>\b` under `lib/`, excluding
   `lib/app/global/languages/generated/**`, `*.g.dart`, `*.freezed.dart` and `*.arb`.
   - Any **real** use (an l10n access `.<key>` / `.<key>(`, or the key as a string literal used to
     look it up) → **STOP for that key**: keep it and list the call sites (`path:line`).
   - Matches that are clearly something else (a local variable, a different class member with the
     same name) → list them as "không phải l10n", treat the key as unused, and say so.
   With `-n`: show the result per key and the lines that would be removed, stop.
3. **Remove** each unused key from **every** locale file: the `"<key>": …` entry and its
   `"@<key>": { … }` block (the whole block, however many lines). Keep JSON valid:
   - Removing a middle entry: remove the entry together with its trailing comma.
   - Removing the **last** entry: also remove the trailing comma of the entry that becomes the new
     last one.
   - Keep the file's ending shape (final `}`, no trailing newline when there was none).
   - A key duplicated in a file → remove every occurrence, and report it.
4. **Build** (SKILL.md §4.12) unless `--no-build`.
5. **Report**: first line `▶ /l10n delete · module …`; a table `Key | Kết quả | Chi tiết` with
   `đã xoá (n file)`, `giữ lại — còn dùng` + call sites, or `không tìm thấy`; build result.
