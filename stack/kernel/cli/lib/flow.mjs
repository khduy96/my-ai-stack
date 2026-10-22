// Claude Code engine for flows: each flow becomes a skill (skills/<prefix><flow>/SKILL.md)
// whose instructions make the main session orchestrate the flow's agents step by step.
// The generic protocol lives in engines/claude-code/flow-skill.md; this file renders the
// flow-specific parts into it.
//
// Step kinds: agent, fanout, agent + foreach, loop (whose body holds agent steps).
// References between steps follow where the target lives:
//   top-level target        -> must be an earlier top-level step
//   target in the same loop -> earlier in the body: this iteration;
//                              later in the body: the previous iteration (only inside a
//                              list of references, which needs a fallback for iteration 1)
//   target in a loop, from a later top-level step -> the loop's last iteration
import path from 'node:path';
import YAML from 'yaml';
import { DEFAULT_STACK_ROOT, GENERATOR, KERNEL_VERSION, RUNS_DIR } from './kernel.mjs';
import { readText } from './load.mjs';
import { sourceOf } from './resolve.mjs';
import { getContract } from './validate.mjs';

export const ENGINE_TEMPLATE = path.join('engines', 'claude-code', 'flow-skill.md');

const REF = /^\$(input|[a-z][a-z0-9-]*)(?:\.(output(?:\.[a-z_][a-z0-9_]*)*|findings|artifacts|questions|summary|checks))?$/;
const PLACEHOLDER = /\{\{\s*([a-z]+)\.([a-z_-]+)\s*\}\}/g;

const CONDITIONS = {
  'has-findings': 'contain at least one finding',
  'has-major-findings': 'contain at least one `critical` or `major` finding',
  'no-findings': 'contain no findings',
  'no-major-findings': 'contain no `critical` or `major` finding',
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

const agentsOf = (step) => (step.loop ? [] : step.fanout ?? [step.agent]);
const refsOf = (value) => (Array.isArray(value) ? value : typeof value === 'string' && value.startsWith('$') ? [value] : []);

// id -> { step, top, loop, body }: top-level index, enclosing loop id, index inside the body.
function positions(steps) {
  const pos = new Map();
  const dup = [];
  const add = (step, entry) => (pos.has(step.id) ? dup.push(step.id) : pos.set(step.id, { step, ...entry }));
  steps.forEach((step, top) => {
    add(step, { top, loop: null, body: null });
    (step.loop?.steps ?? []).forEach((inner, body) => add(inner, { top, loop: step.id, body }));
  });
  return { pos, dup };
}

// How `from` sees `to`: here | prev | last, or an error.
function relation(pos, from, to) {
  const a = pos.get(from);
  const b = pos.get(to);
  if (!b) return { error: `"${to}" is not a step of this flow` };
  if (b.step.loop) return { error: `"${to}" is a loop; refer to a step inside it` };
  if (b.loop === null) return b.top < a.top ? { kind: 'here' } : { error: `"${to}" is not an earlier step` };
  if (a.loop === b.loop) return b.body < a.body ? { kind: 'here' } : { kind: 'prev' };
  if (a.loop === null && a.top > b.top) return { kind: 'last' };
  return { error: `"${to}" is inside a loop that has not run yet` };
}

// Structural checks the schema cannot express. Returns positions, or null when the flow cannot be rendered.
function checkFlow(flow, agents, where, diags) {
  let ok = true;
  const fail = (code, message) => {
    ok = false;
    diags.error(code, `flow "${flow.id}": ${message}`, where);
  };
  const { pos, dup } = positions(flow.data.steps);
  for (const id of dup) fail('duplicate-id', `step "${id}" is defined twice`);

  const checkRef = (stepId, ref, label, { allowPrev = false } = {}) => {
    const m = REF.exec(ref);
    if (!m) return fail('unknown-ref', `step "${stepId}" ${label}: "${ref}" is not a valid reference`), null;
    if (m[1] === 'input') return { kind: 'input' };
    const rel = relation(pos, stepId, m[1]);
    if (rel.error) return fail('unknown-ref', `step "${stepId}" ${label}: ${rel.error}`), null;
    if (rel.kind === 'prev' && !allowPrev) {
      return fail('unknown-ref', `step "${stepId}" ${label}: "${m[1]}" has not run yet in this iteration; refer to it from a list with a fallback, e.g. [$${m[1]}.findings, $<earlier step>.findings]`), null;
    }
    return rel;
  };

  for (const { step } of pos.values()) {
    // External agents are hand-written and not built by the stack: nothing to check here.
    for (const name of step.external ? [] : agentsOf(step)) {
      const agent = agents.get(name);
      if (!agent) fail('unknown-ref', `step "${step.id}" uses unknown agent "${name}"`);
      else if (!agent.enabled) fail('unknown-ref', `step "${step.id}" uses agent "${name}", whose role is not enabled`);
    }
    for (const [key, value] of Object.entries(step.in ?? {})) {
      if (Array.isArray(value)) {
        const kinds = value.map((ref) => checkRef(step.id, ref, `input "${key}"`, { allowPrev: true })?.kind);
        if (kinds.every((k) => k === 'prev')) fail('unknown-ref', `step "${step.id}" input "${key}": every reference is from the previous iteration; add a fallback for the first one`);
      } else if (value.startsWith('$')) {
        checkRef(step.id, value, `input "${key}"`);
      }
    }
    if (step.when) checkRef(step.id, `$${step.when.step}`, 'condition');
    if (step.loop) {
      const target = pos.get(step.loop.until.step);
      if (target?.loop !== step.id) fail('unknown-ref', `loop "${step.id}": until refers to "${step.loop.until.step}", which is not a step of this loop`);
    }
    if (step.foreach && checkRef(step.id, step.foreach, 'foreach')) checkForeachField(step, pos, agents, fail);
  }
  return ok ? pos : null;
}

// $<step>.output.<field>: the producing role's contract must have <field> as a list.
function checkForeachField(step, pos, agents, fail) {
  const [, source, field] = REF.exec(step.foreach);
  const parts = field?.split('.') ?? [];
  if (parts[0] !== 'output' || parts.length !== 2) return;
  const producer = pos.get(source).step;
  if (!producer.agent || producer.foreach) return;
  const contract = getContract(agents.get(producer.agent)?.produces ?? '');
  if (!contract) return;
  const prop = contract.properties?.[parts[1]];
  if (!prop) fail('unknown-ref', `step "${step.id}" foreach: contract "${contract.title}" has no field "${parts[1]}"`);
  else if (prop.type !== 'array') fail('schema-invalid', `step "${step.id}" foreach: "${parts[1]}" of contract "${contract.title}" is not a list`);
}

const baseOf = (entry) => (entry.loop ? `<run>/${entry.loop}/<n>/` : '<run>/');

function locationOf(entry, kind) {
  let base = baseOf(entry);
  if (kind === 'prev') base = base.replace('<n>', '<n-1>');
  if (kind === 'last') base = base.replace('<n>', '<last>');
  const { step } = entry;
  return step.fanout || step.foreach ? `every file in \`${base}${step.id}/\`` : `\`${base}${step.id}.handoff.yaml\``;
}

const SUFFIX = { prev: ' (previous iteration)', last: ' (last iteration that ran)', here: '' };

function describeRef(ref, fromId, pos) {
  const [, source, field] = REF.exec(ref);
  if (source === 'input') return 'the flow input, in `<run>/input.md`';
  const { kind } = relation(pos, fromId, source);
  const where = locationOf(pos.get(source), kind);
  return `${field ? `\`handoff.${field}\` of ${where}` : where}${SUFFIX[kind]}`;
}

function describeInput(value, fromId, pos) {
  if (Array.isArray(value)) return `the most recent that exists of: ${value.map((r) => describeRef(r, fromId, pos)).join('; ')}`;
  return value.startsWith('$') ? describeRef(value, fromId, pos) : JSON.stringify(value);
}

function handoffPath(entry) {
  const base = baseOf(entry);
  const { step } = entry;
  if (step.fanout) return `${base}${step.id}/<agent>.handoff.yaml`;
  if (step.foreach) return `${base}${step.id}/<item id>.handoff.yaml`;
  return `${base}${step.id}.handoff.yaml`;
}

const condition = (c) => `the handoffs of step \`${c.step}\` ${CONDITIONS[c.is]}`;

function renderAgentStep(entry, label, heading, pos, ctx) {
  const { step } = entry;
  // External agents keep their own names: no prefix.
  const name = (agent) => `\`${step.external ? '' : ctx.prefix}${agent}\``;
  const lines = [`${heading} ${label}: \`${step.id}\``, ''];
  if (step.when) lines.push(`**Run only if** ${condition(step.when)}. Otherwise mark this step \`skipped\` and go on.`, '');
  if (step.external) {
    lines.push(
      'This step uses hand-written agents that do not know the handoff format: add to their task that they must end their final message with a fenced `yaml` block whose root key is `handoff`, with at least `status` (done | partial | blocked | failed) and `summary`, plus `artifacts`, `findings` and `questions` when they apply.',
      '',
    );
  }

  if (step.fanout) {
    lines.push(`Start these agents **in parallel, in one message**: ${step.fanout.map(name).join(', ')}.`, '');
  } else if (step.foreach) {
    lines.push(
      `Start one ${name(step.agent)} **for each item** of ${describeRef(step.foreach, step.id, pos)}, passing the item itself as \`inputs.item\` (inline YAML: the one input you paste).`,
      '',
      '- Run the items in waves: an item is ready when every item in its `depends_on` is `done`. Items without `depends_on` are ready at once.',
      '- Start the ready items of a wave **in parallel, in one message**, except items whose `files` overlap: run those one after another.',
      '- Wait for the whole wave before starting the next. If an item does not finish `done`, do not start the items that depend on it.',
      '',
    );
  } else {
    lines.push(`Start the agent ${name(step.agent)}.`, '');
  }

  lines.push(`- **Goal:** ${step.goal.trim()}`);
  const inputs = Object.entries(step.in ?? {});
  if (inputs.length) {
    lines.push('- **Inputs:**');
    for (const [key, value] of inputs) lines.push(`  - \`${key}\`: ${describeInput(value, step.id, pos)}`);
  }
  lines.push(`- **Save the handoff to:** \`${handoffPath(entry)}\``);

  const checks = agentsOf(step).map((agent) => {
    const produces = step.external ? null : ctx.agents.get(agent).produces;
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

function renderLoopStep(entry, label, pos, ctx) {
  const { step } = entry;
  const { max, until, steps } = step.loop;
  const lines = [`### Step ${label}: \`${step.id}\` (loop)`, ''];
  if (step.when) lines.push(`**Run only if** ${condition(step.when)}. Otherwise mark this step \`skipped\` and go on.`, '');
  lines.push(
    `Repeat steps ${label}.1–${label}.${steps.length} **at most ${max} time${max > 1 ? 's' : ''}**. \`<n>\` is the iteration number, starting at 1; record it as \`iteration: <n>\` on the \`${step.id}\` entry in run.yaml, and record the steps of iteration <n> as \`<step id>#<n>\`.`,
    '',
    `- **Stop repeating** after an iteration in which ${condition(until)}.`,
    `- If iteration ${max} ends and that is still not true, tell the user what remains open and ask whether to continue with the next step.`,
    `- **Gate** \`${step.gate ?? 'auto'}\` (after the loop ends): ${GATES[step.gate ?? 'auto']}`,
  );
  for (const [j, inner] of steps.entries()) {
    lines.push('', renderAgentStep(pos.get(inner.id), `${label}.${j + 1}`, '#### Step', pos, ctx));
  }
  return lines.join('\n');
}

const DEFAULT_REPORT = 'Summarize what each step produced, list any open questions or failures, and give the run directory.';

// -> { path, content } or null.
export async function renderFlow(flow, agents, ws, diags, stackRoot) {
  const where = sourceOf(flow);
  const pos = checkFlow(flow, agents, where, diags);
  if (!pos) return null;

  const templateFile = path.join(stackRoot, ENGINE_TEMPLATE);
  const template = await readText(templateFile);
  if (template === null) {
    diags.error('missing-file', `engine template not found (${ENGINE_TEMPLATE})`, templateFile);
    return null;
  }

  const prefix = ws.config.prefix ?? '';
  const data = flow.data;
  const ctx = { prefix, agents, cli: ws.config.cli ?? defaultCli() };

  const inputLines = [];
  if (data.input?.description) inputLines.push(data.input.description.trim());
  if (data.input?.default) inputLines.push(`When the input is empty, use: ${data.input.default.trim()}`);

  const steps = data.steps.map((step, i) =>
    step.loop ? renderLoopStep(pos.get(step.id), `${i + 1}`, pos, ctx) : renderAgentStep(pos.get(step.id), `${i + 1}`, '### Step', pos, ctx),
  );

  const values = {
    'flow.id': flow.id,
    'flow.name': `${prefix}${flow.id}`,
    'flow.description': data.description.trim(),
    'flow.input': inputLines.join('\n\n'),
    'flow.steps': steps.join('\n\n'),
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
