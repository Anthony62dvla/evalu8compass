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
 * Access is required once at least one code exists (so a fresh install is
 * never locked out). Set ACCESS_REQUIRED=0 in .env to switch it off entirely.
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

function required() {
  if (process.env.ACCESS_REQUIRED === "0") return false;
  return load().codes.some(c => !c.revoked);
}

/* ---------- code management (used by scripts/access.js) ---------- */
function newCode() {
  const b = crypto.randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += CHARS[b[i] % CHARS.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
function add(name, days) {
  const db = load();
  const code = newCode();
  const entry = { id: crypto.randomBytes(4).toString("hex"), name: String(name || "School").slice(0, 120), hash: hash(code), createdAt: new Date().toISOString() };
  if (days) entry.expiresAt = new Date(Date.now() + days * 864e5).toISOString();
  db.codes.push(entry); save(db);
  return { ...entry, code };
}
function list() { return load().codes.map(({ hash: _h, ...c }) => c); }
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
  const c = load().codes.find(x => x.hash === h && !x.revoked && !(x.expiresAt && Date.parse(x.expiresAt) < Date.now()));
  if (!c) return null;
  const payload = Buffer.from(JSON.stringify({ id: c.id, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  res.setHeader("set-cookie", cookieHeader(req, `${payload}.${sign(payload)}`, MAX_AGE));
  const db = load(); const e = db.codes.find(x => x.id === c.id); e.lastUsedAt = new Date().toISOString(); save(db);
  return { id: c.id, name: c.name };
}
function logout(req, res) { res.setHeader("set-cookie", cookieHeader(req, "", 0)); }

module.exports = { required, who, login, logout, add, list, revoke, norm };
