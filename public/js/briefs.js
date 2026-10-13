/*
 * Evalu8 Compass — written summaries built from the live data (shared by browser and server)
 * ------------------------------------------------------------
 *   areaReport(state, areas, areaId)   a key leader's report for one Ofsted evaluation area
 *   sipPaper(state, areas, opts)       a discussion paper for a SIP or consultant visit
 * Both return { title, sections: [{ head, para?, lines?: [string], table?: { cols, rows } }] },
 * which the app shows on screen and the server emails.
 * Evidence notes are included (they're for leaders and the school's adviser); never pupils' data.
 */
(function (root) {
  const C = typeof module !== "undefined" && module.exports ? require("./checks.js") : root.HWWD.checks;
  const LABEL = { met: "Met", part: "Partly", no: "Not yet", na: "N/A" };
  const RAG = { on: "On track", risk: "At risk", off: "Off track" };
  const STATUS = { todo: "Not started", doing: "In progress", done: "Done" };
  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";

  /* Key figures each area's leader enters each term (whole-school numbers only) */
  const INDICATORS = {
    sg: [["concerns", "Safeguarding concerns logged this term", ""], ["referrals", "Referrals to children's social care this term", ""], ["earlyhelp", "Early help assessments open", ""], ["trained", "Staff with up-to-date safeguarding training", "%"]],
    inc: [["sensupport", "Pupils on SEN support", "%"], ["ehcp", "Pupils with an EHC plan", ""], ["disadv", "Disadvantaged pupils", "%"], ["disatt", "Disadvantaged pupils' attendance", "%"]],
    ct: [["subjects", "Subjects reviewed this term", ""], ["observed", "Learning walks or drop-ins this term", ""]],
    ach: [["statutory", "Latest statutory outcomes (headline)", "text"], ["internal", "Internal assessment headline", "text"], ["gap", "Disadvantaged gap (headline)", "text"]],
    ab: [["attendance", "Attendance this term", "%"], ["pa", "Persistent absence", "%"], ["suspensions", "Suspensions this term", ""], ["pex", "Permanent exclusions this year", ""], ["incidents", "Recorded behaviour incidents this term", ""]],
    pd: [["safe", "Pupils who say they feel safe (pupil voice)", "%"], ["clubs", "Pupils taking part in clubs or enrichment", "%"], ["wellbeing", "Staff wellbeing survey: positive", "%"]],
    ey: [["gld", "Good level of development (latest)", "%"], ["ratio", "Ratios met every session this term", "text"]],
    p16: [["retention", "Sixth form retention", "%"], ["neet", "Leavers not in education, employment or training", "%"]],
    lg: [["govvisits", "Governor visits this term", ""], ["staffturnover", "Staff turnover this year", "%"]],
    cm: [],
  };
  /* Subjects schools pick from for subject leaders' reviews */
  const SUBJECTS = ["English: reading", "English: writing", "Phonics and early reading", "Mathematics", "Science", "Computing", "History", "Geography", "Religious education", "Art and design",
    "Design and technology", "Music", "Physical education", "Languages", "PSHE and RSE", "Citizenship", "Business", "Economics", "Psychology", "Sociology", "Media studies", "Drama", "Food and nutrition", "Vocational and technical courses", "Early years curriculum"];
  /* What a subject review asks about */
  const SUBJECT_PROMPTS = [["sequence", "The curriculum is well sequenced, with the key knowledge identified"], ["teaching", "Teaching helps pupils learn and remember it"],
    ["assess", "Assessment checks understanding and shapes teaching"], ["work", "Pupils' work shows they know and remember more"], ["send", "Pupils with SEND and disadvantaged pupils are well supported to learn it"], ["staff", "Staff have the subject knowledge and training they need"]];

  function score(area, answers) {
    const c = { met: 0, part: 0, no: 0, na: 0, todo: 0 };
    area.items.forEach(i => { const v = answers[i.id]; if (c[v] != null) c[v]++; else c.todo++; });
    const rated = c.met + c.part + c.no;
    return { ...c, total: area.items.length, rated, pct: rated ? Math.round((c.met + c.part * 0.5) / rated * 100) : null };
  }
  const areaOf = (areas, id) => (areas.find(a => a.items.some(i => i.id === id)) || {}).id;
  function actionLine(a) {
    const ms = (a.milestones || []);
    return `${a.title || "Untitled action"} · ${STATUS[a.status] || "Not started"}${a.rag && a.status !== "done" ? ", " + RAG[a.rag] : ""}${a.owner ? " · " + a.owner : ""}${a.due ? " · due " + nice(a.due) : ""}${ms.length ? ` · milestones ${ms.filter(m => m.done).length}/${ms.length}` : ""}${a.impact ? " · Impact: " + a.impact : ""}`;
  }
  function lastClosed(state) { return (state.meetings || []).filter(m => m.status === "done" && m.answersAtClose).sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)))[0] || null; }
  function changes(state, areas, filterArea) {
    const last = lastClosed(state); if (!last) return null;
    const before = last.answersAtClose, now = state.answers || {}, order = { no: 0, part: 1, met: 2 };
    const out = [];
    areas.forEach(a => { if (filterArea && a.id !== filterArea) return; a.items.forEach(i => {
      if (order[now[i.id]] == null || order[before[i.id]] == null || now[i.id] === before[i.id]) return;
      out.push(`${order[now[i.id]] > order[before[i.id]] ? "Better" : "Slipped"}: ${i.text} (${LABEL[before[i.id]]} → ${LABEL[now[i.id]]})`);
    }); });
    return { since: last.closedAt, lines: out };
  }

  /* ---------- a key leader's area report ---------- */
  function areaReport(state, areas, areaId) {
    const st = state || {}, answers = st.answers || {}, notes = st.notes || {};
    const area = areas.find(a => a.id === areaId);
    if (!area) return null;
    const sc = score(area, answers);
    const lead = (st.leads || {})[areaId] || {};
    const leaders = (st.team || []).filter(m => (m.areas || []).includes(areaId));
    const sections = [];
    sections.push({ head: "Summary", lines: [
      `Led by: ${leaders.length ? leaders.map(m => m.name).join(", ") : "not yet assigned"}`,
      sc.rated ? `${sc.pct}% in place across ${sc.rated} of ${sc.total} lines rated (${sc.met} Met, ${sc.part} Partly, ${sc.no} Not yet${sc.todo ? `, ${sc.todo} not yet rated` : ""})` : `${sc.total} lines, none rated yet`,
    ] });
    if (lead.commentary) sections.push({ head: "Leader's commentary", para: lead.commentary });
    const ind = (INDICATORS[areaId] || []).filter(([k]) => (lead.indicators || {})[k] != null && String((lead.indicators || {})[k].now || "").trim() !== "");
    if (ind.length) sections.push({ head: "Key figures", table: { cols: ["", "This term", "Last term"], rows: ind.map(([k, label, unit]) => {
      const v = lead.indicators[k], u = unit && unit !== "text" ? unit : "";
      return [label, `${v.now}${v.now !== "" && u ? u : ""}`, v.last != null && v.last !== "" ? `${v.last}${u}` : "–"];
    }) } });
    const gaps = area.items.filter(i => answers[i.id] === "no" || answers[i.id] === "part");
    if (gaps.length) sections.push({ head: "Not yet in place", lines: gaps.map(i => `${LABEL[answers[i.id]]}: ${i.text}${notes[i.id] ? " · Evidence: " + notes[i.id].replace(/\s+/g, " ").slice(0, 300) : ""}`) });
    const strengths = area.items.filter(i => answers[i.id] === "met" && notes[i.id]);
    if (strengths.length) sections.push({ head: "Strengths, with evidence", lines: strengths.slice(0, 12).map(i => `${i.text} · ${notes[i.id].replace(/\s+/g, " ").slice(0, 200)}`) });
    const acts = (st.actions || []).filter(a => a.itemId && areaOf(areas, a.itemId) === areaId);
    if (acts.length) sections.push({ head: "Actions", lines: acts.sort((a, b) => (a.status === "done") - (b.status === "done")).map(actionLine) });
    if (areaId === "ct") {
      const subs = (st.subjects || []).filter(s => s && s.subject);
      if (subs.length) sections.push({ head: "Subject reviews", table: { cols: ["Subject", "Leader", ...SUBJECT_PROMPTS.map(p => p[0] === "sequence" ? "Sequenced" : p[0] === "teaching" ? "Teaching" : p[0] === "assess" ? "Assessment" : p[0] === "work" ? "Pupils' work" : p[0] === "send" ? "SEND" : "Staff"), "Next step"],
        rows: subs.map(s => [s.subject, s.leader || "–", ...SUBJECT_PROMPTS.map(([k]) => LABEL[(s.ratings || {})[k]] || "–"), s.next || "–"]) } });
    }
    const tm = C.term(new Date().toISOString());
    const mon = C.since(st, tm.start, areaId);
    if (mon.length) sections.push({ head: `Monitoring this term (${tm.name})`, lines: mon.slice(0, 15).map(r => C.line(r, true)) });
    if (areaId === "sg") { const sgc = C.sgStatus(st); sections.push({ head: "The DSL's termly safeguarding checks", lines: sgc.list.map(x => `${x.label}: ${x.rec ? `done ${x.rec.date}${x.rec.judge ? ", " + C.JUDGE[x.rec.judge] : ""}` : "not done yet"}`) }); }
    const ch = changes(st, areas, areaId);
    if (ch && ch.lines.length) sections.push({ head: `Changes since the last leadership meeting (${nice(ch.since)})`, lines: ch.lines });
    return { title: `${area.name}: leader's report`, area: area.name, sections };
  }

  /* ---------- a discussion paper for a SIP or consultant visit ---------- */
  function sipPaper(state, areas, opts) {
    const st = state || {}, answers = st.answers || {}, p = st.profile || {}, o = opts || {};
    const sections = [];
    const phases = (p.phases || []).map(x => ({ eyfs: "EYFS", ks1: "KS1", ks2: "KS2", ks3: "KS3", ks4: "KS4", p16: "post-16" })[x] || x).join(", ");
    sections.push({ head: "About the school", lines: [`${p.name || "Our school"}: ${({ independent: "independent school", maintained: "maintained school", academy: "academy" })[p.type] || "school"}${phases ? ", " + phases : ""}${p.special ? ", with specialist provision" : ""}${p.newSchool ? ", newly opened" : ""}`] });
    if (o.focus) sections.push({ head: "What we'd like from this visit", para: o.focus });
    const rows = areas.map(a => ({ a, sc: score(a, answers) })).filter(x => x.sc.rated);
    if (rows.length) sections.push({ head: "Our self-evaluation at a glance", table: { cols: ["Evaluation area", "In place", "Met", "Partly", "Not yet"], rows: rows.map(({ a, sc }) => [a.name, `${sc.pct}%`, String(sc.met), String(sc.part), String(sc.no)]) } });
    const rd = st.ofsted && st.ofsted.reading;
    if (rd) {
      const lines = [];
      if (rd.inspectionDate) lines.push(`Inspected: ${rd.inspectionDate}`);
      (rd.grades || []).forEach(g => lines.push(`${g.area}: ${g.grade}`));
      if (rd.safeguarding) lines.push(`Safeguarding: ${rd.safeguarding}`);
      (rd.nextSteps || []).forEach(n => lines.push(`Next step: ${n}`));
      sections.push({ head: "Our latest Ofsted report", lines, para: rd.summary || "" });
    }
    const open = (st.actions || []).filter(a => a.status !== "done");
    const ranked = open.sort((a, b) => ({ off: 0, risk: 1, on: 2 }[a.rag] ?? 3) - ({ off: 0, risk: 1, on: 2 }[b.rag] ?? 3) || String(a.due || "9").localeCompare(String(b.due || "9")));
    if (ranked.length) sections.push({ head: "Our priorities and how they're going", lines: ranked.slice(0, 12).map(actionLine) });
    const done = (st.actions || []).filter(a => a.status === "done" && a.impact);
    if (done.length) sections.push({ head: "Completed, with impact", lines: done.slice(-8).map(a => `${a.title}: ${a.impact}`) });
    const tm = C.term(new Date().toISOString()), mon = C.since(st, tm.start);
    if (mon.length) {
      const other = mon.filter(r => r.type !== "sg");
      sections.push({ head: `What our monitoring shows (${tm.name})`, lines: [C.counts(mon).join(", "),
        ...other.slice(0, 10).map(r => `${C.line(r)}${r.next ? " · Next: " + String(r.next).replace(/\s+/g, " ").slice(0, 200) : ""}`)] });
    }
    const sgArea = areas.find(a => a.id === "sg");
    if (sgArea) {
      const sgGaps = sgArea.items.filter(i => answers[i.id] === "no" || answers[i.id] === "part");
      const sgc = C.sgStatus(st);
      sections.push({ head: "Safeguarding", lines: [...(sgGaps.length ? sgGaps.map(i => `${LABEL[answers[i.id]]}: ${i.text}`) : ["All safeguarding lines rated so far are Met."]),
        `The DSL's termly checks: ${sgc.done} of ${sgc.total} done this term${sgc.done ? " (" + sgc.list.filter(x => x.rec).map(x => x.label).join(", ") + ")" : ""}`] });
    }
    const ch = changes(st, areas);
    if (ch && ch.lines.length) sections.push({ head: `What has changed since our last leadership meeting (${nice(ch.since)})`, lines: ch.lines.slice(0, 15) });
    // Questions for discussion
    const q = [];
    ranked.filter(a => a.rag === "off" || a.rag === "risk").slice(0, 3).forEach(a => q.push(`What would help get "${a.title}" back on track?`));
    rows.slice().sort((x, y) => x.sc.pct - y.sc.pct).slice(0, 2).forEach(({ a }) => q.push(`${a.name}: is our evaluation accurate, and what evidence would an inspector look for?`));
    if (ch && ch.lines.some(l => l.startsWith("Slipped"))) q.push("Some ratings have slipped since our last meeting. What should we do first?");
    q.push("Are these the right priorities for next half-term? What are we not seeing?");
    q.push("How well are leaders checking the impact of our work, not just that it's happened?");
    sections.push({ head: "Questions for discussion", lines: q });
    return { title: `Discussion paper${o.visit ? ": " + o.visit : ""}`, sections };
  }

  /** Agenda items for a SIP or consultant visit, taken from the discussion paper. */
  function sipAgenda(paper) {
    const pick = h => paper.sections.find(s => s.head.startsWith(h));
    const items = [];
    const add = (kind, title, prompt, lines) => items.push({ id: "s" + items.length + Math.random().toString(36).slice(2, 7), kind, title, prompt, lines: (lines || []).slice(0, 10), lineIds: [], actionIds: [] });
    const focus = pick("What we'd like");
    add("sip", "The focus of this visit", focus ? focus.para : "What do we want from today, and what does the adviser want to see?", []);
    const sg = pick("Safeguarding"); if (sg) add("safeguarding", "Safeguarding", "Is our safeguarding culture effective, and how do we know?", sg.lines);
    const pr = pick("Our priorities"); if (pr) add("sip", "Our priorities and how they're going", "Are we checking impact, not just activity?", pr.lines.slice(0, 6));
    const ch = pick("What has changed"); if (ch) add("changes", "What has changed", "", ch.lines.slice(0, 8));
    const q = pick("Questions for discussion"); if (q) q.lines.forEach(l => add("sip", l, "", []));
    add("next", "Agreed next steps, support and the next visit", "What will we do, who will check it, and what will the adviser look at next time?", []);
    return items;
  }

  /** Plain text version, for emails. */
  function toText(doc) {
    return [doc.title, "", ...doc.sections.flatMap(s => [s.head.toUpperCase(), ...(s.para ? [s.para] : []), ...(s.lines || []).map(l => "• " + l),
      ...(s.table ? [s.table.cols.join(" | "), ...s.table.rows.map(r => r.join(" | "))] : []), ""])].join("\n");
  }

  const api = { areaReport, sipPaper, sipAgenda, toText, score, INDICATORS, SUBJECTS, SUBJECT_PROMPTS, LABEL };
  root.HWWD = Object.assign(root.HWWD || {}, { briefs: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
