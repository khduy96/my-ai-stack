// Minimal semver, enough for compatibility ranges (no pre-release tags).
// Ranges: '*', 'x.y.z', 'x.y', 'x', '^x[.y[.z]]', '~x[.y[.z]]', '>=x[.y[.z]]'.

const RANGE = /^(\^|~|>=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

const num = (s) => (s === undefined ? null : Number(s));
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export const isValidRange = (range) => String(range).trim() === '*' || RANGE.test(String(range).trim());

export function satisfies(version, range) {
  const vm = VERSION.exec(String(version).trim());
  const r = String(range).trim();
  if (!vm) return false;
  if (r === '*') return true;
  const rm = RANGE.exec(r);
  if (!rm) return false;

  const v = [Number(vm[1]), Number(vm[2]), Number(vm[3])];
  const [major, minor, patch] = [num(rm[2]), num(rm[3]), num(rm[4])];
  const lo = [major, minor ?? 0, patch ?? 0];
  const op = rm[1] ?? '=';

  if (op === '>=') return cmp(v, lo) >= 0;
  if (op === '=') {
    return v[0] === major && (minor === null || v[1] === minor) && (patch === null || v[2] === patch);
  }
  if (cmp(v, lo) < 0) return false;
  if (op === '~') return v[0] === major && (minor === null || v[1] === minor);
  // Caret: the left-most non-zero component must not change.
  if (major > 0 || minor === null) return v[0] === major;
  if (minor > 0 || patch === null) return v[0] === 0 && v[1] === minor;
  return v[0] === 0 && v[1] === 0 && v[2] === patch;
}
