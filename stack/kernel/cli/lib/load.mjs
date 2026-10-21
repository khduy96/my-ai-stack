// Reads stack.yaml, project.yaml / project.local.yaml and module files into layers.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { KERNEL_VERSION, KINDS } from './kernel.mjs';
import { applyListOps, mergeValue } from './merge.mjs';
import { isValidRange, satisfies } from './semver.mjs';
import { unknownKeys, validate } from './validate.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/;
const firstLine = (s) => String(s).split('\n')[0];

export const normalizeEol = (s) => s.replace(/\r\n?/g, '\n');

export async function readText(file) {
  try {
    return normalizeEol(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// -> { found: false } | { found: true, data } ; data is null when the file does not parse.
async function readYaml(file, diags) {
  const text = await readText(file);
  if (text === null) return { found: false, data: null };
  try {
    const data = YAML.parse(text) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) {
      diags.error('parse-error', 'expected a YAML mapping at the top level', file);
      return { found: true, data: null };
    }
    return { found: true, data };
  } catch (e) {
    diags.error('parse-error', firstLine(e.message), file);
    return { found: true, data: null };
  }
}

function parseModuleFile(text, file, diags) {
  const m = FRONTMATTER.exec(text);
  if (!m) {
    diags.error('parse-error', 'missing YAML frontmatter (--- ... ---) at the top of the file', file);
    return null;
  }
  try {
    const data = YAML.parse(m[1]) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter must be a YAML mapping');
    return { data, body: m[2] };
  } catch (e) {
    diags.error('parse-error', firstLine(e.message), file);
    return null;
  }
}

export async function loadModules(root, layer, diags) {
  const records = [];
  for (const [kind, { dir: sub, ext }] of Object.entries(KINDS)) {
    const dir = path.join(root, sub);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name).sort();
    for (const name of files) {
      const file = path.join(dir, name);
      const parsed = ext === '.md' ? parseModuleFile(await readText(file), file, diags) : await parseYamlModule(file, diags);
      if (!parsed) continue;
      const id = name.slice(0, -ext.length);
      if (parsed.data.kind !== kind) {
        diags.error('kind-mismatch', `file is in ${sub}/ but declares kind "${parsed.data.kind ?? ''}"`, file);
        continue;
      }
      if (parsed.data.id !== id) {
        diags.error('id-mismatch', `id "${parsed.data.id ?? ''}" must equal the file name "${id}"`, file);
        continue;
      }
      records.push({ kind, id, data: parsed.data, body: parsed.body, file, layer });
    }
  }
  return records;
}

async function parseYamlModule(file, diags) {
  const { data } = await readYaml(file, diags);
  return data ? { data, body: '' } : null;
}

const overridesOf = (data) => ({ role: data?.roles ?? {}, trait: data?.traits ?? {}, flow: data?.flows ?? {}, policy: data?.policies ?? {} });

// Builds the ordered layers: core -> packs -> project -> local.
export async function loadWorkspace({ stackRoot, projectRoot }, diags) {
  const stackFile = path.join(stackRoot, 'stack.yaml');
  const stackYaml = await readYaml(stackFile, diags);
  if (!stackYaml.found) diags.error('missing-file', 'stack.yaml not found at the stack root', stackFile);
  const stack = stackYaml.data ?? {};
  if (stackYaml.data) validate('stack', stack, stackFile, diags);

  const claudeDir = projectRoot ? path.join(projectRoot, '.claude') : null;
  const projectFile = claudeDir && path.join(claudeDir, 'project.yaml');
  const localFile = claudeDir && path.join(claudeDir, 'project.local.yaml');
  let project = null;
  let local = null;

  if (projectRoot) {
    const p = await readYaml(projectFile, diags);
    if (!p.found) {
      diags.error('missing-file', 'project.yaml not found; copy templates/project.yaml from the stack to <project>/.claude/project.yaml', projectFile);
    }
    project = p.data;
    local = (await readYaml(localFile, diags)).data;
    for (const [data, file] of [[project, projectFile], [local, localFile]]) {
      if (!data) continue;
      validate('project', data, file, diags);
      for (const key of unknownKeys('project', data)) {
        diags.warn('unsupported-key', `"${key}" is not supported by kernel ${KERNEL_VERSION} and is ignored`, file);
      }
    }
    const range = project?.stack;
    if (range !== undefined && stack.version) {
      if (!isValidRange(range)) diags.error('schema-invalid', `project stack: "${range}" is not a valid version range`, projectFile);
      else if (!satisfies(stack.version, range)) {
        diags.error('incompatible-version', `project requires stack ${range}, but this stack is ${stack.version}`, projectFile);
      }
    }
  }

  // Module overrides (roles/traits/flows/policies) live in layers; everything else is project config.
  const configOf = (d) => {
    const { roles, traits, flows, policies, ...rest } = d ?? {};
    return rest;
  };
  const config = mergeValue(mergeValue(configOf(stack.defaults), configOf(project)), configOf(local));

  const layers = [
    { name: 'core', file: stackFile, modules: await loadModules(path.join(stackRoot, 'modules'), 'core', diags), overrides: {} },
  ];

  for (const packId of applyListOps([], config.packs ?? [])) {
    const dir = path.join(stackRoot, 'packs', packId);
    const packFile = path.join(dir, 'pack.yaml');
    const pack = await readYaml(packFile, diags);
    if (!pack.found) {
      diags.error('unknown-ref', `pack "${packId}" not found (expected ${path.join('packs', packId, 'pack.yaml')})`, projectFile);
      continue;
    }
    if (!pack.data) continue;
    validate('pack', pack.data, packFile, diags);
    if (pack.data.id !== undefined && pack.data.id !== packId) {
      diags.error('id-mismatch', `id "${pack.data.id}" must equal the directory name "${packId}"`, packFile);
    }
    layers.push({
      name: `pack:${packId}`,
      file: packFile,
      modules: await loadModules(path.join(dir, 'modules'), `pack:${packId}`, diags),
      overrides: overridesOf(pack.data),
    });
  }

  if (projectRoot) {
    const modules = [];
    for (const dir of applyListOps([], config.modules ?? [])) {
      modules.push(...(await loadModules(path.resolve(projectRoot, dir), 'project', diags)));
    }
    layers.push({ name: 'project', file: projectFile, modules, overrides: overridesOf(project) });
    if (local) layers.push({ name: 'local', file: localFile, modules: [], overrides: overridesOf(local) });
  }

  return { stack, stackFile, config, layers, projectRoot, claudeDir, projectFile };
}
