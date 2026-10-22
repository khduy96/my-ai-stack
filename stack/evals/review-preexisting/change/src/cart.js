// Shopping cart helpers.
import { execSync } from 'node:child_process';

export function total(items) {
  let sum = 0;
  for (const item of items) sum += item.price * item.qty;
  return sum;
}

// Total quantity of all items in the cart.
export function itemCount(items) {
  let count = 0;
  for (const item of items) count += item.qty;
  return count;
}

// Logs the order to the audit file.
export function audit(orderId) {
  execSync(`echo order ${orderId} >> audit.log`);
}
