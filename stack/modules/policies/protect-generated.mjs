// ai-stack policy "protect-generated": refuses Edit/Write on files matching the
// configured glob patterns (** = any directories, * = any characters but /, ? = one).
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
const patterns = (config.patterns ?? []).map((p) => ({ p, re: globToRegExp(p) }));

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input: input = {}, cwd = process.cwd() } = JSON.parse(raw || '{}');
const file = input.file_path ?? input.notebook_path;
if (!file) process.exit(0);

const rel = path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join('/');
const hit = patterns.find(({ re }) => re.test(rel));
if (!hit) process.exit(0);

console.error(`Blocked by ai-stack policy "protect-generated": ${rel} is generated (matches ${hit.p}). Change its source and run the code generator instead.`);
process.exit(2);
