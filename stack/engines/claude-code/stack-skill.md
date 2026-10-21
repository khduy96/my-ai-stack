# Set up ai-stack in this project

You add ai-stack {{stack.version}} to the project open in this session, or change how it is set up. You survey the repository, ask the user a few questions, write `.claude/project.yaml` (and a few local files when the answers need them), then build and check. Talk to the user in their language.

**Nothing is written before the user approves the plan in step 4.** Steps 1–3 only read.

- Stack: `{{stack.root}}` (guides: `INTEGRATE.md`, `PARTIAL.md`, `EXTEND.md`, `USAGE.md` there).
- CLI: `{{engine.cli}}`.

## 1. Starting point

- The project root is the current working directory. If it is not the root of a git repository, say so and ask whether to continue here.
- If `.claude/project.yaml` already exists, read it and ask what the user wants:
  - **update**: go through steps 2–6 with the current values as the defaults;
  - **rebuild**: skip to step 5 (build only);
  - **check**: run only step 6.
- The command arguments are: `$ARGUMENTS`. If they already name a mode or answer some questions, use that and do not ask again. If they also say to approve without asking, skip the wait in step 4 but still show the plan.

## 2. Survey (read-only)

Collect, without changing anything:

- **Tech and tooling:** manifest files (`package.json`, `pubspec.yaml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `pom.xml`, `build.gradle*`…) and the commands they define for build, test, lint, analyze, format and code generation.
- **Documentation worth reading first:** `CLAUDE.md`, `README*`, `docs/`, architecture or contributing guides. Prefer a few high-value files over many.
- **Existing Claude setup:** `.claude/agents/`, `.claude/skills/`, `.claude/settings*.json`; whether `.claude/` is tracked by git (`git ls-files .claude`); whether any file there starts with `{{stack.prefix}}`.
- **Git state:** uncommitted changes (`git status --short`), so you can warn before writing.

Summarize what you found in a few lines before asking anything.

## 3. Questions

Ask only what the survey did not settle, in at most two rounds. Prefer multiple choice with a recommended option based on the survey; use the AskUserQuestion tool when it is available.

1. **Context:** show a two-to-four-sentence draft (what the project is, its stack, where the code lives) and ask for corrections.
2. **Files to read first:** propose the files from the survey; ask what to add or remove.
3. **Shared or personal:** will the generated files be committed for the team (**shared**), or stay on this machine only (**personal**)? Recommend personal when `.claude/` is tracked and belongs to a team, or when the user says they only work on part of the repository.
4. **Scope:** the whole repository, or only some paths? Paths become `scope:`, which tells agents the boundary and installs a hook that refuses edits outside it.
5. **Checks:** confirm the commands builders and verifiers should run, taken from the survey. Having none is fine.
6. **Guards (optional, recommended):** refuse edits to generated files (`protect-generated`; propose patterns from the survey, e.g. `**/*.g.dart`), and refuse writing secrets into files (`no-secrets`).
7. **Knowledge (optional):** a directory for durable project knowledge (e.g. `docs/knowledge`) that agents consult and `/{{stack.prefix}}learn` writes to. Propose one only if the user wants it; it is created on first use.
8. **What to enable:** everything (recommended), or a subset of:

{{stack.catalog}}

9. **Prefix:** keep `{{stack.prefix}}` unless the survey found files that would clash.

## 4. Propose, then wait

Show the complete `project.yaml` and a list of every other file you will create or change, with the lines you will add. Wait for approval; apply requested changes and show the plan again.

### `project.yaml`

Include only what differs from the defaults. Write the `body` texts in English, with concrete commands and paths.

```yaml
stack: {{stack.compat}}
name: <project name>
context: |
  <approved context>
read_first:
  - <file>
# prefix: <only if changed>
# settings: shared                              <shared setup that commits settings.json>
# scope: [<path>, ...]                          <when scoped>
# knowledge: <dir>                              <when wanted>
# enable: { roles: [...], flows: [...], policies: [protect-generated, no-secrets] }
#                                               <roles/flows only for a subset; policies when chosen>
# policies:                                     <only to change a guard's defaults>
#   protect-generated: { config: { patterns: ['**/*.g.dart'] } }
roles:                                          <when there are checks>
  builder:
    body: |
      ## Project checks
      Run `<command>` before reporting done.
    body_mode: append
  architect:                                    <when scoped>
    body: |
      ## Scope
      Plan work units only inside <paths>. List changes needed elsewhere as risks,
      with the owner to ask, not as units.
    body_mode: append
  verifier:
    body: Run `<command>` as your checks.
    body_mode: append
```

`scope` already adds the boundary to every agent, the refusing hook, and a scoped default for review; the build registers hooks and the flow permissions in the settings file itself.

### Other files, by answer

- **Personal:** append to `.git/info/exclude` (never to `.gitignore`):
  ```
  # ai-stack (personal)
  .claude/project.yaml
  .claude/project.local.yaml
  .claude/.stack-lock.json
  .claude/agents/{{stack.prefix}}*
  .claude/skills/{{stack.prefix}}*
  .claude/settings.local.json
  .claude/hooks/{{stack.prefix}}*
  .ai-runs/
  ```
  Add the knowledge directory too when the user wants it kept private.
- **Shared:** add `.ai-runs/` to `.gitignore`, and `settings: shared` to `project.yaml` if the team should get the permissions and hooks through `settings.json`. Mention that generated skills contain the absolute CLI path of this machine; if the stack is inside this repository, propose `cli: node <relative path to stack.mjs>` in `project.yaml` so every machine builds the same files.
- **Permissions and hooks:** do not edit settings files yourself. The build adds the flow permissions and the hooks of enabled guards to `.claude/settings.local.json` (or `settings.json` with `settings: shared`), and later builds change or remove only the entries they added. Mention this in the plan.

## 5. Write and build

1. Write the approved files.
2. Run `{{engine.cli}} build --project . --dry-run` and show the result. If it reports `unmanaged-file`, stop: an existing file has the same name as a generated one. Agree with the user on another prefix, update `project.yaml` (and the exclude lines), and dry-run again. Never use `--force` on files you did not inspect with the user.
3. Run `{{engine.cli}} build --project .`.

## 6. Check and report

1. Run `{{engine.cli}} doctor --project .`. It must report `0 error(s)`; otherwise fix the cause and run it again.
2. For a personal setup, run `git status --short`: none of the new files may appear.
3. Report to the user:
   - the files written or changed;
   - the agents and commands now available (from the build output);
   - what to try first, for example `/{{stack.prefix}}review` on a small change;
   - that a new session may be needed before the new agents and commands show up;
   - where to read more: `{{stack.root}}/USAGE.md`.
