/*
 * Who changed what: a short record of each save, by name. Saves by the same person within
 * 15 minutes are combined, so the list reads as sessions of work, not keystrokes.
 * data/schools/<id>/history.json (newest last, at most 300 entries). Holds counts only, never content.
 */
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "..", "data", "schools");
const file = id => path.join(DIR, id, "history.json");
const LABEL = { answers: ["rating", "ratings"], notes: ["evidence note", "evidence notes"], actions: ["action", "actions"], team: ["team change", "team changes"], meetings: ["meeting", "meetings"],
  monitoring: ["monitoring record", "monitoring records"], subjects: ["subject review", "subject reviews"], leads: ["area report", "area reports"], govReports: ["governors' report", "governors' reports"],
  challenges: ["governors' question", "governors' questions"], siams: ["SIAMS entry", "SIAMS entries"], csi: ["Catholic inspection entry", "Catholic inspection entries"], profile: ["school setting", "school settings"], ofsted: ["Ofsted report", "Ofsted reports"], review: ["inspector review", "inspector reviews"] };

function read(id) { try { const a = JSON.parse(fs.readFileSync(file(id), "utf8")); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
/** Counts of what a patch changed, by kind. */
function summarise(patch) {
  const c = {}, add = (k, n) => { if (LABEL[k] && n) c[k] = (c[k] || 0) + n; };
  if (!patch || typeof patch !== "object") return c;
  for (const k of [...Object.keys(patch.set || {}), ...(patch.del || [])]) add(k.split(".")[0], 1);
  for (const l of ["actions", "team", "meetings", "monitoring", "subjects", "govReports", "challenges"]) if (patch[l]) add(l, ((patch[l].upsert || []).length) + ((patch[l].del || []).length));
  return c;
}
function record(id, by, counts) {
  if (!id || !Object.keys(counts).length) return;
  const list = read(id), now = new Date().toISOString(), last = list[list.length - 1];
  if (last && last.by === by && Date.now() - Date.parse(last.at) < 15 * 60e3) { for (const [k, n] of Object.entries(counts)) last.counts[k] = (last.counts[k] || 0) + n; last.at = now; }
  else list.push({ at: now, by: String(by || "").slice(0, 100), counts });
  try { fs.mkdirSync(path.join(DIR, id), { recursive: true }); const tmp = file(id) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(list.slice(-300)), { mode: 0o600 }); fs.renameSync(tmp, file(id)); }
  catch (e) { console.error("Couldn't save history", e.message); }
}
/** Recent entries, newest first, with a readable description. */
function recent(id, n) {
  return read(id).slice(-(n || 40)).reverse().map(e => ({ at: e.at, by: e.by, what: Object.entries(e.counts).map(([k, v]) => `${v} ${LABEL[k][v === 1 ? 0 : 1]}`).join(", ") }));
}
module.exports = { summarise, record, recent };
