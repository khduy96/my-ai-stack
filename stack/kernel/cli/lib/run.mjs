// `stack run`: runs a flow without a person, e.g. in CI, and turns the outcome into an
// exit code and a Markdown summary. It drives the same skill as an interactive run, through
// `claude -p`, with the permissions the project's settings allow (default permission mode).
import { realpath } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import YAML from 'yaml';
import { parseTranscript, runClaude } from './eval.mjs';
import { readText } from './load.mjs';

const RANK = { info: 0, minor: 1, major: 2, critical: 3 };

async function handoffsIn(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await handoffsIn(p)));
    else if (e.name.endsWith('.handoff.yaml')) out.push(p);
  }
  return out;
}

async function readHandoff(file) {
  try {
    const data = YAML.parse((await readText(file)) ?? '');
    return data?.handoff ?? data;
  } catch {
    return null;
  }
}

// The findings that count: those of the last step in run.yaml that left handoffs.
export async function finalFindings(runDir) {
  const state = YAML.parse((await readText(path.join(runDir, 'run.yaml'))) ?? '{}') ?? {};
  const all = await handoffsIn(runDir);
  const rel = (f) => path.relative(runDir, f).split(path.sep).join('/');
  for (const step of Object.keys(state.steps ?? {}).reverse()) {
    const id = step.split('#')[0];
    const files = all.filter((f) => {
      const r = rel(f);
      return r === `${id}.handoff.yaml` || r.startsWith(`${id}/`) || new RegExp(`(^|/)${id}(\\.handoff\\.yaml$|/)`).test(r);
    });
    if (!files.length) continue;
    const findings = [];
    for (const f of files) findings.push(...((await readHandoff(f))?.findings ?? []));
    return { step: id, status: state.status ?? null, findings };
  }
  return { step: null, status: state.status ?? null, findings: [] };
}

export function exitCodeFor({ runStatus, findings, failOn, error }) {
  if (error || !runStatus || runStatus === 'failed') return 2;
  if (runStatus === 'waiting') return 3;
  if (failOn === 'none') return 0;
  return findings.some((f) => (RANK[f.severity] ?? 0) >= RANK[failOn]) ? 1 : 0;
}

export function summaryMarkdown({ flow, input, runDir, outcome, transcript, failOn, code }) {
  const verdict = { 0: 'passed', 1: `failed: findings at ${failOn} or above`, 2: 'failed: the run did not finish', 3: 'waiting for a human' }[code];
  const lines = [
    `## ai-stack: /${flow}${input ? ` ${input}` : ''}`,
    '',
    `**Result:** ${verdict} · run status \`${outcome.status ?? 'none'}\`${transcript.costUsd != null ? ` · US$${transcript.costUsd.toFixed(2)}` : ''}${transcript.durationMs != null ? ` · ${Math.round(transcript.durationMs / 1000)}s` : ''}`,
    '',
  ];
  const findings = [...outcome.findings].sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0));
  if (findings.length) {
    lines.push(`| Severity | Finding | Where |`, `|---|---|---|`);
    for (const f of findings) lines.push(`| ${f.severity} | ${String(f.title ?? '').replace(/\|/g, '\\|')} | ${f.evidence ?? ''} |`);
  } else lines.push('No findings.');
  if (transcript.report) lines.push('', '<details><summary>Report</summary>', '', transcript.report.trim(), '', '</details>');
  if (runDir) lines.push('', `Run directory: \`${runDir}\``);
  return `${lines.join('\n')}\n`;
}

// -> { code, outcome, summary }
export async function runFlow({ projectRoot: given, flow, input = '', prefix = 'ai-', model = 'sonnet', failOn = 'major', permissionMode = 'default', claude, summaryFile, runs = '.ai-runs' }) {
  // The long form of the path: Claude Code asks before writing under Windows 8.3 short names (ADMINI~1).
  const projectRoot = await promisify(realpath.native)(given);
  const runsRoot = path.join(projectRoot, runs);
  const before = new Set(await readdir(runsRoot).catch(() => []));
  const started = Date.now();
  const raw = runClaude(projectRoot, `/${prefix}${flow}${input ? ` ${input}` : ''}`, { model, claude, permissionMode });
  const transcript = { ...parseTranscript(raw), durationMs: Date.now() - started };
  const fresh = (await readdir(runsRoot).catch(() => [])).filter((d) => !before.has(d) && d !== '.gitignore').sort();
  const runDir = fresh.length ? path.join(runsRoot, fresh.at(-1)) : null;
  const outcome = runDir ? await finalFindings(runDir) : { step: null, status: null, findings: [] };
  const code = exitCodeFor({ runStatus: outcome.status, findings: outcome.findings, failOn, error: transcript.error });
  const summary = summaryMarkdown({ flow: `${prefix}${flow}`, input, runDir: runDir && path.relative(projectRoot, runDir), outcome, transcript, failOn, code });
  if (summaryFile) await writeFile(summaryFile, summary, { encoding: 'utf8', flag: 'a' });
  return { code, outcome, summary, transcript };
}
