/*
 * Superadmin (developer) access
 * ------------------------------------------------------------
 * One superadmin account protected by a password AND a 6-digit code from an
 * authenticator app (TOTP, RFC 6238). Set it up on the server with:
 *     hwwd-access admin
 * Signing in at /admin.html gives an 8-hour, HttpOnly, SameSite=Strict cookie.
 * Every admin action is appended to data/audit.log.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const access = require("./access");

const DATA = path.join(__dirname, "..", "data");
const FILE = path.join(DATA, "admin.json");
const AUDIT = path.join(DATA, "audit.log");
const COOKIE = "hwwd_admin";
const MAX_AGE = 8 * 3600;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let lastCounter = 0;

function read() { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return null; } }
function configured() { const a = read(); return !!(a && a.passHash && a.totpSecret); }

/* ---------- password ---------- */
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex"); }

/* ---------- TOTP ---------- */
function b32encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
function verifyTotp(secret, code) {
  const c = String(code || "").replace(/\D/g, "");
  if (c.length !== 6) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const w of [-1, 0, 1]) {
    const counter = now + w;
    if (counter > lastCounter && crypto.timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(c))) { lastCounter = counter; return true; }
  }
  return false;
}

/** Creates or replaces the superadmin. Returns the authenticator secret and setup URI. */
function setup(password) {
  if (String(password).length < 12) throw new Error("Use a password of at least 12 characters.");
  const salt = crypto.randomBytes(16).toString("hex");
  const totpSecret = b32encode(crypto.randomBytes(20));
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ passHash: hashPassword(password, salt), salt, totpSecret, createdAt: new Date().toISOString() }, null, 1), { mode: 0o600 });
  audit("admin.setup", "Superadmin password and authenticator set", null);
  return { secret: totpSecret, uri: `otpauth://totp/Evalu8%20Compass:superadmin?secret=${totpSecret}&issuer=Evalu8%20Compass&digits=6&period=30` };
}

/* ---------- sessions ---------- */
function who(req) {
  const m = String(req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m || !configured()) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const expect = access.sign(payload);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    const a = read();
    // Changing the password (re-running setup) signs every existing session out
    return d.role === "admin" && d.exp > Date.now() / 1000 && d.v === a.createdAt ? { admin: true } : null;
  } catch (e) { return null; }
}
function cookie(req, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${access.isHttps(req) ? "; Secure" : ""}`;
}
function login(req, res, password, code) {
  const a = read();
  if (!a) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(hashPassword(password, a.salt), "hex"), Buffer.from(a.passHash, "hex")) && verifyTotp(a.totpSecret, code);
  if (!ok) { audit("admin.login_failed", "", req); return false; }
  const payload = Buffer.from(JSON.stringify({ role: "admin", v: a.createdAt, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  res.setHeader("set-cookie", cookie(req, `${payload}.${access.sign(payload)}`, MAX_AGE));
  audit("admin.login", "", req);
  return true;
}
function logout(req, res) { res.setHeader("set-cookie", cookie(req, "", 0)); audit("admin.logout", "", req); }

/* ---------- audit log ---------- */
function ipOf(req) {
  if (!req) return "server";
  return (process.env.TRUST_PROXY === "1" && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
}
function audit(action, detail, req) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), action, detail: String(detail || "").slice(0, 300), ip: ipOf(req) }) + "\n", { mode: 0o600 });
  } catch (e) {}
}
function recentAudit(n) {
  try {
    const lines = fs.readFileSync(AUDIT, "utf8").trim().split("\n");
    return lines.slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
/** Keep the audit log to the last `days` days (it holds IP addresses). */
function trimAudit(days) {
  try {
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    const lines = fs.readFileSync(AUDIT, "utf8").split("\n").filter(Boolean);
    const keep = lines.filter(l => { try { return JSON.parse(l).at >= cutoff; } catch (e) { return false; } });
    if (keep.length !== lines.length) { const tmp = AUDIT + ".tmp"; fs.writeFileSync(tmp, keep.join("\n") + (keep.length ? "\n" : ""), { mode: 0o600 }); fs.renameSync(tmp, AUDIT); }
  } catch (e) {}
}

module.exports = { configured, setup, who, login, logout, audit, recentAudit, trimAudit, totp, _verify: verifyTotp };
