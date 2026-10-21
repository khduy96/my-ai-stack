// Constants shared by every part of the CLI.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const KERNEL_VERSION = JSON.parse(readFileSync(path.join(CLI_DIR, 'package.json'), 'utf8')).version;
export const CONTRACTS_DIR = path.resolve(CLI_DIR, '../contracts');
export const DEFAULT_STACK_ROOT = path.resolve(CLI_DIR, '../..');
export const GENERATOR = 'ai-stack';

// Module kind -> sub-directory inside a modules root and file format.
// Prompt modules are Markdown with frontmatter; config modules are plain YAML.
export const KINDS = {
  role: { dir: 'roles', ext: '.md' },
  trait: { dir: 'traits', ext: '.md' },
  flow: { dir: 'flows', ext: '.yaml' },
  policy: { dir: 'policies', ext: '.yaml' },
};

// Settings file the build manages permissions and hooks in, by the project's `settings` value.
export const SETTINGS_FILES = { local: 'settings.local.json', shared: 'settings.json' };

// Read-only git commands flows use. The build adds the exact handoff check command
// (`<cli> check *`) and `Edit(<runs dir>/**)`; Claude Code matches file writes against
// Edit rules only, and wants wildcards after the subcommand.
export const FLOW_PERMISSIONS = ['Bash(git diff *)', 'Bash(git status *)', 'Bash(git log *)'];

// Default directory for flow run state, relative to the project root. Kept outside
// .claude/ because Claude Code asks for permission on every write inside .claude/.
export const RUNS_DIR = '.ai-runs';

// Cumulative: each level adds to the previous one.
export const PERMISSION_TOOLS = {
  read: ['Read', 'Grep', 'Glob'],
  write: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
  exec: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
};
