# /l10n find

Search keys by **key name** or by **value text** in any locale, case-insensitive. Read-only. Use it
before `/l10n add` to avoid adding a near-duplicate of an existing key, and to reuse existing
terminology ([SKILL.md §4.3](./SKILL.md#43-english-is-the-meaning-source--one-hop)).

## Syntax

```
/l10n find [-m <module[,module…]|all>] [-l <tags>] [--in key|value] <text…>
```

| Flag | Effect |
|---|---|
| `-m` | Default `cloud`; a list or `all` (skips `social_fi`; name it explicitly to search it) |
| `-l` | Match values only in these locale groups (key names always match) |
| `--in key\|value` | Search only key names / only values (default both) |
| `-n` | No-op (already read-only) |

Everything after the flags is the query (spaces allowed).

## Procedure

1. Run:
   ```
   dart .claude/skills/l10n/scripts/arb_tool.dart find --modules <m> [--locales <tags>] [--in key|value] <text>
   ```
2. Show, per module, a table `Key | en | Khớp` — the key, its `en` value, and the matching locale
   values (`locale: value`, at most 3 + a count); `(tên key)` when only the key name matched. The
   heading shows the accessor (`context.cloudL10n.<key>`).
3. First line `▶ /l10n find "<text>" · module …`. Nothing found → say so and, if the user is about
   to add a string, suggest `/l10n add`.
4. When the user is choosing between adding and reusing: point out the closest existing key(s)
   (same meaning, same placement) and suggest reusing them.
