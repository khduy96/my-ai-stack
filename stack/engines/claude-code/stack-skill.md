# Set up ai-stack in this project

You add ai-stack {{stack.version}} to the project open in this session, or change how it is set up. You survey the repository, ask the user about the project and the tools the team uses, write `.claude/project.yaml` (and a few local files when the answers need them), then build and check. Talk to the user in their language.

**Nothing is written before the user approves the plan in step 5.** Steps 1–4 only read. **Never assume a tool from what happens to be connected**: ask the user which tools the team really uses, and never call an external system's tools (MCP or CLI) during setup.

- Stack: `{{stack.root}}` (guides: `INTEGRATE.md`, `PARTIAL.md`, `EXTEND.md`, `USAGE.md` there).
- CLI: `{{engine.cli}}`.

## 1. Starting point

- The project root is the current working directory. If it is not the root of a git repository, say so and ask whether to continue here.
- If `.claude/project.yaml` already exists, read it and ask what the user wants:
  - **update**: go through steps 2–7 with the current values as the defaults;
  - **tools**: only step 4 (the tools the team uses), then steps 5–7;
  - **rebuild**: skip to step 6 (build only);
  - **check**: run only step 7.
- The command arguments are: `$ARGUMENTS`. If they already name a mode or answer some questions, use that and do not ask again. If they also say to approve without asking, skip the wait in step 5 but still show the plan.

## 2. Survey the repository (read-only)

Collect, without changing anything:

- **Tech and tooling:** manifest files (`package.json`, `pubspec.yaml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `pom.xml`, `build.gradle*`…) and the commands they define for build, test, lint, analyze, format and code generation.
- **Documentation worth reading first:** `CLAUDE.md`, `README*`, `docs/`, architecture or contributing guides. Prefer a few high-value files over many.
- **Existing Claude setup:** `.claude/agents/`, `.claude/skills/`, `.claude/settings*.json`; whether `.claude/` is tracked by git (`git ls-files .claude`); whether any file there starts with `{{stack.prefix}}`.
- **Hints about tools:** the git remote (GitHub, GitLab…), CI files (`.github/workflows/`, `.gitlab-ci.yml`…), ticket references in recent commit messages, links in the README. These are hints to propose, not answers.
- **Git state:** uncommitted changes (`git status --short`), so you can warn before writing.

Summarize what you found in a few lines before asking anything.

## 3. Questions about the project

Ask only what the survey did not settle. Prefer multiple choice with a recommended option based on the survey; use the AskUserQuestion tool when it is available.

1. **Context:** show a two-to-four-sentence draft (what the project is, its stack, where the code lives) and ask for corrections.
2. **Files to read first:** propose the files from the survey; ask what to add or remove.
3. **Shared or personal:** will the generated files be committed for the team (**shared**), or stay on this machine only (**personal**)? Recommend personal when `.claude/` is tracked and belongs to a team, or when the user says they only work on part of the repository.
4. **Scope:** the whole repository, or only some paths? Paths become `scope:`, which tells agents the boundary and installs a hook that refuses edits outside it.
5. **Checks:** confirm the commands builders and verifiers should run, taken from the survey. Having none is fine.
6. **Guards (optional, recommended):** refuse edits to generated files (`protect-generated`; propose patterns from the survey, e.g. `**/*.g.dart`), and refuse writing secrets into files (`no-secrets`).
7. **Packs:** propose the packs that match the survey (available: {{stack.packs}}; for example `flutter` when there is a `pubspec.yaml` with the Flutter SDK).
8. **Knowledge (optional):** a directory for durable project knowledge (e.g. `docs/knowledge`) that agents consult and `/{{stack.prefix}}learn` writes to. Propose one only if the user wants it; it is created on first use.
9. **What to enable:** everything (recommended), or a subset of:

{{stack.catalog}}

10. **Prefix:** keep `{{stack.prefix}}` unless the survey found files that would clash.

## 4. The tools the team uses

Go through these categories. Ask first; then check how each answer can be reached. Use at most two rounds of questions: first which product per category (multiple choice with the options below, "none", and the user's own answer), then the details that matter (project key or ticket format, channel, file or space).

{{stack.tools}}

Finish with: "Is there any other tool the team uses that agents should know about?"

### How each answer is reached (read-only checks, no tool calls)

1. Run `claude mcp list` to see the MCP servers configured on this machine and whether they connect, and look at which `mcp__<server>__*` tool names exist in this session. **Do not call any of those tools**, and do not run the CLI commands below either; you only read names and statuses.
2. For each product the user named, decide with them:
   - **An integration already exists** in the stack ({{stack.integrations}}) and its server is connected: propose enabling it with its default grants.
   - **A server is connected but there is no integration:** propose a new integration file in the project, `.ai/integrations/<id>.yaml` (add `modules: [.ai]` to `project.yaml`). Build it from the server's tool names:
     - `read`: tools that only get, list, search, view, fetch or download;
     - `write`: tools that create, add, update, edit, post, send, comment, transition or record;
     - leave out entirely every tool that deletes, removes, archives or administers;
     - `grants`: the read set to the category's read roles; no write set to anyone unless the user asks for it;
     - `allow: [read]`;
     - `rule`: the product, where things are (project key, channel, file), the reference format, and "never change, post or send anything there unless your task explicitly asks"; add the category's note.
     Show the user the full file, with every tool in its set, and let them move tools between sets.
   - Every integration used, existing or new, must also be listed in `enable.integrations`: integrations are opt-in, and a file alone grants nothing.
   - **Not connected:** say how to connect it (an MCP server with `claude mcp add …`, or a connector in claude.ai settings), and offer what works now: for categories with read-only CLI commands, pre-approving them through `permissions` in `project.yaml`; otherwise the user pastes content into requests. Record the tool in the context either way.
3. Never pre-approve a write set. If the user asks to grant one, warn that the agent will be able to change the external system (Claude Code still asks before each such call), and grant it only to the roles they name.

### What goes into the context

Add a short "Tools" paragraph to the approved `context`, one line per category the team uses: the product, where things are (project key, channel, file, space), the reference format, and for chat: "read only; agents never post". Leave out categories the team does not use.

## 5. Propose, then wait

Show the complete `project.yaml`, every integration file you will create, and a list of every other file you will create or change, with the lines you will add. Wait for approval; apply requested changes and show the plan again.

### `project.yaml`

Include only what differs from the defaults. Write `body` texts and `rule`s in English, with concrete commands and paths.

```yaml
stack: {{stack.compat}}
name: <project name>
context: |
  <approved context>

  Tools:
  - Issues: <product>, <where>, references look like <format>.
  - Design: <product>, <file or project>.
  - Chat: <product>, <channels>; read only, agents never post.
  - Docs: <where>.
  - Code and CI: <host>, <CI>.
  - Errors: <product>, <project>.
read_first:
  - <file>
# prefix: <only if changed>
# settings: shared                              <shared setup that commits settings.json>
# scope: [<path>, ...]                          <when scoped>
# knowledge: <dir>                              <when wanted>
# packs: [<pack>, ...]                          <when chosen>
# modules: [.ai]                                <when the project has its own integrations>
# permissions: ['+Bash(<read-only command> *)'] <CLI fallbacks the user approved>
# enable: { roles: [...], flows: [...], policies: [...], integrations: [...] }
#                                               <roles/flows only for a subset; policies and integrations when chosen>
# integrations:                                 <only to change grants>
#   <id>: { grants: { <role>: [read] } }
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

`scope` already adds the boundary to every agent, the refusing hook, and a scoped default for review; the build registers hooks and permissions in the settings file itself.

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
  .ai/
  ```
  Add the knowledge directory too when the user wants it kept private.
- **Shared:** add `.ai-runs/` to `.gitignore`, and `settings: shared` to `project.yaml` if the team should get the permissions and hooks through `settings.json`. Mention that generated skills contain the absolute CLI path of this machine; if the stack is inside this repository, propose `cli: node <relative path to stack.mjs>` in `project.yaml` so every machine builds the same files.
- **Integrations of the project:** `.ai/integrations/<id>.yaml` as approved in step 4.
- **Permissions and hooks:** do not edit settings files yourself. The build adds the flow permissions, the pre-approved read tools of enabled integrations, the `permissions` of `project.yaml` and the hooks of enabled guards to `.claude/settings.local.json` (or `settings.json` with `settings: shared`), and later builds change or remove only the entries they added. Mention this in the plan.

## 6. Write and build

1. Write the approved files.
2. Run `{{engine.cli}} build --project . --dry-run` and show the result. If it reports `unmanaged-file`, stop: an existing file has the same name as a generated one. Agree with the user on another prefix, update `project.yaml` (and the exclude lines), and dry-run again. Never use `--force` on files you did not inspect with the user.
3. Run `{{engine.cli}} build --project .`.

## 7. Check and report

1. Run `{{engine.cli}} doctor --project .`. It must report `0 error(s)`; otherwise fix the cause and run it again.
2. For a personal setup, run `git status --short`: none of the new files may appear.
3. Report to the user:
   - the files written or changed;
   - the agents and commands now available (from the build output);
   - for each tool the team uses: how agents reach it now (integration, CLI, or pasted content) and what is still to connect;
   - what to try first, for example `/{{stack.prefix}}review` on a small change;
   - that a new session may be needed before the new agents and commands show up;
   - where to read more: `{{stack.root}}/USAGE.md`.
