/*
 * Evalu8 Compass — new independent schools: readiness for the first standard inspection
 * ------------------------------------------------------------
 * A newly registered independent school has had a pre-registration inspection,
 * which only judges whether each independent school standard is "likely to be met"
 * on paper. Its first standard inspection comes within its first year of
 * operation and looks at what is actually happening. This list sets out what
 * must be up and running by then, in the order it needs to happen. Each item is
 * linked to checklist lines, so its status comes from the school's own ratings.
 */
(function (root) {
  const STAGES = [
    { id: "open", label: "Before pupils start" },
    { id: "ht1", label: "First half-term" },
    { id: "t1", label: "By the end of the first term" },
    { id: "first", label: "Before the first standard inspection" },
  ];

  const ITEMS = [
    // Before pupils start
    { stage: "open", ref: "ISS Part 4, paras 18–21", title: "Single central record complete before anyone starts", lines: ["sg-scr", "sg-s128"],
      evidence: "Every member of staff, volunteer and proprietor has all required checks recorded and dated before starting, including section 128 checks for anyone in a management role." },
    { stage: "open", ref: "ISS Part 3, para 7; KCSIE", title: "Safeguarding leadership and training in place from day one", lines: ["sg-dsl", "sg-culture", "sg-gov"],
      evidence: "A trained DSL and deputy, safeguarding training and KCSIE Part 1 records for all staff, a published safeguarding policy, and a proprietor trained in safeguarding." },
    { stage: "open", ref: "ISS Part 3, para 15", title: "Admission and attendance registers kept from the first day", lines: ["ab-admreg", "ab-attreg", "sg-cme"],
      evidence: "Registers kept as the Pupil Registration Regulations require, with correct codes every session, and the local authority told about admissions and removals." },
    { stage: "open", ref: "ISS Part 3, paras 11–14", title: "Health and safety, fire, first aid and supervision arrangements working", lines: ["cm-hs", "cm-supervision"],
      evidence: "Current risk assessments, a fire risk assessment and a fire drill early in the first term, first aiders on site, and supervision rotas that are followed." },
    { stage: "open", ref: "ISS Part 5; Equality Act 2010", title: "Premises match what was registered", lines: ["cm-premises", "inc-access"],
      evidence: "Accommodation, washrooms and a medical room as registered, and an accessibility plan whose objectives are being acted on." },
    { stage: "open", ref: "Education and Skills Act 2008, s162", title: "Pupils admitted match the registration", lines: ["inc-admit", "cm-registration"],
      evidence: "Age range, number on roll and any SEN types match the registration. Any change needs DfE approval through a material change request before it happens." },
    { stage: "open", ref: "ISS Parts 6 and 7", title: "Required information published, and a compliant complaints procedure", lines: ["cm-web", "cm-contact", "cm-complaints"],
      evidence: "The required policies and information published, and a complaints procedure with a panel stage, with a written record of complaints started." },
    // First half-term
    { stage: "ht1", ref: "ISS Part 1, para 2", title: "Curriculum taught as planned in every subject and year group", lines: ["ct-coherent", "ct-breadth", "pd-pshe", "pd-rshe", "pd-careers", "p16-prog"],
      evidence: "Lessons and pupils' work match the written curriculum policy and schemes of work, including PSHE, relationships education or RSE, and careers guidance for secondary pupils." },
    { stage: "ht1", ref: "SEND Code of Practice; ISS para 3", title: "Pupils' starting points and needs known", lines: ["ach-baseline", "inc-identify", "inc-senco", "inc-ehcp"],
      evidence: "Baseline assessments for every pupil, a SEND register, EHC plans received from local authorities, and teachers using them to plan." },
    { stage: "ht1", ref: "ISS Part 3, paras 9–10", title: "Behaviour and anti-bullying policies working, with records", lines: ["ab-policy", "ab-log", "ab-bully"],
      evidence: "A behaviour policy that staff apply consistently, a written record of sanctions for serious misbehaviour, and bullying incidents recorded and acted on." },
    { stage: "ht1", ref: "KCSIE; Working Together 2023", title: "Safeguarding concerns recorded and followed through", lines: ["sg-follow", "sg-earlyhelp", "sg-filter"],
      evidence: "Concerns logged and acted on, links with local safeguarding partners and the LADO established, and online filtering and monitoring tested." },
    { stage: "ht1", ref: "EYFS statutory framework", title: "Early years requirements met", lines: ["ey-framework", "ey-key", "ey-ratio", "sg-eyfs"],
      evidence: "A key person for every child, ratios and qualifications met, paediatric first aid cover, and the seven areas of learning planned." },
    // By the end of the first term
    { stage: "t1", ref: "ISS Part 1, para 4", title: "A framework for assessing pupils' progress in use", lines: ["ach-track", "ct-assess"],
      evidence: "Assessment records show what pupils know and where they need help, and teachers adapt teaching in response." },
    { stage: "t1", ref: "Working together to improve school attendance", title: "Attendance analysed and absence followed up", lines: ["ab-wt", "ab-pa"],
      evidence: "The first term's attendance figures, analysis by group, and follow-up of every pupil whose absence is a concern." },
    { stage: "t1", ref: "ISS Part 2, para 5", title: "Fundamental British values, SMSC and respect for others evident", lines: ["pd-fbv", "pd-smsc"],
      evidence: "Planned and taught, with pupils able to talk about it. Respect for people with all the protected characteristics is actively promoted." },
    { stage: "t1", ref: "ISS Part 8, para 34", title: "The proprietor checks that every standard is met", lines: ["lg-compliance", "lg-gov", "lg-separate", "lg-qa"],
      evidence: "A standards tracker reviewed at least termly, records of the proprietor's checks and challenge, and leaders' monitoring of teaching and the curriculum." },
    // Before the first standard inspection
    { stage: "first", ref: "Toolkit: achievement", title: "Pupils' work shows progress from their starting points", lines: ["ach-work", "ach-ehcp", "ach-reading"],
      evidence: "Books, learning journals or portfolios show the curriculum being learned over the year, including progress towards EHC plan outcomes." },
    { stage: "first", ref: "ISS Part 8, para 34", title: "Policies reviewed against what actually happens", lines: ["lg-policies"],
      evidence: "Policies written before opening reviewed after the first term so they describe practice, not intentions." },
    { stage: "first", ref: "Toolkit: leadership and governance", title: "Staff trained for the pupils on roll", lines: ["inc-training", "ct-knowledge", "lg-staff"],
      evidence: "Induction and training records linked to the needs of the pupils actually admitted." },
    { stage: "first", ref: "ISS Part 6, para 32(1)(f)", title: "Parents informed and their views gathered", lines: ["lg-parents", "pd-voice"],
      evidence: "An annual written report to parents on each pupil's progress planned or sent, and parents' and pupils' views gathered and acted on." },
    { stage: "first", ref: "Toolkit: leadership and governance", title: "An accurate view of the school and a plan to improve", lines: ["lg-vision"],
      evidence: "Leaders' evaluation and improvement plan updated from the first terms' evidence, not just the plans made before opening." },
  ];

  const LABEL = { met: "In place", part: "Partly", no: "Not yet", todo: "Not assessed" };

  /** Items that apply to this school's checklist, each with a status worked out from its linked lines. */
  function evaluate(view, answers) {
    const inView = new Set(view.flatMap(a => a.items.map(i => i.id)));
    return ITEMS.map(it => {
      const lines = it.lines.filter(id => inView.has(id));
      if (!lines.length) return null;
      const applicable = lines.filter(id => answers[id] !== "na");
      const rated = applicable.map(id => answers[id]).filter(Boolean);
      let status = "todo";
      if (!applicable.length) status = "met";                       // everything linked is N/A
      else if (rated.includes("no")) status = "no";
      else if (rated.length === applicable.length && rated.every(v => v === "met")) status = "met";
      else if (rated.length) status = "part";
      return { ...it, lines, status, statusLabel: LABEL[status] };
    }).filter(Boolean);
  }

  /** Months since opening (from "YYYY-MM"), or null. */
  function monthsOpen(opened, now) {
    if (!/^\d{4}-\d{2}$/.test(opened || "")) return null;
    const [y, m] = opened.split("-").map(Number), d = now || new Date();
    return (d.getFullYear() - y) * 12 + (d.getMonth() + 1 - m);
  }
  /** The month by which the first standard inspection should have happened (end of the first year). */
  function dueBy(opened) {
    if (!/^\d{4}-\d{2}$/.test(opened || "")) return "";
    const [y, m] = opened.split("-").map(Number);
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${MONTHS[m - 1]} ${y + 1}`;
  }

  const api = { STAGES, ITEMS, evaluate, monthsOpen, dueBy, LABEL };
  root.HWWD = Object.assign(root.HWWD || {}, { newschool: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
