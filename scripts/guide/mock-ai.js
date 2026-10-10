/*
 * Example AI answers for the user-guide screenshots. Oakfield Academy and its
 * Ofsted report are made up. Shown in the guide as examples of what the AI produces.
 */
const REPORT_TEXT = `Oakfield Academy (fictional example). Inspection report card, renewed inspection framework, 14 May 2026.
Safeguarding standards met. Inclusion: Expected standard. Curriculum and teaching: Expected standard. Achievement: Expected standard. Attendance and behaviour: Strong standard. Personal development and well-being: Strong standard. Leadership and governance: Expected standard.
What it's like to be a pupil at this school: pupils are calm, polite and proud of their school. They feel safe and know who to talk to. Leaders have improved behaviour and attendance. The curriculum is well planned, but some teachers do not adapt it well enough for pupils with SEND, so these pupils do not achieve as well as they could. Checks on what pupils have learned are not used consistently to spot and fix gaps.
Next steps: Leaders should make sure staff adapt the curriculum precisely for pupils with SEND across all subjects. Leaders should make sure teachers check pupils' understanding consistently and use this to address misconceptions.`;

const advice = {
  summary: "Inspectors will test whether every concern, however small, reaches the DSL quickly and is followed through. Late logging by some subject staff is exactly the gap they look for when they sample records.",
  activities: [
    { title: "Re-brief all staff on same-day logging", what: "Use a 10-minute briefing to restate the expectation that concerns are logged on CPOMS the same day, with two short scenarios from your own school.", lead: "DSL", when: "This week", evidence: "Briefing slides and attendance list" },
    { title: "Spot-check 20 recent records", what: "Check the time between the concern and the log, and whether each record shows the action taken and the outcome.", lead: "Deputy DSL", when: "This half-term", evidence: "Dated audit with findings and follow-up" },
    { title: "Add logging to new-staff induction", what: "Make a CPOMS walkthrough part of induction, including supply and trainee teachers.", lead: "DSL with the HR lead", when: "This term", evidence: "Induction checklist signed by each new member of staff" },
  ],
  inspectorQuestion: "Show me a recent concern from a subject teacher: when was it logged, and what happened next?",
  quickWin: "Send a one-line reminder to all staff today that concerns must be logged the same day.",
};

const review = {
  overall: "Safeguarding looks secure, with a couple of points to tighten. The clearest weaknesses are in how well the curriculum is adapted for pupils with SEND and how consistently persistent absence is tackled. These would be the main lines of enquiry.",
  areas: [
    { area: "Safeguarding", grade: "Met", why: "Strong culture and records; filtering and monitoring reports need governor oversight." },
    { area: "Inclusion", grade: "Expected standard", why: "SEND leadership is in place, but identification of need is not yet consistent." },
    { area: "Curriculum and teaching", grade: "Needs attention", why: "Adaptation for pupils with SEND is not yet happening across subjects." },
    { area: "Attendance and behaviour", grade: "Expected standard", why: "Behaviour is calm; analysis of persistent absence by group is only partly in place." },
  ],
  priorities: [
    { title: "Adapt the curriculum for pupils with SEND", area: "Curriculum and teaching", actions: ["Agree what good adaptation looks like in each subject", "Coach teachers using real lessons", "Check pupils' work termly"], lead: "SENCo with heads of department", timescale: "This term", successLooksLike: "In any lesson, staff can show how a pupil's plan shapes their teaching." },
    { title: "Tackle persistent absence group by group", area: "Attendance and behaviour", actions: ["Analyse absence half-termly by group", "Agree a plan for each persistently absent pupil"], lead: "Senior attendance champion", timescale: "This half-term", successLooksLike: "Every persistently absent pupil has a plan and a named adult." },
  ],
  strengths: ["Safeguarding culture", "Behaviour and attitudes", "RSHE"],
  complianceChecks: [{ item: "Present filtering and monitoring reports to governors", lead: "DSL" }],
};

const reading = {
  inspectionDate: "14 May 2026", framework: "renewed", safeguarding: "met",
  grades: [["Inclusion", "Expected standard"], ["Curriculum and teaching", "Expected standard"], ["Achievement", "Expected standard"], ["Attendance and behaviour", "Strong standard"], ["Personal development and well-being", "Strong standard"], ["Leadership and governance", "Expected standard"]].map(([area, grade]) => ({ area, grade })),
  summary: "Oakfield Academy was judged Expected standard in four areas and Strong standard for attendance and behaviour and for personal development. Safeguarding standards were met. Pupils are calm, safe and proud of their school. The main weaknesses are how precisely the curriculum is adapted for pupils with SEND and how consistently teachers check understanding.",
  nextSteps: ["Make sure staff adapt the curriculum precisely for pupils with SEND across all subjects.", "Make sure teachers check pupils' understanding consistently and use this to address misconceptions."],
  findings: [
    { itemId: "ct-send", type: "concern", finding: "Some teachers do not adapt the curriculum well enough for pupils with SEND." },
    { itemId: "ct-assess", type: "concern", finding: "Checks on learning are not used consistently to spot and fix gaps." },
    { itemId: "ab-attitudes", type: "strength", finding: "Pupils are calm, polite and proud of their school." },
  ],
};

const themes = {
  overall: "Staff are positive about behaviour and pastoral care. The strongest theme is that support for pupils with SEND varies between classes, and that teaching assistants are not always part of planning.",
  areas: [
    { area: "Inclusion", themes: [{ theme: "SEND support varies by class", detail: "Pupil profiles exist but are not used consistently when planning.", mentions: "many" }, { theme: "TAs left out of planning", detail: "Support staff would like time with teachers before lessons.", mentions: "several" }] },
    { area: "Attendance and behaviour", themes: [{ theme: "Clear behaviour systems", detail: "Staff say routines are consistent and well understood.", mentions: "several" }] },
  ],
};

const plan = {
  summary: "Oakfield is a calm, inclusive school judged Expected standard or better in every area. Staff and the Ofsted report agree that the next step is precise adaptation for pupils with SEND, supported by consistent checks on learning. This term's plan focuses on four priorities that build on existing strengths.",
  priorities: [
    { title: "Precise adaptation for pupils with SEND in every subject", area: "Curriculum and teaching", why: "The report's first next step, and the strongest theme in staff comments.", sources: ["ofsted", "staff", "agreed"], lines: ["ct-send"],
      actions: [{ action: "Each department agrees two or three adaptations for its most common needs, using pupil profiles", lead: "SENCo with heads of department", by: "October half-term", evidence: "Adaptation notes in each scheme of work" },
        { action: "Fortnightly coaching visits focused on adaptation, with quick feedback", lead: "Deputy head (teaching and learning)", by: "December", evidence: "Coaching log and follow-up visits" }],
      successCriteria: "In any lesson, staff can show how a pupil's profile shapes their teaching.", monitoring: "SENCo reports to the head each half-term; SEND governor visits in December." },
    { title: "Consistent checks on understanding", area: "Curriculum and teaching", why: "The report's second next step; staff ratings were split.", sources: ["ofsted", "staff"], lines: ["ct-assess"],
      actions: [{ action: "Agree two low-workload routines (mini-whiteboards, hinge questions) for every lesson", lead: "Deputy head (teaching and learning)", by: "November", evidence: "Agreed routines and CPD record" },
        { action: "Book looks check that misconceptions are picked up and addressed", lead: "Heads of department", by: "December", evidence: "Book-look summaries" }],
      successCriteria: "Teachers routinely spot misconceptions in lessons and adjust teaching.", monitoring: "Half-termly learning walks by the senior team." },
    { title: "Teaching assistants part of planning", area: "Inclusion", why: "Raised repeatedly by support staff; supports priority 1.", sources: ["staff", "agreed"], lines: ["inc-training"],
      actions: [{ action: "Pilot a 10-minute weekly planning slot between teachers and TAs in English and maths", lead: "SENCo", by: "November", evidence: "Timetabled slots and TA feedback" }],
      successCriteria: "TAs say they know the plan for each lesson before it starts.", monitoring: "SENCo surveys TAs at the end of term." },
    { title: "Persistent absence, group by group", area: "Attendance and behaviour", why: "Attendance is strong overall, but staff and leaders split on whether persistent absence is analysed well.", sources: ["agreed", "staff", "context"], lines: ["ab-pa"],
      actions: [{ action: "Half-termly analysis of persistent absence by year group, SEND and disadvantage", lead: "Senior attendance champion", by: "October half-term", evidence: "Analysis with actions" },
        { action: "A named adult and a short plan for every persistently absent pupil", lead: "Heads of year", by: "December", evidence: "Plans and attendance trends" }],
      successCriteria: "Every persistently absent pupil has a plan, and the gap for disadvantaged pupils narrows.", monitoring: "Attendance champion reports to governors in December." },
  ],
  complianceChecks: [{ item: "Present filtering and monitoring reports to governors", lead: "DSL", by: "Next governors' meeting" }, { item: "Update the SEN information report on the website", lead: "SENCo", by: "2 weeks" }],
  quickWins: ["Share pupil profiles with every teacher and TA through the shared drive", "Remind staff to log concerns on CPOMS the same day"],
  staffMessage: "Thank you for the time and honesty you gave to our workshop. You told us that behaviour and pastoral care are real strengths, and that support for pupils with SEND still varies from class to class. Ofsted said the same. This term we will focus on four things: adapting lessons precisely for pupils with SEND, checking understanding, giving teaching assistants time to plan with teachers, and supporting pupils who miss too much school. Your views shaped every part of this plan, and I'll update you on progress before Christmas.",
};

function answer(prompt) {
  if (/STAFF WORKSHOP RESULTS/.test(prompt)) return plan;
  if (/ANONYMOUS STAFF COMMENTS/.test(prompt)) return themes;
  if (/CHECKLIST LINES/.test(prompt)) return reading;
  if (/readiness review/.test(prompt)) return review;
  return advice;
}

module.exports = { answer, REPORT_TEXT };
