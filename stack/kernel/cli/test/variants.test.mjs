import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { build, doctor } from '../lib/api.mjs';
import { codes, fixture, role, trait } from './helpers.mjs';

const frontmatter = (text) => YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)[1]);
const agents = async (projectRoot) => (await readdir(path.join(projectRoot, '.claude/agents'))).sort();

const VERIFIER = role(
  'v',
  "slots: ['+lens']\nvariants:\n  sec:\n    traits: ['+lens-sec']\n  quick:\n    model: haiku\n    description: Quick pass.\n",
  'Verify.\n\n{{lens}}\n\n{{traits}}',
);
const LENS = trait('lens-sec', 'slot: lens\napplies_to: [v]\n', '## Focus: sec');

test('each variant becomes its own agent, with a default or explicit description', async () => {
  const { stackRoot, projectRoot } = await fixture({ modules: { 'roles/v.md': VERIFIER, 'traits/lens-sec.md': LENS } });
  assert.deepEqual(codes((await build({ stackRoot, projectRoot })).diags), []);
  assert.deepEqual(await agents(projectRoot), ['ai-v-quick.md', 'ai-v-sec.md', 'ai-v.md']);

  const sec = await readFile(path.join(projectRoot, '.claude/agents/ai-v-sec.md'), 'utf8');
  assert.equal(frontmatter(sec).description, 'v role Variant: sec.');
  assert.match(sec, /## Focus: sec/);

  const base = await readFile(path.join(projectRoot, '.claude/agents/ai-v.md'), 'utf8');
  assert.doesNotMatch(base, /Focus/);

  const quick = frontmatter(await readFile(path.join(projectRoot, '.claude/agents/ai-v-quick.md'), 'utf8'));
  assert.equal(quick.description, 'Quick pass.');
  assert.equal(quick.model, 'haiku');
});

test('a project removes a variant with null and adds its own', async () => {
  const { stackRoot, projectRoot } = await fixture({
    modules: { 'roles/v.md': VERIFIER, 'traits/lens-sec.md': LENS },
    project: 'roles:\n  v:\n    variants:\n      quick: null\n      mine:\n        model: opus\n',
  });
  assert.deepEqual(codes((await build({ stackRoot, projectRoot })).diags), []);
  assert.deepEqual(await agents(projectRoot), ['ai-v-mine.md', 'ai-v-sec.md', 'ai-v.md']);
});

test('abstract roles emit only their variants', async () => {
  const { stackRoot, projectRoot } = await fixture({
    modules: { 'roles/v.md': VERIFIER, 'traits/lens-sec.md': LENS },
    project: 'roles:\n  v:\n    abstract: true\n',
  });
  await build({ stackRoot, projectRoot });
  assert.deepEqual(await agents(projectRoot), ['ai-v-quick.md', 'ai-v-sec.md']);
});

test('a broken variant is reported against the variant', async () => {
  const { stackRoot, projectRoot } = await fixture({
    modules: { 'roles/v.md': role('v', 'variants:\n  bad:\n    permission: root\n') },
  });
  const diags = (await doctor({ stackRoot, projectRoot })).diags;
  assert.deepEqual(codes(diags), ['schema-invalid']);
  assert.match(diags.items[0].file, /#variants\.bad$/);
});

test('a role and a variant generating the same agent is a duplicate', async () => {
  const { stackRoot, projectRoot } = await fixture({
    modules: { 'roles/v.md': role('v', 'variants:\n  x: {}\n'), 'roles/v-x.md': role('v-x') },
  });
  assert.deepEqual(codes((await doctor({ stackRoot, projectRoot })).diags), ['duplicate-id']);
});

test('produces renders the output contract and must name a real contract', async () => {
  const body = 'Plan.\n\n{{role.output}}\n\nAgent {{role.name}}.';
  const ok = await fixture({ modules: { 'roles/p.md': role('p', 'produces: plan\n', body) } });
  assert.deepEqual(codes((await build(ok)).diags), []);
  const text = await readFile(path.join(ok.projectRoot, '.claude/agents/ai-p.md'), 'utf8');
  assert.match(text, /Put your plan under `handoff\.output`/);
  assert.match(text, /Agent ai-p\./);

  const bad = await fixture({ modules: { 'roles/p.md': role('p', 'produces: nothing\n', body) } });
  assert.deepEqual(codes((await doctor(bad)).diags), ['unknown-ref']);
});
