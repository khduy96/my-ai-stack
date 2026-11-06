# Changelog

## 1.3.0 — 2026-11-06 (đo trên dự án thật)

- `stack stats [projects...] [--since <date>] [--json] [--transcripts <dir|none>] [--no-git]`: read-only measurement of flow runs on real projects. Per flow: runs, done / waiting / failed, median agent minutes, subagents, output tokens per run. Findings before and after the adversarial pass (only runs whose last findings come from a review step). Whether the files the agents changed were committed, are still uncommitted or were discarded, asked per repository so submodules count. Users' feedback. Subagent tokens per agent type from Claude Code transcripts, joined to runs through the run directory named in each task, split into "in runs" and "direct" calls (the orchestrating session is not counted). Waiting runs with their age, note and `--resume` command.
- Every flow run now saves its report as `<run>/report.md` with findings numbered `F1`, `F2`…, and ends by asking the user for a one-line rating; an answer is saved as `<run>/feedback.yaml` (contract `feedback`: `verdict` useful | partial | not-useful, `wrong` [F…], `note`, `at`). `stack check` validates feedback files.
- Waiting runs carry a `note` saying what they wait for; when the Agent tool does not know an agent type (agents built after the session started) the run waits with the note `agents not loaded in this session` instead of the orchestrator doing the work itself. Runs with `--workflow` also write a run directory (`run.yaml`, report, feedback) so they are counted.
- Flow `fix` (`/ai-fix <run> [F2 F3 | major | minor | all] | <findings>`): one builder fixes the selected findings of a run (default: its confirmed critical, major and minor findings; Rejected and Pre-existing only when named), then verifier-correctness checks them. Replaces the ad-hoc builder runs seen in real use.
- Role `architect` 0.2.0: steps only a person can do (deploy, live configuration, real data migration, device testing) are not units; work split by such steps is planned one phase at a time, later phases under `next`. Found in real use: a 98-unit plan with human UAT units has waited at its first gate for 10 days.
- Measured on 5 real projects (32 runs, 2026-10-20 to 2026-11-05): see ROADMAP.md.
- Additive release: modules keep `kernel: ^1`.

## 1.2.0 — 2026-11-06 (memory bank)

- Memory bank: `memory_bank: <dir>` in project.yaml declares six fixed files (`projectbrief`, `activeContext`, `systemPatterns`, `techContext`, `decisions`, `progress`) that carry the project's brief, current state and decisions across sessions. Every agent is told to read the brief and the active context first and the rest on demand, and to trust the code when they disagree. Placeholder `{{project.memory_bank}}`; the scope policy keeps the directory writable.
- Role `archivist` (exec, writes only the memory bank, produces `notes`): **init** tells a new project (no code yet: built from the user's description, planned stack marked `[?]`, questions for what is missing) from an existing one (read-only survey of docs, manifests, CI, tree, git log, TODO markers, then all six files with sources); **update** refreshes active context and progress from git since the last update, adds a decision only for architectural choices. Never overwrites an existing memory bank, never commits, no secret values, under 150 lines per file.
- Flows `memory-init` (`/ai-memory-init [description]`; the report offers the `# Memory Bank` block for CLAUDE.md so plain sessions load it too, and asks shared or personal) and `memory-update` (`/ai-memory-update [run | note]`; shows the diff).
- `/stack` surveys for an existing memory bank and asks whether to set one up.
- Code maps: `maps: <dir>` in project.yaml declares two kinds of map. The **project map** (`PROJECT_MAP.md` + `<module>.MAP.md`) is organised by feature and keyword: where a feature lives (UI, state, layers, text keys), who calls it from other modules, what it depends on, pitfalls, a public API table with caller counts, and a symptoms table. The **repo map** (`REPO_MAP.md` + `<module>.REPO.MAP.md`) is organised by structure: overview and conventions, call flows and symbols per feature, INBOUND / OUTBOUND contact points with risk (⛔ for boundary violations), shared and global wiring, generated files and the commands that regenerate them. Every agent is told to read the project map before searching the code and the repo map before changing anything another module calls, to search normally for modules under "Not mapped", and to say when its change needs a map refresh. Placeholder `{{project.maps}}`; the scope policy keeps the directory writable.
- Role `cartographer` (exec, writes only the maps directory, produces `notes`): **init** tells a new project (indexes only, planned modules marked `[?]`) from an existing one (survey, every module listed, the modules named or in scope mapped in full, the whole repository when it is small, otherwise asks which module first); **update** maps one more module, re-maps a named module, or refreshes every map from `git diff` since the commit in its header (callers searched again when a public member changed). Every path is checked to exist, callers come from a repository-wide search, unconfirmed facts are marked `[?]`.
- Flows `map-init` (`/ai-map-init [modules | description of a new project]`; the report offers a `# Code maps` block for CLAUDE.md and asks shared or personal) and `map-update` (`/ai-map-update [module | run | note]`; shows the diff).
- Flow `knowledge-audit` (`/ai-knowledge-audit [file | tag | area | older than N days]`): the verifier checks knowledge files (oldest `updated` first, about 30 per run) against their sources, cited lines and `git log`, and reports findings at the knowledge file and line (major: contradicted by the code; minor: moved citation, no longer confirmable, duplicated topic; info: frontmatter, INDEX.md out of sync); human gate; then the scribe corrects, removes or marks `[?]`, merges and refreshes INDEX.md. Files to delete are listed and deleted only on approval.
- Additive release: modules keep `kernel: ^1`.

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
