// Per-module versioning for the stack's own modules (core and packs).
// modules.lock.json records each module's version and a hash of its content;
// `stack doctor` (on the stack) fails when content changed but the version did not,
// and `stack versions --update` records the current state after a bump.
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { hash } from './emit.mjs';
import { KINDS } from './kernel.mjs';
import { readText } from './load.mjs';

export const VERSIONS_LOCK = 'modules.lock.json';

const parseVersion = (v) => String(v ?? '').split('.').map(Number);
const newer = (a, b) => {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

async function list(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

function frontmatterOrYaml(text, ext) {
  if (ext === '.md') {
    const m = /^---\n([\s\S]*?)\n---/.exec(text);
    return m ? YAML.parse(m[1]) ?? {} : {};
  }
  return YAML.parse(text) ?? {};
}

// key -> { version, hash, file } for every module file of one modules root.
async function scanModules(root, keyPrefix, out) {
  for (const [kind, { dir, ext }] of Object.entries(KINDS)) {
    for (const name of (await list(path.join(root, dir))).filter((n) => n.endsWith(ext))) {
      const file = path.join(root, dir, name);
      const text = await readText(file);
      let data;
      try {
        data = frontmatterOrYaml(text, ext);
      } catch {
        continue; // doctor reports unparsable files itself
      }
      let content = text;
      if (kind === 'policy' && data.guard?.script) content += `\n${(await readText(path.join(root, dir, data.guard.script))) ?? ''}`;
      out[`${keyPrefix}${kind}:${name.slice(0, -ext.length)}`] = { version: data.version, hash: hash(content), file };
    }
  }
}

export async function scanStack(stackRoot) {
  const out = {};
  await scanModules(path.join(stackRoot, 'modules'), '', out);
  for (const entry of await readdir(path.join(stackRoot, 'packs'), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const packFile = path.join(stackRoot, 'packs', entry.name, 'pack.yaml');
    const text = await readText(packFile);
    if (text === null) continue;
    out[`pack:${entry.name}`] = { version: (YAML.parse(text) ?? {}).version, hash: hash(text), file: packFile };
    await scanModules(path.join(stackRoot, 'packs', entry.name, 'modules'), `pack:${entry.name}/`, out);
  }
  return out;
}

async function readVersionsLock(stackRoot) {
  const text = await readText(path.join(stackRoot, VERSIONS_LOCK));
  if (text === null) return null;
  return JSON.parse(text).modules ?? {};
}

// -> [{ key, version, locked, status }], status: ok | changed | bumped | new | removed | downgraded
export async function compareVersions(stackRoot) {
  const current = await scanStack(stackRoot);
  const locked = (await readVersionsLock(stackRoot)) ?? {};
  const rows = [];
  for (const [key, cur] of Object.entries(current)) {
    const old = locked[key];
    let status = 'ok';
    if (!old) status = 'new';
    else if (cur.hash !== old.hash && cur.version === old.version) status = 'changed';
    else if (cur.version !== old.version) status = newer(cur.version, old.version) ? 'bumped' : 'downgraded';
    rows.push({ key, version: cur.version, locked: old?.version ?? null, status, file: cur.file });
  }
  for (const key of Object.keys(locked)) if (!(key in current)) rows.push({ key, version: null, locked: locked[key].version, status: 'removed' });
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

// doctor on the stack itself.
export async function checkVersions(stackRoot, diags) {
  if ((await readVersionsLock(stackRoot)) === null) {
    diags.warn('version-unrecorded', `${VERSIONS_LOCK} is missing; run stack versions --update`, path.join(stackRoot, VERSIONS_LOCK));
    return;
  }
  for (const row of await compareVersions(stackRoot)) {
    if (row.status === 'changed') diags.error('version-not-bumped', `${row.key} changed but is still version ${row.version}; bump its version, then run stack versions --update`, row.file);
    if (row.status === 'downgraded') diags.error('version-not-bumped', `${row.key} went from ${row.locked} back to ${row.version}`, row.file);
    if (['new', 'bumped', 'removed'].includes(row.status)) diags.warn('version-unrecorded', `${row.key} is ${row.status} (${row.locked ?? '-'} -> ${row.version ?? '-'}); run stack versions --update`, row.file);
  }
}

export async function updateVersions(stackRoot) {
  const current = await scanStack(stackRoot);
  const modules = Object.fromEntries(Object.entries(current).sort().map(([k, v]) => [k, { version: v.version, hash: v.hash }]));
  await writeFile(path.join(stackRoot, VERSIONS_LOCK), `${JSON.stringify({ modules }, null, 2)}\n`, 'utf8');
  return Object.keys(modules).length;
}

