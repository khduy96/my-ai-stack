// Claude Code engine for flows: each flow becomes a skill (skills/<prefix><flow>/SKILL.md)
// whose instructions make the main session orchestrate the flow's agents step by step.
// The generic protocol lives in engines/claude-code/flow-skill.md; this file renders the
// flow-specific parts into it.
import path from 'node:path';
import YAML from 'yaml';
import { DEFAULT_STACK_ROOT, GENERATOR, KERNEL_VERSION, RUNS_DIR } from './kernel.mjs';
import { readText } from './load.mjs';
import { sourceOf } from './resolve.mjs';

export const ENGINE_TEMPLATE = path.join('engines', 'claude-code', 'flow-skill.md');

const REF = /^\$(input|[a-z][a-z0-9-]*)(?:\.(output|findings|artifacts|questions|summary|checks))?$/;
const PLACEHOLDER = /\{\{\s*([a-z]+)\.([a-z_-]+)\s*\}\}/g;

const CONDITIONS = {
  'has-findings': 'contain at least one finding',
  'has-major-findings': 'contain at least one `critical` or `major` finding',
  'no-findings': 'contain no findings',
  'has-questions': 'contain at least one question',
};

const GATES = {
  auto: 'continue without asking the user.',
  human:
    'show the user a short summary of the result and the handoff path(s), then **stop and wait**. Continue only on approval; if the user asks for changes, run this step again with their feedback added to the task.',
  'on-questions':
    'if any handoff has status `partial` or `blocked`, or a non-empty `questions` list, show those questions to the user and **wait for answers**, then run this step again with the answers added to the task. Otherwise continue without asking.',
};

export const defaultCli = () => `node "${path.join(DEFAULT_STACK_ROOT, 'kernel', 'cli', 'stack.mjs').replaceAll('\\', '/')}"`;

const agentsOf = (step) => (step.fanout ? step.fanout : [step.agent]);
const handoffPath = (step) => (step.fanout ? `<run>/${step.id}/<agent>.handoff.yaml` : `<run>/${step.id}.handoff.yaml`);

function describeRef(ref, stepsById) {
  const [, source, field] = REF.exec(ref);
  if (source === 'input') return 'the flow input, in `<run>/input.md`';
  const step = stepsById.get(source);
  const where = step.fanout ? `every file in \`<run>/${step.id}/\`` : `\`<run>/${step.id}.handoff.yaml\``;
  return field ? `\`handoff.${field}\` of ${where}` : where;
}

// Structural checks the schema cannot express. Returns false when the flow cannot be rendered.
function checkFlow(flow, agents, where, diags) {
  let ok = true;
  const fail = (code, message) => {
    ok = false;
    diags.error(code, `flow "${flow.id}": ${message}`, where);
  };
  const seen = new Map();
  for (const step of flow.data.steps) {
    if (seen.has(step.id)) fail('duplicate-id', `step "${step.id}" is defined twice`);
    for (const name of agentsOf(step)) {
      const agent = agents.get(name);
      if (!agent) fail('unknown-ref', `step "${step.id}" uses unknown agent "${name}"`);
      else if (!agent.enabled) fail('unknown-ref', `step "${step.id}" uses agent "${name}", whose role is not enabled`);
    }
    for (const [key, value] of Object.entries(step.in ?? {})) {
      if (!value.startsWith('$')) continue;
      const m = REF.exec(value);
      if (!m) fail('unknown-ref', `step "${step.id}" input "${key}": "${value}" is not a valid reference`);
      else if (m[1] !== 'input' && !seen.has(m[1])) fail('unknown-ref', `step "${step.id}" input "${key}" refers to "${m[1]}", which is not an earlier step`);
    }
    if (step.when && !seen.has(step.when.step)) fail('unknown-ref', `step "${step.id}" condition refers to "${step.when.step}", which is not an earlier step`);
    seen.set(step.id, step);
  }
  return ok;
}

function renderStep(step, index, stepsById, ctx) {
  const name = (agent) => `\`${ctx.prefix}${agent}\``;
  const lines = [`### Step ${index + 1}: \`${step.id}\``, ''];
  if (step.when) {
    lines.push(`**Run only if** the handoffs of step \`${step.when.step}\` ${CONDITIONS[step.when.is]}. Otherwise mark this step \`skipped\` and go on.`, '');
  }
  lines.push(step.fanout ? `Start these agents **in parallel, in one message**: ${step.fanout.map(name).join(', ')}.` : `Start the agent ${name(step.agent)}.`, '');
  lines.push(`- **Goal:** ${step.goal.trim()}`);
  const inputs = Object.entries(step.in ?? {});
  if (inputs.length) {
    lines.push('- **Inputs:**');
    for (const [key, value] of inputs) {
      lines.push(`  - \`${key}\`: ${value.startsWith('$') ? describeRef(value, stepsById) : JSON.stringify(value)}`);
    }
  }
  lines.push(`- **Save the handoff to:** \`${handoffPath(step)}\``);

  const checks = agentsOf(step).map((agent) => {
    const produces = ctx.agents.get(agent).produces;
    return { agent, cmd: `${ctx.cli} check <file>${produces ? ` --produces ${produces}` : ''}` };
  });
  if (new Set(checks.map((c) => c.cmd)).size === 1) lines.push(`- **Check:** \`${checks[0].cmd}\``);
  else {
    lines.push('- **Check:**');
    for (const c of checks) lines.push(`  - ${name(c.agent)}: \`${c.cmd}\``);
  }
  const gate = step.gate ?? 'auto';
  lines.push(`- **Gate** \`${gate}\`: ${GATES[gate]}`);
  return lines.join('\n');
}

const DEFAULT_REPORT = 'Summarize what each step produced, list any open questions or failures, and give the run directory.';

// -> { path, content } or null.
export async function renderFlow(flow, agents, ws, diags, stackRoot) {
  const where = sourceOf(flow);
  if (!checkFlow(flow, agents, where, diags)) return null;

  const templateFile = path.join(stackRoot, ENGINE_TEMPLATE);
  const template = await readText(templateFile);
  if (template === null) {
    diags.error('missing-file', `engine template not found (${ENGINE_TEMPLATE})`, templateFile);
    return null;
  }

  const prefix = ws.config.prefix ?? '';
  const data = flow.data;
  const ctx = { prefix, agents, cli: ws.config.cli ?? defaultCli() };
  const stepsById = new Map(data.steps.map((s) => [s.id, s]));

  const inputLines = [];
  if (data.input?.description) inputLines.push(data.input.description.trim());
  if (data.input?.default) inputLines.push(`When the input is empty, use: ${data.input.default.trim()}`);

  const values = {
    'flow.id': flow.id,
    'flow.name': `${prefix}${flow.id}`,
    'flow.description': data.description.trim(),
    'flow.input': inputLines.join('\n\n'),
    'flow.steps': data.steps.map((s, i) => renderStep(s, i, stepsById, ctx)).join('\n\n'),
    'flow.report': (data.report ?? DEFAULT_REPORT).trim(),
    'engine.cli': ctx.cli,
    'engine.runs': ws.config.runs ?? RUNS_DIR,
  };

  let failed = false;
  const body = template.replace(PLACEHOLDER, (all, ns, key) => {
    const value = values[`${ns}.${key}`];
    if (value !== undefined) return value;
    failed = true;
    diags.error('unknown-slot', `${all} is not a known placeholder in the flow engine template`, templateFile);
    return all;
  });
  if (failed) return null;

  const frontmatter = {
    name: values['flow.name'],
    description: values['flow.description'],
    ...(data.argument_hint ? { 'argument-hint': data.argument_hint } : {}),
  };
  const header = `# generated by ${GENERATOR} (kernel ${KERNEL_VERSION}) from flow "${flow.id}". Do not edit: change the modules or project.yaml, then run stack build.`;
  const content = `---\n${header}\n${YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.replace(/\n{3,}/g, '\n\n').trim()}\n`;
  return { path: `skills/${values['flow.name']}/SKILL.md`, content };
}
