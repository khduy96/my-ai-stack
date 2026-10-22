// The eval scorer, without a model: a fake run is written into a prepared repository.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { cleanup, compareResults, loadCases, parseTranscript, prepareCase, scoreRun } from '../lib/eval.mjs';
import { tempDir, writeTree } from './helpers.mjs';

async function caseDir(caseYaml, files) {
  const dir = await tempDir();
  await writeTree(dir, { 'case.yaml': caseYaml, ...files });
  return dir;
}

const HANDOFF = (status, findings) =>
  `handoff:\n  status: ${status}\n  summary: s\n  findings:\n${findings.map((f) => `    - { severity: ${f[0]}, title: "${f[1]}", evidence: "${f[2]}" }`).join('\n')}\n`;

test('the shipped cases prepare and build (dry run)', async () => {
  const cases = await loadCases(DEFAULT_STACK_ROOT);
  assert.deepEqual(cases.map((c) => c.id), ['bugfix-total', 'review-planted', 'review-preexisting']);
  for (const c of cases) {
    const prep = await prepareCase(DEFAULT_STACK_ROOT, c, '0.6.1');
    assert.deepEqual(prep.errors, [], c.id);
    assert.match(prep.command, new RegExp(`^/ai-${c.flow}`));
    await cleanup(prep.repo);
  }
});

test('scoring: findings, forbidden findings, invalid handoffs, run status', async () => {
  const dir = await caseDir(
    `flow: review\nexpect:\n  status: done\n  findings_from: [confirm.handoff.yaml, 'review/*.handoff.yaml']\n  findings:\n    - { id: bug, file: src/a.js, match: 'off.by.one', severity: [major, critical] }\n    - { id: missing, match: 'never there' }\n  forbid:\n    - { id: old, match: 'audit', severity: [major, critical] }\n`,
    { 'base/src/a.js': 'x\n' },
  );
  const c = { id: 't', dir, ...(await import('yaml')).default.parse(`flow: review\nexpect:\n  status: done\n  findings_from: [confirm.handoff.yaml, 'review/*.handoff.yaml']\n  findings:\n    - { id: bug, file: src/a.js, match: 'off.by.one', severity: [major, critical] }\n    - { id: missing, match: 'never there' }\n  forbid:\n    - { id: old, match: 'audit', severity: [major, critical] }\n`) };
  const prep = await prepareCase(DEFAULT_STACK_ROOT, c, '0.6.1');
  const run = path.join(prep.repo, '.ai-runs', '20261021-1200-review-x');
  await writeTree(run, {
    'run.yaml': 'flow: review\nstatus: done\n',
    'review/ai-verifier-correctness.handoff.yaml': HANDOFF('done', [['minor', 'ignored, confirm wins', 'src/a.js:1']]),
    'confirm.handoff.yaml': HANDOFF('done', [['major', 'Off-by-one in loop', 'src/a.js:1'], ['major', 'audit injection', 'src/b.js:2']]),
  });
  const scored = await scoreRun(c, prep.repo, null);
  const byName = Object.fromEntries(scored.checks.map((x) => [x.name, x.ok]));
  assert.equal(byName['run status is done'], true);
  assert.equal(byName['every handoff is valid'], true);
  assert.equal(byName['finds bug'], true);
  assert.equal(byName['finds missing'], false);
  assert.equal(byName['does not report old'], false);
  assert.equal(scored.passed, false);

  await writeFile(path.join(run, 'confirm.handoff.yaml'), 'handoff:\n  status: finished\n');
  assert.equal((await scoreRun(c, prep.repo, null)).checks.find((x) => x.name === 'every handoff is valid').ok, false);
  await cleanup(prep.repo);
});

test('scoring: diff limits count only changed lines; check script runs outside the repo', async () => {
  const yamlText = `flow: bugfix\nexpect:\n  diff:\n    files: [src/a.js]\n    max_lines: 2\n    contains: ['i = 0']\n    not_contains: ['keep me']\n  script: check.mjs\n`;
  const dir = await caseDir(yamlText, {
    'base/src/a.js': '// keep me\nlet i = 1;\n',
    'check.mjs': "import { readFileSync } from 'node:fs';\nprocess.exit(readFileSync(process.argv[2] + '/src/a.js', 'utf8').includes('i = 0') ? 0 : 1);\n",
  });
  const c = { id: 'd', dir, ...(await import('yaml')).default.parse(yamlText) };
  const prep = await prepareCase(DEFAULT_STACK_ROOT, c, '0.6.1');
  await writeFile(path.join(prep.repo, 'src/a.js'), '// keep me\nlet i = 0;\n');
  const scored = await scoreRun(c, prep.repo, null);
  const byName = Object.fromEntries(scored.checks.map((x) => [x.name, x.ok]));
  assert.equal(byName['changes only src/a.js'], true);
  assert.equal(byName['changes at most 2 lines'], true);
  assert.equal(byName['diff contains "i = 0"'], true);
  assert.equal(byName['diff does not contain "keep me"'], true, 'context lines do not count');
  assert.equal(byName['check.mjs passes'], true);
  await cleanup(prep.repo);
});

test('transcripts and baseline comparison', () => {
  const t = parseTranscript([
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent' }, { type: 'tool_use', name: 'mcp__x__y' }] } }),
    'noise',
    JSON.stringify({ type: 'result', total_cost_usd: 0.42, duration_ms: 1000, num_turns: 3, is_error: false, result: 'done' }),
  ].join('\n'));
  assert.deepEqual([t.tools, t.mcpCalls, t.costUsd, t.error], [['Agent', 'mcp__x__y'], 1, 0.42, false]);

  const ok = { id: 'a', passed: true, checks: [{ ok: true }, { ok: true }] };
  const bad = { id: 'a', passed: false, checks: [{ name: 'finds bug', ok: false }, { ok: true }] };
  assert.match(compareResults({ cases: [ok] }, { cases: [bad] })[0], /^REGRESSED a: finds bug/);
  assert.match(compareResults({ cases: [bad] }, { cases: [ok] })[0], /^fixed/);
});
