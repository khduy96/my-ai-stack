import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { build, check, doctor } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, fixture, role, tempDir, writeTree } from './helpers.mjs';

const exists = (p) => stat(p).then(() => true, () => false);
const frontmatter = (text) => YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)[1]);
const TEMPLATE = { 'stack/engines/claude-code/flow-skill.md': '# {{flow.name}}\n\n{{flow.steps}}\n\n{{flow.report}}\n' };

const flow = (steps, extra = '') => `id: f\nkind: flow\nversion: 0.1.0\ndescription: Test flow.\n${extra}steps:\n${steps}`;
const STEP_A = '  - id: one\n    agent: a\n    goal: Do it.\n    in: { target: $input }\n';

async function flowFixture(steps, opts = {}) {
  return fixture({
    modules: { 'roles/a.md': role('a'), 'roles/b.md': role('b', 'produces: plan\n'), 'flows/f.yaml': flow(steps), ...opts.modules },
    extra: { ...TEMPLATE, ...opts.extra },
    project: opts.project,
  });
}

test('the real review flow builds into a skill that drives the verifier agents', async () => {
  const projectRoot = await tempDir();
  await writeTree(projectRoot, { '.claude/project.yaml': 'stack: ^0.3\n' });
  const { diags } = await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot });
  assert.deepEqual(codes(diags), []);

  const skill = await readFile(path.join(projectRoot, '.claude/skills/ai-review/SKILL.md'), 'utf8');
  const fm = frontmatter(skill);
  assert.equal(fm.name, 'ai-review');
  assert.match(fm['argument-hint'], /default: uncommitted changes/);
  assert.match(skill, /`ai-verifier-correctness`, `ai-verifier-security`, `ai-verifier-conventions`/);
  assert.match(skill, /\*\*Run only if\*\* the handoffs of step `review` contain at least one finding/);
  assert.match(skill, /`handoff\.findings` of every file in `<run>\/review\/`/);
  assert.match(skill, /stack\.mjs" check <file>`/);
  assert.doesNotMatch(skill, /\{\{/);
  assert.match(skill, /Create `\.ai-runs\/<YYYYMMDD-HHMM>-review-<slug>\/`/);
});

test('check flags per agent follow what each role produces', async () => {
  const { stackRoot, projectRoot } = await flowFixture('  - id: one\n    fanout: [a, b]\n    goal: Go.\n');
  assert.deepEqual(codes((await build({ stackRoot, projectRoot })).diags), []);
  const skill = await readFile(path.join(projectRoot, '.claude/skills/ai-f/SKILL.md'), 'utf8');
  assert.match(skill, /`ai-a`: `.* check <file>`/);
  assert.match(skill, /`ai-b`: `.* check <file> --produces plan`/);
});

test('flow references must point to existing, enabled agents and earlier steps', async () => {
  const cases = {
    'unknown agent': '  - id: one\n    agent: ghost\n    goal: Go.\n',
    'later step': '  - id: one\n    agent: a\n    goal: Go.\n    in: { x: $two.output }\n  - id: two\n    agent: a\n    goal: Go.\n',
    'bad ref': '  - id: one\n    agent: a\n    goal: Go.\n    in: { x: $input.nope }\n',
    'bad when': '  - id: one\n    agent: a\n    goal: Go.\n    when: { step: one, is: has-findings }\n',
  };
  for (const [name, steps] of Object.entries(cases)) {
    const { stackRoot, projectRoot } = await flowFixture(steps);
    assert.deepEqual(codes((await doctor({ stackRoot, projectRoot })).diags), ['unknown-ref'], name);
  }

  const disabled = await flowFixture(STEP_A, { project: "enable:\n  roles: ['*', '-a']\n" });
  assert.deepEqual(codes((await build(disabled)).diags), ['unknown-ref']);
  // Disabling the flow too makes the project consistent again.
  await writeFile(path.join(disabled.projectRoot, '.claude/project.yaml'), "enable:\n  roles: ['*', '-a']\n  flows: []\n");
  assert.deepEqual(codes((await doctor(disabled)).diags), []);
});

test('a step needs exactly one of agent or fanout, and unique ids', async () => {
  const both = await flowFixture('  - id: one\n    agent: a\n    fanout: [a, b]\n    goal: Go.\n');
  assert.deepEqual(codes((await doctor(both)).diags), ['schema-invalid']);
  const dup = await flowFixture(`${STEP_A}${STEP_A}`);
  assert.deepEqual(codes((await doctor(dup)).diags), ['duplicate-id']);
});

test('a project changes one step by id; unknown step ids are reported', async () => {
  const ok = await flowFixture(STEP_A, { project: 'flows:\n  f:\n    steps:\n      one: { gate: human }\n' });
  assert.deepEqual(codes((await build(ok)).diags), []);
  assert.match(await readFile(path.join(ok.projectRoot, '.claude/skills/ai-f/SKILL.md'), 'utf8'), /\*\*Gate\*\* `human`/);

  const bad = await flowFixture(STEP_A, { project: 'flows:\n  f:\n    steps:\n      nope: { gate: human }\n' });
  assert.deepEqual(codes((await doctor(bad)).diags), ['unknown-ref']);
});

test('disabling a flow removes its skill directory', async () => {
  const { stackRoot, projectRoot } = await flowFixture(STEP_A);
  await build({ stackRoot, projectRoot });
  await writeFile(path.join(projectRoot, '.claude/project.yaml'), 'enable:\n  flows: []\n');
  assert.deepEqual(codes((await build({ stackRoot, projectRoot })).diags), []);
  assert.equal(await exists(path.join(projectRoot, '.claude/skills/ai-f')), false);
});

test('an unknown placeholder in the engine template is reported', async () => {
  const { stackRoot, projectRoot } = await flowFixture(STEP_A, {
    extra: { 'stack/engines/claude-code/flow-skill.md': '{{flow.nope}}' },
  });
  assert.deepEqual(codes((await doctor({ stackRoot, projectRoot })).diags), ['unknown-slot']);
});

test('stack check validates a handoff and its output contract', async () => {
  const dir = await tempDir();
  const file = (name, text) => writeTree(dir, { [name]: text }).then(() => path.join(dir, name));

  const good = await file('good.yaml', 'handoff:\n  status: done\n  summary: Planned.\n  output:\n    approach: Reuse X.\n    units:\n      - { id: u1, goal: Do, files: [a.js] }\n');
  assert.deepEqual(codes((await check({ file: good, produces: 'plan' })).diags), []);

  const fenced = await file('msg.md', 'Done.\n\n```yaml\nhandoff:\n  status: done\n  summary: ok\n```\n');
  assert.deepEqual(codes((await check({ file: fenced })).diags), []);

  const badStatus = await file('bad.yaml', 'handoff:\n  status: finished\n  summary: x\n');
  assert.deepEqual(codes((await check({ file: badStatus })).diags), ['schema-invalid']);

  const noOutput = await file('noout.yaml', 'handoff:\n  status: done\n  summary: x\n');
  assert.deepEqual(codes((await check({ file: noOutput, produces: 'plan' })).diags), ['schema-invalid']);
  assert.deepEqual(codes((await check({ file: noOutput, produces: 'nope' })).diags), ['unknown-ref']);

  const badOutput = await file('badout.yaml', 'handoff:\n  status: done\n  summary: x\n  output: { approach: y }\n');
  assert.deepEqual(codes((await check({ file: badOutput, produces: 'plan' })).diags), ['schema-invalid']);
});
