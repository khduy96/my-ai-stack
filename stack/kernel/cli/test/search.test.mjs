import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { search, tokens } from '../lib/search.mjs';
import { codes, tempDir, writeTree } from './helpers.mjs';

const KNOWLEDGE = {
  'docs/knowledge/INDEX.md': '# Knowledge index\n\n- [Orders cache](orders-cache.md)\n',
  'docs/knowledge/orders-cache.md': '---\ntitle: Đơn hàng và cache\ntags: [orders, cache]\n---\nSau mỗi lần ghi đơn hàng phải xoá cache, nếu không màn danh sách hiển thị dữ liệu cũ.\n',
  'docs/knowledge/stock.md': '---\ntitle: Tồn kho\ntags: [warehouse]\n---\nHuỷ đơn thì cộng lại tồn kho cho từng sản phẩm.\n',
  'docs/knowledge/sync.md': '# Sync\n\nThe sync service pushes pending changes when the network returns.\n',
};

test('tokens fold Vietnamese accents', () => {
  assert.deepEqual(tokens('Đơn hàng, tồn KHO'), ['don', 'hang', 'ton', 'kho']);
});

test('search ranks by relevance, accent-insensitive, title and tags first', async () => {
  const root = await tempDir();
  await writeTree(root, KNOWLEDGE);
  const hits = await search({ dir: path.join(root, 'docs/knowledge'), query: 'don hang cache', root });
  assert.equal(hits[0].file, 'docs/knowledge/orders-cache.md');
  assert.equal(hits[0].title, 'Đơn hàng và cache');
  assert.ok(hits[0].lines.some((l) => l.text.includes('xoá cache')));
  assert.equal((await search({ dir: path.join(root, 'docs/knowledge'), query: 'tồn kho', root }))[0].file, 'docs/knowledge/stock.md');
  assert.deepEqual(await search({ dir: path.join(root, 'docs/knowledge'), query: 'nothing matches this', root }), []);
});

test('knowledge with the index retriever: agents are told to search, the command is allowed', async () => {
  const root = await tempDir();
  await writeTree(root, { ...KNOWLEDGE, '.claude/project.yaml': 'stack: ^1\nknowledge: { dir: docs/knowledge, retriever: index }\n' });
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags), []);
  const builder = await readFile(path.join(root, '.claude/agents/ai-builder.md'), 'utf8');
  assert.match(builder, /search it with `node ".*stack\.mjs" search "<terms of your task>" --project \.`/);
  const allow = JSON.parse(await readFile(path.join(root, '.claude/settings.local.json'), 'utf8')).permissions.allow;
  assert.ok(allow.some((a) => /stack\.mjs" search \*\)$/.test(a)));

  // A plain string keeps the grep retriever and adds no permission.
  await writeTree(root, { '.claude/project.yaml': 'stack: ^1\nknowledge: docs/knowledge\n' });
  await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root });
  assert.match(await readFile(path.join(root, '.claude/agents/ai-builder.md'), 'utf8'), /then search that directory/);
  const allow2 = JSON.parse(await readFile(path.join(root, '.claude/settings.local.json'), 'utf8')).permissions.allow;
  assert.ok(!allow2.some((a) => a.includes(' search ')));
});
