// Merge rules shared by every layer (see kernel/conventions.md):
//   scalar -> the later layer wins; null deletes the key
//   map    -> deep merge
//   list   -> a plain list replaces; a list containing '+x' / '-x' is appended as
//             operations and evaluated at the end with applyListOps()
//   body   -> replace (default), append or prepend

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isOp = (v) => typeof v === 'string' && (v.startsWith('+') || v.startsWith('-'));

export function mergeValue(base, over) {
  if (over === undefined) return base;
  if (over === null) return undefined;
  if (Array.isArray(over)) {
    return over.some(isOp) && Array.isArray(base) ? [...base, ...over] : [...over];
  }
  if (isPlainObject(over)) {
    const out = isPlainObject(base) ? { ...base } : {};
    for (const [key, value] of Object.entries(over)) {
      const merged = mergeValue(out[key], value);
      if (merged === undefined) delete out[key];
      else out[key] = merged;
    }
    return out;
  }
  return over;
}

// Evaluates a merged list. A plain item means some layer replaced the list, so
// evaluation starts from empty instead of `base`. With `universe`, '*' expands to it.
export function applyListOps(base, seq = [], universe = null) {
  let out = seq.some((v) => !isOp(v)) ? [] : [...base];
  const add = (x) => {
    if (!out.includes(x)) out.push(x);
  };
  for (const item of seq) {
    if (typeof item === 'string' && item.startsWith('-')) {
      const x = item.slice(1);
      out = x === '*' ? [] : out.filter((y) => y !== x);
      continue;
    }
    const x = typeof item === 'string' && item.startsWith('+') ? item.slice(1) : item;
    if (x === '*' && universe) universe.forEach(add);
    else add(x);
  }
  return out;
}

export function mergeBody(base, over, mode = 'replace') {
  if (over === undefined || over === null || over.trim() === '') return base;
  if (mode === 'append') return `${base.trimEnd()}\n\n${over.trim()}\n`;
  if (mode === 'prepend') return `${over.trim()}\n\n${base.trimStart()}`;
  return over;
}

// `over` = { data, body, mode, source } coming from a later layer.
export function mergeModule(base, over) {
  return {
    ...base,
    data: mergeValue(base.data, over.data ?? {}),
    body: mergeBody(base.body, over.body, over.mode),
    sources: [...base.sources, over.source],
  };
}
