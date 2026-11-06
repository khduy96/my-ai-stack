import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build, check } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { collectStats, findingKind, formatStats, gitOutcome, readRun, summarize, transcriptKey } from '../lib/stats.mjs';
import { codes, tempDir, writeTree } from './helpers.mjs';

const F = (severity, title) => `    - { severity: ${severity}, title: "${title}", evidence: "src/a.js:1" }\n`;
const H = (findings = '', extra = '') => `handoff:\n  status: done\n  summary: s\n${extra}${findings ? `  findings:\n${findings}` : ''}`;

const FEATURE = {
  'run.yaml': [
    'flow: feature',
    'started: 2026-11-01T10:00:00+07:00',
    'finished: 2026-11-01T11:00:00+07:00',
    'status: done',
    'steps:',
    '  build:',
    '    status: done',
    '    agents:',
    '      u1: { started: 2026-11-01T10:00:00+07:00, finished: 2026-11-01T10:20:00+07:00, status: done }',
    '  review: { status: done }',
    '  confirm: { status: done }',
    '  fix: { status: skipped }',
    '',
  ].join('\n'),
  'build/u1.handoff.yaml': H('', '  artifacts:\n    - { path: src/a.js, change: modified }\n  questions: [one?]\n'),
  'review/ai-verifier-correctness.handoff.yaml': H(F('major', 'raw major') + F('minor', 'raw minor')),
  'confirm.handoff.yaml': H(F('minor', 'kept') + F('info', 'Rejected: raw major') + F('info', 'Pre-existing: old')),
  'report.md': '# Report\n',
  'feedback.yaml': 'feedback:\n  verdict: partial\n  wrong: [F1]\n',
};

test('findings are classed by severity, with rejected and pre-existing apart', () => {
  assert.equal(findingKind({ severity: 'major', title: 'x' }), 'major');
  assert.equal(findingKind({ severity: 'info', title: 'Rejected: x' }), 'rejected');
  assert.equal(findingKind({ severity: 'info', title: 'pre-existing: x' }), 'pre-existing');
});

test('a run: agent time, raw and final findings, questions, report and feedback', async () => {
  const dir = await tempDir();
  await writeTree(dir, FEATURE);
  const r = await readRun(dir, { git: false });
  assert.equal(r.flow, 'feature');
  assert.equal(r.wallMin, 60);
  assert.equal(r.agentMin, 20);
  assert.equal(r.fixRound, false);
  assert.equal(r.questions, 1);
  assert.deepEqual(r.raw, { major: 1, minor: 1 });
  assert.deepEqual(r.final, { minor: 1, rejected: 1, 'pre-existing': 1 });
  assert.equal(r.finalStep, 'confirm');
  assert.equal(r.report, true);
  assert.deepEqual(r.feedback, { verdict: 'partial', wrong: ['F1'] });

  await writeTree(dir, { 'feedback.yaml': 'feedback:\n  verdict: great\n' });
  assert.deepEqual((await readRun(dir, { git: false })).feedback, { invalid: true });
});

test('summary and text: flows, findings only from review steps, feedback, waiting runs with a resume command', async () => {
  const project = await tempDir();
  await writeTree(project, {
    ...Object.fromEntries(Object.entries(FEATURE).map(([k, v]) => [`.ai-runs/20261101-1000-feature-x/${k}`, v])),
    '.ai-runs/20261102-0900-explain-y/run.yaml': 'flow: explain\nstarted: 2026-11-02T09:00:00Z\nstatus: done\nsteps:\n  explain: { status: done }\n',
    '.ai-runs/20261102-0900-explain-y/explain.handoff.yaml': H(F('major', 'not a review finding')),
    '.ai-runs/20261103-0900-bugfix-z/run.yaml': 'flow: bugfix\nstarted: 2026-11-03T09:00:00Z\nstatus: waiting\nsteps:\n  diagnose: { status: waiting, note: needs the log file }\n',
  });
  const data = await collectStats({ projects: [project], transcripts: null, git: false });
  const s = summarize(data);
  assert.equal(s.runs, 3);
  assert.deepEqual([s.flows.feature.runs, s.flows.explain.done, s.flows.bugfix.waiting], [1, 1, 1]);
  assert.equal(s.findings.runs, 1, 'the explain run has no review step');
  assert.deepEqual(s.feedback, { rated: 1, verdicts: { partial: 1 }, wrong: 1, invalid: 0 });

  const text = formatStats(s, { now: Date.parse('2026-11-06T09:00:00Z') });
  assert.match(text, /3 run\(s\) in 1 project\(s\)/);
  assert.match(text, /20261103-0900-bugfix-z {2}at diagnose, 3 day\(s\): needs the log file/);
  assert.match(text, /resume: \/ai-bugfix --resume \.ai-runs\/20261103-0900-bugfix-z/);
  assert.match(text, /Feedback: 1 of 3 run\(s\) rated \(useful 0, partial 1, not useful 0\); 1 finding\(s\) marked wrong/);

  const since = summarize(await collectStats({ projects: [project], transcripts: null, git: false, since: '2026-11-02' }));
  assert.equal(since.runs, 2);
});

test('git outcome: committed, still uncommitted or discarded, also inside a nested repository', async () => {
  const repo = await tempDir();
  const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  await writeTree(repo, { 'a.js': '1\n', 'b.js': '1\n', 'c.js': '1\n', 'sub/x.js': '1\n' });
  git(repo, 'init', '-q');
  git(path.join(repo, 'sub'), 'init', '-q');
  git(path.join(repo, 'sub'), 'add', '.');
  git(path.join(repo, 'sub'), 'commit', '-qm', 'sub');
  git(repo, 'add', 'a.js', 'b.js', 'c.js');
  git(repo, 'commit', '-qm', 'base');
  const since = '1970-01-02T00:00:00Z';
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  assert.equal(gitOutcome(repo, ['a.js'], since).outcome, 'committed');
  assert.equal(gitOutcome(repo, ['sub/x.js'], since).outcome, 'committed', 'the nested repository is asked');
  assert.equal(gitOutcome(repo, ['a.js'], tomorrow).outcome, 'discarded');
  await writeTree(repo, { 'b.js': '2\n' });
  assert.equal(gitOutcome(repo, ['b.js'], tomorrow).outcome, 'uncommitted');
  assert.equal(gitOutcome(repo, ['../outside.js'], since), null);
});

test('subagent tokens are joined to runs through the run directory named in their task', async () => {
  const project = await tempDir();
  await writeTree(project, Object.fromEntries(Object.entries(FEATURE).map(([k, v]) => [`.ai-runs/20261101-1000-feature-x/${k}`, v])));
  const transcripts = await tempDir();
  const usage = (id, out) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-x', usage: { input_tokens: 1, cache_read_input_tokens: 100, output_tokens: out } } });
  const sub = path.join(transcriptKey(project), 'session-1', 'subagents');
  await writeTree(transcripts, {
    [`${sub}/agent-a.jsonl`]: [JSON.stringify({ type: 'user', message: { content: 'task:\n  inputs:\n    spec: .ai-runs/20261101-1000-feature-x/spec.handoff.yaml' } }), usage('m1', 10), usage('m1', 10), usage('m2', 5)].join('\n'),
    [`${sub}/agent-a.meta.json`]: '{"agentType":"ai-builder"}',
    [`${sub}/agent-b.jsonl`]: [JSON.stringify({ type: 'user', message: { content: 'look at this' } }), usage('m3', 7)].join('\n'),
    [`${sub}/agent-b.meta.json`]: '{"agentType":"ai-investigator"}',
    ['other-project/s/subagents/agent-c.jsonl']: usage('m4', 99),
  });
  const data = await collectStats({ projects: [project], transcripts, git: false });
  assert.deepEqual(data.runs[0].usage, { agents: 1, tokens: { input: 2, cacheWrite: 0, cacheRead: 200, output: 15 }, models: ['claude-x'] });
  const s = summarize(data);
  assert.deepEqual([s.agents['ai-builder'].inRuns, s.agents['ai-investigator'].direct], [1, 1]);
  assert.equal(Object.keys(s.agents).length, 2, 'other projects are left out');
});

test('stack check validates a run feedback file against the feedback contract', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'ok.yaml': 'feedback:\n  verdict: useful\n  at: 2026-11-06T10:00:00+07:00\n', 'bad.yaml': 'feedback:\n  verdict: meh\n  wrong: [2]\n' });
  assert.deepEqual(codes((await check({ file: path.join(dir, 'ok.yaml') })).diags), []);
  assert.deepEqual(codes((await check({ file: path.join(dir, 'bad.yaml') })).diags), ['schema-invalid', 'schema-invalid']);
});

test('flow skills save the numbered report, ask for feedback and note why a run waits', async () => {
  const projectRoot = await tempDir();
  await writeTree(projectRoot, { '.claude/project.yaml': 'stack: ^1\nname: demo\ncontext: Demo app.\n' });
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot })).diags), []);
  const skill = await readFile(path.join(projectRoot, '.claude/skills/ai-fix/SKILL.md'), 'utf8');
  assert.match(skill, /`F1`, `F2`/);
  assert.match(skill, /<run>\/report\.md/);
  assert.match(skill, /<run>\/feedback\.yaml/);
  assert.match(skill, /\/ai-fix --resume <run>/);
  assert.match(skill, /agents not loaded in this session/);
});
