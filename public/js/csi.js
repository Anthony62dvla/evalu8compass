/*
 * Evalu8 Compass — Catholic Schools Inspectorate (CSI) for Catholic schools (shared by browser and server)
 * ------------------------------------------------------------
 * Follows the CSI National Framework (Inspection Handbook, September 2025). Three key areas,
 * Catholic life and mission, religious education and collective worship, each judged through
 * pupil outcomes, provision and leadership, on the four-point scale. Alongside them, compliance with
 * the Bishops' Conference general norms for RE (and any diocesan requirements), and the response to the
 * last inspection's areas for improvement. Leaders write their Catholic Self-Evaluation Document (CSED) here.
 * The area and sub-area names follow the handbook; the prompts are our own wording.
 *
 * state.csi = { last: { date, overall, clm, re, cw, areas, reading }, ctx: {...}, clm_po..cw_le: { evidence, next, grade },
 *               key_clm/key_re/key_cw: { grade }, comp: { time, red, diocese }, afi: { "0": "fully"|... } }
 */
(function (root) {
  const GRADES = { 1: "Outstanding", 2: "Good", 3: "Requires improvement", 4: "Inadequate" };
  const AREAS = [
    { id: "clm", name: "Catholic life and mission", short: "Catholic life" },
    { id: "re", name: "Religious education", short: "RE" },
    { id: "cw", name: "Collective worship", short: "Worship" },
  ];
  const SUBS = [["po", "Pupil outcomes"], ["pr", "Provision"], ["le", "Leadership"]];
  const PROMPTS = {
    clm_po: ["How well do pupils understand the school's Catholic mission, and how do they contribute to it?", "Do pupils feel valued as unique, made in the image of God?", "Are pupils growing in virtue, and responding to Catholic Social Teaching through action?", "How well do pupils respect themselves and others, and take part in chaplaincy?"],
    clm_pr: ["Is the mission statement known, lived and reviewed by the whole community?", "How committed are staff to the mission, and how are they supported in it?", "Is the school a welcoming community, with pastoral care that reflects the Gospel?", "Does the environment express the Catholic character? How effective is chaplaincy?", "Is relationships, sex and health education in line with Church teaching and diocesan guidance?"],
    clm_le: ["How well do leaders and governors promote the Catholic life and mission, and model it?", "How well do they monitor and evaluate it, and is self-evaluation accurate and used to improve?", "How well do leaders work with parents, the parish and the diocese?"],
    re_po: ["How well do pupils achieve in RE by the end of each key stage, including pupils with SEND and those who are disadvantaged?", "Do pupils' knowledge, understanding and skills grow as the Religious Education Directory expects?", "Do pupils enjoy RE, and can they talk about their learning with confidence?"],
    re_pr: ["How good are teaching, learning and assessment in RE?", "Do teachers have secure subject knowledge, set high expectations and adapt teaching so all pupils succeed?", "Is the curriculum well planned, implementing the Religious Education Directory (To Know You More Clearly)?"],
    re_le: ["How well do leaders and governors promote, monitor and evaluate RE?", "Is RE given its full place: curriculum time, staffing, resources and training on a par with other core subjects?", "How well do leaders know the quality of RE, through accurate assessment and monitoring, and act on it?"],
    cw_po: ["How well do pupils take part in and respond to prayer and collective worship?", "Can pupils plan and lead worship confidently, drawing on scripture and the Church's traditions of prayer?", "Do pupils understand the liturgical year and the place of the sacraments?"],
    cw_pr: ["How good is the collective worship the school provides: rooted in scripture and the liturgical year, with a variety of prayer?", "Is worship inclusive of everyone, respecting those of other faiths and none?", "Are there opportunities for Mass and the sacraments, with the parish?"],
    cw_le: ["How well do leaders and governors promote, monitor and evaluate collective worship?", "How well are staff trained and supported to lead prayer and worship?", "How are pupils given the skills and opportunities to plan and lead worship?"],
  };
  const COMPLIANCE = [
    ["time", "RE has at least 10% of curriculum time (5% in the sixth form), as the Bishops' Conference requires"],
    ["red", "The RE curriculum follows the Religious Education Directory (To Know You More Clearly): fully in place in secondary schools from September 2025 and primary schools from September 2026"],
    ["diocese", "We meet any additional requirements of our diocesan bishop (for example an approved RSHE programme)"],
  ];
  const COMP = { yes: "Yes", partly: "Partly", no: "No" };
  const AFI = { fully: "Fully addressed", partially: "Partially addressed", not: "Not yet addressed", na: "Not applicable" };

  const isCatholic = p => !!(p && p.church === "catholic" && p.type !== "independent");
  const subIds = () => AREAS.flatMap(a => SUBS.map(([s]) => `${a.id}_${s}`));
  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";

  /** The last report's areas for improvement, one per line. */
  const afis = state => String((((state && state.csi) || {}).last || {}).areas || "").split(/\n+/).map(x => x.trim()).filter(Boolean);

  /** Leaders' own grades: sub-areas, a suggested and chosen grade for each key area, and the overall grade that follows. */
  function status(state) {
    const c = (state && state.csi) || {};
    const areas = AREAS.map(a => {
      const subs = SUBS.map(([s, label]) => ({ id: `${a.id}_${s}`, label, grade: Number((c[`${a.id}_${s}`] || {}).grade) || 0 }));
      const g = subs.map(x => x.grade).filter(Boolean);
      const suggested = g.length === 3 ? Math.min(4, Math.round(g.reduce((t, x) => t + x, 0) / 3 + 0.0001)) : 0;
      const chosen = Number((c["key_" + a.id] || {}).grade) || 0;
      return { ...a, subs, suggested, grade: chosen || suggested };
    });
    const comp = c.comp || {}, list = afis(state), resp = c.afi || {};
    const compOk = COMPLIANCE.every(([k]) => comp[k] === "yes"), compAny = COMPLIANCE.some(([k]) => comp[k]);
    const afiAll = list.every((_, i) => ["fully", "na"].includes(resp[i])), afiNone = list.length && list.every((_, i) => resp[i] === "not");
    let overall = 0;
    if (areas.every(a => a.grade)) {
      const worst = Math.max(...areas.map(a => a.grade));
      if (worst === 4) overall = 4;
      else if (worst === 3 || !afiAll) overall = afiNone && list.length ? 4 : 3;
      else if (areas.every(a => a.grade === 1) && compOk && afiAll) overall = 1;
      else overall = 2;
    }
    return { areas, overall, compOk, compAny, afiList: list, afiAll, rated: areas.flatMap(a => a.subs).filter(s => s.grade).length };
  }
  function nextDue(state) {
    const l = (((state && state.csi) || {}).last) || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date || "")) return null;
    const y = Number(l.date.slice(0, 4)) + (Number(l.overall) >= 3 ? 3 : 5);
    return `${y}${l.date.slice(4)}`;
  }
  const evidenceFor = (state, sub) => ((state && state.monitoring) || []).filter(r => r && r.status === "done" && r.csi === sub).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  /** The Catholic Self-Evaluation Document (CSED), as a document. */
  function csed(state) {
    const st = state || {}, p = st.profile || {}, c = st.csi || {}, ctx = c.ctx || {};
    const C = typeof module !== "undefined" && module.exports ? require("./checks.js") : root.HWWD.checks;
    const stt = status(st), sections = [];
    const phases = (p.phases || []).map(x => ({ eyfs: "EYFS", ks1: "KS1", ks2: "KS2", ks3: "KS3", ks4: "KS4", p16: "post-16" })[x] || x).join(", ");
    sections.push({ head: "Our school", lines: [`${p.name || "Our school"}: Catholic ${p.type === "academy" ? "academy" : "maintained school"}${phases ? ", " + phases : ""}${c.roll ? `, ${c.roll} pupils on roll` : ""}${c.catholicPct ? `, ${c.catholicPct}% baptised Catholic` : ""}`,
      ...[["diocese", "Diocese"], ["parish", "Parish and chaplaincy"], ["trust", "Trust or governance"]].filter(([k]) => (ctx[k] || "").trim()).map(([k, l]) => `${l}: ${ctx[k].trim()}`)] });
    if ((ctx.mission || "").trim()) sections.push({ head: "Our mission statement", para: ctx.mission.trim() });
    if ((ctx.context || "").trim()) sections.push({ head: "Our context", para: ctx.context.trim() });
    const l = c.last || {};
    if (l.date || l.overall) sections.push({ head: "Our last Catholic schools inspection", lines: [
      `${l.date ? nice(l.date) : "Date not given"}${l.overall ? ": overall " + GRADES[l.overall] : ""}${["clm", "re", "cw"].some(k => l[k]) ? ` (${AREAS.filter(a => l[a.id]).map(a => `${a.short} ${GRADES[l[a.id]]}`).join(", ")})` : ""}`] });
    sections.push({ head: "Our self-evaluation at a glance", table: { cols: ["", "Pupil outcomes", "Provision", "Leadership", "Overall"], rows: stt.areas.map(a => [a.name, ...a.subs.map(s => s.grade ? GRADES[s.grade] : "–"), a.grade ? GRADES[a.grade] : "–"]) } });
    stt.areas.forEach(a => a.subs.forEach(s => {
      const v = c[s.id] || {}, mon = evidenceFor(st, s.id).slice(0, 5).map(r => "Monitoring: " + C.line(r));
      sections.push({ head: `${a.name}: ${s.label}${s.grade ? " (" + GRADES[s.grade] + ")" : ""}`, lines: mon, para: [(v.evidence || "").trim() ? "Strengths and evidence: " + v.evidence.trim() : "", (v.next || "").trim() ? "\nAreas to develop: " + v.next.trim() : ""].filter(Boolean).join("\n") });
    }));
    const comp = c.comp || {};
    sections.push({ head: "Compliance", lines: COMPLIANCE.map(([k, label]) => `${label}: ${COMP[comp[k]] || "not yet confirmed"}`) });
    if (stt.afiList.length) sections.push({ head: "Response to our last areas for improvement", lines: stt.afiList.map((t, i) => `${t}: ${AFI[(c.afi || {})[i]] || "not yet evaluated"}`) });
    sections.push({ head: "Overall", lines: [stt.overall ? `On the CSI scale, our evaluation points to: ${GRADES[stt.overall]}` : "Grade every area to see where your evaluation points overall."] });
    return { title: `Catholic self-evaluation (CSED)${p.name ? ": " + p.name : ""}`, sections };
  }

  function summaryLines(state) {
    const stt = status(state), out = [];
    out.push(stt.rated ? `Our evaluation: ${stt.areas.map(a => `${a.short} ${a.grade ? GRADES[a.grade] : "not yet graded"}`).join("; ")}${stt.overall ? `; overall ${GRADES[stt.overall]}` : ""}` : "Leaders haven't yet evaluated the Catholic schools inspection areas in Evalu8 Compass.");
    stt.areas.forEach(a => a.subs.filter(s => s.grade >= 3).forEach(s => out.push(`${a.name}, ${s.label.toLowerCase()}: ${GRADES[s.grade]}`)));
    if (stt.compAny && !stt.compOk) out.push("Not yet fully compliant with the general norms for RE or diocesan requirements");
    if (stt.afiList.length && !stt.afiAll) out.push("Not all of our last areas for improvement are fully addressed");
    const due = nextDue(state); if (due) out.push(`Next Catholic schools inspection expected around ${nice(due)}`);
    return out;
  }

  const api = { GRADES, AREAS, SUBS, PROMPTS, COMPLIANCE, COMP, AFI, isCatholic, subIds, afis, status, nextDue, evidenceFor, csed, summaryLines };
  root.HWWD = Object.assign(root.HWWD || {}, { csi: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
