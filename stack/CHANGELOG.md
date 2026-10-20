# Changelog

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
