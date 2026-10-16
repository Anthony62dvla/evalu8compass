/*
 * Trusts and groups: a trust's leaders see a comparison of the schools that have agreed to share.
 * ------------------------------------------------------------
 * The superadmin creates a trust, adds its leaders (name, email, role) and asks to link schools.
 * Nothing is shared until a school's head (or deputy) confirms. A school can stop sharing at any time.
 * Trust leaders sign in with an emailed code (see lib/logins.js) and see summaries only: never
 * evidence notes, monitoring findings or anything about individual pupils.
 *
 * data/trusts.json: { trusts: [{ id, name, createdAt, members: [{ id, name, email, role }],
 *                                schools: [{ id, status: "pending"|"linked", requestedAt, confirmedAt, confirmedBy }] }] }
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const access = require("./access");

const FILE = path.join(__dirname, "..", "data", "trusts.json");
const COOKIE = "hwwd_trust";
const MAX_AGE = 30 * 24 * 3600;
class TrustError extends Error { constructor(status, message) { super(message); this.status = status; } }
const validEmail = e => /^[^@\s<>"(),;:]+@[^@\s<>"(),;:]+\.[a-z]{2,}$/i.test(String(e || "").trim());
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const ROLES = { ceo: "Chief executive", director: "Director of education", improvement: "School improvement lead", governance: "Governance lead", trustee: "Trustee", other: "Other" };

let cache = null, mtime = 0;
function load() {
  try { const m = fs.statSync(FILE).mtimeMs; if (!cache || m !== mtime) { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); mtime = m; } }
  catch (e) { cache = { trusts: [] }; mtime = 0; }
  if (!Array.isArray(cache.trusts)) cache.trusts = [];
  return cache;
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 }); fs.renameSync(tmp, FILE);
  cache = db; mtime = fs.statSync(FILE).mtimeMs;
}
const id = n => crypto.randomBytes(n || 5).toString("hex");
function update(tid, fn) {
  const db = load(), t = db.trusts.find(x => x.id === tid);
  if (!t) throw new TrustError(404, "No trust with that id.");
  const out = fn(t); save(db); return out === undefined ? t : out;
}

/* ---------- superadmin ---------- */
function list() { return load().trusts; }
function get(tid) { return load().trusts.find(x => x.id === tid) || null; }
function create(name) {
  const n = clip(name, 120); if (n.length < 3) throw new TrustError(400, "Enter the trust's name.");
  const db = load(); const t = { id: id(4), name: n, createdAt: new Date().toISOString(), members: [], schools: [] };
  db.trusts.push(t); save(db); return t;
}
function rename(tid, name) { const n = clip(name, 120); if (n.length < 3) throw new TrustError(400, "Enter the trust's name."); return update(tid, t => { t.name = n; }); }
function remove(tid) { const db = load(), n = db.trusts.length; db.trusts = db.trusts.filter(t => t.id !== tid); if (db.trusts.length === n) throw new TrustError(404, "No trust with that id."); save(db); return true; }
function addMember(tid, b) {
  const name = clip(b.name, 100), email = clip(b.email, 200).toLowerCase(), role = ROLES[b.role] ? b.role : "other";
  if (name.length < 2) throw new TrustError(400, "Enter their name.");
  if (!validEmail(email)) throw new TrustError(400, "Enter a valid email address.");
  return update(tid, t => { if (t.members.some(m => m.email === email)) throw new TrustError(409, "That person is already a member."); t.members.push({ id: id(4), name, email, role }); });
}
function removeMember(tid, mid) { return update(tid, t => { t.members = t.members.filter(m => m.id !== mid); }); }
/** Ask to link a school: the head must confirm before anything is shared. */
function requestSchool(tid, schoolId) {
  if (!access.list().some(c => c.id === schoolId)) throw new TrustError(404, "No school with that id.");
  const other = load().trusts.find(t => t.id !== tid && t.schools.some(s => s.id === schoolId && s.status === "linked"));
  if (other) throw new TrustError(409, `That school already shares with ${other.name}. It must stop sharing first.`);
  return update(tid, t => { if (t.schools.some(s => s.id === schoolId)) throw new TrustError(409, "That school is already requested or linked."); t.schools.push({ id: schoolId, status: "pending", requestedAt: new Date().toISOString() }); });
}
function unlink(tid, schoolId) { return update(tid, t => { t.schools = t.schools.filter(s => s.id !== schoolId); }); }

/* ---------- the school's side ---------- */
/** The trust that has asked to see this school, or that it shares with. */
function forSchool(schoolId) {
  for (const t of load().trusts) { const s = t.schools.find(x => x.id === schoolId); if (s) return { id: t.id, name: t.name, status: s.status, requestedAt: s.requestedAt, confirmedAt: s.confirmedAt || null, members: t.members.map(m => ({ name: m.name, role: ROLES[m.role] })) }; }
  return null;
}
function respond(schoolId, action, by) {
  const db = load(), t = db.trusts.find(x => x.schools.some(s => s.id === schoolId));
  if (!t) throw new TrustError(404, "No trust has asked to see your school.");
  const s = t.schools.find(x => x.id === schoolId);
  if (action === "confirm") { if (s.status === "linked") return t; s.status = "linked"; s.confirmedAt = new Date().toISOString(); s.confirmedBy = clip(by, 100); }
  else if (action === "decline" || action === "leave") t.schools = t.schools.filter(x => x.id !== schoolId);
  else throw new TrustError(400, "Unknown action.");
  save(db); return t;
}

/* ---------- trust leaders' sign-in ---------- */
function membersByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return load().trusts.flatMap(t => t.members.filter(m => m.email === e).map(m => ({ trust: t, member: m })));
}
function login(req, res, tid, mid) { const e = (get(tid) || { members: [] }).members.find(m => m.id === mid); access.setSigned(req, res, COOKIE, { t: tid, m: mid, e: access.hashEmail(e && e.email) }, MAX_AGE); }
function who(req) {
  const d = access.readSigned(req, COOKIE); if (!d || !d.t) return null;
  const t = get(d.t); if (!t) return null;
  const m = t.members.find(x => x.id === d.m && access.hashEmail(x.email) === d.e);
  return m ? { trust: t, member: m } : null;
}

module.exports = { list, get, create, rename, remove, addMember, removeMember, requestSchool, unlink, forSchool, respond, membersByEmail, login, who, ROLES, TrustError };
