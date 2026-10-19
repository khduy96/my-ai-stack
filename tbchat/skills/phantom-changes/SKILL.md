---
name: phantom-changes
description: Detect and clear "phantom" git changes — files that `git status` / the IDE change list shows as modified although their content is identical to the index (typically after codegen such as scripts/pull_buf_proto.dart rewrites files with LF while core.autocrlf=true checked them out as CRLF). Classifies every listed file into phantom / EOL-only / mode-only / real change, explains the cause, refreshes only the phantom ones (stages nothing), and suggests a .gitattributes rule to stop it recurring. Use when the user says many files are listed as changed but have no content change, "no content change nhưng vẫn bị liệt kê", or asks to clean up git noise in a folder. Accepts an optional path (file or folder) and "-n" for a dry run.
---

# phantom-changes

Find files that git reports as modified with **no real content change**, explain why, and
clear them from the change list — without touching real changes, untracked files, or the
working tree.

> 📖 Hướng dẫn dùng (tiếng Việt): xem [USAGE.md](./USAGE.md).

## Why it happens

The index stat cache records each file's size/mtime at checkout. With `core.autocrlf=true`
(set system-wide by Git for Windows), checkout writes **CRLF**, so the recorded size includes
one `\r` per line. When a tool later rewrites the file with **LF** (same text), the size no
longer matches and `git status` reports `M` **without comparing content** — while `git diff`
(which does compare content) shows nothing. `git add` of such a file stages nothing (same
blob) but updates the stat cache, which clears it from the list.

## Arguments

- `path` (optional) — a file or folder. Default: the current working directory. The script
  resolves the git repo that **owns the path**, so nested repos work — e.g.
  `lib/features/cloud_storage` is its own repo, separate from the project root repo.
  Known hotspot: `lib/features/cloud_storage/data/_grpc/storage_generated`.
- `-n` (optional) — dry run: report only, do not refresh.

## Command

Run from the project root with the **Bash** tool (Git Bash, not PowerShell):

```
bash .claude/skills/phantom-changes/scripts/phantom.sh [--apply] <path>
```

Pass `--apply` unless the user gave `-n`. The script always prints the report first, then
(with `--apply`) refreshes the phantom files and verifies.

## What the script does

1. **listed** = `git status --porcelain -uno` entries whose worktree column is `M`
   (`-uno`: untracked files are never included).
2. Classifies each listed file:
   - **phantom** — listed, but `git diff --name-only` (content-based) doesn't show it.
   - **eol-only** — real blob change consisting only of CRLF↔LF (not in
     `git diff --ignore-cr-at-eol --numstat`).
   - **mode-only** — only the file mode changed (`git diff --summary`).
   - **real** — actual line changes.
3. Samples one phantom file: index-recorded size vs worktree size, line count, CR count →
   names the cause (e.g. "checked out as CRLF (autocrlf), rewritten as LF by a tool"), plus
   its `text`/`eol` attributes.
4. With `--apply`: `git add` **only the phantom files** (via `--pathspec-from-file`, literal
   pathspecs), then checks that `git diff --cached` gained no entries. If anything got staged
   it rolls those paths back with `git restore --staged` and exits 1.

Exit codes: `0` ok, `1` rollback happened (report it), `2` bad path / not a git repo.

## Procedure

1. Resolve the path (user arg, or ask if the context makes the target folder unclear —
   running it on the whole project root repo misses nested repos like cloud_storage).
2. Run the script (with `--apply` unless `-n`).
3. **Report in Vietnamese**, briefly:
   - Owning repo + counts per bucket.
   - Files with **real** changes (clickable) — these are left untouched.
   - **eol-only** / **mode-only** files, if any — left untouched; explain that they are real
     blob changes (committing them would change line endings / modes), and ask whether the
     user wants them reverted (`git restore -- <file>`) or kept. Don't do it unasked.
   - The cause line from the sample.
   - Apply result: how many refreshed, confirm nothing was staged.
4. **Prevention**: if the cause is CRLF/LF and the sample's `eol` attribute is
   `unspecified`, suggest adding to the **owning repo's** `.gitattributes`:
   ```
   <folder relative to that repo>/** text eol=lf
   ```
   (e.g. `data/_grpc/storage_generated/** text eol=lf` in the cloud_storage repo). Checkout
   then writes LF, matching the generator, so regenerated files stop showing up. Ask before
   writing it — it's a committed repo change.

## Rules

- Never `git add` untracked files, real / eol-only / mode-only changes.
- Never rewrite the working tree (`git checkout --`, `git restore` without `--staged`,
  `git stash`) and never commit — unless the user explicitly asks.
- Don't change `core.autocrlf` globally; prefer the per-repo `.gitattributes` fix.

## Notes

- If the IDE's Source Control panel still shows the files right after a refresh, click
  refresh in that panel — it caches status.
- A skill created/edited mid-session may not appear in the `/` list until Claude Code is
  restarted.
