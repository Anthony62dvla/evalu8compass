/*
 * Workshop session storage — one JSON file per session in data/sessions/.
 * Zero dependencies and fine for one server. To scale to several servers,
 * replace get/save/list with a database (Postgres, Supabase, etc.).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "..", "data", "sessions");
const RETENTION_DAYS = Number(process.env.SESSION_RETENTION_DAYS || 90);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const cache = new Map();
const timers = new Map();

fs.mkdirSync(DIR, { recursive: true });

function fileFor(code) {
  if (!/^[A-Z0-9]{6}$/.test(code)) return null;
  return path.join(DIR, code + ".json");
}

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = "";
    const bytes = crypto.randomBytes(6);
    for (const b of bytes) c += CODE_CHARS[b % CODE_CHARS.length];
    if (!cache.has(c) && !fs.existsSync(fileFor(c))) return c;
  }
  throw new Error("Could not create a unique code");
}

const token = (n = 16) => crypto.randomBytes(n).toString("hex");

function get(code) {
  code = String(code || "").toUpperCase();
  if (cache.has(code)) return cache.get(code);
  const f = fileFor(code);
  if (!f || !fs.existsSync(f)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    cache.set(code, s);
    return s;
  } catch (e) { return null; }
}

/** Saves soon (debounced) so a burst of responses becomes one disk write. */
function save(session, immediate = false) {
  session.updatedAt = new Date().toISOString();
  cache.set(session.code, session);
  clearTimeout(timers.get(session.code));
  const write = () => {
    const f = fileFor(session.code), tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(session));
    fs.renameSync(tmp, f);
  };
  if (immediate) return write();
  timers.set(session.code, setTimeout(write, 400));
}

function create({ profile, areaIds, createdBy }) {
  const code = newCode();
  const now = new Date().toISOString();
  const session = {
    code, createdAt: now, updatedAt: now,
    facilitatorKey: token(),
    createdBy: createdBy || null, // access code id of the school that started it
    profile, areaIds,
    status: "open",             // open | closed (no more responses)
    share: { results: false, plan: false },
    participants: {},           // pid -> { role, joinedAt, tokenHash }
    responses: {},              // pid -> { itemId: { s, c } }
    agreed: {},                 // itemId -> { s, note }
    context: { text: "" },
    report: null,               // AI reading of the Ofsted report
    themes: null,               // AI summary of staff comments
    plan: null,                 // AI improvement plan
  };
  save(session, true);
  return session;
}

function cleanup() {
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".json")) continue;
    const p = path.join(DIR, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (e) {}
  }
}
cleanup();
setInterval(cleanup, 24 * 3600e3).unref();

function flushAll() {
  for (const [code, t] of timers) { clearTimeout(t); const s = cache.get(code); if (s) save(s, true); }
}

const hash = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Light summary of every stored workshop, for the admin console. */
function summaries() {
  const out = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = cache.get(f.slice(0, 6)) || JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      out.push({ code: s.code, createdBy: s.createdBy || null, school: s.profile && s.profile.name, createdAt: s.createdAt, updatedAt: s.updatedAt, participants: Object.keys(s.participants || {}).length });
    } catch (e) {}
  }
  return out;
}

module.exports = { get, save, create, token, hash, safeEqual, flushAll, summaries };
