// Blocks Edit/Write outside the paths you own. Claude Code runs it before those tools
// (PreToolUse); exit code 2 refuses the call and shows the message to Claude.
// Copy to <project>/.claude/hooks/scope-guard.mjs and edit SCOPE. See PARTIAL.md.
import path from 'node:path';

// Directories you may change, relative to the project root, each ending with '/'.
// Keep '.ai-runs/' so ai-stack flows can save their run state.
const SCOPE = ['lib/features/orders/', '.ai-runs/'];

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { tool_input: input = {}, cwd = process.cwd() } = JSON.parse(raw || '{}');
const file = input.file_path ?? input.notebook_path;
if (!file) process.exit(0);

const rel = path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join('/');
if (SCOPE.some((dir) => rel.startsWith(dir))) process.exit(0);

console.error(`Blocked by scope-guard: ${rel} is outside your scope (${SCOPE.join(', ')}). Report the needed change instead of making it.`);
process.exit(2);
