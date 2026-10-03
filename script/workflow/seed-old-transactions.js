#!/usr/bin/env node
// Dev-only helper: inserts dummy workflow transactions created more than
// 3 months ago (91–365 days back), to exercise the admin console's
// "older than 3 months" warning and Delete button. No photos are attached.
//
// Usage:
//   node script/workflow/seed-old-transactions.js                     # 5 rows, first active owner, local D1
//   node script/workflow/seed-old-transactions.js --count 20
//   node script/workflow/seed-old-transactions.js --owner owner@example.com
//   node script/workflow/seed-old-transactions.js --remote --yes      # DANGER: real DB

import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DB_NAME = 'dryyt-tracker-db';
// Same alphabet/length as plugins/workflow/backend/code.ts.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const STATUSES = ['hold', 'in_progress', 'done', 'ready_to_pickup', 'end'];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wranglerBin = path.join(projectRoot, 'node_modules', '.bin', 'wrangler');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const remote = args.includes('--remote');
const count = Number(flag('--count') ?? 5);
const ownerEmail = flag('--owner');

if (!Number.isInteger(count) || count < 1 || count > 500) {
  console.error('--count must be an integer from 1 to 500');
  process.exit(1);
}
if (remote && !args.includes('--yes')) {
  console.error('--remote writes dummy rows to the REAL D1 database. Re-run with --yes to confirm.');
  process.exit(1);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function d1Execute(sql) {
  const out = execFileSync(
    wranglerBin,
    ['d1', 'execute', DB_NAME, remote ? '--remote' : '--local', '--json', '--command', sql],
    { encoding: 'utf8', cwd: projectRoot },
  );
  const [result] = JSON.parse(out);
  if (!result.success) throw new Error(`D1 query failed: ${JSON.stringify(result)}`);
  return result;
}

function generateCode() {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

const owner = d1Execute(
  ownerEmail
    ? `SELECT u.id, u.email FROM users u WHERE u.email = ${sqlString(ownerEmail.toLowerCase())}`
    : `SELECT u.id, u.email FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'owner' AND u.is_active = 1 ORDER BY u.id LIMIT 1`,
).results[0];
if (!owner) {
  console.error(ownerEmail ? `No user found for ${ownerEmail}` : 'No active owner found — pass --owner <email>');
  process.exit(1);
}

const rows = Array.from({ length: count }, (_, i) => {
  const daysAgo = randomInt(91, 366);
  const status = STATUSES[randomInt(STATUSES.length)];
  const created = `datetime('now', '-${daysAgo} days')`;
  const doneAt = ['done', 'ready_to_pickup', 'end'].includes(status) ? `datetime('now', '-${daysAgo - 1} days')` : 'NULL';
  return `(${sqlString(generateCode())}, ${sqlString(`Dummy customer ${i + 1}`)}, ${sqlString(
    '<p>Dummy transaction (seed-old-transactions)</p>',
  )}, ${sqlString(status)}, ${owner.id}, ${created}, ${created}, ${doneAt})`;
});

// OR IGNORE: a code that collides with an existing one is just skipped.
const result = d1Execute(
  `INSERT OR IGNORE INTO workflow_transactions
     (code, customer_name, description, status, created_by, created_at, updated_at, done_at)
   VALUES ${rows.join(',\n')}
   RETURNING id`,
);

console.log(`Inserted ${result.results.length} of ${count} dummy transaction(s) for ${owner.email} (id=${owner.id}),`);
console.log(`created 91–365 days ago, in the ${remote ? 'REMOTE' : 'local'} D1 database.`);
