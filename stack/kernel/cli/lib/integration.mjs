// Integrations are opt-in (enable.integrations). An enabled integration gives the
// roles named in `grants` the MCP tools of the granted sets (mcp__<server>__<tool>),
// variants included, pre-approves the sets listed in `allow` in the managed settings
// file, and adds its rule to every agent's Project rules.
import { applyListOps } from './merge.mjs';
import { sourceOf } from './resolve.mjs';

export function applyIntegrations(modules, ws, diags) {
  const ids = [...modules.values()].filter((m) => m.kind === 'integration').map((m) => m.id);
  const enabled = applyListOps([], ws.config.enable?.integrations ?? [], ids);
  const rules = [];
  const permissions = [];

  for (const id of enabled) {
    const integration = modules.get(`integration:${id}`);
    if (!integration) {
      diags.error('unknown-ref', `enable.integrations lists unknown integration "${id}"`, ws.projectFile ?? ws.stackFile);
      continue;
    }
    const where = sourceOf(integration);
    const { mcp, tools, grants = {}, allow = [], rule } = integration.data;
    if (rule?.trim()) rules.push(rule.trim());
    for (const set of allow) {
      if (!tools[set]) diags.error('unknown-ref', `integration "${id}" pre-approves unknown tool set "${set}"`, where);
      else permissions.push(...tools[set].map((tool) => `mcp__${mcp}__${tool}`));
    }

    for (const [roleId, sets] of Object.entries(grants)) {
      const role = modules.get(`role:${roleId}`);
      if (!role) {
        diags.error('unknown-ref', `integration "${id}" grants tools to unknown role "${roleId}"`, where);
        continue;
      }
      const names = [];
      for (const set of sets) {
        if (!tools[set]) diags.error('unknown-ref', `integration "${id}" grants unknown tool set "${set}" to role "${roleId}"`, where);
        else names.push(...tools[set].map((tool) => `+mcp__${mcp}__${tool}`));
      }
      // Appended as list operations, so they add to whatever tools the role derives.
      role.data = { ...role.data, tools: [...(role.data.tools ?? []), ...names] };
    }
  }
  return { rules, permissions };
}
