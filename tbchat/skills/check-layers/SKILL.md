---
name: check-layers
description: Validate the cloud_storage module (lib/features/cloud_storage) against the cloud layer rules (.claude/_rule/cloud/layer-rules.md, enforced by tool/check_layers.dart) and FIX every violation found so the code follows the rules — moves imports to the right layer, injects dependencies through constructors instead of getIt, moves repository interfaces to domain/repositories, replaces proto/Flutter types in contracts with domain types, routes cross-feature calls through module_bridge. By default fixes only NEW violations (the ones that block git push); "-all" also pays down old baseline debt inside a given path/rule and shrinks tool/layer_baseline.txt. Local fixes are applied directly; structural ones (move files, change a repository contract, touch many files) are shown as a plan and applied after "code đi". Flags - "-n" report + fix plan only, "-y" apply structural fixes without waiting, "--rule=<name>", optional path. Use when the user runs /check-layers, or asks to "check layer / kiểm tra rule layer / sửa vi phạm layer / valid lại với rule".
---

# check-layers — kiểm tra & sửa vi phạm layer của cloud_storage

Run the layer check, then **fix the violations** so the code obeys
[layer-rules.md](../../_rule/cloud/layer-rules.md). The script
`lib/features/cloud_storage/tool/check_layers.dart` is the source of truth — if the rule file
and the script disagree, the script wins. Re-read the rule file at the start of every run (it
may have changed).

> 📖 Hướng dẫn dùng (tiếng Việt): xem [USAGE.md](./USAGE.md).

Below, `CS/` = `lib/features/cloud_storage/`, `MB/` = `lib/module_bridge/`.

## Input

`/check-layers [path] [--rule=<name>] [-all] [-n] [-y]`

| Arg | Meaning |
|---|---|
| *(none)* | Fix all **new** violations (not in the baseline) in the whole module |
| `path` | Only fix violations whose file is under this path (relative to CS or the repo root) |
| `--rule=<name>` | Only this rule (`domain`, `presentation`, `ui-entity`, `application`, `data`, `data-entity`, `model_view`, `shared`, `shared-data`, `cross-feature`, `repository-location`, `repository-contract`, `cubit-locator`, `widget-locator`, `shared-locator`, `shared-structure`) |
| `-all` | Also fix **old** violations listed in `tool/layer_baseline.txt`. Requires `path` or `--rule` (the baseline has ~500 lines — never sweep it all in one run) |
| `-n` | Dry run: report + fix plan, edit nothing |
| `-y` | Apply structural (Tier B) fixes right away instead of waiting for "code đi" |

## Hard rules

- **Never** add lines to `tool/layer_baseline.txt` by hand, and never run `--generate` (only for
  changing the rules in the script). The baseline may only shrink.
- Edit only under `CS/` and `MB/`. Never `lib/features/socialfi/`. If a fix needs a change in
  another feature (or in a caller outside CS/MB), stop and tell the user what that side needs.
- A layer fix is a **behaviour-preserving refactor**: same logic, same results, same public API
  used from outside CS (bridge interfaces, transponders, routes). Don't "improve" anything
  else while fixing. Prefer adding new files/classes (new domain entity, new use case, new
  constructor param) over rewriting stable code.
- Never fix one violation by creating another — every move must land in a layer allowed to
  hold it (see the playbook).
- Don't commit. `CS/` is its own git repo (`git -C lib/features/cloud_storage ...`).

## Procedure

### 1. Run the check (read-only)
From `CS/`:
```
dart tool/check_layers.dart --summary
```
- With `-all`: `dart tool/check_layers.dart --summary --list` (or `--list=<rule>`) to get every
  known location too.
- Parse each violation block: rule name, then lines `path:line:col` followed by
  `→ imports <x>` / `→ uses getIt<T>` / `→ <type>` details. "new" blocks are the ones under
  `── <rule> · N new · mới ──`.
- Filter by `path` / `--rule`. Nothing left → report `No new violations` (plus baseline total)
  and stop.

### 2. Classify each violation

- **Tier A — local**: the fix stays inside the violating file plus at most its direct wiring
  (its constructor call sites, an import swap, a new constructor param, `/build -get`). Apply
  directly (unless `-n`).
- **Tier B — structural**: moving a file/interface, creating a new domain entity or use case,
  changing a repository contract and its Impl, touching > 3 files, or touching stable code
  used outside CS. Show the plan; apply only after the user says **"code đi"** (or `-y`).

For each one, read the violating file and the imported/located symbol before deciding — the
right fix depends on **what the code uses** from the forbidden import.

### 3. Fix playbook (per rule)

| Rule | Typical cause | Fix |
|---|---|---|
| `domain` (domain imports `data/`) | uses a data type (proto, DB class, `*Impl`, data model) | Use/declare the domain equivalent: interface in `domain/repositories/`, entity/params in `domain/entities/`; mapping happens in the `data/` Impl. If the type is already re-declared in domain, just switch the import |
| `domain` (domain imports `package:flutter/` / `package:grpc/`) | `@immutable`, `ValueNotifier`, `debugPrint`, `GrpcError` | `@immutable` → `package:meta/meta.dart`; `ValueNotifier` → `Stream`/return value; `debugPrint` → `shared/utils/cloud_logger.dart`; `GrpcError` → typed domain exception thrown by the Impl |
| `domain` (domain imports `tbchat_main/database/...`) | uses `tbchat_database.dart` / DB class | Import the specific file under `database/tables/cloud_storage/` if it's `CloudFile`/`CloudFolder`; otherwise go through a `domain/repositories/` interface |
| `domain` (imports `model_view/`, `application/`, UI) | view model / UI type in domain | Move the plain-data type to `domain/entities/`; leave view-model building to the cubit |
| `presentation` (pages / shared widgets import `data/` or grpc) | cubit/page uses a data repo, mapper, data model | Inject a use case or `domain/repositories/` interface into the cubit. A mapper used by the UI: if it maps data→entity, move the mapping into the repository Impl so the repo returns the entity; if it maps entity→view, move it to `model_view/` or the page folder. If the interface still lives in `data/`, do `repository-location` first |
| `ui-entity` (UI / model_view import `tbchat_main/database/...`) | `tbchat_database.dart` import | Import the exact `database/tables/cloud_storage/...` file if only `CloudFile`/`CloudFolder` are used; other DB types → read via repository/use case |
| `application` (imports UI) | navigation / widget in application | Return a result; let `pages/` do UI/navigation |
| `data` (imports UI, `go_router`, `material`/`cupertino`) | `ValueNotifier`, `debugPrint`, `Color`, navigation | `ValueNotifier`/`debugPrint` → `package:flutter/foundation.dart`; navigation/dialog → return a result for the page; UI values (`Color`, `IconData`) → domain enum, mapped in the page |
| `data-entity` (data imports `model_view/`, or contract uses a view-model type) | repo returns a view model | Return `CloudFile`/`CloudFolder` (wrap in `CloudItem` if mixed) or a domain entity; the cubit builds the view model |
| `model_view` (imports `pages/`/`transponder/`) | type declared in a page | Move the type to `domain/entities/` or `model_view/`; update imports |
| `shared` (shared imports `pages/`/`transponder/`) | helper depends on a page type | Move the code into the page that needs it, move the type to `domain/entities/`/`model_view/`, or pass it in as a parameter |
| `shared-data` (shared imports `data/`) | data logic in shared | Move to `data/` (if data logic) or pass the value/dependency as a parameter |
| `cross-feature` (`package:tbchat_main/features/<other>/`) | direct call into another feature | Use an existing interface in `MB/`; if none, add a new interface in `MB/` and tell the user the other feature must implement it (never edit socialfi) — Tier B |
| `repository-location` (`abstract/interface class *Repository` outside `domain/repositories/`) | interface in `data/` | Move the interface to `domain/repositories/` (keep `*Impl` in `data/`), update imports. If it only wraps a gRPC/HTTP client and is used only in `data/` → rename to `*DataSource` instead. Tier B |
| `repository-contract` (proto, `Map<String, dynamic>`, `VoidCallback`, `ValueNotifier`, `ValueListenable`, `BuildContext`, `Widget`, `GrpcError`, `ResponseFuture` in an interface body) | leaking data/Flutter types | Add an entity/params class in `domain/entities/`, map in the Impl, return results instead of taking callbacks; update callers. Tier B |
| `cubit-locator` (`getIt` inside a `*Cubit`/`*Bloc`) | service located inside the cubit | Add a constructor parameter (prefer a domain interface/use case over a DB/data class — if only a data class exists, a constructor param of that type is still the minimum fix and removes the locator). If the cubit is `@injectable`, injectable fills it in → run `/build -get`; update manual `XxxCubit(...)` call sites |
| `widget-locator` (UI gets a service via `getIt`) | widget calls a service | Move the call into the cubit (injected via constructor) and read the result from state, or pass the value as a parameter. `getIt<XxxCubit>()` / `getIt<XxxBloc>()` is allowed |
| `shared-locator` (`getIt` in `shared/` outside routes/navigators/network) | helper locates a service | Take the dependency as a parameter; the calling cubit (constructor-injected) passes it |
| `shared-structure` (files in `shared/domain/` or `shared/data/`) | misplaced file | Entities → `domain/entities/`, data code → `data/`; update imports |

General: check whether a domain interface / use case / entity already exists before creating
one (grep `CS/domain/`). Mirror sibling files for style (`final class`, `@LazySingleton()`,
`@injectable` cubits, use cases per [create-usecase](../create-usecase/SKILL.md)).

### 4. Plan output (always shown before Tier B edits; also the whole output of `-n`)

```
## Kiểm tra layer — <phạm vi>
**Kết quả:** <N> vi phạm mới · baseline <M> (nợ cũ) · rule: ...

| # | File:line | Rule | Nguyên nhân | Cách sửa | Tier | File sẽ sửa/tạo |
|---|-----------|------|-------------|----------|------|-----------------|

**Tier A sẽ sửa ngay:** #...
**Tier B cần "code đi":** #...  (hoặc chạy lại với -y)
**Cần phía khác (ngoài CS/MB):** ...
```

### 5. Apply
- Tier A immediately (unless `-n`); Tier B after "code đi" / `-y`.
- Several independent Tier B fixes touching disjoint files → may run as parallel background
  subagents (one per file group), each briefed with this playbook row, the rule file path, the
  exact files it owns, and "don't edit layer_baseline.txt, don't run build_runner, don't commit".
- If an analyzer error blocks a fix inside the touched files, fix it with a safe default + a
  `// TODO(cloud): ...` note instead of stopping.

### 6. Verify (loop up to 3 rounds)
1. Constructor/DI changed → `/build -get`; `@Entity` changed → `/build -obj`.
2. `dart analyze <touched files>` (or `/analyze-cloud` on the folder) — no new errors.
3. `dart tool/check_layers.dart --summary` → `No new violations` (or only violations outside the
   requested scope that existed before this run).
4. Still failing → fix and repeat; after 3 rounds stop and report what remains and why.

With `-all` and old violations fixed: run `dart tool/check_layers.dart` (without `--summary`)
once so the script drops the fixed lines from `tool/layer_baseline.txt` itself; show the
baseline diff (`git -C lib/features/cloud_storage diff --stat tool/layer_baseline.txt`). That
file must be committed together with the fix.

### 7. Report (Vietnamese)
```
## ✅ Layer check — <phạm vi>
| # | File | Rule | Đã sửa thế nào |
**Kết quả cuối:** No new violations | còn N (lý do) · baseline: <trước> → <sau>
**DI / build:** ... · **Analyze:** ...
**TODO / giả định:** ...
**Cần phía khác:** ...
```

## Stop conditions
- A fix needs editing `socialfi` or another feature, or changes a public API used outside CS.
- The right fix depends on a business decision (e.g. which domain shape to expose) → ask.
- Violations remain after 3 verify rounds.

## Notes
- The pre-push hook (`git config core.hooksPath tool/githooks` inside CS) runs the same check;
  `git push --no-verify` bypasses it — never suggest that as the fix.
- A skill created/edited mid-session may not appear in the `/` list until Claude Code is
  restarted.
