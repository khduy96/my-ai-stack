#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build, check, doctor, install } from './lib/api.mjs';
import { DEFAULT_STACK_ROOT } from './lib/kernel.mjs';

const USAGE = `Usage: stack <command> [options]

Commands:
  build           Compose modules + project.yaml into <project>/.claude/
  doctor          Validate modules, project.yaml and generated files
  check <file>    Validate a saved agent handoff (used by flow skills)
  install         Install the /stack setup skill into ~/.claude/ (all projects)
  help            Show this message

Options:
  --project <path>       Project root (default: current directory)
  --dry-run              build, install: show what would change, write nothing
  --force                build, install: overwrite hand-edited or unmanaged files
  --produces <contract>  check: also validate handoff.output against this contract
  --target <dir>         install: directory whose .claude/ receives the skill (default: home)
`;

function printOps(ops, dryRun, label) {
  const verb = dryRun ? 'would ' : '';
  for (const op of ops.filter((o) => o.type !== 'unchanged')) console.log(`${verb}${op.type}  ${op.rel}`);
  const n = (type) => ops.filter((o) => o.type === type).length;
  console.log(`${label}${dryRun ? ' (dry run)' : ''}: ${n('create')} created, ${n('update')} updated, ${n('remove')} removed, ${n('unchanged')} unchanged`);
}

const display = (file) => {
  if (!file) return '';
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith('..') ? rel : file;
};

function printDiagnostics(diags) {
  for (const d of diags.items) {
    console.log(`${d.level.padEnd(5)}  ${d.code}  ${d.message}`);
    if (d.file) console.log(`       at ${display(d.file)}`);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        project: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        produces: { type: 'string' },
        target: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = args;
  const command = values.help ? 'help' : positionals[0];

  if (command === 'build') {
    const projectRoot = path.resolve(values.project ?? process.cwd());
    const { diags, ops } = await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot, force: values.force, dryRun: values['dry-run'] });
    printDiagnostics(diags);
    if (diags.hasErrors()) {
      console.log(`build failed: ${diags.count('error')} error(s), nothing was written`);
      return 1;
    }
    printOps(ops, values['dry-run'], 'build');
    return 0;
  }

  if (command === 'install') {
    const target = values.target ? path.resolve(values.target) : undefined;
    const { diags, ops, claudeDir } = await install({ stackRoot: DEFAULT_STACK_ROOT, target, force: values.force, dryRun: values['dry-run'] });
    printDiagnostics(diags);
    if (diags.hasErrors()) {
      console.log(`install failed: ${diags.count('error')} error(s), nothing was written`);
      return 1;
    }
    printOps(ops, values['dry-run'], `install into ${claudeDir}`);
    if (!values['dry-run']) console.log('Run /stack in Claude Code inside a project to set it up (start a new session if it does not show up).');
    return 0;
  }

  if (command === 'doctor') {
    // With no --project and no project.yaml here, check the stack on its own.
    const cwdHasProject = existsSync(path.join(process.cwd(), '.claude', 'project.yaml'));
    const projectRoot = values.project ? path.resolve(values.project) : cwdHasProject ? process.cwd() : null;
    const { diags, counts } = await doctor({ stackRoot: DEFAULT_STACK_ROOT, projectRoot });
    printDiagnostics(diags);
    const modules = Object.entries(counts).map(([k, v]) => `${v} ${k}(s)`).join(', ') || 'no modules';
    const scope = projectRoot ? `project ${display(projectRoot) || '.'}` : 'stack only';
    console.log(`doctor (${scope}): ${modules}; ${diags.count('error')} error(s), ${diags.count('warn')} warning(s)`);
    return diags.hasErrors() ? 1 : 0;
  }

  if (command === 'check') {
    if (!positionals[1]) {
      console.error(`check needs a file.\n\n${USAGE}`);
      return 2;
    }
    const { diags } = await check({ file: path.resolve(positionals[1]), produces: values.produces ?? null });
    printDiagnostics(diags);
    console.log(diags.hasErrors() ? `check: ${diags.count('error')} error(s)` : 'check: ok');
    return diags.hasErrors() ? 1 : 0;
  }

  if (command === 'help' || command === undefined) {
    console.log(USAGE);
    return command ? 0 : 2;
  }

  console.error(`Unknown command "${command}".\n\n${USAGE}`);
  return 2;
}

process.exitCode = await main();
