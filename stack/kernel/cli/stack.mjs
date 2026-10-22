#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build, check, doctor, install } from './lib/api.mjs';
import { compareVersions, updateVersions } from './lib/versions.mjs';
import { cleanup, compareResults, EVALS_DIR, loadCases, prepareCase, runClaude, scoreRun } from './lib/eval.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { runFlow } from './lib/run.mjs';
import { search } from './lib/search.mjs';
import { loadWorkspace } from './lib/load.mjs';
import { createDiagnostics } from './lib/diag.mjs';
import { readFileSync } from 'node:fs';
import { DEFAULT_STACK_ROOT } from './lib/kernel.mjs';

const USAGE = `Usage: stack <command> [options]

Commands:
  build           Compose modules + project.yaml into <project>/.claude/
  doctor          Validate modules, project.yaml and generated files
  check <file>    Validate a saved agent handoff (used by flow skills)
  install         Install the /stack setup skill into ~/.claude/ (all projects)
  versions        Show module versions against modules.lock.json (--update records them)
  eval [ids...]   Run the eval cases in evals/ with Claude and score them (costs model usage)
  run <flow> [input...]  Run a flow without a person (CI): exit 0 ok, 1 findings at --fail-on or above,
                  2 run failed, 3 waiting for a human
  search <query>  Rank the project's knowledge files for a query (knowledge retriever: index)
  help            Show this message

Options:
  --project <path>       Project root (default: current directory)
  --dry-run              build, install: show what would change, write nothing
  --force                build, install: overwrite hand-edited or unmanaged files
  --produces <contract>  check: also validate handoff.output against this contract
  --target <dir>         install: directory whose .claude/ receives the skill (default: home)
  --update               versions: record current module versions and hashes
  --model <name>         eval: model for the run (default: sonnet)
  --keep                 eval: keep each case's temporary repository
  --baseline             eval: save this run as evals/baseline.json
  --fail-on <level>      run: critical | major (default) | minor | none
  --summary <file>       run: append a Markdown summary (e.g. $GITHUB_STEP_SUMMARY)
  --permission-mode <m>  run: Claude Code permission mode (default: default, i.e. the project's settings)
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
        update: { type: 'boolean', default: false },
        model: { type: 'string', default: 'sonnet' },
        keep: { type: 'boolean', default: false },
        baseline: { type: 'boolean', default: false },
        'fail-on': { type: 'string', default: 'major' },
        summary: { type: 'string' },
        'permission-mode': { type: 'string', default: 'default' },
        top: { type: 'string', default: '8' },
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

  if (command === 'search') {
    const query = positionals.slice(1).join(' ');
    const projectRoot = path.resolve(values.project ?? process.cwd());
    const diags = createDiagnostics();
    const ws = await loadWorkspace({ stackRoot: DEFAULT_STACK_ROOT, projectRoot }, diags);
    if (!ws.config.knowledge) {
      console.error('this project has no knowledge directory (knowledge: in .claude/project.yaml)');
      return 2;
    }
    if (!query) {
      console.error('search needs a query');
      return 2;
    }
    const hits = await search({ dir: path.join(projectRoot, ws.config.knowledge), query, top: Number(values.top) || 8, root: projectRoot });
    if (!hits.length) console.log('no matches');
    for (const h of hits) {
      console.log(`${h.score.toFixed(2).padStart(6)}  ${h.file}  ${h.title}`);
      for (const l of h.lines) console.log(`        ${l.n}: ${l.text.slice(0, 160)}`);
    }
    return 0;
  }

  if (command === 'run') {
    const flow = positionals[1];
    if (!flow) {
      console.error(`run needs a flow, e.g. stack run review

${USAGE}`);
      return 2;
    }
    if (!['critical', 'major', 'minor', 'none'].includes(values['fail-on'])) {
      console.error('--fail-on must be critical, major, minor or none');
      return 2;
    }
    const projectRoot = path.resolve(values.project ?? process.cwd());
    const diags = createDiagnostics();
    const ws = await loadWorkspace({ stackRoot: DEFAULT_STACK_ROOT, projectRoot }, diags);
    printDiagnostics(diags);
    if (diags.hasErrors()) return 2;
    const { code, summary } = await runFlow({
      projectRoot,
      flow,
      input: positionals.slice(2).join(' '),
      prefix: ws.config.prefix ?? '',
      model: values.model,
      failOn: values['fail-on'],
      permissionMode: values['permission-mode'],
      summaryFile: values.summary,
      runs: ws.config.runs ?? '.ai-runs',
    });
    console.log(summary);
    return code;
  }

  if (command === 'eval') {
    const cases = await loadCases(DEFAULT_STACK_ROOT, positionals.slice(1));
    const version = JSON.parse(readFileSync(path.join(DEFAULT_STACK_ROOT, 'kernel', 'cli', 'package.json'), 'utf8')).version;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsDir = path.join(DEFAULT_STACK_ROOT, EVALS_DIR, 'results');
    await mkdir(resultsDir, { recursive: true });
    const results = { stack: version, model: values.model, date: new Date().toISOString(), dryRun: values['dry-run'], cases: [] };
    for (const c of cases) {
      console.log(`
## ${c.id}: ${c.description ?? ''}`);
      const prep = await prepareCase(DEFAULT_STACK_ROOT, c, version);
      let scored;
      if (prep.errors.length) scored = { passed: false, checks: [{ name: 'project builds', ok: false, detail: prep.errors.join('; ') }], findings: [], metrics: null };
      else if (values['dry-run']) scored = { passed: true, checks: [{ name: 'project builds', ok: true, detail: prep.command }], findings: [], metrics: null };
      else {
        console.log(`running ${prep.command} (${values.model}) in ${prep.repo}`);
        const transcript = runClaude(prep.repo, prep.command, { model: values.model });
        await writeFile(path.join(resultsDir, `${stamp}-${c.id}.jsonl`), transcript, 'utf8');
        scored = await scoreRun(c, prep.repo, transcript);
      }
      for (const x of scored.checks) console.log(`${x.ok ? 'ok  ' : 'FAIL'}  ${x.name}${x.detail ? `  (${x.detail})` : ''}`);
      if (scored.metrics) console.log(`cost US$${scored.metrics.costUsd?.toFixed(2) ?? '?'}, ${Math.round((scored.metrics.durationMs ?? 0) / 1000)}s, ${scored.metrics.toolCalls} tool calls`);
      results.cases.push({ id: c.id, ...scored });
      if (values.keep) console.log(`kept ${prep.repo}`);
      else await cleanup(prep.repo);
    }
    const file = path.join(resultsDir, `${stamp}.json`);
    await writeFile(file, `${JSON.stringify(results, null, 2)}
`, 'utf8');
    const passed = results.cases.filter((x) => x.passed).length;
    console.log(`
eval: ${passed}/${results.cases.length} case(s) passed; results in ${display(file)}`);
    const baselineFile = path.join(DEFAULT_STACK_ROOT, EVALS_DIR, 'baseline.json');
    if (!values['dry-run']) {
      try {
        for (const line of compareResults(JSON.parse(readFileSync(baselineFile, 'utf8')), results)) console.log(line);
      } catch {
        console.log('no baseline yet (run with --baseline to record one)');
      }
      if (values.baseline) {
        await writeFile(baselineFile, `${JSON.stringify(results, null, 2)}
`, 'utf8');
        console.log(`baseline saved: ${display(baselineFile)}`);
      }
    }
    return passed === results.cases.length ? 0 : 1;
  }

  if (command === 'versions') {
    const rows = await compareVersions(DEFAULT_STACK_ROOT);
    for (const r of rows.filter((x) => x.status !== 'ok')) console.log(`${r.status.padEnd(10)}  ${r.key}  ${r.locked ?? '-'} -> ${r.version ?? '-'}`);
    const bad = rows.filter((r) => r.status === 'changed' || r.status === 'downgraded');
    if (values.update) {
      if (bad.length) {
        console.log(`versions: ${bad.length} module(s) changed without a version bump; bump them first`);
        return 1;
      }
      console.log(`versions: recorded ${await updateVersions(DEFAULT_STACK_ROOT)} module(s)`);
      return 0;
    }
    console.log(`versions: ${rows.length} module(s), ${rows.filter((r) => r.status !== 'ok').length} differ from the lock`);
    return bad.length ? 1 : 0;
  }

  if (command === 'help' || command === undefined) {
    console.log(USAGE);
    return command ? 0 : 2;
  }

  console.error(`Unknown command "${command}".\n\n${USAGE}`);
  return 2;
}

process.exitCode = await main();
