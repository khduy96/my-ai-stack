// Policies, the managed settings file, and the guard scripts themselves.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build, doctor } from '../lib/api.mjs';
import { defaultCli } from '../lib/flow.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, tempDir, writeTree } from './helpers.mjs';

const exists = (p) => stat(p).then(() => true, () => false);
const read = (root, rel) => readFile(path.join(root, rel), 'utf8');
const json = async (root, rel) => JSON.parse(await read(root, rel));

async function project(yaml, files = {}) {
  const root = await tempDir();
  await writeTree(root, { '.claude/project.yaml': `stack: ^0.5\n${yaml}`, ...files });
  return root;
}
const run = (projectRoot, opts = {}) => build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot, ...opts });

// Runs a generated hook like Claude Code does: JSON on stdin, cwd = project root.
function hook(root, name, toolInput, tool = 'Write') {
  const r = spawnSync(process.execPath, [path.join(root, '.claude/hooks', name)], {
    input: JSON.stringify({ tool_name: tool, tool_input: toolInput, cwd: root }),
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr };
}

test('flow permissions are managed in settings.local.json without touching user entries', async () => {
  const root = await project('', {
    '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(npm test)', 'Bash(git diff *)'] }, model: 'opus' }),
  });
  assert.deepEqual(codes((await run(root)).diags), []);
  const s = await json(root, '.claude/settings.local.json');
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.permissions.allow, ['Bash(npm test)', 'Bash(git diff *)', `Bash(${defaultCli()} check *)`, 'Bash(git status *)', 'Bash(git log *)', 'Edit(.ai-runs/**)']);
  assert.ok(s.permissions.allow.every((rule) => !/^Bash\([^ ]*\*/.test(rule)), 'no wildcard before the subcommand');
  const lock = await json(root, '.claude/.stack-lock.json');
  assert.ok(!lock.settings.allow.includes('Bash(git diff *)'), 'an entry the user already had is not ours');

  // Rebuild: nothing changes. Disable every flow: our entries go, the user's stay.
  assert.ok((await run(root)).ops.every((o) => o.type === 'unchanged'));
  await writeFile(path.join(root, '.claude/project.yaml'), 'stack: ^0.5\nenable:\n  flows: []\n');
  await run(root);
  assert.deepEqual((await json(root, '.claude/settings.local.json')).permissions.allow, ['Bash(npm test)', 'Bash(git diff *)']);
});

test('settings: shared moves the managed entries to settings.json; none manages nothing', async () => {
  const root = await project('');
  await run(root);
  await writeFile(path.join(root, '.claude/project.yaml'), 'stack: ^0.5\nsettings: shared\n');
  await run(root);
  assert.equal(await exists(path.join(root, '.claude/settings.local.json')), true);
  assert.deepEqual((await json(root, '.claude/settings.local.json')), {});
  assert.ok((await json(root, '.claude/settings.json')).permissions.allow.includes('Edit(.ai-runs/**)'));

  await writeFile(path.join(root, '.claude/project.yaml'), 'stack: ^0.5\nsettings: none\n');
  await run(root);
  assert.deepEqual(await json(root, '.claude/settings.json'), {});
  assert.equal((await json(root, '.claude/.stack-lock.json')).settings, undefined);
});

test('scope: rule, review default, hook files, hook registration', async () => {
  const root = await project('scope: [lib/features/orders]\nknowledge: docs/knowledge\n');
  assert.deepEqual(codes((await run(root)).diags), []);

  assert.match(await read(root, '.claude/agents/ai-builder.md'), /Project rules:\n- Only edit files under lib\/features\/orders\./);
  assert.match(await read(root, '.claude/skills/ai-review/SKILL.md'), /use: uncommitted changes under lib\/features\/orders only\./);
  const config = await json(root, '.claude/hooks/ai-scope.json');
  assert.deepEqual(config.paths, ['lib/features/orders']);
  assert.deepEqual(config.always_allowed, ['.ai-runs/', 'docs/knowledge/']);

  const s = await json(root, '.claude/settings.local.json');
  assert.deepEqual(s.hooks.PreToolUse, [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node .claude/hooks/ai-scope.mjs' }] }]);

  assert.equal(hook(root, 'ai-scope.mjs', { file_path: 'lib/features/orders/a.dart' }).status, 0);
  assert.equal(hook(root, 'ai-scope.mjs', { file_path: 'docs/knowledge/x.md' }).status, 0);
  assert.equal(hook(root, 'ai-scope.mjs', { file_path: '.ai-runs/r/run.yaml' }).status, 0);
  const blocked = hook(root, 'ai-scope.mjs', { file_path: 'lib/core/x.dart' });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /outside lib\/features\/orders\//);
  assert.equal(hook(root, 'ai-scope.mjs', { file_path: 'lib/features/orders/../../core/y.dart' }).status, 2);
  assert.equal(hook(root, 'ai-scope.mjs', { file_path: 'lib/features/orders2/z.dart' }).status, 2);

  // Removing scope removes the hook files and the registration.
  await writeFile(path.join(root, '.claude/project.yaml'), 'stack: ^0.5\n');
  await run(root);
  assert.equal(await exists(path.join(root, '.claude/hooks')), false);
  assert.equal((await json(root, '.claude/settings.local.json')).hooks, undefined);
});

test('scope enabled without paths is an error', async () => {
  const root = await project('enable:\n  policies: [scope]\n');
  assert.ok(codes((await doctor({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags).includes('schema-invalid'));
});

test('protect-generated blocks generated files by glob, with project patterns', async () => {
  const root = await project("enable:\n  policies: [protect-generated]\npolicies:\n  protect-generated:\n    config:\n      patterns: ['**/*.g.dart', 'lib/gen/**']\n");
  assert.deepEqual(codes((await run(root)).diags), []);
  assert.match(await read(root, '.claude/agents/ai-builder.md'), /Never edit generated files \(\*\*\/\*\.g\.dart, lib\/gen\/\*\*\)/);
  assert.equal(hook(root, 'ai-protect-generated.mjs', { file_path: 'lib/models/user.g.dart' }).status, 2);
  assert.equal(hook(root, 'ai-protect-generated.mjs', { file_path: 'user.g.dart' }).status, 2);
  assert.equal(hook(root, 'ai-protect-generated.mjs', { file_path: 'lib/gen/a/b.dart' }).status, 2);
  assert.equal(hook(root, 'ai-protect-generated.mjs', { file_path: 'lib/models/user.dart' }).status, 0);
  assert.equal(hook(root, 'ai-protect-generated.mjs', { file_path: 'lib/general/x.dart' }).status, 0);
});

test('no-secrets blocks secrets in Write, Edit and MultiEdit, allows placeholders and ignored files', async () => {
  const root = await project('enable:\n  policies: [no-secrets]\n');
  assert.deepEqual(codes((await run(root)).diags), []);
  const h = (input, tool) => hook(root, 'ai-no-secrets.mjs', input, tool).status;
  const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  assert.equal(h({ file_path: 'src/a.js', content: `const k = "${aws}";` }), 2);
  assert.equal(h({ file_path: 'src/a.js', old_string: 'x', new_string: '-----BEGIN RSA PRIVATE KEY-----' }, 'Edit'), 2);
  assert.equal(h({ file_path: 'src/a.js', edits: [{ old_string: 'a', new_string: 'password = "hunter2hunter2hunter2"' }] }, 'MultiEdit'), 2);
  assert.equal(h({ file_path: 'src/a.js', content: 'password = "your-password-here"' }), 0);
  assert.equal(h({ file_path: 'src/a.js', content: 'const token = process.env.TOKEN;' }), 0);
  assert.equal(h({ file_path: '.env.example', content: `KEY=${aws}` }), 0);
  const blocked = hook(root, 'ai-no-secrets.mjs', { file_path: 'src/a.js', content: aws });
  assert.match(blocked.stderr, /AWS access key/);
  assert.doesNotMatch(blocked.stderr, new RegExp(aws), 'never echoes the secret');
});

test('policy config references must exist; unknown policies are reported', async () => {
  const root = await project('enable:\n  policies: [nope]\n');
  assert.deepEqual(codes((await doctor({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags), ['unknown-ref']);
});

test('settings with invalid JSON stop the build', async () => {
  const root = await project('', { '.claude/settings.local.json': '{ nope' });
  assert.deepEqual(codes((await run(root)).diags), ['parse-error']);
});

test('doctor warns when managed settings entries were removed by hand', async () => {
  const root = await project('');
  await run(root);
  await writeFile(path.join(root, '.claude/settings.local.json'), '{}');
  const diags = (await doctor({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags;
  assert.deepEqual(codes(diags, 'warn'), ['generated-missing']);
});
