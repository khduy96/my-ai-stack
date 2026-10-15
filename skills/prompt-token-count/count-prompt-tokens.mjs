#!/usr/bin/env node
// Đếm số token của một prompt / đoạn văn bản.
//
// Ưu tiên gọi Anthropic Token Counting API (chính xác, miễn phí) khi có
// ANTHROPIC_API_KEY. Nếu không có key hoặc gọi API lỗi → dùng ước lượng cục bộ.
//
// Cách dùng:
//   node count-prompt-tokens.mjs --text="nội dung prompt"
//   node count-prompt-tokens.mjs --file=prompt.txt
//   echo "nội dung" | node count-prompt-tokens.mjs
// Tuỳ chọn:
//   --text=<chuỗi>        Prompt truyền trực tiếp
//   --file=<đường dẫn>    Đọc prompt từ file
//   --system=<chuỗi>      Nội dung system prompt (tính gộp vào tổng)
//   --model=<id>          Model dùng để đếm (mặc định: claude-opus-4-8)
//   --offline             Bỏ qua API, chỉ ước lượng cục bộ
//   --json                In kết quả dạng JSON
// (Không có --text/--file → đọc từ stdin.)

import fs from "node:fs";

// --- Phân tích tham số
const args = process.argv.slice(2);
const opts = { text: null, file: null, system: null, model: "claude-opus-4-8", offline: false, json: false };
for (const a of args) {
  if (a === "--offline") opts.offline = true;
  else if (a === "--json") opts.json = true;
  else if (a.startsWith("--text=")) opts.text = a.slice(7);
  else if (a.startsWith("--file=")) opts.file = a.slice(7);
  else if (a.startsWith("--system=")) opts.system = a.slice(9);
  else if (a.startsWith("--model=")) opts.model = a.slice(8);
}

// --- Lấy nội dung prompt
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

let text = opts.text;
if (text == null && opts.file) {
  if (!fs.existsSync(opts.file)) { console.error(`Không tìm thấy file: ${opts.file}`); process.exit(1); }
  text = fs.readFileSync(opts.file, "utf8");
}
if (text == null) text = await readStdin();
text = text ?? "";

if (!text.trim() && !opts.system) {
  console.error("Không có nội dung để đếm. Dùng --text=, --file=, hoặc truyền qua stdin.");
  process.exit(1);
}

// --- Ước lượng cục bộ (không cần mạng).
// Heuristic: trung bình ~3.8 ký tự / token cho văn bản hỗn hợp; cộng thêm phần
// khoảng trắng/câu. Đây chỉ là ƯỚC LƯỢNG, sai số thường trong khoảng ±10-15%.
function estimateTokens(s) {
  if (!s) return 0;
  const chars = s.length;
  const words = (s.match(/\S+/g) || []).length;
  // Kết hợp hai cách tính rồi lấy trung bình có trọng số.
  const byChars = chars / 3.8;
  const byWords = words * 1.3;
  return Math.max(1, Math.round(byChars * 0.5 + byWords * 0.5));
}

// --- Gọi Anthropic Token Counting API
async function countViaApi(userText, systemText, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const body = { model, messages: [{ role: "user", content: userText || " " }] };
  if (systemText) body.system = systemText;
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.input_tokens;
}

// --- Chạy
const nf = new Intl.NumberFormat("en-US");
const combinedChars = (text || "").length + (opts.system || "").length;

let apiTokens = null, apiError = null;
if (!opts.offline) {
  try { apiTokens = await countViaApi(text, opts.system, opts.model); }
  catch (e) { apiError = e.message; }
}

const estTokens = estimateTokens((opts.system ? opts.system + "\n" : "") + text);
const tokens = apiTokens != null ? apiTokens : estTokens;
const method = apiTokens != null ? "api" : "estimate";

if (opts.json) {
  console.log(JSON.stringify({
    tokens, method, model: opts.model,
    chars: combinedChars,
    estimate: estTokens,
    apiTokens, apiError,
  }, null, 2));
  process.exit(0);
}

console.log(`\nModel     : ${opts.model}`);
console.log(`Ký tự     : ${nf.format(combinedChars)}`);
if (apiTokens != null) {
  console.log(`Token     : ${nf.format(apiTokens)}  (chính xác — Anthropic API)`);
  console.log(`Ước lượng : ${nf.format(estTokens)}  (offline, để so sánh)`);
} else {
  console.log(`Token     : ~${nf.format(estTokens)}  (ƯỚC LƯỢNG cục bộ)`);
  if (apiError) console.log(`Lưu ý     : Gọi API thất bại (${apiError}).`);
  else if (!opts.offline) console.log(`Lưu ý     : Chưa đặt ANTHROPIC_API_KEY → dùng ước lượng. Đặt key để có số chính xác.`);
}
console.log();