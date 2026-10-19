# /l10n add

Add one or more **new** keys to one module, auto-generating keys when needed and translating each
entry into **every** locale of the module. Shared rules: [SKILL.md §4](./SKILL.md#4-shared-rules-add--update-check-measures-with-the-same-table).
Safety: [SKILL.md §5](./SKILL.md#5-safety-rules).

## Syntax

```
/l10n add [-m <module>] [-l <tags>] [-n] [--no-build] [--strict-width] <entry>
<entry>
…
```

Also reached by auto-detect (no subcommand) when a key is new or the entry has no key.

| Flag | Effect here |
|---|---|
| `-m <module>` | Exactly one module (default `cloud`). `all` / a list → stop and ask which one. `social_fi` → ask to confirm first |
| `-l <tags>` | Only these groups are translated. The key is **still written to every locale**: groups outside `-l` get the `en` value and are reported `⚠ chưa dịch`. Groups the user typed text for are always written verbatim, even outside `-l` |
| `-n` | Show keys, values, widths and the exact insertion — write nothing, no build |
| `--no-build` | Write the ARB files, skip the build, print the reminder |
| `--strict-width` | Generated values over the hard cap → ask once per batch (options: ghi kèm ⚠ / tôi tự nhập giá trị / bỏ entry) instead of writing them with ⚠ |

## Entry forms (quotes optional)

1. **Content only** — `Delete file` or `"Delete file"` → key generated.
2. **Key + content** — `deleteFile: "Delete file"` or `"deleteFile": "Delete file"`.
3. **Explicit multi-language** — `|`-separated `tag=value` fields, optional leading key:
   - `deleteFile: en="Delete file" | zh="删除文件" | tw="刪除檔案"`
   - `en="Delete file" | ja="ファイル削除" | ko="파일 삭제"`
   - `en="Delete file"` (only EN → every other group translated from it)
   - Tags: the module's groups ([SKILL.md §2](./SKILL.md#2-modules-and-locale-discovery)) —
     `en`, `zh`/`cn`, `tw`, `hk`, `ja`, `ko`, `id`, `lo`, `ru`, `hi`, `ur`; full codes (`en_US`,
     `zh_CN`, `zh_TW`, `zh_HK`) are aliases. A tag the module has no file for → stop for that entry.
   - Supplied tags are written **verbatim** (never re-translated, never shortened); omitted tags
     are translated **from EN**.

**Multiple entries — one per line**; forms can be mixed:

```
/l10n add Delete file
moveToFolder: "Move to folder"
来自发现
From the chat between {username1} and {username2}
renameOk: en="Rename" | zh="重命名" | tw="重新命名"
```

## Procedure

0. **Discover the module** (`dart $T info --modules <m>`): template file, files, groups, accessor.
   **Split into entries**; process each with steps 1–9. Within one batch, entries already
   processed count as "already added" — two lines resolving to the same key are de-duplicated /
   suffixed.
1. **Parse.** An entry containing one or more `<tag>=<value>` fields is form 3: split on `|`, split
   each field on the first `=`, strip quotes; a `key:` before the first field is the key.
   Otherwise form 1/2: optional `key` + one `content`.
2. **Pin the user's text** (§4.2): detect the language of `content` (form 1/2) and mark that group
   verbatim; for form 3 every supplied tag is verbatim. Verbatim groups skip every re-wording and
   shortening step.
3. **Measure `W`** (§4.5) of the user's text — form 3: the `en` field if given, else the first
   supplied value. `dart $T width "<text>"`.
4. **Resolve the English value** (§4.3) — form 1/2: verbatim if English, else the shortest
   idiomatic UI translation within `W`; form 3: the `en` field verbatim, else translate the nearest
   supplied value under the same constraint.
5. **Key.**
   - **Provided by the user** → if it already exists in the template ARB (or earlier in the batch),
     **skip** the entry and report it (suggest `/l10n update <key>: …`). Never create a conflicting
     entry.
   - **Generated** (none given) → from the **English** value, **camelCase**, **≤ 30 characters**,
     punctuation stripped, descriptive but short (`Delete file` → `deleteFile`,
     `文件将被永久删除` → `fileDeletedPermanent`). If it already exists → append a short numeric
     suffix (`deleteFile2`) and warn.
6. **Produce one value per locale file.** For each group: verbatim if pinned, otherwise translate
   from English, measure, re-word anything over the hard cap (§4.6–4.8). Mirror groups get the same
   value in both files (a string pinned to `zh` lands in `zh` and `zh_CN`).
   With `-l`: groups outside `-l` and not pinned get the `en` value → `⚠ chưa dịch`.
   With `--strict-width`: collect over-cap values, ask once, apply the answers.
7. **Placeholders** (§4.9): keep them identical; add the `@<key>` block in every file.
8. **Duplicate check**: grep the key in every locale file of the module; present anywhere → skip
   and report (the key set would diverge).
9. **Append at the END of each file** — just before the final `}`; never after `@@locale`:
   - The current last entry has no trailing comma → add one, then append the new entry.
   - Deterministic edit: match the file's final `}` together with the preceding entry, replace so
     the preceding entry gains a comma and the new entry (+ `@<key>` block) sits before `}`.
   - With placeholders the `@<key>` block is the last item → no trailing comma before `}`.
   - Keep the file's ending shape (these files end with `}` and no trailing newline — keep it).
   ```json
       "someExistingKey": "…",
       "deleteFile": "Delete file",
       "fromChatBetweenUsers": "From the chat between {username1} and {username2}",
       "@fromChatBetweenUsers": {
         "placeholders": { "username1": {}, "username2": {} }
       }
     }
   ```
   With `-n`: show the planned values and stop here.
10. **Build once** (§4.12) after all entries, unless `--no-build`.
11. **Report** (§4.13): `▶ /l10n add …` first line, a table per entry, then skipped entries
    (existing key / unusable input), `⚠ chưa dịch` groups, over-cap values, build result and usage:
    ```dart
    context.cloudL10n.deleteFile                     // no placeholder
    context.cloudL10n.fromChatBetweenUsers(u1, u2)   // with placeholders
    ```
    (use the module's accessor — `imL10n`, `walletL10n`, `minerL10n`, `mainL10n`, …).

Tip: run `/l10n find <word>` first to avoid a near-duplicate of an existing key.
