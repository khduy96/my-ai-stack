import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exitCodeFor, finalFindings, summaryMarkdown } from '../lib/run.mjs';
import { tempDir, writeTree } from './helpers.mjs';

const H = (severity, title) => `handoff:\n  status: done\n  summary: s\n  findings:\n    - { severity: ${severity}, title: "${title}", evidence: "src/a.js:1" }\n`;

test('final findings come from the last step that left handoffs', async () => {
  const review = await tempDir();
  await writeTree(review, {
    'run.yaml': 'flow: review\nstatus: done\nsteps:\n  review: { status: done }\n  confirm: { status: done }\n',
    'review/ai-verifier-security.handoff.yaml': H('major', 'raw'),
    'confirm.handoff.yaml': H('critical', 'confirmed'),
  });
  assert.deepEqual((await finalFindings(review)).findings.map((f) => f.title), ['confirmed']);

  const skipped = await tempDir();
  await writeTree(skipped, {
    'run.yaml': 'flow: review\nstatus: done\nsteps:\n  review: { status: done }\n  confirm: { status: skipped }\n',
    'review/a.handoff.yaml': H('minor', 'one'),
    'review/b.handoff.yaml': H('info', 'two'),
  });
  const r = await finalFindings(skipped);
  assert.deepEqual([r.step, r.findings.length], ['review', 2]);

  const loop = await tempDir();
  await writeTree(loop, {
    'run.yaml': "flow: feature\nstatus: done\nsteps:\n  confirm: { status: done }\n  fix: { status: done, iteration: 1 }\n  'fix-confirm#1': { status: done }\n",
    'confirm.handoff.yaml': H('major', 'before fix'),
    'fix/1/fix-confirm.handoff.yaml': H('minor', 'after fix'),
  });
  assert.deepEqual((await finalFindings(loop)).findings.map((f) => f.title), ['after fix']);
});

test('exit codes: findings at or above the threshold fail; unfinished runs are distinct', () => {
  const f = [{ severity: 'major' }];
  assert.equal(exitCodeFor({ runStatus: 'done', findings: f, failOn: 'major' }), 1);
  assert.equal(exitCodeFor({ runStatus: 'done', findings: f, failOn: 'critical' }), 0);
  assert.equal(exitCodeFor({ runStatus: 'done', findings: f, failOn: 'none' }), 0);
  assert.equal(exitCodeFor({ runStatus: 'failed', findings: [], failOn: 'major' }), 2);
  assert.equal(exitCodeFor({ runStatus: null, findings: [], failOn: 'major' }), 2);
  assert.equal(exitCodeFor({ runStatus: 'waiting', findings: [], failOn: 'major' }), 3);
  assert.equal(exitCodeFor({ runStatus: 'done', findings: [], failOn: 'major', error: true }), 2);
});

test('summary lists findings by severity and escapes table pipes', () => {
  const md = summaryMarkdown({
    flow: 'ai-review',
    input: 'main..HEAD',
    runDir: '.ai-runs/x',
    outcome: { status: 'done', findings: [{ severity: 'minor', title: 'a' }, { severity: 'critical', title: 'b | c', evidence: 'x.js:2' }] },
    transcript: { costUsd: 0.31, durationMs: 42000, report: 'All good.' },
    failOn: 'major',
    code: 1,
  });
  assert.match(md, /## ai-stack: \/ai-review main\.\.HEAD/);
  assert.match(md, /failed: findings at major or above · run status `done` · US\$0\.31 · 42s/);
  assert.ok(md.indexOf('critical') < md.indexOf('| minor'), 'most severe first');
  assert.match(md, /b \\\| c/);
});
