// Run by `stack eval` as: node check.mjs <repo>. Exit code 0 = the bug is fixed.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { total } = await import(pathToFileURL(path.join(process.argv[2], 'src', 'cart.js')).href);
const cases = [
  [[], 0],
  [[{ price: 500, qty: 2 }], 1000],
  [[{ price: 500, qty: 2 }, { price: 100, qty: 1 }], 1100],
];
for (const [items, want] of cases) {
  const got = total(items);
  if (got !== want) {
    console.log(`total(${JSON.stringify(items)}) = ${got}, expected ${want}`);
    process.exit(1);
  }
}
console.log('total() correct for 0, 1 and 2 items');
