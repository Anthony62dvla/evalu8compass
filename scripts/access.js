#!/usr/bin/env node
/*
 * Manage school access codes.
 *   node scripts/access.js add "Athena School" [--days 365]
 *   node scripts/access.js list
 *   node scripts/access.js revoke <id or school name>
 * On the server use the wrapper:  hwwd-access add "Athena School"
 */
const access = require("../lib/access");
const [cmd, ...args] = process.argv.slice(2);

function help() {
  console.log(`School access codes
  add "School name" [--days N]   create a code (shown once; give it to the school)
  list                           show all codes (codes themselves are never stored)
  revoke <id or name>            stop a code working straight away`);
}

if (cmd === "add") {
  const di = args.indexOf("--days");
  const days = di >= 0 ? Number(args[di + 1]) : 0;
  const name = args.filter((a, i) => di < 0 || (i !== di && i !== di + 1)).join(" ").trim();
  if (!name) { console.error('Give the school name, e.g.  add "Athena School"'); process.exit(1); }
  const c = access.add(name, days);
  console.log(`\nAccess code for ${c.name}:\n\n    ${c.code}\n\nGive this to the school's leaders. It's shown only once.${c.expiresAt ? `\nExpires ${c.expiresAt.slice(0, 10)}.` : ""}\n`);
} else if (cmd === "list") {
  const rows = access.list();
  if (!rows.length) console.log("No access codes yet. The site is open to everyone until you add one.");
  for (const c of rows) {
    const state = c.revoked ? "revoked" : c.expiresAt && Date.parse(c.expiresAt) < Date.now() ? "expired" : "active";
    console.log(`${c.id}  ${state.padEnd(8)} ${c.name.padEnd(32)} created ${c.createdAt.slice(0, 10)}  last used ${c.lastUsedAt ? c.lastUsedAt.slice(0, 10) : "never"}`);
  }
  console.log(access.required() ? "\nAccess codes are required." : "\nAccess codes are NOT required (no active codes, or ACCESS_REQUIRED=0).");
} else if (cmd === "revoke") {
  const n = access.revoke(args.join(" "));
  console.log(n ? `Revoked ${n} code(s).` : "No active code matched.");
} else help();
