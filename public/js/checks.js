/*
 * Evalu8 Compass — monitoring (shared by browser and server)
 * ------------------------------------------------------------
 * Leaders plan and record monitoring: learning walks, work scrutiny, pupil,
 * staff and parent voice, records reviews, governor visits, and the DSL's
 * termly safeguarding checks. Findings become evidence for the self-evaluation
 * and feed leaders' reports, meeting agendas, the SIP paper and governors' reports.
 *
 * Record: { id, type, check?, date, by, areaId, lineId?, focus, found, next,
 *           judge: "strong" | "dev" | "concern" | "", status: "planned" | "done",
 *           actionIds: [], evidenceAt?, createdAt, updatedAt }
 */
(function (root) {
  const TYPES = [["walk", "Learning walk"], ["drop", "Lesson visit or drop-in"], ["work", "Work scrutiny"], ["pupil", "Pupil voice"], ["staff", "Staff voice or survey"],
    ["parent", "Parent voice or survey"], ["records", "Records or data review"], ["sg", "Safeguarding check"], ["gov", "Governor or trustee visit"], ["other", "Other"]];
  const TYPE = Object.fromEntries(TYPES);
  const JUDGE = { strong: "Working well", dev: "Developing", concern: "Concern" };

  /* The DSL's termly safeguarding checks: what Ofsted expects leaders to know about
     the culture of safeguarding. (The single central record is checked in the school's MIS.) */
  const SG_CHECKS = [
    ["staffknow", "Staff safeguarding knowledge", "Ask a sample of staff, including new, support and part-time staff: how do you report a concern, and a low-level concern about an adult? What would you do if a child told you something worrying? What are the signs of risk online?"],
    ["pupilsafe", "Pupil voice: feeling safe", "Talk with groups of pupils across the school: do they feel safe, know who to talk to and how to stay safe online? Do they believe adults act when they raise a worry?"],
    ["records", "Safeguarding records audit", "Sample concerns logged this term: recorded promptly and clearly, with actions, outcomes and chronologies? Referrals made in good time, and escalated when the response wasn't what the school expected?"],
    ["filter", "Filtering and monitoring", "With the IT lead: test that filtering blocks harmful content, that monitoring alerts reach the DSL and are acted on, and that staff know how to report problems."],
    ["vulnerable", "Pupils who need help or protection", "Review pupils with child protection, child in need or early help plans, and looked-after children: is the school doing what it agreed, and is it making a difference?"],
    ["absence", "Absence and children missing education", "With the attendance lead: is absence that may signal risk followed up? Are children missing education, on part-time timetables or in alternative provision safe and accounted for?"],
    ["training", "Training and induction", "Are all staff, volunteers and supply staff trained and up to date, and have they read the latest Keeping children safe in education Part 1? Are new starters inducted before they work with pupils?"],
    ["govcheck", "Governor or trustee oversight", "Has the safeguarding governor or trustee met the DSL this term, seen the evidence and challenged where needed?"],
  ];
  const SG = Object.fromEntries(SG_CHECKS.map(c => [c[0], c[1]]));

  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "";

  /** The school term a date falls in (approximate English term dates). */
  function term(date) {
    const d = String(date || new Date().toISOString()).slice(0, 10), y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    if (m >= 9) return { key: `${y}-autumn`, name: `Autumn term ${y}`, start: `${y}-09-01`, end: `${y}-12-19` };
    if (m <= 3) return { key: `${y}-spring`, name: `Spring term ${y}`, start: `${y}-01-01`, end: `${y}-03-31` };
    return { key: `${y}-summer`, name: `Summer term ${y}`, start: `${y}-04-01`, end: `${y}-08-31` };
  }
  const inTerm = (r, t) => r.date && r.date >= t.start && r.date <= t.end;
  const records = state => ((state && state.monitoring) || []).filter(r => r && r.id);
  const done = state => records(state).filter(r => r.status === "done");
  const title = r => r.type === "sg" && r.check ? SG[r.check] || "Safeguarding check" : (r.focus || TYPE[r.type] || "Monitoring");

  /** This term's safeguarding checks: [{ key, label, prompt, rec }] where rec is the latest record (or null). */
  function sgStatus(state, today) {
    const t = term(today), recs = done(state).filter(r => r.type === "sg" && inTerm(r, t));
    const list = SG_CHECKS.map(([key, label, prompt]) => ({ key, label, prompt, rec: recs.filter(r => r.check === key).sort((a, b) => b.date.localeCompare(a.date))[0] || null }));
    return { term: t, list, done: list.filter(x => x.rec).length, total: list.length, concerns: recs.filter(r => r.judge === "concern").length };
  }

  /** A line describing a record. withText adds what was found and what next (internal use only). */
  function line(r, withText) {
    const head = `${nice(r.date)} · ${TYPE[r.type] || "Monitoring"}${r.type === "sg" ? "" : r.focus ? ": " + r.focus : ""}${r.type === "sg" && r.check ? ": " + (SG[r.check] || "") : ""}${r.by ? " · " + r.by : ""}${r.judge ? " · " + JUDGE[r.judge] : ""}`;
    if (!withText) return head;
    const f = String(r.found || "").replace(/\s+/g, " ").trim().slice(0, 240), n = String(r.next || "").replace(/\s+/g, " ").trim().slice(0, 240);
    return head + (f ? ` · Found: ${f}` : "") + (n ? ` · Next: ${n}` : "");
  }

  /** Records done since a date (or this term), optionally for one area. */
  function since(state, from, areaId) {
    return done(state).filter(r => r.date && r.date >= from && (!areaId || r.areaId === areaId)).sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Counts by type, e.g. "3 learning walks, 1 pupil voice". */
  function counts(list) {
    const c = {}; list.forEach(r => { c[r.type] = (c[r.type] || 0) + 1; });
    return TYPES.filter(([k]) => c[k]).map(([k, l]) => `${l}: ${c[k]}`);
  }

  const api = { TYPES, TYPE, JUDGE, SG_CHECKS, SG, term, inTerm, records, done, sgStatus, line, since, counts, title };
  root.HWWD = Object.assign(root.HWWD || {}, { checks: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
