// Folds layers into one module per kind:id, then checks the module graph.
import { KERNEL_VERSION } from './kernel.mjs';
import { applyListOps, mergeModule, mergeValue } from './merge.mjs';
import { isValidRange, satisfies } from './semver.mjs';
import { validate } from './validate.mjs';

const keyOf = (kind, id) => `${kind}:${id}`;
export const sourceOf = (mod) => mod.sources.join(' + ');

function splitBodyMode(data) {
  const { body_mode, ...rest } = data;
  return { data: rest, mode: body_mode };
}

// A flow override may give `steps` as a map keyed by step id, changing single steps
// instead of replacing the whole list.
function expandStepMap(prev, data, where, diags) {
  const map = data.steps;
  if (prev.kind !== 'flow' || map === null || typeof map !== 'object' || Array.isArray(map)) return data;
  const steps = Array.isArray(prev.data.steps) ? prev.data.steps : [];
  const ids = steps.flatMap((s) => [s?.id, ...(s?.loop?.steps ?? []).map((b) => b?.id)]);
  for (const id of Object.keys(map)) {
    if (!ids.includes(id)) diags.error('unknown-ref', `override targets unknown step "${id}" of flow "${prev.id}"`, where);
  }
  const apply = (s) => (s?.id in map ? mergeValue(s, map[s.id]) : s);
  return {
    ...data,
    steps: steps.map((s) => {
      const out = apply(s);
      return Array.isArray(out?.loop?.steps) ? { ...out, loop: { ...out.loop, steps: out.loop.steps.map(apply) } } : out;
    }),
  };
}

export function resolve(ws, diags) {
  const modules = new Map();

  for (const layer of ws.layers) {
    const seen = new Set();
    for (const rec of layer.modules) {
      const key = keyOf(rec.kind, rec.id);
      if (seen.has(key)) {
        diags.error('duplicate-id', `${rec.kind} "${rec.id}" is defined more than once in layer ${layer.name}`, rec.file);
        continue;
      }
      seen.add(key);
      const { data, mode } = splitBodyMode(rec.data);
      const prev = modules.get(key);
      modules.set(
        key,
        prev
          ? mergeModule(prev, { data: expandStepMap(prev, data, rec.file, diags), body: rec.body, mode, source: rec.file })
          : { kind: rec.kind, id: rec.id, data: mergeValue({}, data), body: rec.body, sources: [rec.file] },
      );
    }

    for (const [kind, map] of Object.entries(layer.overrides)) {
      for (const [id, override] of Object.entries(map ?? {})) {
        const key = keyOf(kind, id);
        const prev = modules.get(key);
        if (!prev) {
          diags.error('unknown-ref', `override targets unknown ${kind} "${id}"`, layer.file);
          continue;
        }
        if (override === null || typeof override !== 'object') continue; // schema already reported it
        const { body, body_mode, ...data } = override;
        const source = `${layer.file}#${kind}s.${id}`;
        modules.set(key, mergeModule(prev, { data: expandStepMap(prev, data, source, diags), body, mode: body_mode, source }));
      }
    }
  }

  for (const mod of modules.values()) {
    validate(mod.kind, mod.data, sourceOf(mod), diags);
    const range = mod.data.kernel;
    if (typeof range === 'string') {
      if (!isValidRange(range)) diags.error('schema-invalid', `${mod.kind} kernel: "${range}" is not a valid version range`, sourceOf(mod));
      else if (!satisfies(KERNEL_VERSION, range)) {
        diags.error('incompatible-version', `${mod.kind} "${mod.id}" requires kernel ${range}, but this kernel is ${KERNEL_VERSION}`, sourceOf(mod));
      }
    }
  }

  checkGraph(modules, diags);
  return modules;
}

// 'id' or 'kind:id' -> module, or an error string.
function lookup(modules, ref) {
  if (ref.includes(':')) return modules.get(ref) ?? `unknown module "${ref}"`;
  const hits = [...modules.values()].filter((m) => m.id === ref);
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return `unknown module "${ref}"`;
  return `"${ref}" is ambiguous (${hits.map((m) => keyOf(m.kind, m.id)).join(', ')}); write it as kind:id`;
}

function checkGraph(modules, diags) {
  const edges = new Map();
  for (const mod of modules.values()) {
    const deps = [];
    for (const ref of mod.data.requires ?? []) {
      const hit = lookup(modules, ref);
      if (typeof hit === 'string') diags.error('unknown-ref', `${mod.kind} "${mod.id}" requires ${hit}`, sourceOf(mod));
      else deps.push(keyOf(hit.kind, hit.id));
    }
    if (mod.kind === 'role') {
      for (const id of applyListOps([], mod.data.traits ?? [])) {
        if (modules.has(keyOf('trait', id))) deps.push(keyOf('trait', id));
      }
    }
    edges.set(keyOf(mod.kind, mod.id), deps);
  }

  // Depth-first search; a grey node reached again closes a cycle.
  const state = new Map();
  const reported = new Set();
  const visit = (node, trail) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'active') {
      const cycle = [...trail.slice(trail.indexOf(node)), node];
      const id = [...cycle].slice(0, -1).sort().join('|');
      if (!reported.has(id)) {
        reported.add(id);
        diags.error('requires-cycle', `dependency cycle: ${cycle.join(' -> ')}`, sourceOf(modules.get(node)));
      }
      return;
    }
    state.set(node, 'active');
    for (const next of edges.get(node) ?? []) visit(next, [...trail, node]);
    state.set(node, 'done');
  };
  for (const node of edges.keys()) visit(node, []);
}
