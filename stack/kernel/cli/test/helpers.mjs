import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
}

export const tempDir = () => mkdtemp(path.join(tmpdir(), 'ai-stack-'));

export const role = (id, fm = '', body = 'Role {{traits}}') =>
  `---\nid: ${id}\nkind: role\nversion: 0.1.0\ndescription: ${id} role\npermission: read\n${fm}---\n${body}\n`;

export const trait = (id, fm = '', body = `Trait ${id}.`) =>
  `---\nid: ${id}\nkind: trait\nversion: 0.1.0\ndescription: ${id} trait\n${fm}---\n${body}\n`;

export const STACK_YAML = "name: test-stack\nversion: 0.1.0\ndefaults:\n  prefix: ai-\n  enable:\n    roles: ['*']\n";

// A stack with the given module files plus a project; returns both roots.
export async function fixture({ modules = {}, project = 'stack: ^0.1\n', local = null, extra = {} } = {}) {
  const root = await tempDir();
  const stackRoot = path.join(root, 'stack');
  const projectRoot = path.join(root, 'project');
  const files = { 'stack/stack.yaml': STACK_YAML, 'project/.claude/project.yaml': project, ...extra };
  for (const [rel, content] of Object.entries(modules)) files[`stack/modules/${rel}`] = content;
  if (local !== null) files['project/.claude/project.local.yaml'] = local;
  await writeTree(root, files);
  return { root, stackRoot, projectRoot };
}

export const codes = (diags, level = 'error') => diags.items.filter((d) => d.level === level).map((d) => d.code);
