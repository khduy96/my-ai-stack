// One case per error doctor must catch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doctor } from '../lib/api.mjs';
import { codes, fixture, role, trait } from './helpers.mjs';

const check = async (opts) => {
  const { stackRoot, projectRoot } = await fixture(opts);
  return (await doctor({ stackRoot, projectRoot })).diags;
};

const cases = {
  'schema-invalid': { modules: { 'roles/a.md': role('a', 'permision: write\n') } },
  'parse-error': { modules: { 'roles/a.md': 'no frontmatter here' } },
  'id-mismatch': { modules: { 'roles/a.md': role('b') } },
  'kind-mismatch': { modules: { 'traits/a.md': role('a') } },
  'unknown-ref': { modules: { 'roles/a.md': role('a', 'traits: [missing]\n') } },
  'duplicate-id': {
    modules: { 'roles/a.md': role('a') },
    project: 'modules: [m1, m2]\n',
    extra: { 'project/m1/roles/b.md': role('b'), 'project/m2/roles/b.md': role('b') },
  },
  'requires-cycle': {
    modules: { 'traits/x.md': trait('x', 'requires: [y]\n'), 'traits/y.md': trait('y', 'requires: [x]\n') },
  },
  'trait-conflict': {
    modules: {
      'roles/a.md': role('a', 'traits: [x, y]\n'),
      'traits/x.md': trait('x', 'conflicts: [y]\n'),
      'traits/y.md': trait('y'),
    },
  },
  'trait-not-applicable': {
    modules: { 'roles/a.md': role('a', 'traits: [x]\n'), 'traits/x.md': trait('x', 'applies_to: [other]\n') },
  },
  'unknown-slot': { modules: { 'roles/a.md': role('a', '', 'Body {{nope}}') } },
  'incompatible-version': { modules: { 'roles/a.md': role('a', 'kernel: ^9\n') } },
  'missing-file': { modules: { 'roles/a.md': role('a') }, extra: { 'project/.claude/project.yaml': null } },
};

for (const [code, opts] of Object.entries(cases)) {
  test(`doctor reports ${code}`, async () => {
    if (opts.extra?.['project/.claude/project.yaml'] === null) {
      const { stackRoot, projectRoot } = await fixture({ ...opts, extra: {} });
      const { rm } = await import('node:fs/promises');
      await rm(`${projectRoot}/.claude/project.yaml`);
      const { diags } = await doctor({ stackRoot, projectRoot });
      assert.ok(codes(diags).includes(code), JSON.stringify(diags.items));
      return;
    }
    const diags = await check(opts);
    assert.ok(codes(diags).includes(code), JSON.stringify(diags.items, null, 2));
  });
}

test('trait targeting an undeclared slot is reported', async () => {
  const diags = await check({ modules: { 'roles/a.md': role('a', 'traits: [x]\n'), 'traits/x.md': trait('x', 'slot: other\n') } });
  assert.deepEqual(codes(diags), ['unknown-slot']);
});

test('project requiring another stack version is reported', async () => {
  const diags = await check({ modules: { 'roles/a.md': role('a') }, project: 'stack: ^2\n' });
  assert.deepEqual(codes(diags), ['incompatible-version']);
});

test('override of an unknown module and unknown project keys', async () => {
  const diags = await check({ modules: { 'roles/a.md': role('a') }, project: 'roles:\n  ghost: { model: sonnet }\nknowledge: [x]\n' });
  assert.deepEqual(codes(diags), ['unknown-ref']);
  assert.deepEqual(codes(diags, 'warn'), ['unsupported-key']);
});

test('a clean fixture has no diagnostics', async () => {
  const diags = await check({ modules: { 'roles/a.md': role('a', 'traits: [x]\n'), 'traits/x.md': trait('x') } });
  assert.deepEqual(diags.items, []);
});
