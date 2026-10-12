/*
 * Each school's self-evaluation and action plan, saved on the server
 * ------------------------------------------------------------
 * One folder per access code:  data/schools/<codeId>/
 *   state.json      { rev, updatedAt, state }   the live checklist + action plan
 *   snapshots.json  [ { id, name, at, rev, state } ]  termly "save points"
 *
 * Browsers send only what changed (see public/js/statediff.js), so several
 * leaders can work at once: different lines merge; the same line, last save wins.
 * Everything is written atomically (temp file + rename) and is covered by the
 * daily encrypted backup, which copies the whole data folder.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const D = require("../public/js/statediff.js");

const DIR = path.join(__dirname, "..", "data", "schools");
const MAX_BYTES = 1.5 * 1024 * 1024;   // a full checklist with logo and AI advice is ~0.3 MB
const MAX_SNAPSHOTS = 40;
const ANSWERS = new Set(["met", "part", "no", "na"]);
const ROLES = new Set(["head", "deputy", "dsl", "ddsl", "senco", "ahead", "phase", "subject", "attendance", "ey", "p16", "gov", "trustee", "other"]);
const cache = new Map();

class SchoolError extends Error { constructor(status, message) { super(message); this.status = status; } }

const safeId = id => /^[a-z0-9]{1,16}$/.test(String(id)) ? String(id) : null;
function dirFor(id) { const s = safeId(id); if (!s) throw new SchoolError(400, "Bad school id"); return path.join(DIR, s); }
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; } }

/** Keep only the shapes the app uses, with sensible limits. */
function clean(s) {
  const src = s && typeof s === "object" ? s : {};
  const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
  const obj = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const out = { version: 2, profile: {}, answers: {}, notes: {}, ai: {}, review: null, ofsted: null, actions: [], collapsed: {}, team: [], meetings: [] };
  const p = obj(src.profile);
  out.profile = {
    name: str(p.name, 160), type: ["independent", "maintained", "academy"].includes(p.type) ? p.type : "independent",
    phases: Array.isArray(p.phases) ? p.phases.filter(x => typeof x === "string").slice(0, 10) : [],
    special: !!p.special, by: str(p.by, 160), date: str(p.date, 20), ai: p.ai !== false,
    newSchool: !!p.newSchool && p.type === "independent", opened: /^\d{4}-\d{2}$/.test(p.opened || "") ? p.opened : "",
  };
  if (typeof p.logo === "string" && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(p.logo) && p.logo.length < 300 * 1024) out.profile.logo = p.logo;
  const key = k => /^[A-Za-z0-9_.:-]{1,60}$/.test(k);
  for (const [k, v] of Object.entries(obj(src.answers))) if (key(k) && ANSWERS.has(v)) out.answers[k] = v;
  for (const [k, v] of Object.entries(obj(src.notes))) if (key(k) && typeof v === "string" && v) out.notes[k] = v.slice(0, 4000);
  for (const [k, v] of Object.entries(obj(src.ai))) if (key(k) && v && typeof v === "object") out.ai[k] = v;
  for (const [k, v] of Object.entries(obj(src.collapsed))) if (key(k) && v) out.collapsed[k] = true;
  if (src.review && typeof src.review === "object") out.review = src.review;
  // The AI's reading of the school's latest Ofsted report (the report itself isn't stored)
  out.ofsted = src.ofsted && typeof src.ofsted === "object" && src.ofsted.reading && JSON.stringify(src.ofsted).length < 80000 ? src.ofsted : null;
  if (Array.isArray(src.actions)) out.actions = src.actions.filter(a => a && typeof a === "object" && typeof a.id === "string").slice(0, 400);
  // The leadership team: who owns actions and who gets alerts
  if (Array.isArray(src.team)) out.team = src.team.filter(m => m && typeof m === "object" && typeof m.id === "string").slice(0, 40).map(m => ({
    id: str(m.id, 20), name: str(m.name, 100), role: ROLES.has(m.role) ? m.role : "other", email: str(m.email, 200).trim().toLowerCase(),
    alerts: m.alerts === "urgent" ? "urgent" : "weekly", areas: Array.isArray(m.areas) ? m.areas.filter(x => typeof x === "string").slice(0, 12) : [],
    subjects: Array.isArray(m.subjects) ? m.subjects.filter(x => typeof x === "string").slice(0, 20) : [],
  }));
  if (Array.isArray(src.meetings)) out.meetings = src.meetings.filter(m => m && typeof m === "object" && typeof m.id === "string" && JSON.stringify(m).length < 60000).slice(0, 60);
  return out;
}
function checkSize(state) {
  if (Buffer.byteLength(JSON.stringify(state)) > MAX_BYTES) throw new SchoolError(413, "This self-evaluation has grown too large to save. Remove some AI suggestions or the logo and try again.");
}

function load(id) {
  const key = safeId(id); if (!key) throw new SchoolError(400, "Bad school id");
  if (cache.has(key)) return cache.get(key);
  const rec = readJSON(path.join(dirFor(key), "state.json"), null);
  if (rec) cache.set(key, rec);
  return rec;
}
function store(id, rec) { cache.set(safeId(id), rec); writeJSON(path.join(dirFor(id), "state.json"), rec); }

/** Current saved copy, or { rev: 0, state: null } if this school hasn't saved yet. */
function get(id) { const r = load(id); return r ? { rev: r.rev, updatedAt: r.updatedAt, state: r.state } : { rev: 0, updatedAt: null, state: null }; }

/** Apply a change-set from one browser. Returns the new rev, plus the full state
 *  when someone else saved in between (so that browser can catch up). */
function patch(id, baseRev, changes) {
  if (!changes || typeof changes !== "object") throw new SchoolError(400, "Nothing to save");
  const cur = load(id);
  const before = cur ? cur.state : clean({});
  const next = clean(D.apply(before, changes));
  checkSize(next);
  const rev = (cur ? cur.rev : 0) + 1;
  const othersSaved = Number(baseRev) !== (cur ? cur.rev : 0);
  store(id, { rev, updatedAt: new Date().toISOString(), state: next });
  return othersSaved ? { rev, state: next } : { rev };
}

/** Replace the whole copy (first upload from a browser, or "use this device's copy"). */
function replace(id, state) {
  const cur = load(id);
  const next = clean(state); checkSize(next);
  const rev = (cur ? cur.rev : 0) + 1;
  store(id, { rev, updatedAt: new Date().toISOString(), state: next });
  return { rev, state: next };
}

/* ---------- snapshots ---------- */
function snapFile(id) { return path.join(dirFor(id), "snapshots.json"); }
function snapList(id) { return readJSON(snapFile(id), []); }
function counts(st) {
  const c = { met: 0, part: 0, no: 0, na: 0 };
  for (const v of Object.values((st && st.answers) || {})) if (c[v] != null) c[v]++;
  const acts = (st && st.actions) || [];
  return { ...c, actions: acts.length, done: acts.filter(a => a.status === "done").length };
}
const summary = s => ({ id: s.id, name: s.name, at: s.at, counts: counts(s.state) });
function snapshots(id) { return snapList(id).map(summary).sort((a, b) => b.at.localeCompare(a.at)); }
function snapshot(id, sid) { const s = snapList(id).find(x => x.id === sid); return s ? { id: s.id, name: s.name, at: s.at, state: s.state } : null; }
function addSnapshot(id, name) {
  const cur = load(id);
  if (!cur || !cur.state) throw new SchoolError(409, "There's nothing saved yet to take a snapshot of.");
  const list = snapList(id);
  if (list.length >= MAX_SNAPSHOTS) throw new SchoolError(409, `You can keep up to ${MAX_SNAPSHOTS} snapshots. Delete an old one first.`);
  const label = String(name || "").trim().slice(0, 80) || "Snapshot " + new Date().toLocaleDateString("en-GB");
  const s = { id: crypto.randomBytes(4).toString("hex"), name: label, at: new Date().toISOString(), rev: cur.rev, state: cur.state };
  list.push(s); writeJSON(snapFile(id), list);
  return summary(s);
}
function deleteSnapshot(id, sid) {
  const list = snapList(id), n = list.length;
  const rest = list.filter(x => x.id !== sid);
  if (rest.length === n) return false;
  writeJSON(snapFile(id), rest); return true;
}

/** Permanently delete a school's saved work and snapshots. */
function erase(id) {
  const key = safeId(id); if (!key) return false;
  cache.delete(key);
  const dir = path.join(DIR, key);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Delete saved work for schools whose access ended more than `days` ago.
 *  endedAt(id) returns the ISO date access ended, null if still active, or
 *  undefined if the code no longer exists (then the folder's age is used). */
function cleanup(endedAt, days) {
  const cutoff = Date.now() - days * 864e5, gone = [];
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return gone; }
  for (const id of names) {
    if (!safeId(id) || id === "admin" || id === "open") continue;
    let end = endedAt(id);
    if (end === undefined) { try { end = fs.statSync(path.join(DIR, id, "state.json")).mtime.toISOString(); } catch (e) { end = new Date(0).toISOString(); } }
    if (end && Date.parse(end) < cutoff && erase(id)) gone.push(id);
  }
  return gone;
}

/** Light summary of every school's saved work, for the admin console. */
function summaries() {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return out; }
  for (const id of names) {
    if (!safeId(id)) continue;
    const r = load(id); if (!r) continue;
    out[id] = { updatedAt: r.updatedAt, assessed: Object.keys(r.state.answers || {}).length, actions: (r.state.actions || []).length, snapshots: snapList(id).length };
  }
  return out;
}

module.exports = { get, patch, replace, snapshots, snapshot, addSnapshot, deleteSnapshot, summaries, erase, cleanup, clean, SchoolError, MAX_BYTES };
