// `stack stats`: measures how flows are used on real projects, read-only.
// Sources: each project's run directories (run.yaml, handoffs, report.md, feedback.yaml),
// the project's git history (did the agents' changes land?) and Claude Code's subagent
// transcripts (~/.claude/projects/<project>/<session>/subagents/*.jsonl) for token usage.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { readText } from './load.mjs';
import { finalFindings, handoffsIn, readHandoff } from './run.mjs';
import { RUNS_DIR } from './kernel.mjs';
import { createDiagnostics } from './diag.mjs';
import { validate } from './validate.mjs';

export const VERDICTS = ['useful', 'partial', 'not-useful'];
export const SEVERITIES = ['critical', 'major', 'minor', 'info'];
export const DEFAULT_TRANSCRIPTS = path.join(os.homedir(), '.claude', 'projects');
const REVIEW_STEP = /(^|-)(review|confirm|verify)$/;
const RUN_NAME =/\b\d{8}-\d{4}-[a-z0-9][a-z0-9-]*/gi;

// critical | major | minor | info | pre-existing | rejected
export function findingKind(f) {
  const title = String(f?.title ?? '');
  if (/^rejected\b/i.test(title)) return 'rejected';
  if (/^pre-existing\b/i.test(title)) return 'pre-existing';
  return SEVERITIES.includes(f?.severity) ? f.severity : 'info';
}

const tally = (findings) => findings.reduce((a, f) => ((a[findingKind(f)] = (a[findingKind(f)] ?? 0) + 1), a), {});
const minutes = (a, b) => (Date.parse(a) && Date.parse(b) ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

async function readYaml(file) {
  try {
    return YAML.parse((await readText(file)) ?? '') ?? null;
  } catch {
    return undefined; // present but unreadable
  }
}

async function dirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

// Claude Code keeps a project's sessions under its path with every non-alphanumeric character as "-".
export const transcriptKey = (projectRoot) => path.resolve(projectRoot).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// The repository that holds a path: the project's own, or a submodule or nested repository inside it.
function repoOf(projectRoot, rel, cache) {
  let dir = path.dirname(path.join(projectRoot, rel));
  while (!existsSync(dir) && dir.length > projectRoot.length) dir = path.dirname(dir);
  if (!cache.has(dir)) {
    let top = null;
    try {
      top = path.resolve(git(dir, 'rev-parse', '--show-toplevel'));
    } catch {}
    cache.set(dir, top);
  }
  return cache.get(dir);
}

// Did the files the agents changed land? Read-only git, across all branches, per repository
// (feature folders are often submodules, whose commits the outer repository does not see).
export function gitOutcome(projectRoot, files, since) {
  const inside = [...new Set(files)].filter((f) => f && !path.isAbsolute(f) && !f.startsWith('..')).slice(0, 200);
  if (!inside.length) return null;
  // git prints long paths; a Windows 8.3 short path (ADMINI~1) would not relate to them.
  let root = path.resolve(projectRoot);
  try {
    root = realpathSync.native(root);
  } catch {}
  projectRoot = root;
  const cache = new Map();
  const byRepo = new Map();
  for (const f of inside) {
    const repo = repoOf(root, f, cache);
    if (!repo) continue;
    const list = byRepo.get(repo) ?? [];
    list.push(path.relative(repo, path.join(projectRoot, f)).split(path.sep).join('/'));
    byRepo.set(repo, list);
  }
  if (!byRepo.size) return null; // not a git repository, or git missing
  let commits = 0;
  let pending = 0;
  try {
    for (const [repo, list] of byRepo) {
      commits += git(repo, 'log', '--all', `--since=${since}`, '--format=%h', '--', ...list).split('\n').filter(Boolean).length;
      pending += git(repo, 'status', '--porcelain', '--', ...list).split('\n').filter(Boolean).length;
    }
  } catch {
    return null;
  }
  return { files: inside.length, repos: byRepo.size, commits, pending, outcome: commits ? 'committed' : pending ? 'uncommitted' : 'discarded' };
}

// null when there is no feedback.yaml; { invalid: true } when it breaks the feedback contract.
function readFeedback(data) {
  if (data === null) return null;
  const fb = data?.feedback;
  if (!fb || typeof fb !== 'object' || !validate('feedback', fb, null, createDiagnostics())) return { invalid: true };
  return fb;
}

export async function readRun(runDir, { git = true, projectRoot } = {}) {
  const state = await readYaml(path.join(runDir, 'run.yaml'));
  if (!state || typeof state !== 'object') return null;
  const rel = (f) => path.relative(runDir, f).split(path.sep).join('/');
  const handoffs = [];
  for (const file of await handoffsIn(runDir)) handoffs.push({ file: rel(file), h: await readHandoff(file) });
  const valid = handoffs.filter((x) => x.h && typeof x.h === 'object' && x.h.status);
  const steps = state.steps ?? {};
  const agents = Object.values(steps).flatMap((s) => Object.values(s?.agents ?? {}));
  const waitingStep = Object.entries(steps).find(([, s]) => s?.status === 'waiting');
  const final = await finalFindings(runDir);
  const feedback = readFeedback(await readYaml(path.join(runDir, 'feedback.yaml')));
  const artifacts = valid.flatMap((x) => (x.h.artifacts ?? []).map((a) => a?.path)).filter(Boolean);
  return {
    run: path.basename(runDir),
    dir: runDir,
    flow: String(state.flow ?? '').split(/\s/)[0] || '?',
    status: state.status ?? 'unknown',
    started: state.started ?? null,
    finished: state.finished ?? null,
    wallMin: minutes(state.started, state.finished),
    agentMin: agents.reduce((a, x) => a + (minutes(x?.started, x?.finished) ?? 0), 0),
    agents: agents.length,
    fixRound: Object.entries(steps).some(([k, s]) => /^(fix|retry)\b/.test(k) && s?.status && s.status !== 'skipped'),
    handoffs: handoffs.length,
    invalidHandoffs: handoffs.length - valid.length,
    questions: valid.reduce((a, x) => a + (x.h.questions?.length ?? 0), 0),
    raw: tally(valid.filter((x) => x.file.startsWith('review/')).flatMap((x) => x.h.findings ?? [])),
    final: tally(final.findings),
    finalStep: final.step,
    report: Boolean(await readText(path.join(runDir, 'report.md'))),
    feedback,
    git: git && projectRoot && state.started ? gitOutcome(projectRoot, artifacts, state.started) : null,
    waiting: state.status === 'waiting' ? { step: waitingStep?.[0] ?? null, note: waitingStep?.[1]?.note ?? state.note ?? null } : null,
  };
}

// Token usage of every subagent of the given projects, keyed by run name when its task
// prompt names a run directory. Main-session (orchestrator) tokens are not counted.
export async function readUsage(transcriptsDir, projectRoots, runNames) {
  const wanted = new Map(projectRoots.map((p) => [transcriptKey(p), p]));
  const agents = [];
  for (const dir of await dirs(transcriptsDir)) {
    const project = wanted.get(dir.toLowerCase());
    if (!project) continue;
    for (const session of await dirs(path.join(transcriptsDir, dir))) {
      const sub = path.join(transcriptsDir, dir, session, 'subagents');
      let files;
      try {
        files = (await readdir(sub)).filter((n) => n.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const name of files) {
        const text = (await readText(path.join(sub, name))) ?? '';
        let meta = {};
        try {
          meta = JSON.parse((await readText(path.join(sub, name.replace(/\.jsonl$/, '.meta.json')))) ?? '{}');
        } catch {}
        const tokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
        const seen = new Set();
        let model = null;
        let run = null;
        for (const line of text.split('\n')) {
          if (!line.startsWith('{')) continue;
          let e;
          try {
            e = JSON.parse(line);
          } catch {
            continue;
          }
          if (run === null && e.type === 'user') {
            const prompt = typeof e.message?.content === 'string' ? e.message.content : JSON.stringify(e.message?.content ?? '');
            run = (prompt.match(RUN_NAME) ?? []).find((n) => runNames.has(n)) ?? '';
          }
          const m = e.message;
          if (!m?.usage) continue;
          const key = m.id ?? e.uuid; // one API message is split over several lines
          if (seen.has(key)) continue;
          seen.add(key);
          model ??= m.model ?? null;
          tokens.input += m.usage.input_tokens ?? 0;
          tokens.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
          tokens.cacheRead += m.usage.cache_read_input_tokens ?? 0;
          tokens.output += m.usage.output_tokens ?? 0;
        }
        agents.push({ project, type: meta.agentType ?? 'unknown', run: run || null, model, tokens });
      }
    }
  }
  return agents;
}

const add = (a, b) => {
  for (const k of Object.keys(b)) a[k] = (a[k] ?? 0) + b[k];
  return a;
};

export async function collectStats({ projects, transcripts = DEFAULT_TRANSCRIPTS, since = null, git = true, prefix = 'ai-', runsDir = RUNS_DIR }) {
  const runs = [];
  for (const projectRoot of projects) {
    const root = path.join(projectRoot, runsDir);
    for (const name of await dirs(root)) {
      const r = await readRun(path.join(root, name), { git, projectRoot });
      if (!r) continue;
      if (since && r.started && Date.parse(r.started) < Date.parse(since)) continue;
      runs.push({ project: path.basename(path.resolve(projectRoot)), projectRoot, ...r, usage: { agents: 0, tokens: {}, models: [] } });
    }
  }
  const byName = new Map(runs.map((r) => [r.run, r]));
  const agents = transcripts ? await readUsage(transcripts, projects, new Set(byName.keys())) : [];
  for (const a of agents) {
    const r = a.run && byName.get(a.run);
    if (!r) continue;
    r.usage.agents++;
    add(r.usage.tokens, a.tokens);
    if (a.model && !r.usage.models.includes(a.model)) r.usage.models.push(a.model);
  }
  return { projects: projects.map((p) => path.resolve(p)), since, runs, agents: agents.filter((a) => a.type.startsWith(prefix) || a.run) };
}

export function summarize({ runs, agents }) {
  const flows = {};
  for (const r of runs) {
    const f = (flows[r.flow] ??= { runs: 0, done: 0, waiting: 0, failed: 0, agentMin: [], agents: 0, output: 0 });
    f.runs++;
    if (r.status in f) f[r.status]++;
    f.agentMin.push(r.agentMin);
    f.agents += r.usage.agents;
    f.output += r.usage.tokens.output ?? 0;
  }
  // Only runs whose findings come from a review step; an explainer's or investigator's notes are not review findings.
  const reviewed = runs.filter((r) => REVIEW_STEP.test(r.finalStep ?? ''));
  const rated = runs.filter((r) => r.feedback && VERDICTS.includes(r.feedback.verdict));
  const changed = runs.filter((r) => r.git);
  const byAgent = {};
  for (const a of agents) {
    const t = (byAgent[a.type] ??= { calls: 0, inRuns: 0, direct: 0, tokens: {} });
    t.calls++;
    a.run ? t.inRuns++ : t.direct++;
    add(t.tokens, a.tokens);
  }
  return {
    runs: runs.length,
    projects: [...new Set(runs.map((r) => r.project))],
    from: runs.map((r) => r.started).filter(Boolean).sort()[0] ?? null,
    to: runs.map((r) => r.started).filter(Boolean).sort().at(-1) ?? null,
    flows: Object.fromEntries(Object.entries(flows).map(([k, f]) => [k, { ...f, agentMin: median(f.agentMin) }])),
    findings: { runs: reviewed.length, raw: reviewed.reduce((a, r) => add(a, r.raw), {}), final: reviewed.reduce((a, r) => add(a, r.final), {}) },
    invalidHandoffs: runs.reduce((a, r) => a + r.invalidHandoffs, 0),
    handoffs: runs.reduce((a, r) => a + r.handoffs, 0),
    git: changed.reduce((a, r) => ((a[r.git.outcome] = (a[r.git.outcome] ?? 0) + 1), a), {}),
    feedback: {
      rated: rated.length,
      verdicts: rated.reduce((a, r) => ((a[r.feedback.verdict] = (a[r.feedback.verdict] ?? 0) + 1), a), {}),
      wrong: rated.reduce((a, r) => a + (r.feedback.wrong?.length ?? 0), 0),
      invalid: runs.filter((r) => r.feedback?.invalid).length,
    },
    agents: byAgent,
    waiting: runs.filter((r) => r.status === 'waiting'),
  };
}

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n ?? 0));
function table(head, rows) {
  const all = [head, ...rows].map((r) => r.map((c) => String(c ?? '-')));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ')).join('\n');
}

export function formatStats(s, { prefix = 'ai-', now = Date.now() } = {}) {
  const out = [];
  out.push(`stats: ${s.runs} run(s) in ${s.projects.length} project(s)${s.from ? `, ${s.from.slice(0, 10)} to ${s.to.slice(0, 10)}` : ''}`);
  if (!s.runs) return `${out[0]}\n`;
  out.push('', 'Runs by flow');
  out.push(table(['flow', 'runs', 'done', 'waiting', 'failed', 'agent-min (median)', 'subagents', 'output tokens/run'],
    Object.entries(s.flows).sort((a, b) => b[1].runs - a[1].runs).map(([id, f]) => [id, f.runs, f.done, f.waiting, f.failed, f.agentMin, f.agents, k(Math.round(f.output / f.runs))])));
  out.push('', `Handoffs: ${s.handoffs}, ${s.invalidHandoffs} unreadable or without a status`);
  if (s.findings.runs) {
    const cols = [...SEVERITIES, 'pre-existing', 'rejected'];
    out.push('', `Findings in ${s.findings.runs} run(s) with a review (raw = before the adversarial pass)`);
    out.push(table(['', ...cols], [['raw', ...cols.map((c) => s.findings.raw[c] ?? 0)], ['final', ...cols.map((c) => s.findings.final[c] ?? 0)]]));
  }
  const g = s.git;
  if (Object.keys(g).length) out.push('', `Files the agents changed, in git since each run started: committed ${g.committed ?? 0} · still uncommitted ${g.uncommitted ?? 0} · discarded ${g.discarded ?? 0} run(s)`);
  const fb = s.feedback;
  out.push('', `Feedback: ${fb.rated} of ${s.runs} run(s) rated${fb.rated ? ` (useful ${fb.verdicts.useful ?? 0}, partial ${fb.verdicts.partial ?? 0}, not useful ${fb.verdicts['not-useful'] ?? 0}); ${fb.wrong} finding(s) marked wrong` : ''}${fb.invalid ? `; ${fb.invalid} unreadable feedback.yaml` : ''}`);
  const agentRows = Object.entries(s.agents).filter(([t]) => t.startsWith(prefix)).sort((a, b) => (b[1].tokens.output ?? 0) - (a[1].tokens.output ?? 0));
  if (agentRows.length) {
    const total = agentRows.reduce((a, [, t]) => a + (t.tokens.output ?? 0), 0) || 1;
    out.push('', 'Subagents (orchestrator sessions not counted; direct = started outside a flow run)');
    out.push(table(['agent', 'calls', 'in runs', 'direct', 'output', 'output/call', 'cache read/call', 'share'],
      agentRows.map(([t, a]) => [t, a.calls, a.inRuns, a.direct, k(a.tokens.output), k(Math.round((a.tokens.output ?? 0) / a.calls)), k(Math.round((a.tokens.cacheRead ?? 0) / a.calls)), `${Math.round(((a.tokens.output ?? 0) / total) * 100)}%`])));
  }
  if (s.waiting.length) {
    out.push('', 'Waiting runs');
    for (const r of s.waiting) {
      const age = r.started ? Math.floor((now - Date.parse(r.started)) / 86400000) : '?';
      out.push(`- ${r.project}  ${r.run}  at ${r.waiting.step ?? '?'}, ${age} day(s)${r.waiting.note ? `: ${String(r.waiting.note).slice(0, 140)}` : ' (no note)'}`);
      out.push(`    resume: /${prefix}${r.flow} --resume ${path.relative(r.projectRoot, r.dir).split(path.sep).join('/')}`);
    }
  }
  return `${out.join('\n')}\n`;
}
