/*
 * School access codes
 * ------------------------------------------------------------
 * Leaders enter a school access code once; the server then sets a signed,
 * HttpOnly cookie for 30 days. Codes protect the checklist, starting a
 * workshop and the AI features. Staff joining a workshop never need one.
 *
 * Codes live in data/access.json, stored only as SHA-256 hashes. Manage them
 * with:  hwwd-access add "School name"  |  hwwd-access list  |  hwwd-access revoke <id>
 *
 * Access is required once any code has been created or the superadmin is set
 * up (so a fresh install is never locked out, and revoking every code never
 * re-opens the site). Set ACCESS_REQUIRED=0 in .env to switch it off entirely.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA = path.join(__dirname, "..", "data");
const FILE = path.join(DATA, "access.json");
const SECRET_FILE = path.join(DATA, "secret.key");
const COOKIE = "hwwd_access";
const MAX_AGE = 30 * 24 * 3600; // seconds
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let cache = null, cacheMtime = 0;
let adminCheck = () => null; // set by server.js: a signed-in superadmin can use everything

function load() {
  try {
    const m = fs.statSync(FILE).mtimeMs;
    if (!cache || m !== cacheMtime) { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); cacheMtime = m; }
  } catch (e) { cache = { codes: [] }; cacheMtime = 0; }
  if (!Array.isArray(cache.codes)) cache.codes = [];
  return cache;
}
function save(db) {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  cache = db; cacheMtime = fs.statSync(FILE).mtimeMs;
}
function secret() {
  try { return fs.readFileSync(SECRET_FILE); } catch (e) {}
  fs.mkdirSync(DATA, { recursive: true });
  const s = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
  return s;
}

const norm = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hash = c => crypto.createHash("sha256").update(norm(c)).digest("hex");
const sign = v => crypto.createHmac("sha256", secret()).update(v).digest("base64url");

/** Codes are required once any code has ever been created or the superadmin is set up.
 *  Revoking every code never re-opens the site; only ACCESS_REQUIRED=0 does. */
function required() {
  if (process.env.ACCESS_REQUIRED === "0") return false;
  return load().codes.length > 0 || fs.existsSync(path.join(DATA, "admin.json"));
}

/* ---------- code management (used by scripts/access.js) ---------- */
function newCode() {
  const b = crypto.randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += CHARS[b[i] % CHARS.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
function add(name, days, extra) {
  const db = load();
  const code = newCode();
  const x = extra || {};
  const entry = { id: crypto.randomBytes(4).toString("hex"), name: String(name || "School").slice(0, 120), hash: hash(code), createdAt: new Date().toISOString() };
  if (x.email) entry.email = String(x.email).slice(0, 200);
  if (x.notes) entry.notes = String(x.notes).slice(0, 500);
  if (days) entry.expiresAt = new Date(Date.now() + days * 864e5).toISOString();
  if (x.expiresAt) entry.expiresAt = x.expiresAt;
  if (x.billing) Object.assign(entry, x.billing);   // tier, contact, urn, trialEndsAt… (see lib/billing.js)
  db.codes.push(entry); save(db);
  return { ...entry, code };
}
const pub = ({ hash: _h, altHashes: _a, ...c }) => c;
function list() { return load().codes.map(pub); }
/** Change one code. fn works on a copy, so if it throws nothing is changed. */
function update(id, fn) {
  const db = load(); const i = db.codes.findIndex(x => x.id === id);
  if (i < 0) return null;
  const c = JSON.parse(JSON.stringify(db.codes[i]));
  fn(c);
  db.codes[i] = c; save(db);
  return pub(c);
}
const matches = (c, h) => c.hash === h || (Array.isArray(c.altHashes) && c.altHashes.includes(h));
/** The code entry for a typed code, whether or not it has expired (null if unknown). */
function lookup(code) { const h = hash(code); const c = load().codes.find(x => matches(x, h)); return c ? pub(c) : null; }
/** A fresh code for an existing school (lost code). The old code keeps working, so colleagues aren't locked out. */
function addCode(id) {
  const code = newCode();
  let added = false;
  // Extra codes are never retired silently; after 10, the school asks support instead
  const ok = update(id, c => { const a = c.altHashes || []; if (a.length < 10) { c.altHashes = [...a, hash(code)]; added = true; } });
  return ok && added ? code : null;
}
/** Delete a school's code record completely (the school can no longer sign in, and its details are gone). */
function remove(id) {
  const db = load(), n = db.codes.length;
  db.codes = db.codes.filter(c => c.id !== id);
  if (db.codes.length === n) return false;
  save(db); return true;
}
function reactivate(id) { return update(id, c => { delete c.revoked; }); }
function extend(id, days) {
  return update(id, c => {
    const base = Math.max(Date.now(), c.expiresAt ? Date.parse(c.expiresAt) : Date.now());
    if (!days) delete c.expiresAt; else c.expiresAt = new Date(base + days * 864e5).toISOString();
  });
}
function revoke(idOrName) {
  const db = load(); let n = 0;
  db.codes.forEach(c => { if (!c.revoked && (c.id === idOrName || c.name.toLowerCase() === String(idOrName).toLowerCase())) { c.revoked = new Date().toISOString(); n++; } });
  save(db); return n;
}

/* ---------- request handling ---------- */
function active(id) {
  const c = load().codes.find(x => x.id === id);
  if (!c || c.revoked) return null;
  if (c.expiresAt && Date.parse(c.expiresAt) < Date.now()) return null;
  return c;
}
function readCookie(req) {
  const m = String(req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const expect = sign(payload);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return active(data.id) ? data : null;
  } catch (e) { return null; }
}
/** The school this request is signed in as, or null. Always "open" when access isn't required. */
function who(req) {
  if (adminCheck(req)) return { id: "admin", name: "Evalu8 Compass admin", admin: true };
  if (!required()) return { open: true, name: "" };
  const d = readCookie(req);
  if (!d) return null;
  const c = active(d.id);
  return c ? { id: c.id, name: c.name } : null;
}
function isHttps(req) { return req.headers["x-forwarded-proto"] === "https" || !!req.socket.encrypted; }
function cookieHeader(req, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
}

/** POST /api/access {code} → sets cookie. Returns {ok, school} or throws {status, message}. */
function login(req, res, code) {
  const h = hash(code);
  const c = load().codes.find(x => matches(x, h) && !x.revoked && !(x.expiresAt && Date.parse(x.expiresAt) < Date.now()));
  if (!c) return null;
  const payload = Buffer.from(JSON.stringify({ id: c.id, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  res.setHeader("set-cookie", cookieHeader(req, `${payload}.${sign(payload)}`, MAX_AGE));
  const db = load(); const e = db.codes.find(x => x.id === c.id); e.lastUsedAt = new Date().toISOString(); save(db);
  return { id: c.id, name: c.name };
}
function logout(req, res) { res.setHeader("set-cookie", cookieHeader(req, "", 0)); }

/** Remove contact details from codes whose access ended more than `days` ago (retention). */
function scrubEnded(days) {
  const db = load(), cutoff = Date.now() - days * 864e5; let n = 0;
  for (const c of db.codes) {
    const ended = c.revoked || (c.expiresAt && Date.parse(c.expiresAt) < Date.now() ? c.expiresAt : null);
    if (ended && Date.parse(ended) < cutoff && (c.email || c.notes || c.contact || (c.sub && c.sub.billing))) {
      delete c.email; delete c.notes; delete c.contact;
      for (const s of [c.sub, ...(c.history || [])]) if (s && s.billing) delete s.billing;   // invoices themselves are kept in data/invoices.jsonl
      n++;
    }
  }
  if (n) save(db);
  return n;
}

module.exports = { scrubEnded, required, who, login, logout, add, list, update, lookup, addCode, remove, revoke, reactivate, extend, norm, sign, isHttps, setAdminCheck: fn => { adminCheck = fn; } };
