/*
 * What a trust's leaders see: one row per school that has agreed to share, and a summary of each.
 * Built from the schools' live data; never evidence notes, monitoring findings or pupils' information.
 */
const schools = require("./schools");
const access = require("./access");
const criteria = require("../public/js/criteria.js");
const BR = require("../public/js/briefs.js");
const C = require("../public/js/checks.js");
const SI = require("../public/js/siams.js");
const CSI = require("../public/js/csi.js");
const AREA_IDS = ["sg", "inc", "ct", "ach", "ab", "pd", "lg", "cm"];

function row(id) {
  const c = access.list().find(x => x.id === id);
  const cur = schools.get(id), st = cur.state || {};
  const p = st.profile || {}, areas = criteria.resolve(p);
  const sc = Object.fromEntries(areas.map(a => [a.id, BR.score(a, st.answers || {})]).filter(([, s]) => s.rated).map(([k, s]) => [k, s.pct]));
  const answers = st.answers || {}, sgGaps = areas.filter(a => a.id === "sg").flatMap(a => a.items).filter(i => answers[i.id] === "no" || answers[i.id] === "part").length;
  const sgc = C.sgStatus(st), tm = C.term(new Date().toISOString()), mon = C.since(st, tm.start);
  const acts = (st.actions || []).filter(a => a && a.id), open = acts.filter(a => a.status !== "done"), today = new Date().toISOString().slice(0, 10);
  const lastGov = (st.govReports || []).filter(r => r.status === "issued").map(r => r.issuedAt).sort().pop() || null;
  const faith = SI.isChurch(p) ? { kind: "SIAMS", yes: SI.status(st).yes, total: SI.status(st).total } : CSI.isCatholic(p) ? { kind: "CSI", overall: CSI.status(st).overall } : null;
  const rated = Object.values(sc), overall = rated.length ? Math.round(rated.reduce((t, x) => t + x, 0) / rated.length) : null;
  return {
    id, name: (c && c.name) || p.name || "School", type: p.type || "", phases: p.phases || [], updatedAt: cur.updatedAt || null,
    scores: sc, overall,
    safeguarding: { gaps: sgGaps, checks: sgc.done, of: sgc.total, concerns: sgc.concerns },
    plan: { open: open.length, done: acts.length - open.length, risk: open.filter(a => a.rag === "risk").length, off: open.filter(a => a.rag === "off").length, overdue: open.filter(a => a.due && a.due < today).length },
    monitoring: { term: mon.length, concerns: mon.filter(r => r.judge === "concern").length },
    governors: { lastReport: lastGov, openQuestions: (st.challenges || []).filter(x => x.status === "open").length },
    ofsted: st.ofsted && st.ofsted.reading ? { date: st.ofsted.reading.inspectionDate || null, grades: (st.ofsted.reading.grades || []).slice(0, 8) } : null,
    faith,
  };
}

function view(trust, member) {
  const linked = trust.schools.filter(s => s.status === "linked");
  return {
    trust: { id: trust.id, name: trust.name }, me: { name: member.name },
    areas: criteria.AREAS ? criteria.AREAS.map(a => ({ id: a.id, name: a.name })) : AREA_IDS.map(id => ({ id, name: id })),
    schools: linked.map(s => row(s.id)),
    pending: trust.schools.filter(s => s.status === "pending").map(s => ({ name: (access.list().find(c => c.id === s.id) || {}).name || "School", requestedAt: s.requestedAt })),
  };
}

/** One school's summary for the trust: the governors' report as it stands today, without the suggested questions. */
function school(id) {
  const st = schools.get(id).state || {}, areas = criteria.resolve(st.profile || {});
  const doc = BR.govReport(st, areas, {});
  doc.title = `${(access.list().find(c => c.id === id) || {}).name || "School"}: summary for the trust`;
  doc.sections = doc.sections.filter(s => s.head !== "Questions governors may want to ask" && s.head !== "About this report");
  doc.sections.unshift({ head: "About this summary", lines: ["Written from the school's live self-evaluation, improvement plan and monitoring in Evalu8 Compass, today. It contains no evidence notes and no information about individual pupils."] });
  return { row: row(id), doc };
}

module.exports = { view, school, row };
