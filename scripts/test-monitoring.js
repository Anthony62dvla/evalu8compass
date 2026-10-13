/* Monitoring and the DSL's termly safeguarding checks. Run: node scripts/test-monitoring.js
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
const SMTP = 3985;
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", SITE_URL: "https://evalu8compass.test", MAIL_OUTBOX: "" });
const wait = () => new Promise(r => setTimeout(r, 200));

let mail;
(async () => {
  try {
    mail = await require("./fake-mail").start(SMTP);
    const C = require("../public/js/checks.js"), AG = require("../public/js/agenda.js"), BR = require("../public/js/briefs.js"), criteria = require("../public/js/criteria.js");
    const access = require("../lib/access"), schools = require("../lib/schools"), alerts = require("../lib/alerts");

    // Terms
    ok(C.term("2026-10-13").key === "2026-autumn" && C.term("2027-02-01").key === "2027-spring" && C.term("2027-06-01").key === "2027-summer", "dates fall in the right term");
    ok(C.SG_CHECKS.length === 8 && !C.SG_CHECKS.some(c => /central record/i.test(c[1])), "eight termly safeguarding checks, not the single central record");

    const profile = { name: "Oak Primary", type: "maintained", phases: ["ks1", "ks2"] };
    const areas = criteria.resolve(profile);
    const team = [
      { id: "m1", name: "Pat Head", role: "head", email: "head@oak.sch.uk", alerts: "weekly", areas: [] },
      { id: "m2", name: "Dee Puty", role: "deputy", email: "deputy@oak.sch.uk", alerts: "weekly", areas: ["ct"] },
      { id: "m3", name: "Sam Safe", role: "dsl", email: "dsl@oak.sch.uk", alerts: "weekly", areas: ["sg"] },
      { id: "m4", name: "Kim Reading", role: "subject", email: "kim@oak.sch.uk", alerts: "weekly", areas: [] },
      { id: "m6", name: "Alex Adviser", role: "sip", email: "alex@adviser.test", alerts: "urgent", areas: [] },
    ];
    const T = "2026-10-13";
    const state = {
      profile, team, answers: { "sg-culture": "met" }, notes: {}, actions: [], meetings: [],
      monitoring: [
        { id: "r1", type: "sg", check: "staffknow", date: "2026-10-05", by: "Sam Safe", areaId: "sg", focus: "Staff safeguarding knowledge", found: "Most staff confident; two lunchtime staff unsure of low-level concerns", next: "Brief lunchtime staff", judge: "dev", status: "done", actionIds: [] },
        { id: "r2", type: "walk", date: "2026-10-08", by: "Dee Puty", areaId: "ct", lineId: "ct-coherent", focus: "Reading in Year 3", found: "Phonics consistent", next: "Share practice with Year 4", judge: "strong", status: "done", actionIds: [] },
        { id: "r3", type: "work", date: "2026-10-14", by: "Kim Reading", areaId: "ct", focus: "Writing books Year 5", status: "planned", actionIds: [] },
        { id: "r4", type: "pupil", date: "2026-06-10", by: "Dee Puty", areaId: "pd", focus: "Last term", status: "done", judge: "strong", actionIds: [] },
        { id: "bad", type: "walk", date: "not a date", judge: "awful", status: "weird", found: "x".repeat(5000) },
      ],
    };
    const code = access.add("Oak Primary", 365);
    schools.replace(code.id, state);
    const saved = schools.get(code.id).state;
    const bad = saved.monitoring.find(r => r.id === "bad");
    ok(saved.monitoring.length === 5 && bad.date === "" && bad.judge === "" && bad.status === "done" && bad.found.length === 3000, "records are cleaned when saved");
    const st = { ...state, monitoring: saved.monitoring.filter(r => r.id !== "bad") };

    const sgc = C.sgStatus(st, T);
    ok(sgc.done === 1 && sgc.total === 8 && sgc.list[0].rec.id === "r1", "this term's safeguarding checks: 1 of 8 done");
    ok(C.sgStatus(st, "2027-01-10").done === 0, "a new term starts the checks again");

    // Agenda
    const ag = AG.buildAgenda(st, areas, T);
    const sgItem = ag.find(i => i.kind === "safeguarding"), monItem = ag.find(i => i.kind === "monitoring");
    ok(sgItem.lines.some(l => /DSL's termly checks .*1 of 8 done/.test(l)), "agenda: safeguarding item shows the DSL's checks");
    ok(monItem && monItem.lines.some(l => /Reading in Year 3/.test(l) && /Share practice/.test(l)) && !monItem.lines.some(l => /Last term/.test(l)) && !monItem.lines.some(l => /lunchtime/.test(l)), "agenda: monitoring this term, without the safeguarding findings");
    ok(monItem.lineIds.includes("ct-coherent"), "agenda: linked lines can be re-rated in the meeting");

    // Reports
    const ct = BR.areaReport(st, areas, "ct");
    ok(ct.sections.some(s => /^Monitoring this term/.test(s.head) && s.lines.some(l => /Phonics consistent/.test(l))), "curriculum report includes its monitoring");
    const sg = BR.areaReport(st, areas, "sg");
    ok(sg.sections.some(s => s.head === "The DSL's termly safeguarding checks" && s.lines.length === 8), "safeguarding report lists all eight checks");
    const paper = BR.sipPaper(st, areas, {});
    const txt = BR.toText(paper);
    ok(/What our monitoring shows/i.test(txt) && /Learning walk: 1/.test(txt) && /Share practice with Year 4/.test(txt), "SIP paper summarises monitoring");
    ok(!/lunchtime staff/.test(txt) && /termly checks: 1 of 8 done/.test(txt), "SIP paper gives the safeguarding check count, not its findings");

    // Alerts: first run is quiet
    schools.replace(code.id, st);
    await alerts.runSchool(code.id, "Oak Primary", new Date(T + "T10:00:00Z")); await wait();
    ok(mail.inbox.length === 0, "first run: quiet");
    // A safeguarding check raises a concern
    st.monitoring.push({ id: "r5", type: "sg", check: "filter", date: T, by: "Sam Safe", areaId: "sg", found: "SECRET finding", judge: "concern", status: "done", actionIds: [] });
    st.monitoring.push({ id: "r6", type: "walk", date: T, by: "Pat Head", areaId: "ct", focus: "Maths Year 6", found: "SECRET2", judge: "concern", status: "done", actionIds: [] });
    schools.replace(code.id, st);
    await alerts.runSchool(code.id, "Oak Primary", new Date(T + "T11:00:00Z")); await wait();
    const sgm = mail.inbox.filter(m => /Safeguarding monitoring raised a concern: Filtering and monitoring/.test(m.subject));
    ok(sgm.length === 1 && ["head@oak.sch.uk", "deputy@oak.sch.uk", "dsl@oak.sch.uk"].every(e => sgm[0].to.includes(e)) && !sgm[0].to.includes("alex@adviser.test"), "safeguarding concern: key leaders told straight away");
    const ctm = mail.inbox.filter(m => /^\[Oak Primary\] Monitoring raised a concern: Maths Year 6/.test(m.subject));
    ok(ctm.length === 1 && ctm[0].to.includes("head@oak.sch.uk") && ctm[0].to.includes("deputy@oak.sch.uk") && !ctm[0].to.includes("dsl@oak.sch.uk"), "other concern: the head and the area's leader told");
    ok(!mail.inbox.some(m => /SECRET/.test(m.text)), "alerts never include what was found");
    await alerts.runSchool(code.id, "Oak Primary", new Date(T + "T12:00:00Z")); await wait();
    ok(mail.inbox.filter(m => /raised a concern/.test(m.subject)).length === 2, "not sent twice");

    // Monday: the person carrying out planned monitoring is reminded
    await alerts.runSchool(code.id, "Oak Primary", new Date("2026-10-19T06:30:00Z")); await wait();
    const kim = mail.inbox.find(m => /Your week/.test(m.subject) && m.to.includes("kim@oak.sch.uk"));
    ok(kim && /MONITORING/.test(kim.text) && /Writing books Year 5/.test(kim.text) && /Late, planned for/.test(kim.text), "Monday: planned monitoring in the leader's email (late, here)");
    const dsl = mail.inbox.find(m => /Your week/.test(m.subject) && m.to.includes("dsl@oak.sch.uk"));
    ok(dsl && /2 of 8 done/.test(dsl.text), "Monday: the DSL sees the termly checks still to do");
    const head = mail.inbox.find(m => /Your week/.test(m.subject) && m.to.includes("head@oak.sch.uk"));
    ok(head && /MONITORING THIS TERM/.test(head.text) && /Concern:/.test(head.text), "Monday: the head's summary includes this term's monitoring and concerns");

    // Four weeks before the end of term
    const n0 = mail.inbox.length;
    await alerts.runSchool(code.id, "Oak Primary", new Date("2026-11-25T10:00:00Z")); await wait();
    const rem = mail.inbox.slice(n0).filter(m => /Safeguarding checks: 6 still to do this term/.test(m.subject));
    ok(rem.length === 1 && rem[0].to.includes("dsl@oak.sch.uk") && rem[0].to.includes("head@oak.sch.uk") && !rem[0].to.includes("deputy@oak.sch.uk"), "four weeks before the end of term: DSL and head reminded of checks not done");
    await alerts.runSchool(code.id, "Oak Primary", new Date("2026-11-26T10:00:00Z")); await wait();
    ok(mail.inbox.filter(m => /still to do this term/.test(m.subject)).length === 1, "the reminder is sent once a term");
  } catch (e) { console.error(e); ok(false, "threw: " + e.message); }
  finally {
    if (mail) mail.close();
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    setTimeout(() => process.exit(), 50);
  }
})();
