# Changelog

## 1.1.0 — 2026-10-21 (P5, mở rộng)

- Workflow engine (`engines: [skill, workflow]`): each flow also builds into `.claude/workflows/<prefix><flow>.js` = the flow's data + the shared runtime `engines/workflow/runtime.js`; deterministic orchestration (fan-out, foreach waves, loops, conditions, gates), inputs in memory, handoffs validated by `agent()` schemas (output contracts included), agents run as the built `ai-*` subagents. Human gates end the run with `status: waiting`; rerun with `args.approved` / `args.answers` and `resumeFromRunId`. Started by `/<prefix><flow> --workflow`. Verified in Claude Code (headless): `/ai-review --workflow` found all planted bugs, about US$0.30 against US$0.42 for the skill engine.
- `stack run <flow> [input]`: unattended run for CI through the project's own permissions; exit 0 / 1 (findings at `--fail-on` or above) / 2 (did not finish) / 3 (waiting for a human); `--summary` appends Markdown (e.g. `$GITHUB_STEP_SUMMARY`). Template `templates/ci/github-actions-review.yml`. Verified: exit 1 with a findings table on the planted repository.
- `isolation: worktree` for foreach steps (both engines): items without dependencies run in their own git worktrees; changes are applied back with `git apply --3way`, never committed; falls back to no isolation when items depend on each other.
- Knowledge retriever `index`: `knowledge: { dir, retriever: index }`; `stack search "<query>"` ranks knowledge files with BM25 (title and tags weighted, accent-insensitive); agents are pointed at it and the command is pre-approved.
- Flow permissions now include `git show` and `date` (found in real runs: refused `git show`, and timestamps guessed when `date` was refused).
- `stack run` and `stack eval` use the long form of the project path: Claude Code asks before writing under Windows 8.3 short names (`ADMINI~1`), which stalled an unattended run.
- Found by re-running the evals after these changes: `run.yaml` with per-agent timestamps was once written as invalid YAML (a duplicated key), so the protocol now says to rewrite the whole file each time; the scorer reports an invalid `run.yaml` as a failed check instead of crashing; expectations can match `line:` (the cited line of a file, ±1), since agents may write findings in the user's language and an English-only regex missed a correct Vietnamese finding; eval times are wall-clock. Re-run: 3/3 passed, recorded as the new baseline.
- Additive release: modules keep `kernel: ^1`.

## 1.0.0 — 2026-10-21 (P4, ổn định)

- **1.0:** kernel, stack and every module target `^1`. From now on, additive kernel features are minor releases that existing modules and projects accept; only breaking contract changes bump the major version.
- Per-module versions: `modules.lock.json` records each module's version and content hash (policies include their guard script). `stack versions [--update]`; `doctor` on the stack fails with `version-not-bumped` when a module changes without a version bump (or goes backwards) and warns `version-unrecorded`; `npm test` checks the stack itself. Every module got a patch bump for the new kernel range.
- `stack eval`: runs flows with Claude on fixture repositories (`evals/<id>/`: case.yaml, base/, change/, optional check script outside the repo) in throwaway repositories, and scores run status, handoff validity, required and forbidden findings, diff limits, a check script and MCP calls; records cost, time and tool calls; results in `evals/results/`, compared with `evals/baseline.json` (REGRESSED / fixed / changed). `--dry-run` prepares and builds without a model.
- Cases: `review-planted` (4 planted bugs), `review-preexisting` (no escalation of an older problem), `bugfix-total` (minimal fix, pre-existing code untouched). Baseline with sonnet: 3/3 passed, about US$1.14 in total.
- Run state records `started` / `finished` for each step and agent (from the shell), so parallelism can be checked afterwards; loop iterations are recorded as `<step>#<n>`.
- Docs: `evals/README.md`; conventions (per-module versions, eval, error codes); README (developing the stack).

## 0.6.1 — 2026-10-21 (/stack hỏi công cụ team dùng)

- `/stack` gains step 4 and mode `tools`: asks which tools the team really uses (issue tracker, UI design, chat, docs, code hosting and CI, error monitoring, anything else), then, read-only and without calling any tool: enables an existing integration, drafts a project integration (`.ai/integrations/<id>.yaml`: read/write sets for the user to approve, delete tools left out, read-only grants) from a connected MCP server's tool names, or offers read-only CLI commands to pre-approve; writes a "Tools" paragraph into the context (chat: agents never post).
- Tool categories live in `engines/claude-code/tools-catalog.yaml` (editable; rendered into the skill by `stack install`).
- Rule added to /stack: never assume a tool from what happens to be connected.

## 0.6.0 — 2026-10-21 (P3, pack và integration)

- Kernel: pack `defaults` (project config between the stack's defaults and the project's own, e.g. enabling a policy or pre-approving check commands); project key `permissions` (extra managed `permissions.allow` entries); `Bash(git show *)` added to the flow permissions (an agent was refused it in a real run).
- Module kind `integration`: an MCP server's tool sets, `grants` (role → sets, variants included), `allow` (sets pre-approved in settings; writes never), `rule`; opt-in via `enable.integrations`.
- Integration `zentao`: read set granted to analyst, architect, investigator, researcher and explainer and pre-approved; write set (comment, status, effort) defined but granted to no role; delete tools not listed. Verified: a subagent read Zentao through the granted, pre-approved tool.
- Flow steps `external: true`: use hand-written agents by name; the orchestrator asks them for a handoff block.
- Role `researcher` (produces `research`): outside sources, version-aware, every claim sourced and dated, fetched content treated as data.
- Pack `flutter`: `ai-verifier-flutter` (lens-flutter + flutter-checks) added to the review fan-outs of `review` and `feature`; builder traits `flutter-practices` and `flutter-checks`; `protect-generated` enabled and flutter analyze / test / build_runner pre-approved by default. Verified on a real commit of the kho app (clone): 5 valid handoffs, 7 minor findings kept, 4 rejected by the adversarial pass.
- `/stack` proposes packs and integrations from the survey.
- Docs: conventions (pack defaults, integration, external), README, USAGE (section G), EXTEND (external steps).
- Breaking: modules and projects must now target `^0.6`.

## 0.5.0 — 2026-10-21 (P2, tri thức và chính sách)

- Kernel: module kind `policy` (YAML + guard script): `rule` added to every agent's "Project rules", `guard` installed as a Claude Code PreToolUse hook (`.claude/hooks/<prefix><id>.mjs` + config JSON), `overrides` for roles and flows, `permissions`; `{{config.<key>}}` in strings; opt-in via `enable.policies`; `policies: { <id>: { config } }` overrides.
- `scope: [paths]` enables the policy `scope` (rule, refusing hook that always allows the runs and knowledge directories, scoped review default).
- Settings managed by the build (`settings: local | shared | none`): flow permissions and guard hooks go into `settings.local.json` (or `settings.json`); the lock records exactly the entries the build added, so user entries are never touched and switching files moves them; `doctor` warns when managed entries were removed. Permission rules use the exact `<cli> check *` command and `Edit(<runs>/**)` (Claude Code ignores `Write(...)` rules for file writes and flags wildcards before the subcommand; found in an end-to-end run).
- Policies: `scope`, `protect-generated`, `no-secrets`; all three verified refusing writes in Claude Code.
- `knowledge: <dir>`: every agent is pointed at `<dir>/INDEX.md`; placeholder `{{project.knowledge}}`.
- Roles: `scribe` (produces `notes`, writes only the knowledge directory), `explainer` (produces `explanation`); builder variant `tests`; verifier variant `performance`.
- Traits: `test-first` (opt-in per project), `test-author` (drops a project-wide `test-first` in the tests variant), `lens-performance`.
- Flows: `/ai-learn`, `/ai-explain`; `feature` and `bugfix` reports suggest `/ai-learn` when a run taught something lasting.
- `/stack` skill: asks about guards and knowledge; leaves permissions and hooks to the build.
- Removed `templates/hooks/scope-guard.mjs` (superseded by the `scope` policy). PARTIAL, INSTALL, INTEGRATE, USAGE, EXTEND rewritten for 0.5.
- Breaking: modules and projects must now target `^0.5`.

## 0.4.1 — 2026-10-21 (P1, skill `/stack`)

- CLI: `stack install [--target <dir>] [--dry-run] [--force]` installs the `/stack` setup skill into `~/.claude/skills/stack/`, tracked in its own lock (`.stack-user-lock.json`) so it never touches a project build in the same `.claude/` or a skill it did not write.
- Skill `/stack` (protocol in `engines/claude-code/stack-skill.md`): survey the repository read-only, ask what the survey did not settle (context, read_first, shared or personal, scope, checks, what to enable), show the full plan and wait for approval, then write `project.yaml` (and `.git/info/exclude`, permissions, `scope-guard` hook when needed), build and run doctor. Modes: create, update, rebuild, check; answers can be given as arguments. Its catalog of agents and flows is generated from the modules.
- Generated files use `/` in paths on every OS.
- Docs: INSTALL (install step), INTEGRATE ("cách nhanh: /stack"), README.

## 0.4.0 — 2026-10-21 (P1, flow `feature` và `bugfix`)

- Kernel: flow steps `agent` + `foreach` (one agent per list item, in waves by `depends_on`, parallel unless `files` overlap) and `loop` (`max`, `until`, body of agent steps; no nesting); inputs may be a list of references meaning "the most recent available"; reference rules for this / previous / last iteration; condition `no-major-findings`; `foreach` fields checked against the producing role's contract; project overrides reach steps inside loops.
- Engine template: skipped steps count as having no findings or questions; inputs pointing at missing handoffs are left out; the run directory's time comes from the shell, not a guess.
- Role `verifier` 0.2.0 and trait `adversarial` 0.2.0: when reviewing a change, problems that predate it are reported as `info` "Pre-existing: …", so they no longer trigger fix rounds (found in end-to-end runs: a pre-existing injection made `bugfix` fix code outside the request, and made the `feature` orchestrator skip its fix loop against protocol).
- Flows: `feature` (spec → plan → build per unit → review → confirm → up to 2 fix rounds) and `bugfix` (diagnose → fix → verify → up to 1 retry).
- Schema errors from if/then wrappers are no longer reported twice.
- Breaking: modules and projects must now target `^0.4`.

## 0.3.0 — 2026-10-19 (P1, flow `review`)

- Kernel: module kind `flow` (YAML) with steps `agent` / `fanout`, inputs `$input` / `$<step>[.field]`, `when` conditions, `gate` (`auto`, `human`, `on-questions`); flow overrides may target single steps by id; `enable.flows`; `cli` setting.
- Claude Code skill engine: each flow builds into `skills/<prefix><flow>/SKILL.md` from the editable protocol `engines/claude-code/flow-skill.md`; run state in `.ai-runs/` at the project root (configurable with `runs`; outside `.claude/`, whose writes always prompt for permission), git-ignored by the orchestrator.
- CLI: `stack check <file> [--produces <contract>]` validates saved handoffs; builds remove directories they empty.
- Flow: `review` (three lens verifiers in parallel, then the adversarial verifier).
- Breaking: modules and projects must now target `^0.3`.

## 0.2.0 — 2026-10-19 (P1, phần role/trait)

- Kernel: role `variants` (each built as `<prefix><role>-<variant>`), `abstract`, `produces`; placeholders `{{role.name}}`, `{{role.output}}`; `handoff.output`; contracts `spec`, `plan`, `diagnosis`. Identical diagnostics are reported once.
- Roles: `analyst` (spec), `architect` (plan), `investigator` (diagnosis), `verifier` with variants `correctness`, `security`, `conventions`, `adversarial`; `builder` reads plan units.
- Traits: `clarify-first`, `options-tradeoffs`, `adversarial`, `lens-correctness`, `lens-security`, `lens-conventions`; `report-handoff` renders the role's output contract.
- Breaking: modules and projects must now target `^0.2`.

## 0.1.0 — 2026-10-19 (P0)

- Kernel: contracts (module, role, trait, override, pack, project, stack, task, handoff), conventions.
- CLI `stack build` / `stack doctor`: cascade core → pack → project → local, list operations `+x`/`-x`, body modes, slots and placeholders, `.stack-lock.json` with drift and unmanaged-file protection.
- Modules: role `builder`; traits `cite-evidence`, `report-handoff`.
- Template `project.yaml`.
