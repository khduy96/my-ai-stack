import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, fixture, role, tempDir, writeTree } from './helpers.mjs';

const exists = (p) => stat(p).then(() => true, () => false);
const read = (root, rel) => readFile(path.join(root, rel), 'utf8');

async function flutterProject(extra = '') {
  const root = await tempDir();
  await writeTree(root, { '.claude/project.yaml': `stack: ^0.6\npacks: [flutter]\n${extra}` });
  const { diags } = await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root });
  assert.deepEqual(codes(diags), []);
  return root;
}

test('flutter pack: lens variant in review fan-outs, builder traits, generated files protected', async () => {
  const root = await flutterProject();
  assert.match(await read(root, '.claude/agents/ai-verifier-flutter.md'), /## Focus: Flutter[\s\S]*## Flutter checks/);
  const builder = await read(root, '.claude/agents/ai-builder.md');
  assert.match(builder, /## Flutter practices/);
  assert.match(builder, /dart run build_runner build --delete-conflicting-outputs/);
  assert.match(builder, /Never edit generated files \(\*\*\/\*\.g\.dart/);
  const fanout = /`ai-verifier-correctness`, `ai-verifier-security`, `ai-verifier-conventions`, `ai-verifier-flutter`/;
  assert.match(await read(root, '.claude/skills/ai-review/SKILL.md'), fanout);
  const feature = await read(root, '.claude/skills/ai-feature/SKILL.md');
  assert.equal(feature.match(new RegExp(fanout.source, 'g')).length, 2, 'review and fix-review');
  assert.ok(await exists(path.join(root, '.claude/hooks/ai-protect-generated.mjs')));
  const allow = JSON.parse(await read(root, '.claude/settings.local.json')).permissions.allow;
  assert.ok(allow.includes('Bash(flutter test *)') && allow.includes('Bash(flutter analyze)'), 'pack pre-approves its checks');
});

test('a project overrides pack defaults and pack traits', async () => {
  const root = await flutterProject("enable:\n  policies: ['-protect-generated']\nroles:\n  builder:\n    traits: ['-flutter-checks']\n");
  assert.equal(await exists(path.join(root, '.claude/hooks')), false);
  const builder = await read(root, '.claude/agents/ai-builder.md');
  assert.doesNotMatch(builder, /## Flutter checks/);
  assert.match(builder, /## Flutter practices/);
});

test('pack defaults sit between stack defaults and the project', async () => {
  const f = await fixture({
    modules: { 'roles/a.md': role('a') },
    extra: { 'stack/packs/p/pack.yaml': 'id: p\nkind: pack\nversion: 0.1.0\ndefaults:\n  prefix: px-\n  context: From the pack.\n' },
    project: 'stack: ^0.1\npacks: [p]\ncontext: From the project.\n',
  });
  assert.deepEqual(codes((await build(f)).diags), []);
  const agent = await read(f.projectRoot, '.claude/agents/px-a.md');
  assert.ok(agent, 'pack default prefix applies');
});
