/* Checks the AI quality-check scoring with made-up AI replies (no AI calls). Run: node scripts/test-evals.js */
const E = require("../lib/evals");
const C = require("../public/js/criteria.js");
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const ref = E.REFERENCE.find(r => r.id === "belle-vue");
const ids = new Set(C.resolve(ref.profile).flatMap(a => a.items.map(i => i.id)));
const anyId = [...ids][0];

const good = {
  inspectionDate: "11 November 2025", framework: "renewed", safeguarding: "met",
  grades: [{ area: "Personal development and well-being", grade: "Strong standard" }, { area: "Achievement", grade: "Expected standard" },
    { area: "Attendance and behaviour", grade: "Expected standard" }, { area: "Curriculum and teaching", grade: "Expected standard" },
    { area: "Inclusion", grade: "Expected standard" }, { area: "Leadership and governance", grade: "Expected standard" }, { area: "Post 16 provision", grade: "Expected standard" }],
  nextSteps: ["Leaders should give staff clearer guidance on how to adapt the curriculum and teaching for pupils with SEND so they achieve well academically.",
    "Checks on what pupils have learned need to be used consistently, so gaps in understanding are spotted and inform future teaching."],
  findings: [{ itemId: anyId, type: "concern", finding: "a" }, { itemId: anyId, type: "concern", finding: "b" }, { itemId: null, type: "strength", finding: "c" }],
};
let s = E.score(ref.expected, good, ids);
ok(s.pct === 100, `faithful reading scores 100% (got ${s.pct}%: ${s.checks.filter(c => !c.ok).map(c => c.label).join(", ")})`);
ok(s.steps.every(x => x.ok), "paraphrased next steps are recognised");

const bad = JSON.parse(JSON.stringify(good));
bad.grades[0].grade = "Exceptional";                                   // wrong grade
bad.grades.push({ area: "Overall effectiveness", grade: "Good" });     // invented
bad.nextSteps.push("Improve the quality of homework across all subjects"); // added
bad.safeguarding = null; bad.framework = "earlier";
bad.findings.push({ itemId: "made-up-id", type: "concern", finding: "x" });
s = E.score(ref.expected, bad, ids);
const failed = s.checks.filter(c => !c.ok).map(c => c.label);
ok(failed.includes("Grade: Personal development and well-being"), "wrong grade caught");
ok(failed.includes("No grades that aren't in the report"), "invented grade caught");
ok(failed.includes("No next steps added that aren't in the report"), "added next step caught");
ok(failed.includes("Safeguarding") && failed.includes("Framework recognised"), "missing safeguarding and wrong framework caught");
ok(failed.includes("Findings only use real checklist lines"), "made-up checklist id caught");
ok(s.pct < 70, `poor reading scores low (${s.pct}%)`);

// The grade key at the end of a report card must not be read as this school's grades
const key = JSON.parse(JSON.stringify(good));
key.grades.push({ area: "Exceptional", grade: "Exceptional" }, { area: "Urgent improvement", grade: "Urgent improvement" });
ok(E.score(ref.expected, key, ids).checks.find(c => c.label === "No grades that aren't in the report").ok === false, "grade explanations read as grades are caught");

// Unrelated next step doesn't count as a match
ok(E.overlap("Promote and celebrate high attendance so that it improves for all pupils", "Improve reading in early years") < 0.34, "unrelated next steps don't match");
ok(E.overlap("Promote and celebrate high attendance so that it improves for all pupils", "Leaders should promote the importance of high attendance and celebrate it") >= 0.34, "paraphrase of the attendance step matches");

// Earlier framework reference
const old = E.REFERENCE.find(r => r.id === "bnos-zion");
const oldIds = new Set(C.resolve(old.profile).flatMap(a => a.items.map(i => i.id)));
const oldGood = { framework: "earlier", safeguarding: "effective", grades: old.expected.grades.map(([area, grade]) => ({ area, grade })), nextSteps: old.expected.nextSteps, findings: old.expected.nextSteps.map(() => ({ itemId: null, type: "concern", finding: "x" })) };
ok(E.score(old.expected, oldGood, oldIds).pct === 100, "earlier-framework report scored on its own grades");

// Typed expectations
const ex = E.parseExpected("Inclusion: Needs attention\nSafeguarding: Met\nFramework: renewed\nNext step: Improve attendance\nAchievement: Expected standard");
ok(ex.grades.length === 2 && ex.safeguarding === "met" && ex.nextSteps.length === 1, "admin can type the expected answers");
ok(E.parseExpected("") === null, "blank expectations: human review only");

// Line advice checks
ok(E.checkAdvice({ activities: [1, 2, 3].map(() => ({ lead: "SENCo", evidence: "x", when: "This term" })), inspectorQuestion: "q", quickWin: "w" }).length === 0, "well-formed advice passes");
const iss = E.checkAdvice({ activities: [{ lead: "", evidence: "", when: "Soon" }], summary: "Attendance is 87.3% nationally" });
ok(iss.some(i => /activities/.test(i)) && iss.some(i => /percentages/.test(i)) && iss.some(i => /no lead/.test(i)), "advice problems flagged: " + iss.length);

ok(E.checkAdvice({ activities: [1, 2, 3].map(() => ({ lead: "Attendance lead", evidence: "x", when: "This week", what: "List pupils below 90% attendance (persistent absence) and below 50% (severe absence)" })), inspectorQuestion: "q", quickWin: "w" }).length === 0, "DfE absence thresholds aren't flagged as invented statistics");

// Every reference report resolves to a checklist and its areas exist in the checklist's vocabulary
for (const r of E.REFERENCE) ok(C.resolve(r.profile).length >= 6 && r.url.startsWith("https://files.ofsted.gov.uk/"), `reference report ready: ${r.school}`);

// Same count, same order, different words: matched by position and flagged for a wording check
const pos = E.score({ framework: "renewed", safeguarding: "met", grades: [["Inclusion", "Expected standard"]], nextSteps: ["Make teaching clearer and tackle misconceptions"] },
  { framework: "renewed", safeguarding: "met", grades: [{ area: "Inclusion", grade: "Expected standard" }], nextSteps: ["Ensure pupils grasp demonstrations and explanations"], findings: [{ itemId: null, type: "concern", finding: "x" }] }, new Set());
ok(pos.pct === 100 && pos.checks.some(c => /matched by position/.test(c.detail)), "differently worded step in the same position matched and flagged for checking");
