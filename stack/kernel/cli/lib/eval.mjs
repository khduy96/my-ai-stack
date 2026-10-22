// `stack eval`: runs flows on small fixture repositories and scores the outcome, so a
// change to a prompt, a module or the kernel shows whether agents got better or worse.
//
// evals/<id>/case.yaml   flow, input, project.yaml lines, expectations
// evals/<id>/base/       files committed first
// evals/<id>/change/     files laid over the base: left uncommitted, or committed
//
// Each case runs in its own temporary git repository with
// `claude -p "/<prefix><flow> <input>" --permission-mode bypassPermissions`, which is
// why the repository is throwaway. Scoring is separate (scoreRun) and needs no model.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { build, check } from './api.mjs';
import { readText } from './load.mjs';
import { compatRange } from './setup.mjs';

export const EVALS_DIR = 'evals';

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const exists = (p) => stat(p).then(() => true, () => false);

export async function loadCases(stackRoot, ids = []) {
  const root = path.join(stackRoot, EVALS_DIR);
  const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && e.name !== 'results').map((e) => e.name).sort();
  const cases = [];
  for (const name of names) {
    if (ids.length && !ids.includes(name)) continue;
    const text = await readText(path.join(root, name, 'case.yaml'));
    if (text === null) continue;
    cases.push({ id: name, dir: path.join(root, name), ...YAML.parse(text) });
  }
  const unknown = ids.filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length) throw new Error(`unknown eval case(s): ${unknown.join(', ')}`);
  return cases;
}

// Builds the case's repository: base committed, change laid over it, project built.
export async function prepareCase(stackRoot, c, version, prefix = 'ai-') {
  const repo = await mkdtemp(path.join(tmpdir(), `ai-stack-eval-${c.id}-`));
  await cp(path.join(c.dir, 'base'), repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'eval@ai-stack.local');
  git(repo, 'config', 'user.name', 'ai-stack eval');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  if (await exists(path.join(c.dir, 'change'))) {
    await cp(path.join(c.dir, 'change'), repo, { recursive: true });
    if (c.change === 'commit') {
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'change');
    }
  }
  await mkdir(path.join(repo, '.claude'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'project.yaml'), `stack: ${compatRange(version)}\n${c.project ?? ''}`, 'utf8');
  // Keep the project's own state out of what the agents review.
  await writeFile(path.join(repo, '.git', 'info', 'exclude'), '.claude/\n.ai-runs/\n', 'utf8');
  const { diags } = await build({ stackRoot, projectRoot: repo });
  const errors = diags.items.filter((d) => d.level === 'error').map((d) => `${d.code}: ${d.message}`);
  return { repo, errors, command: `/${prefix}${c.flow}${c.input ? ` ${c.input}` : ''}` };
}

// Summary of a `claude -p --output-format stream-json --verbose` transcript.
export function parseTranscript(text) {
  const tools = [];
  let result = null;
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'assistant') for (const c of event.message?.content ?? []) if (c.type === 'tool_use') tools.push(c.name);
    if (event.type === 'result') result = event;
  }
  return {
    tools,
    mcpCalls: tools.filter((t) => t.startsWith('mcp__')).length,
    costUsd: result?.total_cost_usd ?? null,
    durationMs: result?.duration_ms ?? null,
    turns: result?.num_turns ?? null,
    error: result ? Boolean(result.is_error) : true,
    report: result?.result ?? '',
  };
}

function quoteArg(a) {
  return `"${String(a).replace(/"/g, '\\"')}"`;
}

export function runClaude(repo, command, { model, claude = 'claude', timeoutMs = 1_800_000, permissionMode = 'bypassPermissions' }) {
  const args = ['-p', command, '--model', model, '--permission-mode', permissionMode, '--output-format', 'stream-json', '--verbose'];
  // claude is an npm shim (a .cmd on Windows), so go through the shell with quoted arguments.
  const line = [claude, ...args.map(quoteArg)].join(' ');
  const r = spawnSync(line, { cwd: repo, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

async function readYamlFile(file) {
  const text = await readText(file);
  if (text === null) return null;
  const fences = [...text.matchAll(/```ya?ml\n([\s\S]*?)```/g)];
  try {
    const data = YAML.parse(fences.length ? fences.at(-1)[1] : text);
    return data?.handoff ?? data;
  } catch {
    return null;
  }
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^/]*')}$`);
const allowed = (severity, levels) => levels.includes(severity);

function matches(finding, expected) {
  const text = [finding.title, finding.detail, finding.evidence].filter(Boolean).join('\n');
  if (expected.file && !text.includes(expected.file)) return false;
  if (expected.match && !new RegExp(expected.match, 'i').test(text)) return false;
  if (expected.severity && !allowed(finding.severity, expected.severity)) return false;
  return true;
}

// Scores a finished run. Returns { checks: [{ name, ok, detail }], passed, findings }.
export async function scoreRun(c, repo, transcript) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const expect = c.expect ?? {};

  const runsRoot = path.join(repo, '.ai-runs');
  const runs = (await readdir(runsRoot, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const runDir = runs.length ? path.join(runsRoot, runs.at(-1)) : null;
  add('run directory created', Boolean(runDir), runDir ? runs.at(-1) : 'no .ai-runs/<run>/');

  const runState = runDir ? YAML.parse((await readText(path.join(runDir, 'run.yaml'))) ?? '{}') ?? {} : {};
  if (expect.status) add(`run status is ${expect.status}`, runState.status === expect.status, `run.yaml status: ${runState.status ?? 'missing'}`);

  const files = runDir ? (await walk(runDir)).filter((f) => f.endsWith('.handoff.yaml')) : [];
  const invalid = [];
  for (const f of files) {
    const { diags } = await check({ file: f });
    if (diags.hasErrors()) invalid.push(path.relative(runDir, f));
  }
  add('every handoff is valid', files.length > 0 && !invalid.length, files.length ? `${files.length} handoffs${invalid.length ? `, invalid: ${invalid.join(', ')}` : ''}` : 'no handoffs');

  // The final findings: the first glob in findings_from that matches any handoff.
  let findings = [];
  for (const glob of expect.findings_from ?? []) {
    const re = globToRegExp(glob);
    const hits = files.filter((f) => re.test(path.relative(runDir, f).split(path.sep).join('/')));
    if (!hits.length) continue;
    for (const f of hits) findings.push(...((await readYamlFile(f))?.findings ?? []));
    break;
  }

  for (const e of expect.findings ?? []) {
    const hit = findings.find((f) => matches(f, e));
    add(`finds ${e.id}`, Boolean(hit), hit ? `${hit.severity}: ${hit.title}` : 'not found');
  }
  for (const e of expect.forbid ?? []) {
    const hit = findings.find((f) => matches(f, e));
    add(`does not report ${e.id}`, !hit, hit ? `${hit.severity}: ${hit.title}` : '');
  }

  if (expect.diff) {
    const numstat = git(repo, 'diff', '--numstat', 'HEAD').stdout.trim().split('\n').filter(Boolean);
    const changed = numstat.map((l) => l.split('\t')[2]);
    const lines = numstat.reduce((n, l) => n + Number(l.split('\t')[0]) + Number(l.split('\t')[1]), 0);
    // Only added and removed lines count, not the context around them.
    const diffText = git(repo, 'diff', 'HEAD')
      .stdout.split('\n')
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
      .join('\n');
    if (expect.diff.files) {
      const outside = changed.filter((f) => !expect.diff.files.includes(f));
      add(`changes only ${expect.diff.files.join(', ')}`, changed.length > 0 && !outside.length, `changed: ${changed.join(', ') || 'nothing'}`);
    }
    for (const s of expect.diff.contains ?? []) add(`diff contains "${s}"`, diffText.includes(s));
    for (const s of expect.diff.not_contains ?? []) add(`diff does not contain "${s}"`, !diffText.includes(s));
    if (expect.diff.max_lines) add(`changes at most ${expect.diff.max_lines} lines`, lines <= expect.diff.max_lines, `${lines} lines`);
  }

  // A check script kept in the case directory, outside the repository the agents see.
  if (expect.script) {
    const r = spawnSync(process.execPath, [path.join(c.dir, expect.script), repo], { encoding: 'utf8' });
    add(`${expect.script} passes`, r.status === 0, (r.stdout + r.stderr).trim().split('\n').at(-1) ?? '');
  }

  const t = transcript ? parseTranscript(transcript) : null;
  if (t && expect.mcp_calls !== undefined) add(`at most ${expect.mcp_calls} MCP calls`, t.mcpCalls <= expect.mcp_calls, `${t.mcpCalls}`);

  return { checks, passed: checks.every((x) => x.ok), findings: findings.map((f) => ({ severity: f.severity, title: f.title })), metrics: t && { costUsd: t.costUsd, durationMs: t.durationMs, turns: t.turns, toolCalls: t.tools.length, mcpCalls: t.mcpCalls } };
}

// Compares two results files: cases that passed before and fail now, and score changes.
export function compareResults(baseline, current) {
  const lines = [];
  for (const cur of current.cases) {
    const base = baseline.cases.find((b) => b.id === cur.id);
    if (!base) {
      lines.push(`new       ${cur.id}`);
      continue;
    }
    const score = (r) => r.checks.filter((x) => x.ok).length;
    if (base.passed && !cur.passed) lines.push(`REGRESSED ${cur.id}: ${cur.checks.filter((x) => !x.ok).map((x) => x.name).join('; ')}`);
    else if (!base.passed && cur.passed) lines.push(`fixed     ${cur.id}`);
    else if (score(cur) !== score(base)) lines.push(`changed   ${cur.id}: ${score(base)} -> ${score(cur)} checks passing`);
  }
  return lines;
}

export async function cleanup(repo) {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
}

