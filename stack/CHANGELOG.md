# Changelog

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
