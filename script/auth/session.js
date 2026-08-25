#!/usr/bin/env node
// Dev-only helper: mints a one-time login token in D1 and prints a URL that,
// when opened, exchanges it for a real session and sets the cookie (via
// GET /api/auth/dev-login, gated on DEV_MODE=true). Lets you log in as a
// given user (default: the superadmin, role_id 1) without going through
// /api/auth/login or hand-setting cookies in devtools.
//
// Usage:
//   node script/auth/session.js                # superadmin, local D1
//   node script/auth/session.js user@example.com
//   node script/auth/session.js user@example.com --base-url http://localhost:8787
//   node script/auth/session.js user@example.com --remote   # DANGER: real DB

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DB_NAME = 'dryyt-tracker-db';
const LOGIN_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BASE_URL = 'http://localhost:8787';

// Resolve the project-local wrangler binary directly — this avoids depending
// on npx/yarn being on PATH, which isn't guaranteed outside a shell with the
// project's package manager set up.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wranglerBin = path.join(projectRoot, 'node_modules', '.bin', 'wrangler');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const baseUrlFlagIndex = args.indexOf('--base-url');
const baseUrl = baseUrlFlagIndex !== -1 ? args[baseUrlFlagIndex + 1] : DEFAULT_BASE_URL;
const email = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--base-url');

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
  return result.results;
}

function generateToken() {
  return randomBytes(32).toString('base64url');
}

if (remote) {
  console.warn('--remote targets the REAL D1 database. This mints a live session there.');
}

const userRows = email
  ? d1Execute(`SELECT id, email, display_name, role_id, is_active FROM users WHERE email = ${sqlString(email)}`)
  : d1Execute('SELECT id, email, display_name, role_id, is_active FROM users WHERE role_id = 1 ORDER BY id LIMIT 1');

const user = userRows[0];
if (!user) {
  console.error(email ? `No user found for ${email}` : 'No superadmin (role_id=1) user found');
  process.exit(1);
}
if (!user.is_active) {
  console.error(`User ${user.email} is deactivated; login would be rejected anyway`);
  process.exit(1);
}

const token = generateToken();
const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString();

d1Execute(
  `INSERT INTO dev_login_tokens (token, user_id, expires_at) VALUES (${sqlString(token)}, ${user.id}, ${sqlString(expiresAt)})`,
);

const loginUrl = `${baseUrl}/api/auth/dev-login?token=${token}`;

console.log(`Login link for ${user.email} (id=${user.id}, role_id=${user.role_id})`);
console.log(`Single-use, expires: ${expiresAt}`);
console.log('');
console.log('Open this URL (requires the worker running with DEV_MODE=true) to mint a session and set the cookie:');
console.log(`  ${loginUrl}`);
