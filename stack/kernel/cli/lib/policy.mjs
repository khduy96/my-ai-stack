// Policies are opt-in. An enabled policy can:
//   rule        -> a line under "Project rules" in every agent's context (advisory)
//   overrides   -> changes to roles and flows, applied like a project's overrides
//   guard       -> a Claude Code hook script that refuses tool calls (enforced)
//   permissions -> entries for permissions.allow in the managed settings file
// Strings may use {{config.<key>}}; the project overrides config with
// policies: { <id>: { config: {...} } }. `scope: [paths]` enables the policy "scope".
import path from 'node:path';
import { RUNS_DIR } from './kernel.mjs';
import { readText } from './load.mjs';
import { applyListOps, mergeModule } from './merge.mjs';
import { sourceOf } from './resolve.mjs';
import { validate } from './validate.mjs';

const CONFIG_REF = /\{\{\s*config\.([a-z_][a-z0-9_]*)\s*\}\}/g;

function fill(value, config, onMissing) {
  if (typeof value === 'string') {
    return value.replace(CONFIG_REF, (all, key) => {
      if (!(key in config)) {
        onMissing(key);
        return all;
      }
      return Array.isArray(config[key]) ? config[key].join(', ') : String(config[key]);
    });
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, config, onMissing));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, config, onMissing)]));
  return value;
}

export function enabledPolicies(modules, ws, diags) {
  const ids = [...modules.values()].filter((m) => m.kind === 'policy').map((m) => m.id);
  const enabled = applyListOps([], ws.config.enable?.policies ?? [], ids);
  if (ws.config.scope?.length && !enabled.includes('scope')) enabled.push('scope');
  for (const id of enabled) {
    if (!ids.includes(id)) diags.error('unknown-ref', `enable.policies lists unknown policy "${id}"`, ws.projectFile ?? ws.stackFile);
  }
  return enabled.filter((id) => ids.includes(id));
}

async function findScript(policy, name) {
  for (const src of [...policy.sources].reverse()) {
    if (src.includes('#')) continue; // an override in a YAML file, not a policy file
    const file = path.join(path.dirname(src), name);
    const text = await readText(file);
    if (text !== null) return text;
  }
  return null;
}

// Applies enabled policies to `modules` in place; returns { rules, guards, permissions }.
export async function applyPolicies(modules, ws, diags) {
  const result = { rules: [], guards: [], permissions: [] };
  for (const id of enabledPolicies(modules, ws, diags)) {
    const policy = modules.get(`policy:${id}`);
    const where = sourceOf(policy);
    let config = policy.data.config ?? {};
    if (id === 'scope') {
      // The project's `scope` wins; flow run state and the knowledge directory stay writable.
      const paths = ws.config.scope?.length ? ws.config.scope : config.paths ?? [];
      if (!paths.length) diags.error('schema-invalid', 'policy "scope" is enabled without paths; set scope: [paths] in project.yaml', ws.projectFile ?? where);
      const extra = [`${ws.config.runs ?? RUNS_DIR}/`, ...(ws.config.knowledge ? [`${ws.config.knowledge}/`] : [])];
      config = { ...config, paths, always_allowed: [...new Set([...(config.always_allowed ?? []), ...extra])] };
    }

    const missing = (key) => diags.error('unknown-ref', `policy "${id}" uses {{config.${key}}}, which its config does not define`, where);
    const { rule, overrides, permissions } = fill(
      { rule: policy.data.rule, overrides: policy.data.overrides, permissions: policy.data.permissions },
      config,
      missing,
    );

    if (rule?.trim()) result.rules.push(rule.trim());
    result.permissions.push(...(permissions ?? []));

    for (const [kind, map] of [['role', overrides?.roles], ['flow', overrides?.flows]]) {
      for (const [target, override] of Object.entries(map ?? {})) {
        const prev = modules.get(`${kind}:${target}`);
        if (!prev) {
          diags.error('unknown-ref', `policy "${id}" overrides unknown ${kind} "${target}"`, where);
          continue;
        }
        const { body, body_mode, ...data } = override;
        const merged = mergeModule(prev, { data, body, mode: body_mode, source: `${where}#overrides.${kind}s.${target}` });
        modules.set(`${kind}:${target}`, merged);
        validate(kind, merged.data, sourceOf(merged), diags);
      }
    }

    if (policy.data.guard) {
      const source = await findScript(policy, policy.data.guard.script);
      if (source === null) {
        diags.error('missing-file', `policy "${id}": guard script "${policy.data.guard.script}" not found next to the policy`, where);
        continue;
      }
      result.guards.push({ id, event: policy.data.guard.event, matcher: policy.data.guard.matcher, source, config });
    }
  }
  return result;
}
