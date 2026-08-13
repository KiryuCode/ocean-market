#!/usr/bin/env node
/**
 * Hash an admin password with bcrypt for ADMIN_PASSWORD_HASH in .env.
 *
 *   npm run admin:hash -- 'your-password'
 *   node scripts/hash-admin-password.js 'your-password'
 */

const bcrypt = require("bcryptjs");

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run admin:hash -- '<password>'");
  process.exit(1);
}

const rounds = 12;
const hash = bcrypt.hashSync(password, rounds);
console.log(hash);
console.log("");
console.log("Add this to .env (and remove ADMIN_PASSWORD):");
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
