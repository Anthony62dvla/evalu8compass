/*
 * AI quality check (superadmin only)
 * ------------------------------------------------------------
 * Runs the AI inspector on a published Ofsted report exactly as a workshop
 * would, then checks what it produced against what the report actually says:
 *   - grades: every area graded as in the report, nothing invented
 *   - safeguarding and framework read correctly
 *   - next steps: each one found, none added
 *   - findings mapped to real checklist lines
 *   - line-level advice for two of the concerns is well formed
 * The admin (an experienced inspector) then rates the quality by hand. Runs
 * and ratings are kept in data/ai-evals.jsonl so prompt changes can be compared.
 *
 * Reference reports are published Ofsted reports (Crown copyright, reusable
 * under the Open Government Licence). Only the expected grades and our own
 * paraphrase of each report's next steps are stored here.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const C = require("../public/js/criteria.js");
const prompts = require("../public/js/prompts.js");

const FILE = path.join(__dirname, "..", "data", "ai-evals.jsonl");
const PROMPT_VERSION = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", "public", "js", "prompts.js"))).digest("hex").slice(0, 8);
const ALLOWED_HOSTS = new Set(["files.ofsted.gov.uk", "reports.ofsted.gov.uk"]);
const MAX_PDF = 25 * 1024 * 1024;

const REFERENCE = [
  {
    id: "belle-vue", school: "Belle Vue Girls' Academy", urn: "138087", url: "https://files.ofsted.gov.uk/v1/file/50293465",
    profile: { name: "Belle Vue Girls' Academy", type: "academy", phases: ["ks3", "ks4", "p16"], special: false },
    expected: { framework: "renewed", safeguarding: "met", grades: [
      ["Inclusion", "Expected standard"], ["Curriculum and teaching", "Expected standard"], ["Achievement", "Expected standard"],
      ["Attendance and behaviour", "Expected standard"], ["Personal development and well-being", "Strong standard"],
      ["Leadership and governance", "Expected standard"], ["Post-16 provision", "Expected standard"]],
      nextSteps: ["Give staff better guidance on adapting the curriculum and teaching so pupils with SEND make strong academic progress",
        "Make checks on pupils' learning consistent so gaps in understanding are identified and used to shape later teaching"] },
  },
  {
    id: "seahaven", school: "Seahaven Academy", urn: "140679", url: "https://files.ofsted.gov.uk/v1/file/50293453",
    profile: { name: "Seahaven Academy", type: "academy", phases: ["ks3", "ks4"], special: false },
    expected: { framework: "renewed", safeguarding: "met", grades: [
      ["Inclusion", "Expected standard"], ["Curriculum and teaching", "Expected standard"], ["Achievement", "Expected standard"],
      ["Attendance and behaviour", "Expected standard"], ["Personal development and well-being", "Expected standard"],
      ["Leadership and governance", "Expected standard"]],
      nextSteps: ["Promote and celebrate high attendance so that it improves for all pupils",
        "Make sure teachers adapt the curriculum to pupils' specific needs so they overcome barriers to learning across subjects"] },
  },
  {
    id: "bank-leaze", school: "Oasis Academy Bank Leaze", urn: "138409", url: "https://files.ofsted.gov.uk/v1/file/50293449",
    profile: { name: "Oasis Academy Bank Leaze", type: "academy", phases: ["eyfs", "ks1", "ks2"], special: false },
    expected: { framework: "renewed", safeguarding: "met", grades: [
      ["Inclusion", "Strong standard"], ["Curriculum and teaching", "Expected standard"], ["Achievement", "Strong standard"],
      ["Attendance and behaviour", "Expected standard"], ["Personal development and well-being", "Strong standard"],
      ["Leadership and governance", "Strong standard"], ["Early years", "Expected standard"]],
      nextSteps: ["Make sure teachers consistently choose learning activities that deepen pupils' knowledge",
        "Make sure early years staff use every chance for high-quality interactions that build children's knowledge and vocabulary"] },
  },
  {
    id: "bnos-zion", school: "Bnos Zion of Bobov (2019, earlier framework)", urn: "136015", url: "https://files.ofsted.gov.uk/v1/file/50101385",
    profile: { name: "Bnos Zion of Bobov", type: "independent", phases: ["eyfs", "ks1", "ks2", "ks3"], special: false },
    expected: { framework: "earlier", safeguarding: "effective", grades: [
      ["Overall effectiveness", "Requires improvement"], ["Effectiveness of leadership and management", "Requires improvement"],
      ["Quality of teaching, learning and assessment", "Requires improvement"], ["Personal development, behaviour and welfare", "Good"],
      ["Outcomes for pupils", "Requires improvement"], ["Early years provision", "Requires improvement"]],
      nextSteps: ["Strengthen leadership and management so the independent school standards are met consistently",
        "Raise expectations of pupils' writing, especially in key stage 2",
        "Make sure pupils understand teachers' explanations and demonstrations, and that teachers act promptly when they do not",
        "Use assessment more effectively, including in early years and for the most able",
        "Act promptly when pupils deface books or the classroom"] },
  },
];

/* ---------- scoring (pure functions, tested in scripts/test-evals.js) ---------- */
const normArea = s => String(s || "").toLowerCase().replace(/well-being/g, "wellbeing").replace(/post[\s-]?16|sixth form/g, "post16")
  .replace(/\bprovision\b|\bthe\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const normGrade = s => String(s || "").toLowerCase().replace(/safeguarding (standards )?/, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set("that this with their they them from into have make sure more most when which every there pupils pupil school schools staff should ensure leaders".split(" "));
const words = s => new Set(String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)).map(w => w.replace(/(ing|ed|es|s)$/, "")));
function overlap(a, b) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(w => { if (B.has(w)) n++; }); return n / Math.min(A.size, B.size); }

function score(expected, reading, lineIds) {
  const out = { checks: [], points: 0, max: 0 };
  const add = (ok, label, detail, weight = 1) => { out.checks.push({ ok, label, detail: detail || "" }); out.max += weight; if (ok) out.points += weight; };
  const r = reading || {};
  add(!!r && typeof r === "object" && Array.isArray(r.grades) && Array.isArray(r.nextSteps) && Array.isArray(r.findings), "Reply in the expected format");

  // Grades
  const got = new Map((r.grades || []).filter(g => !/safeguard/i.test(g.area)).map(g => [normArea(g.area), g.grade]));
  const grades = expected.grades.map(([area, grade]) => {
    const g = got.get(normArea(area));
    return { area, expected: grade, got: g == null ? null : g, ok: g != null && normGrade(g) === normGrade(grade) };
  });
  grades.forEach(g => add(g.ok, `Grade: ${g.area}`, g.got == null ? "missing" : g.ok ? g.got : `said "${g.got}", report says "${g.expected}"`));
  const known = new Set(expected.grades.map(([a]) => normArea(a)));
  const invented = [...got.keys()].filter(k => !known.has(k));
  add(!invented.length, "No grades that aren't in the report", invented.length ? (r.grades || []).filter(g => invented.includes(normArea(g.area))).map(g => `${g.area}: ${g.grade}`).join("; ") : "");

  // Safeguarding and framework
  const sg = r.safeguarding || ((r.grades || []).find(g => /safeguard/i.test(g.area)) || {}).grade || null;
  add(sg != null && normGrade(sg) === normGrade(expected.safeguarding), "Safeguarding", sg == null ? "missing" : `said "${sg}", report says "${expected.safeguarding}"`);
  add(String(r.framework || "").toLowerCase().includes(expected.framework), "Framework recognised", `said "${r.framework || "nothing"}"`);

  // Next steps: each expected one found once; nothing extra
  const ai = (r.nextSteps || []).map(String);
  const used = new Set();
  const steps = expected.nextSteps.map(e => {
    let best = -1, bs = 0;
    ai.forEach((a, i) => { const v = overlap(e, a); if (v > bs && !used.has(i)) { bs = v; best = i; } });
    const ok = bs >= 0.34; if (ok) used.add(best);
    return { expected: e, got: ok ? ai[best] : null, match: Math.round(bs * 100) / 100, ok };
  });
  // Same number of steps in the same order: an unmatched step is compared with the AI's step in the same position
  if (ai.length === expected.nextSteps.length) steps.forEach((s, i) => {
    if (!s.ok && !used.has(i)) { s.ok = true; s.got = ai[i]; s.byPosition = true; used.add(i); }
  });
  steps.forEach((s, i) => add(s.ok, `Next step ${i + 1} found`, s.ok ? (s.byPosition ? "matched by position: check the wording" : "") : "not found in the AI's list"));
  const extra = ai.filter((_, i) => !used.has(i));
  add(extra.length === 0, "No next steps added that aren't in the report", extra.join(" | "));

  // Findings mapped to real lines
  const f = Array.isArray(r.findings) ? r.findings : [];
  const bad = f.filter(x => x.itemId && !lineIds.has(x.itemId)).map(x => x.itemId);
  add(!bad.length, "Findings only use real checklist lines", bad.length ? "unknown ids: " + bad.join(", ") : "");
  const concerns = f.filter(x => x.type === "concern");
  add(concerns.length >= expected.nextSteps.length, "Each next step shows up as a concern", `${concerns.length} concerns for ${expected.nextSteps.length} next steps`);

  out.pct = out.max ? Math.round(out.points / out.max * 100) : 0;
  return { ...out, grades, steps, extra };
}

function checkAdvice(a) {
  const issues = [];
  const acts = Array.isArray(a && a.activities) ? a.activities : [];
  if (acts.length < 3 || acts.length > 4) issues.push(`${acts.length} activities (asked for 3 or 4)`);
  acts.forEach((x, i) => {
    if (!x.lead) issues.push(`activity ${i + 1} has no lead`);
    if (!x.evidence) issues.push(`activity ${i + 1} has no evidence`);
    if (!["This week", "This half-term", "This term", "This year"].includes(x.when)) issues.push(`activity ${i + 1} timescale "${x.when}"`);
  });
  if (!a || !a.inspectorQuestion) issues.push("no inspector question");
  if (!a || !a.quickWin) issues.push("no quick win");
  // Percentages can be invented statistics. The DfE's own absence thresholds (persistent
  // absence below 90% attendance / 10% absence, severe absence 50%) are definitions, not claims.
  const txt = JSON.stringify(a || {});
  const known = /absen|attendance/i.test(txt) ? new Set(["90%", "50%", "10%"]) : new Set();
  const stats = [...new Set((txt.match(/\b\d{1,3}(\.\d+)?%/g) || []).filter(x => !known.has(x)))];
  if (stats.length) issues.push("contains percentages to check aren't invented: " + stats.join(", "));
  return issues;
}

/* ---------- running ---------- */
async function fetchReport(url) {
  let u;
  try { u = new URL(url); } catch (e) { throw Object.assign(new Error("That isn't a web address."), { status: 400 }); }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) throw Object.assign(new Error("Use a link to a report PDF on files.ofsted.gov.uk."), { status: 400 });
  const r = await fetch(u, { redirect: "manual" });
  if (r.status >= 300 && r.status < 400) {
    const next = new URL(r.headers.get("location"), u);
    if (!ALLOWED_HOSTS.has(next.hostname)) throw Object.assign(new Error("The report link redirected somewhere unexpected."), { status: 400 });
    return fetchReport(next.href);
  }
  if (!r.ok) throw Object.assign(new Error(`Ofsted's site answered ${r.status}. Check the link.`), { status: 502 });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_PDF || buf.slice(0, 4).toString() !== "%PDF") throw Object.assign(new Error("That link isn't a PDF report (or it's too large)."), { status: 400 });
  return buf;
}

/** Run one check. src: { refId } or { url, profile, expected? } or { pdf (base64), profile, expected? } */
async function run(src, ai) {
  const ref = src.refId ? REFERENCE.find(x => x.id === src.refId) : null;
  if (src.refId && !ref) throw Object.assign(new Error("Unknown reference report."), { status: 404 });
  const profile = ref ? ref.profile : sanitiseProfile(src.profile);
  const expected = ref ? ref.expected : parseExpected(src.expected);
  const pdf = src.pdf ? Buffer.from(String(src.pdf).replace(/^data:[^,]+,/, ""), "base64") : await fetchReport(ref ? ref.url : src.url);
  if (pdf.slice(0, 4).toString() !== "%PDF") throw Object.assign(new Error("That file isn't a PDF."), { status: 400 });
  const areas = C.resolve(profile);
  const lineIds = new Set(areas.flatMap(a => a.items.map(i => i.id)));
  const t0 = Date.now();
  const reading = await ai.askJson({
    system: prompts.SYSTEM, maxTokens: 8000, account: "admin",
    content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
      { type: "text", text: prompts.reportPrompt({ ctx: profile, areas, hasPdf: true }) }],
  });
  const seconds = Math.round((Date.now() - t0) / 1000);
  // Line-level advice for up to two mapped concerns, as a school would see it
  // Prefer concerns from different evaluation areas, so the advice covers more than one next step
  const areaOf = id => (areas.find(a => a.items.some(i => i.id === id)) || {}).id;
  const mapped = (reading.findings || []).filter(f => f.type === "concern" && f.itemId && lineIds.has(f.itemId));
  const concerns = [];
  for (const f of mapped) if (concerns.length < 2 && !concerns.some(c => areaOf(c.itemId) === areaOf(f.itemId))) concerns.push(f);
  for (const f of mapped) if (concerns.length < 2 && !concerns.includes(f) && !concerns.some(c => c.itemId === f.itemId)) concerns.push(f);
  const advice = [];
  for (const c of concerns) {
    const area = areas.find(a => a.items.some(i => i.id === c.itemId)), item = area.items.find(i => i.id === c.itemId);
    try {
      const a = await ai.askJson({ system: prompts.SYSTEM, maxTokens: 1500, account: "admin", content: prompts.itemPrompt({ ctx: profile, area: area.name, item, status: "part", note: "From our latest Ofsted report: " + c.finding }) });
      advice.push({ itemId: c.itemId, line: item.text, finding: c.finding, advice: a, issues: checkAdvice(a) });
    } catch (e) { advice.push({ itemId: c.itemId, line: item.text, finding: c.finding, error: e.message }); }
  }
  const rec = {
    id: crypto.randomBytes(4).toString("hex"), at: new Date().toISOString(), promptVersion: PROMPT_VERSION, model: ai.model(),
    report: ref ? { refId: ref.id, school: ref.school, url: ref.url } : { school: profile.name || "Uploaded report", url: src.url || null },
    profile, seconds, reading, advice, score: expected ? score(expected, reading, lineIds) : null, expected: expected || null, review: null,
  };
  append(rec);
  return rec;
}

function sanitiseProfile(p) {
  p = p || {};
  const phases = (Array.isArray(p.phases) ? p.phases : []).filter(x => C.PHASES.some(y => y.id === x));
  return { name: String(p.name || "").slice(0, 120), type: ["maintained", "academy", "independent"].includes(p.type) ? p.type : "academy", phases: phases.length ? phases : ["ks3", "ks4"], special: !!p.special };
}
/** Expected answers typed by the admin: lines "Area: Grade", "Safeguarding: met", "Framework: renewed", "Next step: ..." */
function parseExpected(text) {
  if (!text || !String(text).trim()) return null;
  const e = { framework: "renewed", safeguarding: "met", grades: [], nextSteps: [] };
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*([^:]+):\s*(.+?)\s*$/); if (!m) continue;
    const k = m[1].trim(), v = m[2].trim();
    if (/^safeguarding$/i.test(k)) e.safeguarding = v.toLowerCase();
    else if (/^framework$/i.test(k)) e.framework = /earlier|old|2019|previous/i.test(v) ? "earlier" : "renewed";
    else if (/^next step/i.test(k)) e.nextSteps.push(v);
    else e.grades.push([k, v]);
  }
  return e.grades.length || e.nextSteps.length ? e : null;
}

/* ---------- storage ---------- */
function all() {
  try { return fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); }
  catch (e) { return []; }
}
function writeAll(list) { const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, list.map(x => JSON.stringify(x)).join("\n") + "\n", { mode: 0o600 }); fs.renameSync(tmp, FILE); }
function append(rec) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.appendFileSync(FILE, JSON.stringify(rec) + "\n", { mode: 0o600 }); }
function get(id) { return all().find(x => x.id === id) || null; }
function review(id, rv) {
  const list = all(), rec = list.find(x => x.id === id);
  if (!rec) return null;
  const n = v => { const x = Number(v); return x >= 1 && x <= 4 ? x : null; };
  rec.review = { grades: n(rv.grades), nextSteps: n(rv.nextSteps), mapping: n(rv.mapping), advice: n(rv.advice), wouldShare: rv.wouldShare === true || rv.wouldShare === "yes", notes: String(rv.notes || "").slice(0, 4000), at: new Date().toISOString() };
  writeAll(list);
  return rec;
}
function remove(id) { const list = all(), rest = list.filter(x => x.id !== id); if (rest.length === list.length) return false; writeAll(rest); return true; }
function summaries() {
  return all().map(x => ({ id: x.id, at: x.at, report: x.report, promptVersion: x.promptVersion, model: x.model, seconds: x.seconds, pct: x.score ? x.score.pct : null, review: x.review })).reverse();
}

module.exports = { REFERENCE, PROMPT_VERSION, run, get, review, remove, summaries, score, checkAdvice, parseExpected, normArea, overlap };
