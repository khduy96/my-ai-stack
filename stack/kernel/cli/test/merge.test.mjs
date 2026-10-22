import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyListOps, mergeBody, mergeValue } from '../lib/merge.mjs';
import { satisfies } from '../lib/semver.mjs';

test('scalars: later wins, null deletes', () => {
  assert.deepEqual(mergeValue({ a: 1, b: 2 }, { a: 3, b: null }), { a: 3 });
});

test('maps merge deeply', () => {
  assert.deepEqual(mergeValue({ x: { a: 1, b: 1 } }, { x: { b: 2 } }), { x: { a: 1, b: 2 } });
});

test('plain list replaces, op list is appended', () => {
  assert.deepEqual(mergeValue({ l: ['a', 'b'] }, { l: ['c'] }), { l: ['c'] });
  assert.deepEqual(mergeValue({ l: ['a'] }, { l: ['+b', '-a'] }), { l: ['a', '+b', '-a'] });
});

test('applyListOps evaluates ops against a base unless a layer replaced the list', () => {
  assert.deepEqual(applyListOps(['Read', 'Grep'], ['+Bash', '-Grep']), ['Read', 'Bash']);
  assert.deepEqual(applyListOps(['Read', 'Grep'], ['Bash', '+Edit']), ['Bash', 'Edit']);
  assert.deepEqual(applyListOps([], ['*', '-b'], ['a', 'b', 'c']), ['a', 'c']);
});

test('body modes', () => {
  assert.equal(mergeBody('A', 'B'), 'B');
  assert.equal(mergeBody('A\n', 'B', 'append'), 'A\n\nB\n');
  assert.equal(mergeBody('A', 'B', 'prepend'), 'B\n\nA');
  assert.equal(mergeBody('A', '  '), 'A');
});

test('semver ranges', () => {
  assert.ok(satisfies('0.1.4', '^0.1'));
  assert.ok(!satisfies('0.2.0', '^0.1'));
  assert.ok(satisfies('1.4.0', '^1.2'));
  assert.ok(!satisfies('2.0.0', '^1.2'));
  assert.ok(satisfies('1.2.9', '~1.2'));
  assert.ok(satisfies('3.0.0', '>=2'));
  assert.ok(satisfies('0.1.0', '*'));
  assert.ok(!satisfies('0.1.0', 'not-a-range'));
});
