// The generated workflow scripts, run against fake Workflow hooks (no model).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, tempDir, writeTree } from './helpers.mjs';

const AsyncFunction = (async () => {}).constructor;

async function project(extra = '') {
  const root = await tempDir();
  await writeTree(root, { '.claude/project.yaml': `stack: ^1\nengines: [skill, workflow]\n${extra}` });
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags), []);
  return root;
}

// Runs a generated script; `respond(call)` plays the agent. Returns the result and every call.
async function run(root, flow, respond, args = '') {
  const text = await readFile(path.join(root, `.claude/workflows/ai-${flow}.js`), 'utf8');
  const meta = /export const meta = (\{[\s\S]*?\n\})\n/.exec(text);
  assert.ok(meta, 'meta literal');
  JSON.parse(meta[1]); // a pure literal
  const body = text.slice(meta.index + meta[0].length);
  const calls = [];
  const logs = [];
  const agent = async (prompt, opts) => {
    const call = { prompt, opts, task: JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? 'null')?.task };
    calls.push(call);
    return respond(call);
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const result = await new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', body)(agent, parallel, null, () => {}, (m) => logs.push(m), args);
  return { result, calls, logs, meta: JSON.parse(meta[1]) };
}

const done = (extra = {}) => ({ status: 'done', summary: 'ok', ...extra });

test('review: three verifiers with schemas, confirm only when there are findings', async () => {
  const root = await project();
  const clean = await run(root, 'review', () => done({ findings: [] }));
  assert.equal(clean.result.status, 'done');
  assert.deepEqual(clean.calls.map((c) => c.opts.agentType), ['ai-verifier-correctness', 'ai-verifier-security', 'ai-verifier-conventions']);
  assert.ok(clean.calls.every((c) => c.opts.schema.required.includes('status')));
  assert.deepEqual(clean.meta.phases.map((p) => p.title), ['review', 'confirm']);

  const found = await run(root, 'review', (c) =>
    c.opts.agentType === 'ai-verifier-security' ? done({ findings: [{ severity: 'major', title: 'injection' }] }) : done({ findings: [] }),
  );
  const confirm = found.calls.at(-1);
  assert.equal(confirm.opts.agentType, 'ai-verifier-adversarial');
  assert.deepEqual(confirm.task.inputs.claims, [{ severity: 'major', title: 'injection' }]);
});

test('feature: waits at the plan, runs units in waves, stops the fix loop once clean', async () => {
  const root = await project();
  const units = [
    { id: 'u1', goal: 'a', files: ['a.js'] },
    { id: 'u2', goal: 'b', files: ['b.js'], depends_on: ['u1'] },
    { id: 'u3', goal: 'c', files: ['a.js'] },
  ];
  let reviews = 0;
  const respond = (c) => {
    const t = c.opts.agentType;
    if (t === 'ai-analyst') return done({ output: { goal: 'g', acceptance: ['x'] } });
    if (t === 'ai-architect') return done({ output: { approach: 'p', units } });
    if (t.startsWith('ai-verifier-') && t !== 'ai-verifier-adversarial') {
      reviews++;
      return done({ findings: reviews <= 3 && t === 'ai-verifier-correctness' ? [{ severity: 'major', title: 'bug' }] : [] });
    }
    if (t === 'ai-verifier-adversarial') return done({ findings: c.task.inputs.claims });
    return done({ artifacts: [{ path: 'a.js', change: 'modified' }] });
  };

  const first = await run(root, 'feature', respond, { input: 'add x' });
  assert.equal(first.result.status, 'waiting');
  assert.equal(first.result.approve, 'plan');
  assert.ok(first.calls[1].opts.schema.properties.output.properties.units, 'the plan contract is the output schema');

  reviews = 0;
  const second = await run(root, 'feature', respond, { input: 'add x', approved: ['plan'] });
  assert.equal(second.result.status, 'done');
  const builds = second.calls.filter((c) => c.opts.label?.startsWith('build:')).map((c) => c.opts.label);
  assert.deepEqual(builds, ['build:u1', 'build:u3', 'build:u2'], 'u3 shares a.js with u1, u2 waits for u1');
  assert.deepEqual(second.calls.find((c) => c.opts.label === 'build:u2').task.inputs.item.id, 'u2');
  assert.ok(second.result.results['fix-build#1'], 'one fix round ran');
  assert.equal(second.result.results['fix-build#2'], undefined, 'and stopped once no major finding was left');
  assert.deepEqual(second.calls.find((c) => c.opts.label === 'fix-build#1').task.inputs.findings, [{ severity: 'major', title: 'bug' }]);
});

test('worktree isolation: independent units in worktrees, then one merge', async () => {
  const root = await project('flows:\n  feature:\n    steps:\n      plan: { gate: auto }\n      build: { isolation: worktree }\n');
  const units = [{ id: 'u1', goal: 'a', files: ['a.js'] }, { id: 'u2', goal: 'b', files: ['a.js'] }];
  const { calls, result } = await run(root, 'feature', (c) => {
    const t = c.opts.agentType;
    if (t === 'ai-analyst') return done({ output: { goal: 'g', acceptance: ['x'] } });
    if (t === 'ai-architect') return done({ output: { approach: 'p', units } });
    if (c.opts.isolation === 'worktree') return done({ worktree: `/tmp/wt-${c.task.inputs.item.id}` });
    return done({ findings: [] });
  });
  assert.equal(result.status, 'done');
  const builds = calls.filter((c) => c.opts.label?.startsWith('build:'));
  assert.deepEqual(builds.map((c) => [c.opts.label, c.opts.isolation]), [['build:u1', 'worktree'], ['build:u2', 'worktree'], ['build:merge', undefined]]);
  assert.ok(builds[0].opts.schema.required.includes('worktree'));
  assert.match(builds[2].prompt, /\/tmp\/wt-u1.*\/tmp\/wt-u2/);
});

test('bugfix: questions stop the run; answers resume it', async () => {
  const root = await project();
  const respond = (c) =>
    c.opts.agentType === 'ai-investigator' && !c.prompt.includes('Answers from the user')
      ? { status: 'partial', summary: 'unsure', questions: ['Which screen?'] }
      : done({ output: { symptom: 's', hypotheses: [{ hypothesis: 'h', status: 'confirmed' }] }, findings: [] });
  const first = await run(root, 'bugfix', respond, { input: 'total is 0' });
  assert.deepEqual([first.result.status, first.result.step, first.result.questions], ['waiting', 'diagnose', ['Which screen?']]);
  const second = await run(root, 'bugfix', respond, { input: 'total is 0', answers: { diagnose: 'The cart screen.' } });
  assert.equal(second.result.status, 'done');
  assert.match(second.calls[0].prompt, /Answers from the user .*The cart screen\./);
});

test('workflows are only built when the project asks for the engine', async () => {
  const root = await tempDir();
  await writeTree(root, { '.claude/project.yaml': 'stack: ^1\n' });
  const { ops } = await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root });
  assert.ok(!ops.some((o) => o.rel.startsWith('workflows/')));
  assert.doesNotMatch(await readFile(path.join(root, '.claude/skills/ai-review/SKILL.md'), 'utf8'), /--workflow/);
});
