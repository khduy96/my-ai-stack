import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { build, doctor } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, fixture, role, tempDir, trait, writeTree } from './helpers.mjs';

const exists = (p) => stat(p).then(() => true, () => false);
const frontmatter = (text) => YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)[1]);

test('the real stack builds valid agents and rebuilding changes nothing', async () => {
  const projectRoot = await tempDir();
  await writeTree(projectRoot, { '.claude/project.yaml': 'stack: ^0.4\nname: demo\ncontext: Demo app.\n' });

  const first = await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot });
  assert.deepEqual(codes(first.diags), []);
  assert.deepEqual(first.ops.map((o) => o.rel).sort(), [
    'agents/ai-analyst.md',
    'agents/ai-architect.md',
    'agents/ai-builder.md',
    'agents/ai-investigator.md',
    'agents/ai-verifier-adversarial.md',
    'agents/ai-verifier-conventions.md',
    'agents/ai-verifier-correctness.md',
    'agents/ai-verifier-security.md',
    'agents/ai-verifier.md',
    'skills/ai-bugfix/SKILL.md',
    'skills/ai-feature/SKILL.md',
    'skills/ai-review/SKILL.md',
  ]);

  const builder = await readFile(path.join(projectRoot, '.claude/agents/ai-builder.md'), 'utf8');
  assert.equal(frontmatter(builder).tools, 'Read, Grep, Glob, Edit, Write, Bash');
  assert.match(builder, /Demo app\./);
  assert.match(builder, /`status` \(required\)/);
  assert.doesNotMatch(builder, /handoff\.output/);

  const architect = await readFile(path.join(projectRoot, '.claude/agents/ai-architect.md'), 'utf8');
  assert.equal(frontmatter(architect).tools, 'Read, Grep, Glob');
  assert.match(architect, /Put your plan under `handoff\.output`/);
  assert.match(architect, /`units` \(required\)/);

  const security = await readFile(path.join(projectRoot, '.claude/agents/ai-verifier-security.md'), 'utf8');
  assert.equal(frontmatter(security).tools, 'Read, Grep, Glob, Bash');
  assert.match(security, /## Focus: security/);
  assert.doesNotMatch(security, /## Focus: correctness/);

  for (const op of first.ops) assert.doesNotMatch(await readFile(op.abs, 'utf8'), /\{\{/);

  const second = await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot });
  assert.ok(second.ops.every((o) => o.type === 'unchanged'));

  const checked = await doctor({ stackRoot: DEFAULT_STACK_ROOT, projectRoot });
  assert.deepEqual(codes(checked.diags), []);
});

test('dry run writes nothing', async () => {
  const { stackRoot, projectRoot } = await fixture({ modules: { 'roles/a.md': role('a') } });
  const { ops } = await build({ stackRoot, projectRoot, dryRun: true });
  assert.deepEqual(ops.map((o) => o.type), ['create']);
  assert.equal(await exists(path.join(projectRoot, '.claude/agents/ai-a.md')), false);
  assert.equal(await exists(path.join(projectRoot, '.claude/.stack-lock.json')), false);
});

test('never overwrites a file it did not generate, unless forced', async () => {
  const { stackRoot, projectRoot } = await fixture({
    modules: { 'roles/a.md': role('a') },
    extra: { 'project/.claude/agents/ai-a.md': 'mine' },
  });
  const blocked = await build({ stackRoot, projectRoot });
  assert.deepEqual(codes(blocked.diags), ['unmanaged-file']);
  assert.equal(await readFile(path.join(projectRoot, '.claude/agents/ai-a.md'), 'utf8'), 'mine');

  const forced = await build({ stackRoot, projectRoot, force: true });
  assert.deepEqual(codes(forced.diags), []);
});

test('detects hand edits to generated files', async () => {
  const { stackRoot, projectRoot } = await fixture({ modules: { 'roles/a.md': role('a') } });
  await build({ stackRoot, projectRoot });
  const agentFile = path.join(projectRoot, '.claude/agents/ai-a.md');
  await writeFile(agentFile, `${await readFile(agentFile, 'utf8')}\nhand edit\n`);

  assert.deepEqual(codes((await doctor({ stackRoot, projectRoot })).diags), ['generated-drift']);
  assert.deepEqual(codes((await build({ stackRoot, projectRoot })).diags), ['generated-drift']);
  assert.deepEqual(codes((await build({ stackRoot, projectRoot, force: true })).diags), []);
});

test('CRLF checkouts do not count as hand edits', async () => {
  const { stackRoot, projectRoot } = await fixture({ modules: { 'roles/a.md': role('a') } });
  await build({ stackRoot, projectRoot });
  const agentFile = path.join(projectRoot, '.claude/agents/ai-a.md');
  await writeFile(agentFile, (await readFile(agentFile, 'utf8')).replace(/\n/g, '\r\n'));
  assert.deepEqual(codes((await doctor({ stackRoot, projectRoot })).diags), []);
});

test('disabling a role removes its generated file', async () => {
  const { stackRoot, projectRoot } = await fixture({ modules: { 'roles/a.md': role('a'), 'roles/b.md': role('b') } });
  await build({ stackRoot, projectRoot });
  await writeFile(path.join(projectRoot, '.claude/project.yaml'), "enable:\n  roles: ['*', '-b']\n");
  const { ops } = await build({ stackRoot, projectRoot });
  assert.deepEqual(ops.map((o) => `${o.type} ${o.rel}`).sort(), ['remove agents/ai-b.md', 'unchanged agents/ai-a.md']);
  assert.equal(await exists(path.join(projectRoot, '.claude/agents/ai-b.md')), false);
});

test('cascade: pack and project overrides, local prefix, slots and tools', async () => {
  const { stackRoot, projectRoot } = await fixture({
    modules: {
      'roles/a.md': role('a', "traits: [t1]\nslots: ['+extra']\n", 'Base.\n\n{{traits}}\n\n{{extra}}'),
      'traits/t1.md': trait('t1'),
      'traits/t2.md': trait('t2', 'slot: extra\n'),
    },
    extra: {
      'stack/packs/p/pack.yaml': 'id: p\nkind: pack\nversion: 0.1.0\nroles:\n  a:\n    tools: [\'+Bash\']\n',
      'stack/packs/p/modules/traits/t1.md': trait('t1', 'body_mode: append\n', 'Pack addition.'),
    },
    project: "packs: [p]\nroles:\n  a:\n    traits: ['+t2']\n    model: sonnet\n    body: Project note.\n    body_mode: append\n",
    local: 'prefix: x-\n',
  });
  const { diags } = await build({ stackRoot, projectRoot });
  assert.deepEqual(codes(diags), []);
  const text = await readFile(path.join(projectRoot, '.claude/agents/x-a.md'), 'utf8');
  const fm = frontmatter(text);
  assert.equal(fm.tools, 'Read, Grep, Glob, Bash');
  assert.equal(fm.model, 'sonnet');
  assert.match(text, /Base\.\n\nTrait t1\.\n\nPack addition\.\n\nTrait t2\.\n\nProject note\.\n$/);
});
