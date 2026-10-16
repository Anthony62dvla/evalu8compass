/*
 * Evalu8 Compass — SIAMS for Church of England and Methodist schools (shared by browser and server)
 * ------------------------------------------------------------
 * Follows the SIAMS Framework (September 2024, updated September 2026). SIAMS deliberately has no
 * criteria to meet: it asks Inspection Questions about impact, rooted in the school's theologically
 * rooted Christian vision. So this module holds the school's context, its vision, and for each
 * Inspection Question its evidence of impact, what isn't yet true, and whether leaders believe they
 * can answer the question "yes" with evidence. The main questions are quoted from the framework;
 * the prompts beneath them are our own wording. See nse.org.uk for the framework itself.
 *
 * state.siams = { last: { date, outcome: "J1"|"J2"|"other", areas }, ctx1: {...}, ctx2: {...}, iq1..iq7: { evidence, next, judge } }
 */
(function (root) {
  const CHURCH = { cofe: "Church of England", methodist: "Methodist", joint: "Joint Anglican and Methodist" };
  const DESIGNATION = { vc: "Voluntary controlled", fvc: "Academy, formerly voluntary controlled", va: "Voluntary aided", fva: "Academy, formerly voluntary aided", foundation: "Foundation", other: "Other designation" };
  const JUDGE = { yes: "Yes, with evidence", partly: "Partly", notyet: "Not yet" };

  /* Context 1: who are we? (factual; no judgement is made on it) */
  const CTX1 = [
    ["leadership", "How school and trust leadership is structured, and what is delegated locally"],
    ["pupils", "Our pupils and community: how diverse, and what pupils need educationally"],
    ["partners", "Our church and diocesan (or MAST) partnerships"],
    ["other", "Other links and partnerships"],
  ];
  /* Context 2: what are we doing here? (informs the judgements) */
  const CTX2 = [
    ["vision", "Our vision, and the trust's vision", "Write the vision as you would say it to a visitor."],
    ["theology", "How our vision is theologically rooted", "The biblical text or theology at its heart, and why it fits this school. How the trust's vision resonates with it."],
    ["context", "How our community's needs shape the vision", "Do we understand our context, and do we know how to respond to it theologically?"],
    ["status", "Why we are a maintained school or an academy", "And how that status makes us more effective as a Church school."],
    ["governance", "Our governance, and how it strengthens us as a Church school", "Why it is structured as it is, given our vision, foundation and context, and how we know it adds to our work."],
    ["worship", "Our arrangements for collective worship, and why", ""],
    ["re", "How RE is structured and organised, and why", ""],
    ["diocese", "Our relationship with the diocese (DBE) and/or MAST", "How it helps us live out our vision and live up to our foundation."],
    ["church", "Our relationship with our local church or churches", "How it helps us live out our vision and live up to our foundation."],
  ];

  /* The Inspection Questions. q = the framework's question; prompts = our wording; trust = extra prompt for academies;
     gap = what SIAMS would report if leaders can't answer the question "yes"; seen = monitoring types that give evidence. */
  const IQS = [
    { id: "iq1", n: 1, short: "Vision", q: "How does the school's theologically rooted Christian vision enable pupils and adults to flourish?",
      prompts: ["How is the vision expressed, for example through values faithful to our Anglican or Methodist foundation?", "What else do leaders do so that the vision is a living reality, not words on a wall?", "How do we know the vision is helping pupils and adults to flourish? What would people tell an inspector?"],
      trust: "How does the trust's vision resonate with ours in a way that strengthens our work and our Christian foundation?",
      gap: "a theologically rooted Christian vision that is enabling pupils and adults to flourish", seen: ["pupil", "staff", "parent", "gov"] },
    { id: "iq2", n: 2, short: "Curriculum", q: "How does the curriculum reflect the school's theologically rooted Christian vision?",
      prompts: ["Where does the vision shape the curriculum, including what happens beyond lessons?", "How is spiritual development part of the curriculum itself, not an add-on?", "How do we know the curriculum is having the effect we intend for pupils?", "How does the vision shape learning for pupils who are vulnerable or disadvantaged?"],
      trust: "How does being part of the trust strengthen our curriculum?",
      gap: "a curriculum that reflects the school's Christian vision", seen: ["walk", "drop", "work", "pupil"] },
    { id: "iq3", n: 3, short: "Collective worship", q: "How is daily collective worship enabling pupils and adults to flourish spiritually?",
      prompts: ["How do our vision and foundation shape worship and spirituality in school?", "How do our diocesan or MAST partners, and our local church, enrich this?", "In what ways is worship inclusive, invitational and inspirational?", "What do pupils and adults understand spirituality to mean here, and how does that enrich worship and their own spiritual development?"],
      trust: "How does the trust add to our worship and spiritual life?",
      gap: "daily collective worship that is enabling pupils and adults to flourish spiritually", seen: ["cw", "pupil", "staff"] },
    { id: "iq4", n: 4, short: "Treated well", q: "How does the school's theologically rooted Christian vision create a culture in which pupils and adults are treated well?",
      prompts: ["How does the vision help everyone live well together in an inclusive, dignifying and fair culture?", "How do our policies and practice improve people's wellbeing?", "How is good mental health for everyone central to our work?", "What helps pupils and adults, including those who are vulnerable or disadvantaged, through difficult times?"],
      trust: "How does the trust add to the inclusion and wellbeing of pupils and adults?",
      gap: "a culture in which pupils and adults are treated well", seen: ["pupil", "staff", "parent", "records"] },
    { id: "iq5", n: 5, short: "Justice and responsibility", q: "How does the school's theologically rooted Christian vision create an active culture of justice and responsibility?",
      prompts: ["How does the vision build relationships that balance individual freedom and rights with responsibility to others?", "How are pupils encouraged towards justice and courageous advocacy, making ethical choices and becoming agents of change?", "Which partnerships matter to us because of our vision, and how do they make a difference, both ways?"],
      trust: "How does the trust have a positive effect on our culture?",
      gap: "an active culture of justice and responsibility", seen: ["pupil", "walk"] },
    { id: "iq6", n: 6, short: "RE curriculum", q: "Is the religious education curriculum effective (with reference to the Church of England's Statement of Entitlement for RE)?",
      prompts: ["Do the provision, profile and priority of RE in every key stage reflect its place in a Church school?", "Is RE taught in a way that is objective, critical and pluralistic, and challenging, well sequenced, balanced and relevant?", "Is RE well resourced, so pupils meet a range of ways of knowing: theology, philosophy, and the human and social sciences?", "Does staff training give teachers secure subject knowledge, so they teach accurately and tackle misconceptions?"],
      trust: "",
      gap: "provision, profile and priority for RE that result in an effective curriculum", seen: ["re", "work", "pupil"] },
    { id: "iq7", n: 7, short: "Quality of RE", q: "What is the quality of religious education?",
      prompts: ["How does teaching help all pupils achieve highly, whatever their needs or disadvantage?", "How does accurate, inclusive assessment help every pupil make progress?", "Judge this against the expectations of the RE syllabus you use, or national standards."],
      trust: "",
      gap: "pupils achieving highly in RE, with accurate and inclusive assessment ensuring this", seen: ["re", "work"] },
  ];

  const isChurch = p => !!(p && CHURCH[p.church] && p.type !== "independent");
  /** IQ7 applies to voluntary aided schools, former VA academies, and former VC academies that teach denominational RE. */
  const hasIQ7 = p => !!p && (p.designation === "va" || p.designation === "fva" || (p.designation === "fvc" && p.denomRE));
  const isAcademy = p => !!p && p.type === "academy";
  function iqsFor(p) { return IQS.filter(q => q.id !== "iq7" || hasIQ7(p)); }

  /** Where the school stands: for each IQ, leaders' own view; and the J2 statements that would apply. */
  function status(state) {
    const st = state || {}, p = st.profile || {}, s = st.siams || {};
    const list = iqsFor(p).map(q => ({ q, judge: (s[q.id] || {}).judge || "", evidence: (s[q.id] || {}).evidence || "", next: (s[q.id] || {}).next || "" }));
    const yes = list.filter(x => x.judge === "yes").length, rated = list.filter(x => x.judge).length;
    const gaps = list.filter(x => x.judge === "partly" || x.judge === "notyet");
    return { list, yes, rated, total: list.length, gaps, ready: rated === list.length && !gaps.length };
  }
  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  /** Roughly when the next inspection is due: SIAMS normally inspects every five years. */
  function nextDue(state) {
    const d = ((state && state.siams) || {}).last && state.siams.last.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return null;
    const y = Number(d.slice(0, 4)) + 5; return `${y}${d.slice(4)}`;
  }

  /** Monitoring linked to an Inspection Question (tagged directly, or of a type that usually gives evidence for it). */
  function evidenceFor(state, iqId) {
    return ((state && state.monitoring) || []).filter(r => r && r.status === "done" && r.iq === iqId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /** The SIAMS self-evaluation, as a document (see briefs.js for the shape). For the school, its adviser and governors. */
  function sef(state) {
    const st = state || {}, p = st.profile || {}, s = st.siams || {}, c1 = s.ctx1 || {}, c2 = s.ctx2 || {};
    const C = typeof module !== "undefined" && module.exports ? require("./checks.js") : root.HWWD.checks;
    const sections = [];
    const phases = (p.phases || []).map(x => ({ eyfs: "EYFS", ks1: "KS1", ks2: "KS2", ks3: "KS3", ks4: "KS4", p16: "post-16" })[x] || x).join(", ");
    sections.push({ head: "Who are we?", lines: [
      `${p.name || "Our school"}: ${CHURCH[p.church] || "Church"} school, ${DESIGNATION[p.designation] ? DESIGNATION[p.designation].toLowerCase() : "designation not given"}${p.type === "academy" ? ", academy" : ", maintained"}${phases ? ", " + phases : ""}${s.roll ? `, ${s.roll} pupils on roll` : ""}`,
      ...(p.designation === "fvc" ? [`Denominational RE: ${p.denomRE ? "yes" : "no"}`] : []),
      ...CTX1.filter(([k]) => (c1[k] || "").trim()).map(([k, label]) => `${label}: ${c1[k].trim()}`),
    ] });
    const c2lines = CTX2.filter(([k]) => (c2[k] || "").trim());
    if (c2lines.length) c2lines.forEach(([k, label]) => sections.push({ head: label, para: c2[k].trim() }));
    if (s.last && (s.last.date || s.last.outcome)) sections.push({ head: "Our last SIAMS inspection", lines: [
      `${s.last.date ? nice(s.last.date) : "Date not given"}${s.last.outcome ? ": " + ({ J1: "living up to our foundation as a Church school (J1)", J2: "strengths, with issues to address (J2)", other: "under the previous framework" })[s.last.outcome] : ""}`,
      ...String(s.last.areas || "").split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => "Area for development: " + x)] });
    const stt = status(st);
    stt.list.forEach(({ q, judge, evidence, next }) => {
      const mon = evidenceFor(st, q.id).slice(0, 6).map(r => "Monitoring: " + C.line(r));
      sections.push({ head: `IQ${q.n}: ${q.q}`, lines: [`Our view: ${judge ? JUDGE[judge] : "not yet considered"}`, ...mon], para: [evidence.trim() ? "Evidence of impact: " + evidence.trim() : "", next.trim() ? "\nWhat we are working on: " + next.trim() : ""].filter(Boolean).join("\n") });
    });
    sections.push({ head: "Where we stand", lines: stt.rated < stt.total ? [`We have considered ${stt.rated} of the ${stt.total} Inspection Questions so far.`] :
      stt.gaps.length ? [`We can answer ${stt.yes} of ${stt.total} Inspection Questions "yes" with evidence. We are working on: ${stt.gaps.map(x => x.q.short).join(", ")}.`] : [`We believe we can answer all ${stt.total} Inspection Questions "yes", with evidence.`] });
    return { title: `SIAMS self-evaluation${p.name ? ": " + p.name : ""}`, sections };
  }

  /** Short lines for agendas, the governors' report and the SIP paper. */
  function summaryLines(state) {
    const stt = status(state), out = [];
    out.push(stt.rated ? `Inspection Questions we can answer "yes" with evidence: ${stt.yes} of ${stt.total}` : "Leaders haven't yet considered the SIAMS Inspection Questions in Evalu8 Compass.");
    stt.gaps.forEach(x => out.push(`IQ${x.q.n} ${x.q.short}: ${JUDGE[x.judge]}${x.next ? " · Next: " + x.next.replace(/\s+/g, " ").slice(0, 200) : ""}`));
    const due = nextDue(state); if (due) out.push(`Next SIAMS inspection expected around ${nice(due)} (usually five years after the last)`);
    return out;
  }

  const api = { CHURCH, DESIGNATION, JUDGE, CTX1, CTX2, IQS, isChurch, hasIQ7, isAcademy, iqsFor, status, nextDue, evidenceFor, sef, summaryLines };
  root.HWWD = Object.assign(root.HWWD || {}, { siams: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
