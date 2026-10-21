// foreach, loop and the reference rules between iterations.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build, doctor } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, fixture, role, tempDir, writeTree } from './helpers.mjs';

const TEMPLATE = { 'stack/engines/claude-code/flow-skill.md': '{{flow.steps}}\n' };
const flow = (steps) => `id: f\nkind: flow\nversion: 0.1.0\ndescription: T.\nsteps:\n${steps}`;

async function run(steps, cmd = doctor) {
  const f = await fixture({
    modules: { 'roles/p.md': role('p', 'produces: plan\n'), 'roles/b.md': role('b'), 'roles/v.md': role('v'), 'flows/f.yaml': flow(steps) },
    extra: TEMPLATE,
  });
  const result = await cmd(f);
  const skill = cmd === build ? await readFile(path.join(f.projectRoot, '.claude/skills/ai-f/SKILL.md'), 'utf8').catch(() => '') : '';
  return { errors: codes(result.diags), messages: result.diags.items.map((d) => d.message), skill };
}

const PLAN = '  - id: plan\n    agent: p\n    goal: Plan.\n';
const LOOP = (body, until = 'check', extra = '') =>
  `  - id: fix\n${extra}    loop:\n      max: 2\n      until: { step: ${until}, is: no-major-findings }\n      steps:\n${body}`;
const FIX = (inp) => `        - id: repair\n          agent: b\n          goal: Fix.\n          in: { findings: ${inp} }\n`;
const CHECK = '        - id: check\n          agent: v\n          goal: Check.\n          in: { changes: $repair.artifacts }\n';

test('foreach renders waves and per-item handoffs', async () => {
  const { errors, skill } = await run(`${PLAN}  - id: build\n    agent: b\n    foreach: $plan.output.units\n    goal: Build.\n`, build);
  assert.deepEqual(errors, []);
  assert.match(skill, /for each item\*\* of `handoff\.output\.units` of `<run>\/plan\.handoff\.yaml`/);
  assert.match(skill, /items whose `files` overlap: run those one after another/);
  assert.match(skill, /`<run>\/build\/<item id>\.handoff\.yaml`/);
});

test('foreach must name a list field of the producing contract', async () => {
  const missing = await run(`${PLAN}  - id: build\n    agent: b\n    foreach: $plan.output.nope\n    goal: Build.\n`);
  assert.deepEqual(missing.errors, ['unknown-ref']);
  const notList = await run(`${PLAN}  - id: build\n    agent: b\n    foreach: $plan.output.approach\n    goal: Build.\n`);
  assert.deepEqual(notList.errors, ['schema-invalid']);
  const withFanout = await run(`${PLAN}  - id: build\n    fanout: [b, v]\n    foreach: $plan.output.units\n    goal: Build.\n`);
  assert.deepEqual(withFanout.errors, ['schema-invalid']);
});

test('loop renders iterations, the previous-iteration fallback and the last iteration after it', async () => {
  const steps = `${PLAN}${LOOP(FIX('[$check.findings, $plan.output]') + CHECK)}  - id: after\n    agent: v\n    goal: Sum up.\n    in: { last: $check.findings }\n`;
  const { errors, skill } = await run(steps, build);
  assert.deepEqual(errors, []);
  assert.match(skill, /### Step 2: `fix` \(loop\)/);
  assert.match(skill, /Repeat steps 2\.1–2\.2 \*\*at most 2 times\*\*/);
  assert.match(skill, /#### Step 2\.1: `repair`/);
  assert.match(skill, /the most recent that exists of: `handoff\.findings` of `<run>\/fix\/<n-1>\/check\.handoff\.yaml` \(previous iteration\); `handoff\.output` of `<run>\/plan\.handoff\.yaml`/);
  assert.match(skill, /`changes`: `handoff\.artifacts` of `<run>\/fix\/<n>\/repair\.handoff\.yaml`/);
  assert.match(skill, /`last`: `handoff\.findings` of `<run>\/fix\/<last>\/check\.handoff\.yaml` \(last iteration that ran\)/);
});

test('reference rules around loops', async () => {
  const cases = {
    'later body step without a list': `${PLAN}${LOOP(FIX('$check.findings') + CHECK)}`,
    'list with only previous-iteration refs': `${PLAN}${LOOP(FIX('[$check.findings, $check.summary]') + CHECK)}`,
    'until outside the loop': `${PLAN}${LOOP(FIX('$plan.output') + CHECK, 'plan')}`,
    'reference to the loop itself': `${PLAN}${LOOP(FIX('$plan.output') + CHECK)}  - id: after\n    agent: v\n    goal: Go.\n    in: { x: $fix.findings }\n`,
    'loop step when on its own body': `${PLAN}${LOOP(FIX('$plan.output') + CHECK, 'check', '    when: { step: check, is: has-findings }\n')}`,
    'top-level step before the loop reading its body': `  - id: early\n    agent: v\n    goal: Go.\n    in: { x: $check.findings }\n${PLAN}${LOOP(FIX('$plan.output') + CHECK)}`,
  };
  for (const [name, steps] of Object.entries(cases)) {
    const { errors, messages } = await run(steps);
    assert.deepEqual(errors, ['unknown-ref'], `${name}: ${messages.join(' | ')}`);
  }
});

test('loops do not nest and need max, until and steps', async () => {
  const nested = await run(`${PLAN}${LOOP(`        - id: inner\n          loop:\n            max: 1\n            until: { step: x, is: no-findings }\n            steps: []\n`, 'inner')}`);
  assert.ok(nested.errors.includes('schema-invalid'));
  const noMax = await run(`${PLAN}  - id: fix\n    loop:\n      until: { step: check, is: no-findings }\n      steps:\n        - id: check\n          agent: v\n          goal: Check.\n`);
  assert.deepEqual(noMax.errors, ['schema-invalid']);
});

test('a project overrides a step inside a loop by id', async () => {
  const f = await fixture({
    modules: { 'roles/p.md': role('p', 'produces: plan\n'), 'roles/b.md': role('b'), 'roles/v.md': role('v'), 'flows/f.yaml': flow(`${PLAN}${LOOP(FIX('$plan.output') + CHECK)}`) },
    extra: TEMPLATE,
    project: 'flows:\n  f:\n    steps:\n      check: { gate: human }\n',
  });
  assert.deepEqual(codes((await build(f)).diags), []);
  assert.match(await readFile(path.join(f.projectRoot, '.claude/skills/ai-f/SKILL.md'), 'utf8'), /Step 2\.2: `check`[\s\S]*\*\*Gate\*\* `human`/);
});

test('the real feature and bugfix flows build', async () => {
  const projectRoot = await tempDir();
  await writeTree(projectRoot, { '.claude/project.yaml': 'stack: ^0.4\n' });
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot })).diags), []);
  const feature = await readFile(path.join(projectRoot, '.claude/skills/ai-feature/SKILL.md'), 'utf8');
  assert.match(feature, /for each item\*\* of `handoff\.output\.units`/);
  assert.match(feature, /### Step 6: `fix` \(loop\)/);
  const bugfix = await readFile(path.join(projectRoot, '.claude/skills/ai-bugfix/SKILL.md'), 'utf8');
  assert.match(bugfix, /--produces diagnosis/);
  assert.match(bugfix, /\*\*at most 1 time\*\*/);
});
