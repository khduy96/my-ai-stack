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

test('memory bank: every agent reads the brief and active context, the archivist gets its directory', async () => {
  const root = await built('memory_bank: docs/memory-bank\n');
  for (const agent of ['ai-builder', 'ai-architect', 'ai-verifier-security']) {
    const text = await read(root, `.claude/agents/${agent}.md`);
    assert.match(text, /read `docs\/memory-bank\/projectbrief\.md`/);
    assert.match(text, /`docs\/memory-bank\/activeContext\.md`/);
    assert.match(text, /`docs\/memory-bank\/decisions\.md`: before proposing/);
  }
  assert.match(await read(root, '.claude/agents/ai-archivist.md'), /Memory bank directory: `docs\/memory-bank`\./);
  for (const flow of ['ai-memory-init', 'ai-memory-update']) {
    const skill = await read(root, `.claude/skills/${flow}/SKILL.md`);
    assert.match(skill, /ai-archivist/);
    assert.match(skill, /--produces notes/);
  }
});

test('without a memory bank, agents get no pointer and the archivist knows to stop', async () => {
  const root = await built('');
  assert.doesNotMatch(await read(root, '.claude/agents/ai-builder.md'), /memory bank/i);
  assert.match(await read(root, '.claude/agents/ai-archivist.md'), /Memory bank directory: ``\. If that is empty/);
});

test('scope keeps the memory bank writable', async () => {
  const root = await built('scope: [src]\nknowledge: docs/knowledge\nmemory_bank: memory-bank\n');
  const config = JSON.parse(await read(root, '.claude/hooks/ai-scope.json'));
  assert.deepEqual(config.paths, ['src']);
  for (const dir of ['.ai-runs/', 'docs/knowledge/', 'memory-bank/']) assert.ok(config.always_allowed.includes(dir), dir);
});
