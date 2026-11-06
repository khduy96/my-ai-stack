import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, tempDir, writeTree } from './helpers.mjs';

const read = (root, rel) => readFile(path.join(root, rel), 'utf8');

async function built(yaml) {
  const root = await tempDir();
  await writeTree(root, { '.claude/project.yaml': `stack: ^1\n${yaml}` });
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags), []);
  return root;
}

test('maps: every agent reads the project map before searching, the repo map before changing contact points', async () => {
  const root = await built('maps: docs/maps\n');
  for (const agent of ['ai-builder', 'ai-investigator', 'ai-verifier-security']) {
    const text = await read(root, `.claude/agents/${agent}.md`);
    assert.match(text, /Before you search the code, read `docs\/maps\/PROJECT_MAP\.md`/);
    assert.match(text, /read `docs\/maps\/REPO_MAP\.md` and the module's `docs\/maps\/<module>\.REPO\.MAP\.md`/);
    assert.match(text, /the maps need `\/ai-map-update`/);
  }
  assert.match(await read(root, '.claude/agents/ai-cartographer.md'), /Maps directory: `docs\/maps`\./);
  for (const flow of ['ai-map-init', 'ai-map-update']) {
    const skill = await read(root, `.claude/skills/${flow}/SKILL.md`);
    assert.match(skill, /ai-cartographer/);
    assert.match(skill, /--produces notes/);
  }
});

test('the update command in the pointer follows the prefix', async () => {
  const root = await built('prefix: x-\nmaps: maps\n');
  assert.match(await read(root, '.claude/agents/x-builder.md'), /the maps need `\/x-map-update`/);
});

test('without maps, agents get no pointer and the cartographer knows to stop', async () => {
  const root = await built('');
  assert.doesNotMatch(await read(root, '.claude/agents/ai-builder.md'), /PROJECT_MAP/);
  assert.match(await read(root, '.claude/agents/ai-cartographer.md'), /Maps directory: ``\. If that is empty/);
});

test('scope keeps the maps writable', async () => {
  const root = await built('scope: [src]\nmaps: maps\n');
  const config = JSON.parse(await read(root, '.claude/hooks/ai-scope.json'));
  assert.deepEqual(config.paths, ['src']);
  for (const dir of ['.ai-runs/', 'maps/']) assert.ok(config.always_allowed.includes(dir), dir);
});
