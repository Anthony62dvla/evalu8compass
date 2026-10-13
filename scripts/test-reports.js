/* Leaders' reports and the SIP discussion paper. Run: node scripts/test-reports.js
 * Uses a fake email server, and backs up and restores the data files it touches. */
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["access.json"].map(f => path.join(DATA, f));
fs.mkdirSync(path.join(DATA, "schools"), { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const before = new Set(fs.readdirSync(path.join(DATA, "schools")));
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const SMTP = 3984;
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", SITE_URL: "https://evalu8compass.test", MAIL_OUTBOX: "" });
const wait = () => new Promise(r => setTimeout(r, 200));

let mail;
(async () => {
  try {
    mail = await require("./fake-mail").start(SMTP);
    const BR = require("../public/js/briefs.js"), criteria = require("../public/js/criteria.js");
    const access = require("../lib/access"), schools = require("../lib/schools"), alerts = require("../lib/alerts"), M = require("../lib/meetings");
    const profile = { name: "Oak Primary", type: "maintained", phases: ["ks1", "ks2"] };
    const areas = criteria.resolve(profile);
    const team = [
      { id: "m1", name: "Pat Head", role: "head", email: "head@oak.sch.uk", alerts: "weekly", areas: [] },
      { id: "m2", name: "Dee Puty", role: "deputy", email: "deputy@oak.sch.uk", alerts: "weekly", areas: ["ct"] },
      { id: "m3", name: "Sam Safe", role: "dsl", email: "dsl@oak.sch.uk", alerts: "urgent", areas: ["sg"] },
      { id: "m6", name: "Alex Adviser", role: "sip", email: "alex@adviser.test", alerts: "urgent", areas: [] },
    ];
    const state = {
      profile, team,
      answers: { "sg-culture": "met", "sg-dsl": "no", "sg-follow": "part" },
      notes: { "sg-culture": "Staff survey: 98% know how to raise a concern", "sg-dsl": "Training lapsed in July" },
      actions: [
        { id: "a1", title: "DSL refresher training", owner: "DSL", itemId: "sg-dsl", due: "2026-11-01", status: "doing", rag: "risk", milestones: [{ id: "x", text: "Book course", done: true }] },
        { id: "a2", title: "Reading fluency programme", owner: "Deputy head", status: "done", impact: "Year 3 fluency up 12 words per minute" },
      ],
      leads: { sg: { commentary: "Culture is strong; training records need tightening.", indicators: { concerns: { now: "14", last: "11" }, trained: { now: "92", last: "100" } } } },
      subjects: [{ id: "s1", subject: "Mathematics", leader: "Kim Maths", ratings: { sequence: "met", assess: "part" }, strengths: "Clear progression", next: "Tighten retrieval practice" }],
      meetings: [],
    };

    // Area report
    const r = BR.areaReport(state, areas, "sg");
    const heads = r.sections.map(s => s.head);
    ok(r.title === "Safeguarding: leader's report" || /leader's report/.test(r.title), "area report has a title");
    ok(heads.includes("Leader's commentary") && heads.includes("Key figures") && heads.includes("Not yet in place") && heads.includes("Actions"), "area report: commentary, key figures, gaps and actions");
    const kf = r.sections.find(s => s.head === "Key figures");
    ok(kf.table.rows.some(row => row[0].includes("training") && row[1] === "92%" && row[2] === "100%"), "key figures show this term and last term with units");
    ok(r.sections.find(s => s.head === "Summary").lines[0].includes("Sam Safe"), "report names the area's leader");
    ok(!BR.areaReport(state, areas, "nope"), "unknown area gives nothing");
    const ct = BR.areaReport(state, areas, "ct");
    const sr = ct.sections.find(s => s.head === "Subject reviews");
    ok(sr && sr.table.rows[0][0] === "Mathematics" && sr.table.rows[0].includes("Partly") && sr.table.rows[0].includes("Tighten retrieval practice"), "curriculum report includes subject reviews");
    ok(BR.SUBJECTS.length >= 20 && BR.SUBJECTS.includes("Mathematics"), "subjects come from a list");

    // Discussion paper
    const paper = BR.sipPaper(state, areas, { focus: "Test our view of safeguarding training", visit: "SIP visit: Autumn" });
    const ph = paper.sections.map(s => s.head);
    ok(paper.title === "Discussion paper: SIP visit: Autumn", "paper titled with the visit");
    ok(["About the school", "What we'd like from this visit", "Our self-evaluation at a glance", "Our priorities and how they're going", "Completed, with impact", "Safeguarding", "Questions for discussion"].every(h => ph.includes(h)), "paper has all its sections");
    ok(paper.sections.find(s => s.head === "Questions for discussion").lines.some(l => l.includes("DSL refresher training")), "questions include the action at risk");
    ok(!BR.toText(paper).includes("Training lapsed"), "the paper doesn't include evidence notes");
    const ag = BR.sipAgenda(paper);
    ok(ag[0].title === "The focus of this visit" && ag[0].prompt.includes("safeguarding training") && ag[ag.length - 1].kind === "next" && ag.some(i => i.kind === "safeguarding"), "visit agenda: focus first, safeguarding, next steps last");
    ok(ag.every(i => i.id && Array.isArray(i.lines) && Array.isArray(i.lineIds)), "agenda items have the meeting item shape");

    // Emails
    const code = access.add("Oak Primary", 365);
    schools.replace(code.id, state);
    const n = await M.sendReport("Oak Primary", schools.get(code.id).state, "sg"); await wait();
    const rep = mail.inbox.filter(m => /Safeguarding: leader's report/.test(m.subject));
    ok(n === 2 && rep.length === 1 && rep[0].to.includes("dsl@oak.sch.uk") && rep[0].to.includes("head@oak.sch.uk") && !rep[0].to.includes("alex@adviser.test") && !rep[0].to.includes("deputy@oak.sch.uk"), "report emailed to the area's leader and the head only");
    ok(/92%/.test(rep[0].text) && /Culture is strong/.test(rep[0].text), "report email includes the key figures and commentary");

    const visit = { id: "v1", kind: "sip", title: "SIP visit: Autumn second half-term", date: "2026-10-19", time: "09:00", status: "planned", focus: "Test our view of safeguarding training", attendees: ["m1", "m2"], agenda: ag, minutes: {}, actions: [] };
    state.meetings = [visit]; schools.replace(code.id, state);
    let err = null; try { await M.sendMeeting("Oak Primary", schools.get(code.id).state, visit, "paper"); } catch (e) { err = e; }
    ok(err && err.status === 400 && /Tick your SIP/.test(err.message), "paper won't send until the adviser is an attendee");
    visit.attendees.push("m6"); schools.replace(code.id, state);
    const np = await M.sendMeeting("Oak Primary", schools.get(code.id).state, visit, "paper"); await wait();
    const pm = mail.inbox.filter(m => /Discussion paper: SIP visit/.test(m.subject));
    ok(np === 3 && pm.length === 1 && pm[0].to.includes("alex@adviser.test") && pm[0].to.includes("head@oak.sch.uk"), "paper emailed to the adviser and the leaders attending");
    ok(/Questions for discussion/i.test(pm[0].text) && /Test our view of safeguarding training/.test(pm[0].text), "paper email has the focus and questions");
    ok(!/Training lapsed/.test(pm[0].text), "no evidence notes in the adviser's copy");

    // A week before: the draft paper goes to the school's leaders, not the adviser
    const T = "2026-10-13";
    const n0 = await alerts.runSchool(code.id, "Oak Primary", new Date(T + "T10:00:00Z")); await wait();
    const auto = mail.inbox.filter(m => /Discussion paper/.test(m.subject)).slice(1);
    ok(auto.length === 1 && !auto[0].to.includes("alex@adviser.test") && auto[0].to.includes("head@oak.sch.uk") && /Check it, then send it to your adviser/.test(auto[0].text), "a week before: draft paper to leaders only, to check");
    ok(!mail.inbox.some(m => /Agenda: SIP visit/.test(m.subject)), "no leadership agenda email for a SIP visit");
    await alerts.runSchool(code.id, "Oak Primary", new Date(T + "T11:00:00Z")); await wait();
    ok(mail.inbox.filter(m => /Discussion paper/.test(m.subject)).length === 2, "the draft isn't sent twice");
    ok(n0 >= 1, "counted as sent");

    // Weekly emails never go to the adviser
    await alerts.runSchool(code.id, "Oak Primary", new Date("2026-10-19T06:30:00Z")); await wait();
    ok(!mail.inbox.some(m => /Your week/.test(m.subject) && m.to.includes("alex@adviser.test")), "the adviser doesn't get the school's weekly email");

    // Sanitising
    const cleaned = schools.get(code.id).state;
    ok(cleaned.leads.sg.indicators.trained.now === "92" && cleaned.subjects[0].subject === "Mathematics" && cleaned.meetings[0].kind === "sip", "reports, subjects and visits are saved");
  } catch (e) { console.error(e); ok(false, "threw: " + e.message); }
  finally {
    if (mail) mail.close();
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    setTimeout(() => process.exit(), 50);
  }
})();
