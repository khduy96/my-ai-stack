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
  await writeTree(root, { '.claude/project.yaml': `stack: ^0.6\n${yaml}` });
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags), []);
  return root;
}

test('knowledge: every agent is pointed at the index, the scribe at its directory', async () => {
  const root = await built('knowledge: docs/knowledge\n');
  for (const agent of ['ai-builder', 'ai-explainer', 'ai-verifier-security']) {
    assert.match(await read(root, `.claude/agents/${agent}.md`), /Start from `docs\/knowledge\/INDEX\.md`/);
  }
  assert.match(await read(root, '.claude/agents/ai-scribe.md'), /Knowledge directory: `docs\/knowledge`\./);
  assert.match(await read(root, '.claude/skills/ai-learn/SKILL.md'), /--produces notes/);
  assert.match(await read(root, '.claude/skills/ai-explain/SKILL.md'), /--produces explanation/);
});

test('without knowledge, agents get no pointer and the scribe knows to stop', async () => {
  const root = await built('');
  assert.doesNotMatch(await read(root, '.claude/agents/ai-builder.md'), /INDEX\.md/);
  assert.match(await read(root, '.claude/agents/ai-scribe.md'), /Knowledge directory: ``\. If that is empty/);
});

test('new traits and variants', async () => {
  const root = await built("roles:\n  builder:\n    traits: ['+test-first']\n");
  assert.match(await read(root, '.claude/agents/ai-builder.md'), /## Test first/);
  const tests = await read(root, '.claude/agents/ai-builder-tests.md');
  assert.match(tests, /## Tests only/);
  assert.doesNotMatch(tests, /## Test first/, 'the tests variant drops a project-wide test-first instead of conflicting with it');
  assert.match(await read(root, '.claude/agents/ai-verifier-performance.md'), /## Focus: performance/);
});
