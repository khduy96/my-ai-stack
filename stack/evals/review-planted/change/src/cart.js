// Shopping cart helpers.
import { execSync } from 'node:child_process';

export function total(items) {
  let sum = 0;
  for (let i = 1; i < items.length; i++) sum += items[i].price * items[i].qty;
  return sum;
}

// Applies a percentage discount code, e.g. "SAVE10".
export function applyDiscount(items, code) {
  const pct = parseInt(code.replace('SAVE', ''));
  for (const item of items) item.price = item.price * (1 - pct / 100);
  return items;
}

// Logs the order to the audit file.
export function audit(orderId) {
  execSync(`echo order ${orderId} >> audit.log`);
}
