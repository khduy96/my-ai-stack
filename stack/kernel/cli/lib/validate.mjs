// JSON Schema validation against kernel/contracts/*.schema.json.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Ajv2019 from 'ajv/dist/2019.js';
import { CONTRACTS_DIR } from './kernel.mjs';

const ID_BASE = 'https://ai-stack.local/contracts/';

let ajv = null;
const contracts = new Map();

function load() {
  if (ajv) return;
  ajv = new Ajv2019({ allErrors: true, strict: false });
  for (const file of readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.schema.json'))) {
    const schema = JSON.parse(readFileSync(path.join(CONTRACTS_DIR, file), 'utf8'));
    contracts.set(file.replace('.schema.json', ''), schema);
    ajv.addSchema(schema);
  }
}

export function getContract(name) {
  load();
  return contracts.get(name) ?? null;
}

function describe(err) {
  const where = err.instancePath ? err.instancePath.slice(1).replaceAll('/', '.') : '(root)';
  const p = err.params ?? {};
  if (p.unevaluatedProperty) return `${where}: unknown field "${p.unevaluatedProperty}"`;
  if (p.additionalProperty) return `${where}: unknown field "${p.additionalProperty}"`;
  if (p.allowedValues) return `${where}: must be one of ${p.allowedValues.join(', ')}`;
  if (err.keyword === 'false schema') return `${where}: not allowed here`;
  return `${where}: ${err.message}`;
}

// Reports every violation; returns true when `data` is valid.
export function validate(name, data, file, diags) {
  load();
  const fn = ajv.getSchema(`${ID_BASE}${name}.schema.json`);
  if (!fn) throw new Error(`unknown contract "${name}"`);
  if (fn(data)) return true;
  // allOf/$ref failures repeat the same message; report each once. An if/then/else
  // failure only wraps the errors of the branch, which are reported themselves.
  for (const message of new Set(fn.errors.filter((e) => e.keyword !== 'if').map(describe))) {
    diags.error('schema-invalid', `${name} ${message}`, file);
  }
  return false;
}

// Top-level keys the schema does not know about (forward-compatible configs).
export function unknownKeys(name, data) {
  const props = getContract(name)?.properties ?? {};
  return Object.keys(data ?? {}).filter((k) => !(k in props));
}
