import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { doctor } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { compareVersions, updateVersions } from '../lib/versions.mjs';
import { codes, role, STACK_YAML, tempDir, writeTree } from './helpers.mjs';

const stackDoctor = async (stackRoot) => (await doctor({ stackRoot })).diags;

test('the real stack: every changed module has a bumped, recorded version', async () => {
  const rows = await compareVersions(DEFAULT_STACK_ROOT);
  const off = rows.filter((r) => r.status !== 'ok').map((r) => `${r.status} ${r.key} ${r.locked} -> ${r.version}`);
  assert.deepEqual(off, [], 'bump the version of each changed module, then run: node stack.mjs versions --update');
});

test('changing a module without a version bump fails doctor; bumping and recording fixes it', async () => {
  const root = await tempDir();
  await writeTree(root, { 'stack.yaml': STACK_YAML, 'modules/roles/a.md': role('a') });
  assert.deepEqual(codes(await stackDoctor(root), 'warn'), ['version-unrecorded'], 'no lock yet');
  await updateVersions(root);
  assert.deepEqual((await stackDoctor(root)).items, []);

  await writeFile(path.join(root, 'modules/roles/a.md'), role('a', '', 'Changed body {{traits}}'));
  assert.deepEqual(codes(await stackDoctor(root)), ['version-not-bumped']);

  await writeFile(path.join(root, 'modules/roles/a.md'), role('a', '', 'Changed body {{traits}}').replace('version: 0.1.0', 'version: 0.1.1'));
  const diags = await stackDoctor(root);
  assert.deepEqual(codes(diags), []);
  assert.deepEqual(codes(diags, 'warn'), ['version-unrecorded']);

  await updateVersions(root);
  assert.deepEqual((await stackDoctor(root)).items, []);
});

test('a version going backwards is an error; policy scripts count as content', async () => {
  const root = await tempDir();
  await writeTree(root, {
    'stack.yaml': STACK_YAML,
    'modules/roles/a.md': role('a').replace('version: 0.1.0', 'version: 0.2.0'),
    'modules/policies/p.yaml': 'id: p\nkind: policy\nversion: 0.1.0\ndescription: P.\nguard: { event: PreToolUse, matcher: Write, script: p.mjs }\n',
    'modules/policies/p.mjs': 'process.exit(0);\n',
  });
  await updateVersions(root);
  await writeFile(path.join(root, 'modules/roles/a.md'), role('a'));
  await writeFile(path.join(root, 'modules/policies/p.mjs'), 'process.exit(2);\n');
  const rows = (await compareVersions(root)).filter((r) => r.status !== 'ok').map((r) => `${r.status} ${r.key}`);
  assert.deepEqual(rows, ['changed policy:p', 'downgraded role:a']);
});
