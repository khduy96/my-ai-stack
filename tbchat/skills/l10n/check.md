# /l10n check

**Report only — never writes a file**, never builds, never touches git. Shared width rules:
[SKILL.md §4.4–4.6](./SKILL.md#44-length--display-width-not-stringlength).

## Syntax

```
/l10n check [-m <module[,module…]|all>] [-l <tags>] [--limit <n>]
```

| Flag | Effect |
|---|---|
| `-m` | Default `cloud`; a list or `all` (skips `social_fi`; name it explicitly to read it) |
| `-l` | Check only these locale groups |
| `--limit <n>` | Rows shown per problem type (default 30) |
| `-n` | No-op (already read-only) |

## Procedure

1. Run:
   ```
   dart .claude/skills/l10n/scripts/arb_tool.dart check --modules <m> [--locales <tags>] [--limit <n>]
   ```
   Exit `0` = clean, `4` = problems found (not a failure of the command), `1` = error.
2. The script checks, per module (files and groups discovered from `l10n.yaml`):

   | Problem type (as printed) | Meaning |
   |---|---|
   | `JSON lỗi` | the file does not parse — message + offset |
   | `Conflict marker` | a line starting with `<<<<<<<`, `=======` or `>>>>>>>` |
   | `Thiếu key ở locale` | a key present in some locale file but missing in others (noted when it is not even in the template) |
   | `Key trùng` | the same key twice in one file (JSON parsers silently keep the last one) |
   | `Placeholder khác nhau giữa locale` | the `{placeholder}` sets of a key differ between locales |
   | `@key placeholder lệch` | an `@key.placeholders` map declares names the value does not use, misses names it uses, or the template value has placeholders but no `@key` block |
   | `Vượt trần độ rộng` | a locale value wider than `max(1.15 × W, W + 4)`, `W` = display width of the key's `en` value |
   | `Vượt trần (body, chỉ tham khảo)` | the same, for `W > 80` (advisory, not counted as an error) |
   | `Nhóm mirror lệch (info)` | `en` ≠ `en_US` or `zh` ≠ `zh_CN` for a key (info, not counted) |

3. Present the output as is (it is already Vietnamese markdown): first line
   `▶ /l10n check · module …`, then per module a **count per problem type** and a **table of the
   offending keys** per type. End with a short next-step hint per type, e.g. `Thiếu key` →
   `/l10n add` / `/l10n update -f`, `Vượt trần` → `/l10n update <key>@<locale>: …`,
   `Key trùng` → fix by hand / `/l10n delete` (only when unused), `Conflict marker` →
   `/l10n resolve`.

Do **not** fix anything inside `check`, even when the fix is obvious — propose the command.
