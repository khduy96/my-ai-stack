#!/usr/bin/env node
// Đếm token Claude Code đã dùng cho dự án, gộp theo 30phút/ngày/tuần/tháng/năm.
// Đọc các transcript JSONL trong ~/.claude/projects/<project-slug>/
//
// Cách dùng:
//   node count-tokens.mjs [30m|day|week|month|year|all] [tuỳ chọn]
// Tuỳ chọn:
//   --period=30m|day|week|month|year|all   (mặc định: all)
//   --dir=<đường dẫn dự án>            (mặc định: thư mục hiện tại)
//   --since=YYYY-MM-DD                 (chỉ tính từ ngày này)
//   --until=YYYY-MM-DD                 (chỉ tính đến hết ngày này)
//   --cost                             (ước tính chi phí theo bảng giá bên dưới)
//   --json                             (in kết quả dạng JSON)
// Lưu ý: mốc 30m mặc định chỉ tính trong NGÀY HÔM NAY; dùng --since/--until để xem ngày khác.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- Bảng giá ước tính (USD / 1 triệu token). Sửa nếu cần cho đúng model của bạn.
const RATES = {
  "claude-opus-4-8":  { input: 5,    output: 25,  cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4":    { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.5 },
  "claude-sonnet-5":  { input: 3,    output: 15,  cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4":  { input: 3,    output: 15,  cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1,    output: 5,   cacheWrite: 1.25, cacheRead: 0.1 },
  _default:           { input: 5,    output: 25,  cacheWrite: 6.25, cacheRead: 0.5 },
};

// --- Phân tích tham số dòng lệnh
const args = process.argv.slice(2);
const opts = { period: "all", cost: false, json: false, dir: process.cwd(), since: null, until: null };
for (const a of args) {
  if (a === "--cost") opts.cost = true;
  else if (a === "--json") opts.json = true;
  else if (a.startsWith("--period=")) opts.period = a.slice(9);
  else if (a.startsWith("--dir=")) opts.dir = a.slice(6);
  else if (a.startsWith("--since=")) opts.since = a.slice(8);
  else if (a.startsWith("--until=")) opts.until = a.slice(8);
  else if (["30m", "day", "week", "month", "year", "all"].includes(a)) opts.period = a;
}

// --- Tìm thư mục transcript của dự án
function slugify(p) {
  return path.resolve(p).replace(/[^A-Za-z0-9]/g, "-");
}
const projectsRoot = path.join(os.homedir(), ".claude", "projects");
let projectDir = path.join(projectsRoot, slugify(opts.dir));

// Dự phòng: nếu không thấy thư mục theo slug, quét toàn bộ và khớp theo trường cwd.
if (!fs.existsSync(projectDir)) {
  const target = path.resolve(opts.dir).toLowerCase();
  let found = null;
  if (fs.existsSync(projectsRoot)) {
    for (const d of fs.readdirSync(projectsRoot)) {
      const full = path.join(projectsRoot, d);
      if (!fs.statSync(full).isDirectory()) continue;
      const files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl"));
      for (const f of files) {
        const first = fs.readFileSync(path.join(full, f), "utf8").split("\n").find((l) => l.includes('"cwd"'));
        if (first) {
          try {
            const cwd = JSON.parse(first).cwd;
            if (cwd && path.resolve(cwd).toLowerCase() === target) { found = full; break; }
          } catch {}
        }
      }
      if (found) break;
    }
  }
  if (found) projectDir = found;
}

if (!fs.existsSync(projectDir)) {
  console.error(`Không tìm thấy dữ liệu transcript cho dự án:\n  ${opts.dir}\n  (đã tìm: ${projectDir})`);
  process.exit(1);
}

// --- Các hàm gộp theo khoảng thời gian (dùng giờ địa phương)
const pad = (n) => String(n).padStart(2, "0");
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Thứ Hai = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // đến Thứ Năm
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fdNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fdNum + 3);
  const week = 1 + Math.round((date - firstThu) / (7 * 864e5));
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}
const keyers = {
  "30m": (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${d.getMinutes() < 30 ? "00" : "30"}`,
  day:   (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  week:  (d) => isoWeek(d),
  month: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
  year:  (d) => `${d.getFullYear()}`,
};

// --- Mốc 30 phút mặc định chỉ tính trong NGÀY HÔM NAY (trừ khi có --since/--until).
const explicitRange = Boolean(opts.since || opts.until);
const todayKey = keyers.day(new Date());
// Khi chỉ xem riêng 30 phút → giới hạn toàn bộ (kể cả tổng) về hôm nay.
if (opts.period === "30m" && !explicitRange) { opts.since = todayKey; opts.until = todayKey; }

// --- Đọc và cộng dồn
const periods = opts.period === "all" ? ["30m", "day", "week", "month", "year"] : [opts.period];
const buckets = Object.fromEntries(periods.map((p) => [p, new Map()]));
const grand = { in: 0, out: 0, cw: 0, cr: 0, cost: 0, msgs: 0 };
const models = new Set();

function emptyRow() { return { in: 0, out: 0, cw: 0, cr: 0, cost: 0, msgs: 0 }; }

const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
for (const f of files) {
  const lines = fs.readFileSync(path.join(projectDir, f), "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const u = o.message && o.message.usage;
    if (!u) continue;
    const iTok = u.input_tokens || 0, oTok = u.output_tokens || 0;
    const cw = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
    if (!(iTok || oTok || cw || cr)) continue;
    const d = new Date(o.timestamp);
    if (isNaN(d)) continue;
    const dayKey = keyers.day(d);
    if (opts.since && dayKey < opts.since) continue;
    if (opts.until && dayKey > opts.until) continue;

    const model = o.message.model || "unknown";
    models.add(model);
    const r = RATES[model] || RATES._default;
    const cost = (iTok * r.input + oTok * r.output + cw * r.cacheWrite + cr * r.cacheRead) / 1e6;

    for (const p of periods) {
      // Ở chế độ "all", bảng 30 phút chỉ hiển thị hôm nay (các mức khác vẫn đủ).
      if (p === "30m" && !explicitRange && dayKey !== todayKey) continue;
      const k = keyers[p](d);
      if (!buckets[p].has(k)) buckets[p].set(k, emptyRow());
      const row = buckets[p].get(k);
      row.in += iTok; row.out += oTok; row.cw += cw; row.cr += cr; row.cost += cost; row.msgs++;
    }
    grand.in += iTok; grand.out += oTok; grand.cw += cw; grand.cr += cr; grand.cost += cost; grand.msgs++;
  }
}

if (grand.msgs === 0) {
  console.log("Không tìm thấy dữ liệu sử dụng token trong khoảng đã chọn.");
  process.exit(0);
}

// --- Xuất kết quả
const nf = new Intl.NumberFormat("en-US");
const fmt = (n) => nf.format(n);
const total = (r) => r.in + r.out + r.cw + r.cr;

if (opts.json) {
  const out = { project: projectDir, models: [...models], grandTotal: { ...grand, total: total(grand) }, periods: {} };
  for (const p of periods) {
    out.periods[p] = [...buckets[p].entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, r]) => ({ period: k, ...r, total: total(r) }));
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const labels = { "30m": "30 PHÚT", day: "NGÀY", week: "TUẦN", month: "THÁNG", year: "NĂM" };
console.log(`\nDự án : ${projectDir}`);
console.log(`Model : ${[...models].join(", ")}`);
if (opts.cost) console.log(`(Chi phí là ƯỚC TÍNH theo bảng giá trong script — sửa RATES nếu cần)`);

for (const p of periods) {
  const rows = [...buckets[p].entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`\n=== Theo ${labels[p]} ===`);
  if (rows.length === 0) {
    console.log(p === "30m" ? "  (hôm nay chưa có dữ liệu)" : "  (không có dữ liệu)");
    continue;
  }
  const head = ["Kỳ", "Input", "Output", "Cache tạo", "Cache đọc", "Tổng", "Msgs"];
  if (opts.cost) head.push("Chi phí($)");
  const data = rows.map(([k, r]) => {
    const base = [k, fmt(r.in), fmt(r.out), fmt(r.cw), fmt(r.cr), fmt(total(r)), fmt(r.msgs)];
    if (opts.cost) base.push(r.cost.toFixed(2));
    return base;
  });
  printTable(head, data);
}

// Dòng tổng
console.log(`\n=== TỔNG CỘNG ===`);
const gRow = [fmt(grand.in), fmt(grand.out), fmt(grand.cw), fmt(grand.cr), fmt(total(grand)), fmt(grand.msgs)];
const gHead = ["Input", "Output", "Cache tạo", "Cache đọc", "Tổng", "Msgs"];
if (opts.cost) { gHead.push("Chi phí($)"); gRow.push(grand.cost.toFixed(2)); }
printTable(gHead, [gRow]);
console.log();

function printTable(head, rows) {
  const cols = head.length;
  const w = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    w[c] = head[c].length;
    for (const r of rows) w[c] = Math.max(w[c], String(r[c]).length);
  }
  const line = (cells, padStartFrom) =>
    cells.map((c, i) => (i >= padStartFrom ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join("  ");
  const padFrom = 1; // cột đầu canh trái, các cột số canh phải
  console.log(line(head, padFrom));
  console.log(w.map((x) => "-".repeat(x)).join("  "));
  for (const r of rows) console.log(line(r, padFrom));
}
