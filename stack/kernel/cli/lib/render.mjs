// Turns resolved roles (and their variants) into Claude Code agent files.
//
// Placeholders in a role body:
//   {{<slot>}}          trait bodies whose `slot` is <slot> (declared in the role's `slots`)
//   {{project.context}} project context, read_first list, knowledge pointer, policy rules
//   {{project.name}}    project name
//   {{project.knowledge}} knowledge directory (empty when the project has none)
//   {{role.name}}       generated agent name, e.g. ai-verifier-security
//   {{role.output}}     field list of the contract the role `produces` (empty if none)
//   {{contract.<name>}} field list of kernel/contracts/<name>.schema.json
// Trait bodies may use every placeholder except slots.
import YAML from 'yaml';
import { GENERATOR, KERNEL_VERSION, PERMISSION_TOOLS } from './kernel.mjs';
import { applyListOps, mergeModule } from './merge.mjs';
import { sourceOf } from './resolve.mjs';
import { getContract, validate } from './validate.mjs';
import { defaultCli } from './flow.mjs';

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9-]*)(?:\.([a-z][a-z0-9_-]*))?\s*\}\}/g;

function renderContext(ws) {
  const { config } = ws;
  const parts = [];
  if (typeof config.context === 'string' && config.context.trim()) parts.push(config.context.trim());
  const readFirst = applyListOps([], config.read_first ?? []);
  if (readFirst.length) parts.push(['Read these files before you start:', ...readFirst.map((f) => `- \`${f}\``)].join('\n'));
  if (config.knowledge) {
    const find =
      config.knowledge_retriever === 'index'
        ? `then search it with \`${config.cli ?? defaultCli()} search "<terms of your task>" --project .\` (ranked by relevance) and open the files it returns`
        : 'then search that directory for the terms of your task';
    parts.push(
      `Durable project knowledge lives in \`${config.knowledge}/\`. Start from \`${config.knowledge}/INDEX.md\`, ${find}, and cite the knowledge files you rely on. If they contradict the code, trust the code and say so.`,
    );
  }
  if (ws.rules?.length) parts.push(['Project rules:', ...ws.rules.map((rule) => `- ${rule}`)].join('\n'));
  return parts.length ? `## Project context\n\n${parts.join('\n\n')}` : '';
}

function typeLabel(schema = {}) {
  if (schema.enum) return schema.enum.map((v) => `\`${v}\``).join(' | ');
  if (schema.const !== undefined) return `\`${schema.const}\``;
  if (schema.type === 'array') return schema.items?.type === 'object' ? 'list of objects' : `list of ${typeLabel(schema.items)}`;
  return schema.type ?? 'any';
}

function renderFields(schema, depth) {
  const required = new Set(schema.required ?? []);
  const lines = [];
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const desc = prop.description ? ` — ${prop.description}` : '';
    lines.push(`${'  '.repeat(depth)}- \`${key}\`${required.has(key) ? ' (required)' : ''}: ${typeLabel(prop)}${desc}`);
    if (prop.type === 'object' && prop.properties) lines.push(...renderFields(prop, depth + 1));
    if (prop.type === 'array' && prop.items?.properties) lines.push(...renderFields(prop.items, depth + 1));
  }
  return lines;
}

export function renderContract(schema) {
  return [`**${schema.title}** — ${schema.description}`, '', ...renderFields(schema, 0)].join('\n');
}

function renderOutput(produces) {
  if (!produces) return '';
  const schema = getContract(produces);
  return schema ? `Put your ${schema.title.toLowerCase()} under \`handoff.output\`:\n\n${renderContract(schema)}` : '';
}

// Expands project.*, role.* and contract.*; bare names go to `onSlot` (or are an error).
function expand(text, ctx, where, diags, onSlot = null) {
  return text.replace(PLACEHOLDER, (all, ns, key) => {
    if (ns === 'project' && key === 'context') return renderContext(ctx.ws);
    if (ns === 'project' && key === 'name') return ctx.ws.config.name ?? '';
    if (ns === 'project' && key === 'knowledge') return ctx.ws.config.knowledge ?? '';
    if (ns === 'role' && key === 'name') return ctx.agentName;
    if (ns === 'role' && key === 'output') return renderOutput(ctx.data.produces);
    if (ns === 'contract' && key) {
      const schema = getContract(key);
      if (schema) return renderContract(schema);
      diags.error('unknown-ref', `${all} names no contract in kernel/contracts/`, where);
      return all;
    }
    if (!key && onSlot) return onSlot(all, ns);
    diags.error('unknown-slot', `${all} is not a known placeholder here`, where);
    return all;
  });
}

const tidy = (text) => text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// One agent from a role (or a role variant already merged into it).
function renderAgent(role, agentId, modules, ws, sharedDiags) {
  const where = sourceOf(role);
  const data = role.data;
  const prefix = ws.config.prefix ?? '';
  const ctx = { ws, data, agentName: `${prefix}${agentId}` };
  // Tracks this agent's own errors: a variant repeating its base role's error is deduplicated globally.
  let failed = false;
  const diags = {
    ...sharedDiags,
    error: (...args) => {
      failed = true;
      sharedDiags.error(...args);
    },
  };

  if (data.produces && !getContract(data.produces)) {
    diags.error('unknown-ref', `role "${agentId}" produces "${data.produces}", which names no contract in kernel/contracts/`, where);
  }

  const slots = applyListOps(['traits'], data.slots ?? []);
  const fills = new Map(slots.map((s) => [s, []]));

  const traits = [];
  for (const id of applyListOps([], data.traits ?? [])) {
    const trait = modules.get(`trait:${id}`);
    if (!trait) {
      diags.error('unknown-ref', `role "${agentId}" uses unknown trait "${id}"`, where);
      continue;
    }
    const appliesTo = trait.data.applies_to ?? [];
    if (appliesTo.length && !appliesTo.includes(role.id)) {
      diags.error('trait-not-applicable', `trait "${id}" applies only to ${appliesTo.join(', ')}, not to role "${role.id}"`, where);
      continue;
    }
    traits.push(trait);
  }

  const pairs = new Set();
  for (const a of traits) {
    for (const other of a.data.conflicts ?? []) {
      const pair = [a.id, other].sort().join(' + ');
      if (traits.some((b) => b.id === other) && !pairs.has(pair)) {
        pairs.add(pair);
        diags.error('trait-conflict', `traits ${pair} cannot be combined (role "${agentId}")`, where);
      }
    }
  }

  for (const trait of traits) {
    const slot = trait.data.slot ?? 'traits';
    if (!fills.has(slot)) {
      diags.error('unknown-slot', `trait "${trait.id}" targets slot "${slot}", which role "${agentId}" does not declare (slots: ${slots.join(', ')})`, where);
      continue;
    }
    fills.get(slot).push(tidy(expand(trait.body, ctx, sourceOf(trait), diags)));
  }

  const used = new Set();
  const body = expand(role.body, ctx, where, diags, (all, name) => {
    if (!fills.has(name)) {
      diags.error('unknown-slot', `${all} is not a declared slot of role "${agentId}" (slots: ${slots.join(', ')})`, where);
      return all;
    }
    used.add(name);
    return fills.get(name).join('\n\n');
  });
  for (const [slot, content] of fills) {
    if (content.length && !used.has(slot)) {
      diags.error('unknown-slot', `slot "${slot}" has traits but the body of role "${agentId}" has no {{${slot}}} placeholder`, where);
    }
  }

  if (failed) return null;

  const tools = applyListOps(PERMISSION_TOOLS[data.permission] ?? [], data.tools ?? []);
  const frontmatter = {
    ...(data.engines?.['claude-code'] ?? {}),
    name: ctx.agentName,
    description: String(data.description).trim(),
    tools: tools.join(', '),
    ...(data.model ? { model: data.model } : {}),
  };
  const header = `# generated by ${GENERATOR} (kernel ${KERNEL_VERSION}) from role "${agentId}". Do not edit: change the modules or project.yaml, then run stack build.`;
  const content = `---\n${header}\n${YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${tidy(body)}\n`;
  return { path: `agents/${ctx.agentName}.md`, content, agentId, produces: data.produces ?? null, description: frontmatter.description };
}

// The role itself (unless abstract) plus one agent per variant.
export function renderRole(role, modules, ws, diags) {
  const { variants = {}, abstract = false, ...data } = role.data;
  const base = { ...role, data };
  const outputs = [];
  if (!abstract) outputs.push(renderAgent(base, role.id, modules, ws, diags));

  for (const [name, override] of Object.entries(variants)) {
    if (override === null || typeof override !== 'object') continue;
    const { body, body_mode, ...over } = override;
    const variant = mergeModule(base, { data: over, body, mode: body_mode, source: `${sourceOf(role)}#variants.${name}` });
    if (!('description' in over)) variant.data.description = `${String(data.description).trim()} Variant: ${name}.`;
    if (!validate('role', variant.data, sourceOf(variant), diags)) continue;
    outputs.push(renderAgent(variant, `${role.id}-${name}`, modules, ws, diags));
  }
  return outputs.filter(Boolean);
}

// Selects ids of one kind through config.enable.<key>, reporting unknown ones.
export function enabledIds(modules, kind, key, ws, diags) {
  const ids = [...modules.values()].filter((m) => m.kind === kind).map((m) => m.id);
  const enabled = applyListOps([], ws.config.enable?.[key] ?? ['*'], ids);
  for (const id of enabled) {
    if (!ids.includes(id)) diags.error('unknown-ref', `enable.${key} lists unknown ${kind} "${id}"`, ws.projectFile ?? ws.stackFile);
  }
  return enabled;
}

// Every agent the roles produce, flagged with whether config.enable.roles selects its role.
export function renderAgents(modules, ws, diags) {
  const roles = [...modules.values()].filter((m) => m.kind === 'role').sort((a, b) => a.id.localeCompare(b.id));
  const enabled = enabledIds(modules, 'role', 'roles', ws, diags);

  const outputs = new Map();
  for (const role of roles) {
    for (const out of renderRole(role, modules, ws, diags)) {
      if (outputs.has(out.path)) {
        diags.error('duplicate-id', `two roles/variants both generate ${out.path}`, sourceOf(role));
        continue;
      }
      outputs.set(out.path, { ...out, enabled: enabled.includes(role.id) });
    }
  }
  return [...outputs.values()];
}
