// Writes generated files into <project>/.claude/ and tracks them in .stack-lock.json,
// so a build never touches files it did not create and can remove the ones it no longer makes.
//
// It also manages a few entries in one settings file (permissions.allow and hooks):
// the lock records exactly the entries the build added, so later builds change or remove
// only those, and entries the user wrote stay untouched even when they are identical.
import { createHash } from 'node:crypto';
import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GENERATOR, KERNEL_VERSION } from './kernel.mjs';
import { normalizeEol, readText } from './load.mjs';

export const LOCK_FILE = '.stack-lock.json';
// Lock of what `stack install` put in the user's ~/.claude/, kept apart from any project lock.
export const USER_LOCK_FILE = '.stack-user-lock.json';

// Line endings are normalised so a git autocrlf checkout does not look like a hand edit.
export const hash = (text) => createHash('sha256').update(normalizeEol(text)).digest('hex');

async function readLock(claudeDir, diags, lockFile = LOCK_FILE) {
  const file = path.join(claudeDir, lockFile);
  const text = await readText(file);
  if (text === null) return { files: {}, settings: null };
  try {
    const lock = JSON.parse(text);
    return { files: lock.files ?? {}, settings: lock.settings ?? null };
  } catch {
    diags.error('parse-error', `${lockFile} is not valid JSON; delete it and rebuild with --force`, file);
    return { files: {}, settings: null };
  }
}

function hasHook(json, h) {
  return (json.hooks?.[h.event] ?? []).some((entry) => entry.matcher === h.matcher && (entry.hooks ?? []).some((x) => x.command === h.command));
}

// Removes the entries a previous build added; prunes containers it leaves empty.
function removeManaged(json, managed) {
  const allow = json.permissions?.allow;
  if (Array.isArray(allow) && managed.allow?.length) {
    json.permissions.allow = allow.filter((a) => !managed.allow.includes(a));
    if (!json.permissions.allow.length) delete json.permissions.allow;
    if (!Object.keys(json.permissions).length) delete json.permissions;
  }
  for (const h of managed.hooks ?? []) {
    const list = json.hooks?.[h.event];
    if (!Array.isArray(list)) continue;
    json.hooks[h.event] = list
      .map((entry) => (entry.matcher === h.matcher ? { ...entry, hooks: (entry.hooks ?? []).filter((x) => x.command !== h.command) } : entry))
      .filter((entry) => entry.hooks?.length);
    if (!json.hooks[h.event].length) delete json.hooks[h.event];
    if (!Object.keys(json.hooks).length) delete json.hooks;
  }
}

// Adds wanted entries; returns those it actually added (entries already present are the user's).
function addManaged(json, wanted) {
  const added = { allow: [], hooks: [] };
  for (const a of wanted.allow ?? []) {
    json.permissions ??= {};
    json.permissions.allow ??= [];
    if (json.permissions.allow.includes(a)) continue;
    json.permissions.allow.push(a);
    added.allow.push(a);
  }
  for (const h of wanted.hooks ?? []) {
    if (hasHook(json, h)) continue;
    json.hooks ??= {};
    json.hooks[h.event] ??= [];
    json.hooks[h.event].push({ matcher: h.matcher, hooks: [{ type: 'command', command: h.command }] });
    added.hooks.push(h);
  }
  return added;
}

// -> { ops, managed } for the settings file(s); `wanted` is { file, allow, hooks } or null.
async function planSettings(claudeDir, wanted, previous, diags) {
  const ops = [];
  let managed = null;
  for (const file of new Set([previous?.file, wanted?.file].filter(Boolean))) {
    const abs = path.join(claudeDir, file);
    const text = await readText(abs);
    let json = {};
    if (text !== null) {
      try {
        json = JSON.parse(text);
      } catch {
        diags.error('parse-error', `${file} is not valid JSON; fix it, then build again`, abs);
        continue;
      }
    }
    const before = JSON.stringify(json);
    if (previous?.file === file) removeManaged(json, previous);
    if (wanted?.file === file) {
      // Entries the previous build added are ours again, even though removeManaged just took them out.
      managed = { file, ...addManaged(json, wanted) };
    }
    if (JSON.stringify(json) === before) continue;
    if (text === null && !Object.keys(json).length) continue;
    ops.push({ type: text === null ? 'create' : 'update', rel: file, abs, content: `${JSON.stringify(json, null, 2)}\n` });
  }
  const empty = !managed || (!managed.allow.length && !managed.hooks.length);
  return { ops, managed: empty ? null : managed };
}

// Decides what to do with every file before anything is written, so a conflict aborts the whole build.
export async function planEmit(claudeDir, outputs, { force, lockFile = LOCK_FILE, settings = null }, diags) {
  const { files: locked, settings: lockedSettings } = await readLock(claudeDir, diags, lockFile);
  const next = new Map(outputs.map((o) => [o.path, o.content]));
  const ops = [];

  for (const [rel, content] of next) {
    const abs = path.join(claudeDir, rel);
    const current = await readText(abs);
    if (current === null) {
      ops.push({ type: 'create', rel, abs, content });
      continue;
    }
    const currentHash = hash(current);
    if (!force && !(rel in locked)) {
      diags.error('unmanaged-file', `${rel} already exists and was not generated by stack; rename it or pass --force to overwrite`, abs);
      continue;
    }
    if (!force && currentHash !== locked[rel]) {
      diags.error('generated-drift', `${rel} was edited by hand since the last build; move the change into a module or project.yaml, or pass --force to overwrite`, abs);
      continue;
    }
    ops.push(currentHash === hash(content) ? { type: 'unchanged', rel } : { type: 'update', rel, abs, content });
  }

  for (const [rel, lockedHash] of Object.entries(locked)) {
    if (next.has(rel)) continue;
    const abs = path.join(claudeDir, rel);
    const current = await readText(abs);
    if (current === null) continue;
    if (!force && hash(current) !== lockedHash) {
      diags.error('generated-drift', `${rel} is no longer generated but was edited by hand; delete it yourself or pass --force`, abs);
      continue;
    }
    ops.push({ type: 'remove', rel, abs });
  }

  const planned = await planSettings(claudeDir, settings, lockedSettings, diags);
  ops.push(...planned.ops);

  const files = Object.fromEntries([...next.keys()].sort().map((rel) => [rel, hash(next.get(rel))]));
  const lock = { generator: GENERATOR, kernel: KERNEL_VERSION, files, ...(planned.managed ? { settings: planned.managed } : {}) };
  return { ops, lockFile, lock };
}

export async function applyEmit(claudeDir, plan) {
  for (const op of plan.ops) {
    if (op.type === 'create' || op.type === 'update') {
      await mkdir(path.dirname(op.abs), { recursive: true });
      await writeFile(op.abs, op.content, 'utf8');
    } else if (op.type === 'remove') {
      await rm(op.abs);
      // Drop directories the build emptied (e.g. skills/<name>/), never claudeDir itself.
      for (let dir = path.dirname(op.abs); dir.startsWith(claudeDir) && dir !== claudeDir; dir = path.dirname(dir)) {
        try {
          await rmdir(dir);
        } catch {
          break;
        }
      }
    }
  }
  const lockPath = path.join(claudeDir, plan.lockFile ?? LOCK_FILE);
  const lockText = `${JSON.stringify(plan.lock, null, 2)}\n`;
  if ((await readText(lockPath)) !== lockText) {
    await mkdir(claudeDir, { recursive: true });
    await writeFile(lockPath, lockText, 'utf8');
  }
}

// doctor: generated files edited or deleted by hand, and managed settings entries that went missing.
export async function checkDrift(claudeDir, diags) {
  const { files, settings } = await readLock(claudeDir, diags);
  for (const [rel, lockedHash] of Object.entries(files)) {
    const abs = path.join(claudeDir, rel);
    const current = await readText(abs);
    if (current === null) diags.warn('generated-missing', `${rel} is in ${LOCK_FILE} but missing; run stack build`, abs);
    else if (hash(current) !== lockedHash) diags.error('generated-drift', `${rel} was edited by hand since the last build`, abs);
  }
  if (!settings) return;
  const abs = path.join(claudeDir, settings.file);
  let json = {};
  try {
    json = JSON.parse((await readText(abs)) ?? '{}');
  } catch {
    diags.error('parse-error', `${settings.file} is not valid JSON`, abs);
    return;
  }
  const lost = [
    ...(settings.allow ?? []).filter((a) => !(json.permissions?.allow ?? []).includes(a)),
    ...(settings.hooks ?? []).filter((h) => !hasHook(json, h)).map((h) => `hook ${h.command}`),
  ];
  if (lost.length) diags.warn('generated-missing', `${settings.file} lost entries the build manages (${lost.join('; ')}); run stack build`, abs);
}
