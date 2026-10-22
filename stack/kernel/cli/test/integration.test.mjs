import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { build, doctor } from '../lib/api.mjs';
import { DEFAULT_STACK_ROOT } from '../lib/kernel.mjs';
import { codes, fixture, role, tempDir, writeTree } from './helpers.mjs';

const read = (root, rel) => readFile(path.join(root, rel), 'utf8');
const tools = async (root, agent) => YAML.parse(/^---\n([\s\S]*?)\n---/.exec(await read(root, `.claude/agents/${agent}.md`))[1]).tools.split(', ');

async function project(yaml) {
  const root = await tempDir();
  await writeTree(root, { '.claude/project.yaml': `stack: ^1\n${yaml}` });
  return root;
}

test('zentao: read tools granted to the listed roles and their variants, rule for everyone', async () => {
  const root = await project('enable:\n  integrations: [zentao]\n');
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags), []);
  const analyst = await tools(root, 'ai-analyst');
  assert.ok(analyst.includes('mcp__zentao__zentao_get_details'));
  assert.ok(analyst.includes('Read'), 'keeps the tools derived from permission');
  assert.ok(!analyst.includes('mcp__zentao__zentao_add_comment'), 'write tools are not granted by default');
  assert.ok(!(await tools(root, 'ai-builder')).some((t) => t.startsWith('mcp__zentao__')), 'builder gets nothing by default');
  assert.match(await read(root, '.claude/agents/ai-builder.md'), /Project rules:\n- When a request mentions a Zentao ticket/);
  const allow = JSON.parse(await read(root, '.claude/settings.local.json')).permissions.allow;
  assert.ok(allow.includes('mcp__zentao__zentao_get_details'), 'reads are pre-approved');
  assert.ok(!allow.some((a) => a.includes('add_comment')), 'writes are never pre-approved');
});

test('a project grants a write set explicitly; unknown sets and roles are errors', async () => {
  const root = await project("enable:\n  integrations: [zentao]\nintegrations:\n  zentao:\n    grants:\n      builder: [read, write]\n");
  assert.deepEqual(codes((await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root })).diags), []);
  assert.ok((await tools(root, 'ai-builder')).includes('mcp__zentao__zentao_add_comment'));

  const bad = await project("enable:\n  integrations: [zentao]\nintegrations:\n  zentao:\n    grants:\n      builder: [delete]\n      ghost: [read]\n");
  assert.deepEqual(codes((await doctor({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: bad })).diags), ['unknown-ref', 'unknown-ref']);
});

test('without enabling, no MCP tools appear', async () => {
  const root = await project('');
  await build({ stackRoot: DEFAULT_STACK_ROOT, projectRoot: root });
  assert.ok(!(await tools(root, 'ai-analyst')).some((t) => t.startsWith('mcp__')));
});

test('external steps use hand-written agents by name and ask them for a handoff', async () => {
  const f = await fixture({
    modules: {
      'roles/a.md': role('a'),
      'flows/f.yaml': 'id: f\nkind: flow\nversion: 0.1.0\ndescription: T.\nsteps:\n  - id: data\n    agent: ms-data\n    external: true\n    goal: Do the data part.\n  - id: check\n    agent: a\n    goal: Check.\n    in: { changes: $data.artifacts }\n',
    },
    extra: { 'stack/engines/claude-code/flow-skill.md': '{{flow.steps}}\n' },
  });
  assert.deepEqual(codes((await build(f)).diags), []);
  const skill = await read(f.projectRoot, '.claude/skills/ai-f/SKILL.md');
  assert.match(skill, /Start the agent `ms-data`\./);
  assert.match(skill, /hand-written agents that do not know the handoff format/);
  assert.match(skill, /Start the agent `ai-a`\./);
});
