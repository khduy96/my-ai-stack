// The /stack skill: an interview that writes a project's project.yaml and builds it.
// It has to work in projects that have no stack yet, so `stack install` puts it in the
// user's ~/.claude/ instead of a project. Its protocol lives in
// engines/claude-code/stack-skill.md; this file fills in the stack-specific parts.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { GENERATOR, KERNEL_VERSION } from './kernel.mjs';
import { defaultCli } from './flow.mjs';
import { readText } from './load.mjs';

export const SETUP_TEMPLATE = path.join('engines', 'claude-code', 'stack-skill.md');
export const SETUP_SKILL_PATH = 'skills/stack/SKILL.md';

const PLACEHOLDER = /\{\{\s*([a-z]+)\.([a-z_-]+)\s*\}\}/g;
const firstSentence = (text) => /^(.+?[.!?])(\s|$)/s.exec(String(text).trim())?.[1].replace(/\s+/g, ' ') ?? String(text).trim();

// ^0.4 while the stack is 0.x, ^1 from 1.0 on.
export function compatRange(version) {
  const [major, minor] = String(version).split('.').map(Number);
  return major === 0 ? `^0.${minor}` : `^${major}`;
}

function catalog(modules, agents, prefix) {
  const lines = ['Agents:'];
  for (const a of [...agents].sort((x, y) => x.agentId.localeCompare(y.agentId))) {
    lines.push(`- \`${prefix}${a.agentId}\`: ${firstSentence(a.description)}`);
  }
  lines.push('', 'Flows (slash commands):');
  for (const f of [...modules.values()].filter((m) => m.kind === 'flow').sort((x, y) => x.id.localeCompare(y.id))) {
    lines.push(`- \`/${prefix}${f.id}\`: ${firstSentence(f.data.description)}`);
  }
  return lines.join('\n');
}

export const TOOLS_CATALOG = path.join('engines', 'claude-code', 'tools-catalog.yaml');

// The tool categories /stack asks about, as a Markdown list. null when the catalog is invalid.
async function renderTools(stackRoot, diags) {
  const file = path.join(stackRoot, TOOLS_CATALOG);
  const text = await readText(file);
  if (text === null) return 'No tool categories are defined.';
  let categories;
  try {
    categories = YAML.parse(text)?.categories;
  } catch (e) {
    diags.error('parse-error', String(e.message).split('\n')[0], file);
    return null;
  }
  if (!Array.isArray(categories) || categories.some((c) => !c?.id || !c?.title || !c?.ask)) {
    diags.error('schema-invalid', 'tools catalog: `categories` must be a list of entries with id, title and ask', file);
    return null;
  }
  const code = (list) => list.map((x) => `\`${x}\``).join(', ');
  return categories
    .map((c) => {
      const lines = [`- **${c.title}** (\`${c.id}\`): ${c.ask}`];
      if (c.examples?.length) lines.push(`  - Options to offer: ${c.examples.join(', ')}.`);
      if (c.use) lines.push(`  - What agents do with it: ${c.use}`);
      if (c.read_roles?.length) lines.push(`  - Read tools go to: ${code(c.read_roles)}.`);
      if (c.cli?.length) lines.push(`  - Without MCP, read-only CLI commands to pre-approve: ${code(c.cli.map((x) => `Bash(${x})`))}.`);
      if (c.note) lines.push(`  - Note: ${c.note}`);
      return lines.join('\n');
    })
    .join('\n');
}

// -> { path, content } or null.
export async function renderSetupSkill(ws, modules, agents, diags, stackRoot) {
  const templateFile = path.join(stackRoot, SETUP_TEMPLATE);
  const template = await readText(templateFile);
  if (template === null) {
    diags.error('missing-file', `setup skill template not found (${SETUP_TEMPLATE})`, templateFile);
    return null;
  }

  const prefix = ws.config.prefix ?? '';
  const describe = (id, description) => `\`${id}\` (${firstSentence(description ?? '').replace(/\.$/, '')})`;
  const packs = [];
  for (const entry of await readdir(path.join(stackRoot, 'packs'), { withFileTypes: true }).catch(() => [])) {
    const text = entry.isDirectory() ? await readText(path.join(stackRoot, 'packs', entry.name, 'pack.yaml')) : null;
    if (text !== null) packs.push(describe(entry.name, YAML.parse(text)?.description));
  }
  const integrations = [...modules.values()].filter((m) => m.kind === 'integration').map((m) => describe(m.id, m.data.description));
  const tools = await renderTools(stackRoot, diags);
  if (tools === null) return null;
  const values = {
    'stack.tools': tools,
    'stack.packs': packs.sort().join(', ') || 'none',
    'stack.integrations': integrations.sort().join(', ') || 'none',
    'stack.version': ws.stack.version,
    'stack.compat': compatRange(ws.stack.version),
    'stack.root': stackRoot.split(path.sep).join('/'),
    'stack.catalog': catalog(modules, agents, prefix),
    'stack.prefix': prefix,
    'engine.cli': defaultCli(),
  };

  let failed = false;
  const body = template.replace(PLACEHOLDER, (all, ns, key) => {
    const value = values[`${ns}.${key}`];
    if (value !== undefined) return value;
    failed = true;
    diags.error('unknown-slot', `${all} is not a known placeholder in the setup skill template`, templateFile);
    return all;
  });
  if (failed) return null;

  const frontmatter = {
    name: 'stack',
    description:
      'Sets up or updates ai-stack in the current project: surveys the repository, asks a few questions, writes .claude/project.yaml (plus local git excludes, permissions and a scope hook when needed), then builds and checks it. Use when the user wants to add ai-stack to a project, change its stack configuration, or rebuild it.',
    'argument-hint': '[update | rebuild | check | answers to the questions]',
  };
  const header = `# generated by ${GENERATOR} (kernel ${KERNEL_VERSION}) by "stack install". Do not edit: change ${SETUP_TEMPLATE.split(path.sep).join('/')} in the stack, then run stack install.`;
  const content = `---\n${header}\n${YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.replace(/\n{3,}/g, '\n\n').trim()}\n`;
  return { path: SETUP_SKILL_PATH, content };
}
