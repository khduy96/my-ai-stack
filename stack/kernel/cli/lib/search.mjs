// `stack search`: the "index" knowledge retriever. Ranks the Markdown files of the
// knowledge directory against a query with BM25, accent-insensitive (đơn hàng = don hang),
// title and tags counting double. Computed per call: no index file that can go stale.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { readText } from './load.mjs';

const K1 = 1.2;
const B = 0.75;

export function tokens(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

async function markdownFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await markdownFiles(p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function split(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  try {
    return { meta: YAML.parse(m[1]) ?? {}, body: m[2] };
  } catch {
    return { meta: {}, body: m[2] };
  }
}

// -> [{ file, score, title, lines: [{ n, text }] }], best first.
export async function search({ dir, query, top = 8, root = dir }) {
  const docs = [];
  for (const file of await markdownFiles(dir)) {
    const text = (await readText(file)) ?? '';
    const { meta, body } = split(text);
    const title = meta.title ?? (/^#\s+(.+)$/m.exec(body)?.[1] ?? path.basename(file, '.md'));
    const heading = [title, ...(Array.isArray(meta.tags) ? meta.tags : [])].join(' ');
    const terms = [...tokens(heading), ...tokens(heading), ...tokens(body)];
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    docs.push({ file, title, body, tf, length: terms.length });
  }
  const q = [...new Set(tokens(query))];
  if (!docs.length || !q.length) return [];

  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.tf.has(t)).length]));
  const scored = docs
    .map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avg)));
      }
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);

  return scored.map(({ d, score }) => ({
    file: path.relative(root, d.file).split(path.sep).join('/'),
    score: Math.round(score * 100) / 100,
    title: d.title,
    lines: d.body
      .split('\n')
      .map((text, i) => ({ n: i + 1, text: text.trim() }))
      .filter((l) => l.text && tokens(l.text).some((t) => q.includes(t)))
      .slice(0, 2),
  }));
}
