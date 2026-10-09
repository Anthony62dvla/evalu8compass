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
  revoke <id or name>            stop a code working straight away
  admin                          set up (or reset) the superadmin password and authenticator`);
}

/** Reads a line without echoing it (for passwords). */
function hidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("Run this in an interactive terminal."));
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let value = "";
    const onData = ch => {
      if (ch === "\u0003") { process.stdout.write("\n"); process.exit(1); }
      if (ch === "\r" || ch === "\n" || ch === "\u0004") { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); process.stdout.write("\n"); return resolve(value); }
      if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); return; }
      value += ch;
    };
    stdin.on("data", onData);
  });
}

async function adminSetup() {
  const admin = require("../lib/admin");
  if (admin.configured()) console.log("A superadmin already exists. Continuing will replace the password and authenticator, and sign out any admin sessions.\n");
  const a = await hidden("New superadmin password (12+ characters): ");
  if (a.length < 12) { console.error("Too short. Use at least 12 characters (a passphrase of 3-4 words works well)."); process.exit(1); }
  const b = await hidden("Type it again: ");
  if (a !== b) { console.error("The passwords didn't match. Nothing has changed."); process.exit(1); }
  const r = admin.setup(a);
  console.log(`
Superadmin set up.

1. Open your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, etc.)
2. Add an account by entering this key manually:

      ${r.secret.replace(/(.{4})/g, "$1 ").trim()}

   Account: Evalu8 Compass superadmin · Type: time-based

   (Or paste this into an app that accepts setup links: ${r.uri})

3. Sign in at https://<your domain>/admin.html with the password and the 6-digit code from the app.

Keep the key somewhere safe. If you lose your phone, run "hwwd-access admin" again on the server.
`);
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
  console.log(access.required() ? "\nAccess codes are required." : "\nAccess codes are NOT required (none created yet, or ACCESS_REQUIRED=0).");
} else if (cmd === "revoke") {
  const n = access.revoke(args.join(" "));
  console.log(n ? `Revoked ${n} code(s).` : "No active code matched.");
} else if (cmd === "admin") {
  adminSetup().catch(e => { console.error(e.message); process.exit(1); });
} else help();
