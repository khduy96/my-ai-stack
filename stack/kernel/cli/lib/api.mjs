// The CLI commands, usable from the CLI and from tests.
import { homedir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { createDiagnostics } from './diag.mjs';
import { applyEmit, checkDrift, planEmit, USER_LOCK_FILE } from './emit.mjs';
import { defaultCli, renderFlow } from './flow.mjs';
import { renderWorkflow } from './workflow.mjs';
import { FLOW_PERMISSIONS, RUNS_DIR, SETTINGS_FILES } from './kernel.mjs';
import { applyIntegrations } from './integration.mjs';
import { applyPolicies } from './policy.mjs';
import { loadWorkspace, readText } from './load.mjs';
import { applyListOps } from './merge.mjs';
import { enabledIds, renderAgents } from './render.mjs';
import { resolve } from './resolve.mjs';
import { renderSetupSkill } from './setup.mjs';
import { checkVersions } from './versions.mjs';
import { getContract, validate } from './validate.mjs';

// Renders everything; `all` = also disabled roles and flows (doctor checks them too).
// Returns the files to write and the entries for the managed settings file.
async function renderWorkspace(ws, modules, diags, stackRoot, { all }) {
  const policies = await applyPolicies(modules, ws, diags);
  const integrations = applyIntegrations(modules, ws, diags);
  ws.rules = [...policies.rules, ...integrations.rules];
  const prefix = ws.config.prefix ?? '';

  const agents = renderAgents(modules, ws, diags);
  const agentsById = new Map(agents.map((a) => [a.agentId, a]));
  // A disabled flow is only checked for consistency, so any role may back it.
  const anyRole = new Map(agents.map((a) => [a.agentId, { ...a, enabled: true }]));
  const enabledFlows = enabledIds(modules, 'flow', 'flows', ws, diags);

  const flows = [];
  for (const flow of [...modules.values()].filter((m) => m.kind === 'flow').sort((a, b) => a.id.localeCompare(b.id))) {
    const enabled = enabledFlows.includes(flow.id);
    if (!all && !enabled) continue;
    const out = await renderFlow(flow, enabled ? agentsById : anyRole, ws, diags, stackRoot);
    if (out && enabled) flows.push(out);
    if (out && enabled && applyListOps([], ws.config.engines ?? ['skill']).includes('workflow')) {
      const script = await renderWorkflow(flow, agentsById, ws, diags, stackRoot);
      if (script) flows.push(script);
    }
  }

  // Each guard script reads its config from the JSON file next to it.
  const hooks = policies.guards.flatMap((g) => [
    { path: `hooks/${prefix}${g.id}.mjs`, content: g.source },
    { path: `hooks/${prefix}${g.id}.json`, content: `${JSON.stringify(g.config, null, 2)}\n` },
  ]);

  const mode = ws.config.settings ?? 'local';
  const cli = ws.config.cli ?? defaultCli();
  const flowAllow = [`Bash(${cli} check *)`, ...FLOW_PERMISSIONS, `Edit(${ws.config.runs ?? RUNS_DIR}/**)`];
  const allow = [...(flows.length ? flowAllow : []), ...policies.permissions, ...integrations.permissions, ...applyListOps([], ws.config.permissions ?? [])];
  const settings =
    mode === 'none'
      ? null
      : {
          file: SETTINGS_FILES[mode],
          allow: [...new Set(allow)],
          hooks: policies.guards.map((g) => ({ event: g.event, matcher: g.matcher, command: `node .claude/hooks/${prefix}${g.id}.mjs` })),
        };

  const outputs = [...agents.filter((a) => all || a.enabled), ...flows, ...hooks].map(({ path, content }) => ({ path, content }));
  return { outputs, settings };
}

export async function build({ stackRoot, projectRoot, force = false, dryRun = false }) {
  const diags = createDiagnostics();
  const ws = await loadWorkspace({ stackRoot, projectRoot }, diags);
  if (diags.hasErrors()) return { diags, ops: [] };

  const modules = resolve(ws, diags);
  const { outputs, settings } = await renderWorkspace(ws, modules, diags, stackRoot, { all: false });
  if (diags.hasErrors()) return { diags, ops: [] };

  const plan = await planEmit(ws.claudeDir, outputs, { force, settings }, diags);
  if (diags.hasErrors()) return { diags, ops: [] };
  if (!dryRun) await applyEmit(ws.claudeDir, plan);
  return { diags, ops: plan.ops };
}

// Without projectRoot, checks the stack's own modules only.
export async function doctor({ stackRoot, projectRoot = null }) {
  const diags = createDiagnostics();
  const ws = await loadWorkspace({ stackRoot, projectRoot }, diags);
  const modules = resolve(ws, diags);
  await renderWorkspace(ws, modules, diags, stackRoot, { all: true });
  if (ws.claudeDir) await checkDrift(ws.claudeDir, diags);
  else await checkVersions(stackRoot, diags); // the stack itself: modules must bump their version when they change

  const counts = {};
  for (const m of modules.values()) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  return { diags, counts };
}

// Installs the /stack setup skill into <target>/.claude/ (default: the user's home), so it
// is available in projects that do not use the stack yet. Tracked in its own lock file.
export async function install({ stackRoot, target = homedir(), force = false, dryRun = false }) {
  const diags = createDiagnostics();
  const ws = await loadWorkspace({ stackRoot, projectRoot: null }, diags);
  if (diags.hasErrors()) return { diags, ops: [] };

  const modules = resolve(ws, diags);
  const agents = renderAgents(modules, ws, diags);
  const skill = await renderSetupSkill(ws, modules, agents, diags, stackRoot);
  if (diags.hasErrors() || !skill) return { diags, ops: [] };

  const claudeDir = path.join(target, '.claude');
  const plan = await planEmit(claudeDir, [skill], { force, lockFile: USER_LOCK_FILE }, diags);
  if (diags.hasErrors()) return { diags, ops: [] };
  if (!dryRun) await applyEmit(claudeDir, plan);
  return { diags, ops: plan.ops, claudeDir };
}

// Validates one saved handoff: the handoff contract, plus handoff.output against the
// contract the agent's role produces. Accepts a bare YAML file or text with a ```yaml fence.
export async function check({ file, produces = null }) {
  const diags = createDiagnostics();
  const text = await readText(file);
  if (text === null) {
    diags.error('missing-file', 'handoff file not found', file);
    return { diags };
  }

  const fences = [...text.matchAll(/```ya?ml\n([\s\S]*?)```/g)];
  let data;
  try {
    data = YAML.parse(fences.length ? fences.at(-1)[1] : text);
  } catch (e) {
    diags.error('parse-error', String(e.message).split('\n')[0], file);
    return { diags };
  }
  const handoff = data && typeof data === 'object' && 'handoff' in data ? data.handoff : data;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    diags.error('schema-invalid', 'expected a mapping with root key "handoff"', file);
    return { diags };
  }

  validate('handoff', handoff, file, diags);
  if (produces) {
    if (!getContract(produces)) diags.error('unknown-ref', `--produces "${produces}" names no contract in kernel/contracts/`, file);
    else if (handoff.output !== undefined) validate(produces, handoff.output, file, diags);
    else if (handoff.status === 'done') diags.error('schema-invalid', `handoff.output is required when status is done (this agent produces a ${produces})`, file);
  }
  return { diags };
}
