// Diagnostics collector: every stage reports problems here instead of throwing,
// so one run surfaces all of them at once. A role and its variants share most
// checks, so identical reports are kept once.
export function createDiagnostics() {
  const items = [];
  const seen = new Set();
  const add = (level) => (code, message, file) => {
    const key = `${level}\0${code}\0${message}\0${file ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ level, code, message, file });
  };
  return {
    items,
    error: add('error'),
    warn: add('warn'),
    hasErrors: () => items.some((d) => d.level === 'error'),
    count: (level) => items.filter((d) => d.level === level).length,
  };
}
