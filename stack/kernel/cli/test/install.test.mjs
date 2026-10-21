import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { install } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { compatRange } from '../lib/setup.mjs';
import { codes, tempDir, writeTree } from './helpers.mjs';

const exists = (p) => stat(p).then(() => true, () => false);
const frontmatter = (text) => YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)[1]);

test('install writes the /stack skill with the live catalog, idempotently', async () => {
  const target = await tempDir();
  const first = await install({ stackRoot: DEFAULT_STACK_ROOT, target });
  assert.deepEqual(codes(first.diags), []);
  assert.deepEqual(first.ops.map((o) => `${o.type} ${o.rel}`), ['create skills/stack/SKILL.md']);

  const skill = await readFile(path.join(target, '.claude/skills/stack/SKILL.md'), 'utf8');
  assert.equal(frontmatter(skill).name, 'stack');
  assert.doesNotMatch(skill, /\{\{/);
  assert.doesNotMatch(skill, /\\/, 'no Windows separators: the file must not depend on the machine beyond the stack path');
  assert.match(skill, /- `ai-verifier-security`: Verifier focused on security/);
  assert.match(skill, /- `\/ai-feature`: Builds a feature end to end/);
  assert.match(skill, /^stack: \^0\.\d+$/m);
  // The tools catalog: every category, untruncated, with its CLI fallbacks.
  for (const title of ['Issue tracker', 'UI design', 'Team chat', 'Documentation and specs', 'Code hosting and CI', 'Error monitoring']) {
    assert.match(skill, new RegExp(`- \\*\\*${title}\\*\\*`));
  }
  assert.match(skill, /\(for example SHOP-123 or #45\)\?/);
  assert.match(skill, /`Bash\(gh pr view \*\)`/);
  assert.ok(await exists(path.join(target, '.claude/.stack-user-lock.json')));
  assert.equal(await exists(path.join(target, '.claude/.stack-lock.json')), false, 'never touches a project lock');

  const second = await install({ stackRoot: DEFAULT_STACK_ROOT, target });
  assert.deepEqual(second.ops.map((o) => o.type), ['unchanged']);
});

test('install never overwrites a /stack skill it did not write, unless forced', async () => {
  const target = await tempDir();
  await writeTree(target, { '.claude/skills/stack/SKILL.md': 'mine' });
  assert.deepEqual(codes((await install({ stackRoot: DEFAULT_STACK_ROOT, target })).diags), ['unmanaged-file']);
  assert.equal(await readFile(path.join(target, '.claude/skills/stack/SKILL.md'), 'utf8'), 'mine');
  assert.deepEqual(codes((await install({ stackRoot: DEFAULT_STACK_ROOT, target, force: true })).diags), []);
});

test('install leaves files of a project build in the same .claude/ alone', async () => {
  const target = await tempDir();
  await writeTree(target, { '.claude/.stack-lock.json': JSON.stringify({ files: { 'agents/ai-x.md': 'abc' } }), '.claude/agents/ai-x.md': 'x' });
  await install({ stackRoot: DEFAULT_STACK_ROOT, target });
  assert.equal(await readFile(path.join(target, '.claude/agents/ai-x.md'), 'utf8'), 'x');
  assert.match(await readFile(path.join(target, '.claude/.stack-lock.json'), 'utf8'), /ai-x/);
});

test('install dry run writes nothing; edited skill is drift', async () => {
  const target = await tempDir();
  await install({ stackRoot: DEFAULT_STACK_ROOT, target, dryRun: true });
  assert.equal(await exists(path.join(target, '.claude')), false);
  await install({ stackRoot: DEFAULT_STACK_ROOT, target });
  const file = path.join(target, '.claude/skills/stack/SKILL.md');
  await writeFile(file, `${await readFile(file, 'utf8')}\nedit\n`);
  assert.deepEqual(codes((await install({ stackRoot: DEFAULT_STACK_ROOT, target })).diags), ['generated-drift']);
});

test('compatRange follows semver caret rules', () => {
  assert.equal(compatRange('0.4.1'), '^0.4');
  assert.equal(compatRange('1.2.3'), '^1');
});
