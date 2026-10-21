// ai-stack policy "scope": refuses Edit/Write outside the configured paths.
// Claude Code runs it before those tools (PreToolUse); exit code 2 refuses the call
// and shows the message to Claude. Config: the JSON file next to this script.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(readFileSync(fileURLToPath(import.meta.url).replace(/\.mjs$/, '.json'), 'utf8'));
const asDir = (p) => `${String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')}/`;
const dirs = [...(config.paths ?? []), ...(config.always_allowed ?? [])].map(asDir);

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input: input = {}, cwd = process.cwd() } = JSON.parse(raw || '{}');
const file = input.file_path ?? input.notebook_path;
if (!file) process.exit(0);

const rel = path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join('/');
if (dirs.some((dir) => rel.startsWith(dir))) process.exit(0);

console.error(`Blocked by ai-stack policy "scope": ${rel} is outside ${dirs.join(', ')}. Describe the needed change under next instead of making it.`);
process.exit(2);
