#!/usr/bin/env bash
# Detect (and optionally clear) "phantom" git modifications: files that
# `git status` lists as modified although their content is identical to the
# index. Typical cause: core.autocrlf=true checked the file out as CRLF (the
# index stat cache records that size), then a codegen tool rewrote it with LF.
# The size no longer matches, so status reports "M" without comparing content.
#
# Usage: phantom.sh [--apply] [path]
#   path     file or directory to inspect (default: .). The owning repo is
#            resolved from the path itself, so nested repos work.
#   --apply  refresh the index stat info of the phantom files only (`git add`
#            of content identical to the index stages nothing), then verify.
#
# Never touches untracked files, real content changes, EOL-only or mode-only
# changes, and never rewrites the working tree.
set -uo pipefail
export LC_ALL=C

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; shift; fi
TARGET="${1:-.}"

[[ -e "$TARGET" ]] || { echo "ERROR: path not found: $TARGET" >&2; exit 2; }

if [[ -d "$TARGET" ]]; then DIR="$TARGET"; NAME=""; else DIR="$(dirname "$TARGET")"; NAME="$(basename "$TARGET")"; fi
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "ERROR: not inside a git repository: $TARGET" >&2; exit 2; }
PREFIX="$(git -C "$DIR" rev-parse --show-prefix)"
REL="${PREFIX}${NAME}"
REL="${REL%/}"
[[ -n "$REL" ]] || REL="."

# core.safecrlf=false silences the "LF will be replaced by CRLF" warning spam.
G() { git -C "$ROOT" -c core.quotepath=off -c core.safecrlf=false "$@"; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# Worktree-vs-index "M" as status reports it (stat based). -uno: never untracked.
G status --porcelain=v1 -uno -- "$REL" \
  | awk 'substr($0,2,1)=="M" && substr($0,1,1)!~/[RC]/ {print substr($0,4)}' \
  | sort -u > "$T/listed"
# Worktree-vs-index by content (after EOL conversion).
G diff --name-only -- "$REL" | sort -u > "$T/diff"
# Files with at least one changed line, ignoring CR at end of line.
G diff --ignore-cr-at-eol --numstat -- "$REL" \
  | awk -F'\t' '!($1=="0" && $2=="0") {print $3}' | sort -u > "$T/content"
G diff --summary -- "$REL" \
  | sed -n 's/^ mode change [0-7]* => [0-7]* //p' | sort -u > "$T/mode"

comm -23 "$T/listed" "$T/diff"    > "$T/phantom"
comm -12 "$T/listed" "$T/content" > "$T/real"
comm -23 "$T/mode" "$T/content"   > "$T/modeonly"
comm -23 "$T/diff" "$T/content" | comm -23 - "$T/mode" > "$T/eolonly"

count() { wc -l < "$1" | tr -d ' '; }
list()  { sed 's/^/    /' "$1"; }

echo "repo:     $ROOT"
echo "target:   $REL"
echo "autocrlf: $(G config --show-origin --get core.autocrlf 2>/dev/null | tr '\t' ' ' || echo unset)"
echo "listed as modified (status): $(count "$T/listed")"
echo "  phantom (stat only, content identical): $(count "$T/phantom")"
echo "  eol-only (real blob change, CRLF<->LF): $(count "$T/eolonly")"
[[ -s "$T/eolonly" ]] && list "$T/eolonly"
echo "  mode-only:                              $(count "$T/modeonly")"
[[ -s "$T/modeonly" ]] && list "$T/modeonly"
echo "  real content change:                    $(count "$T/real")"
[[ -s "$T/real" ]] && list "$T/real"

# Sample one phantom file to explain the cause (skip C-quoted names).
F="$(grep -v -m1 '^"' "$T/phantom" || true)"
if [[ -n "$F" ]]; then
  IDX="$(G ls-files --debug -- "$F" | sed -n 's/^ *size: \([0-9]*\).*/\1/p')"
  WT="$(wc -c < "$ROOT/$F" | tr -d ' ')"
  LINES="$(wc -l < "$ROOT/$F" | tr -d ' ')"
  CR="$(tr -cd '\r' < "$ROOT/$F" | wc -c | tr -d ' ')"
  if [[ "$CR" == "0" && "$IDX" == "$((WT + LINES))" ]]; then
    WHY="checked out as CRLF (autocrlf), rewritten as LF by a tool"
  elif [[ "$CR" != "0" && "$WT" == "$((IDX + CR))" ]]; then
    WHY="checked out as LF, rewritten as CRLF by a tool"
  elif [[ "$IDX" == "$WT" ]]; then
    WHY="same size, only timestamps changed"
  else
    WHY="size differs for another reason (inspect manually)"
  fi
  echo "cause sample: $F"
  echo "  index-size=$IDX worktree-size=$WT lines=$LINES CR=$CR -> $WHY"
  echo "  attributes: $(G check-attr text eol -- "$F" | sed 's/^.*: \(text\|eol\): /\1=/' | paste -sd' ')"
fi

[[ "$APPLY" == "1" ]] || exit 0

if [[ ! -s "$T/phantom" ]]; then
  echo "apply: nothing to refresh"
  exit 0
fi

G diff --cached --name-only | sort -u > "$T/cached_before"
G --literal-pathspecs add --pathspec-from-file=- < "$T/phantom"
G diff --cached --name-only | sort -u > "$T/cached_after"
comm -13 "$T/cached_before" "$T/cached_after" > "$T/newly"

if [[ -s "$T/newly" ]]; then
  echo "apply: ERROR - refresh staged real changes, rolling back:"
  list "$T/newly"
  G --literal-pathspecs restore --staged --pathspec-from-file=- < "$T/newly"
  exit 1
fi

LEFT="$(G status --porcelain=v1 -uno -- "$REL" | awk 'substr($0,2,1)=="M"' | wc -l | tr -d ' ')"
echo "apply: refreshed $(count "$T/phantom") file(s), nothing staged; still listed as modified: $LEFT"
