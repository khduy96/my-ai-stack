// ai-stack policy "no-secrets": refuses Edit/Write/MultiEdit whose new text contains
// something that looks like a secret. The message names the kind, never the value.
// Claude Code runs it before those tools (PreToolUse); exit code 2 refuses the call.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(readFileSync(fileURLToPath(import.meta.url).replace(/\.mjs$/, '.json'), 'utf8'));

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const KINDS = [
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/],
  ['API key (sk-…)', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/],
];
// name = "literal" with a long value, e.g. password: "hunter2hunter2"
const ASSIGNMENT = /\b(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi;
const PLACEHOLDER = /example|sample|dummy|placeholder|changeme|your[_-]|xxx|<|\$\{|process\.env|\*\*\*/i;

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input: input = {}, cwd = process.cwd() } = JSON.parse(raw || '{}');
const file = input.file_path;
if (!file) process.exit(0);

const rel = path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join('/');
if ((config.ignore ?? []).some((g) => globToRegExp(g).test(rel))) process.exit(0);

const text = [input.content, input.new_string, ...(input.edits ?? []).map((e) => e.new_string)].filter(Boolean).join('\n');
const found = KINDS.find(([, re]) => re.test(text))?.[0] ?? ([...text.matchAll(ASSIGNMENT)].some((m) => !PLACEHOLDER.test(m[1])) ? 'literal credential' : null);
if (!found) process.exit(0);

console.error(`Blocked by ai-stack policy "no-secrets": the new content of ${rel} looks like it contains a ${found}. Read it from the environment or a secret store, or use an obvious placeholder.`);
process.exit(2);
