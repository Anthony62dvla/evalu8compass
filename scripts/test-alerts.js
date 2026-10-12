/* Leadership team alerts. Run: node scripts/test-alerts.js
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
const SMTP = 3983;
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", SITE_URL: "https://evalu8compass.test", MAIL_OUTBOX: "" });

const D = (s, h) => new Date(`${s}T${String(h == null ? 10 : h).padStart(2, "0")}:00:00Z`);   // October is BST, so 06:30Z = 07:30 UK
let mail;
(async () => {
  try {
    mail = await require("./fake-mail").start(SMTP);
    const access = require("../lib/access"), schools = require("../lib/schools"), alerts = require("../lib/alerts");
    const L = require("../public/js/leaders.js");
    const code = access.add("Oak Primary", 365);
    const team = [
      { id: "m1", name: "Pat Head", role: "head", email: "head@oak.sch.uk", alerts: "weekly" },
      { id: "m2", name: "Dee Puty", role: "deputy", email: "deputy@oak.sch.uk", alerts: "weekly" },
      { id: "m3", name: "Sam Safe", role: "dsl", email: "dsl@oak.sch.uk", alerts: "urgent" },
      { id: "m4", name: "Jo Smith", role: "senco", email: "senco@oak.sch.uk", alerts: "weekly" },
      { id: "m5", name: "No Email", role: "attendance", email: "", alerts: "weekly" },
    ];
    // Ownership
    ok(L.owners(team, "SENCo")[0].id === "m4" && L.owners(team, "jo smith")[0].id === "m4" && L.owners(team, "DSL")[0].id === "m3" && L.owners(team, "Headteacher")[0].id === "m1", "owners matched by name or role");
    ok(L.keyLeaders(team).map(m => m.id).join() === "m1,m2,m3", "key leaders: head, deputy and DSL");

    const T = "2026-10-13";   // a Tuesday
    const state = {
      profile: { name: "Oak Primary", type: "maintained", phases: ["ks1", "ks2"] },
      answers: { "sg-dsl": "no", "sg-culture": "met" }, notes: { "sg-dsl": "SECRET-NOTE about a pupil" },
      team,
      actions: [
        { id: "a1", title: "Phonics catch-up groups", owner: "SENCo", due: "2026-10-16", status: "doing", milestones: [{ id: "x1", text: "Assess Year 2", due: "2026-10-15", done: false }] },
        { id: "a2", title: "DSL refresher training", owner: "DSL", itemId: "sg-dsl", due: "2026-10-11", status: "todo" },
        { id: "a3", title: "Attendance letters", owner: "Jo Smith", due: "2026-10-01", status: "todo" },
      ],
    };
    schools.replace(code.id, state);
    const run = now => alerts.runSchool(code.id, "Oak Primary", now);
    const n0 = await run(D(T));
    ok(n0 === 0 && mail.inbox.length === 0, "first run: takes stock quietly, no flood of emails");
    ok(await run(D(T)) === 0, "nothing new: nothing sent");

    // A safeguarding line newly rated Not yet
    state.answers["sg-culture"] = "no"; schools.replace(code.id, state);
    const n1 = await run(D(T)); await new Promise(r => setTimeout(r, 200));
    const sg = mail.inbox.filter(m => /Safeguarding: a line rated Not yet/.test(m.subject));
    ok(n1 === 1 && sg.length === 1 && ["head@oak.sch.uk", "deputy@oak.sch.uk", "dsl@oak.sch.uk"].every(e => sg[0].to.includes(e)) && !sg[0].to.includes("senco@oak.sch.uk"), "safeguarding line rated Not yet: head, deputy and DSL alerted (even the DSL, who chose urgent only)");
    ok(/Everyone knows how to raise a safeguarding concern/i.test(sg[0].text) || /safeguarding/i.test(sg[0].text), "the alert names the line");
    ok(await run(D(T)) === 0, "not sent twice");

    // An action marked At risk
    state.actions[0].rag = "risk"; schools.replace(code.id, state);
    await run(D(T)); await new Promise(r => setTimeout(r, 200));
    const risk = mail.inbox.filter(m => /At risk: Phonics catch-up groups/.test(m.subject));
    ok(risk.length === 1 && risk[0].to.includes("senco@oak.sch.uk") && risk[0].to.includes("head@oak.sch.uk"), "action marked At risk: key leaders and the owner (SENCo) alerted");
    state.actions[0].rag = "off"; schools.replace(code.id, state);
    await run(D(T)); await new Promise(r => setTimeout(r, 200));
    ok(mail.inbox.some(m => /Off track: Phonics/.test(m.subject)), "then Off track: alerted again");

    // New overdue items after the first run
    state.actions.push({ id: "a4", title: "Test filtering and monitoring", owner: "DSL", itemId: "sg-filter", due: "2026-10-12", status: "todo" });
    state.actions.push({ id: "a5", title: "Governor visit report", owner: "Pat Head", due: "2026-10-05", status: "todo" });
    schools.replace(code.id, state);
    await run(D(T)); await new Promise(r => setTimeout(r, 200));
    ok(mail.inbox.some(m => /Safeguarding action overdue: Test filtering/.test(m.subject) && m.to.includes("dsl@oak.sch.uk")), "safeguarding action overdue: alerted");
    const esc = mail.inbox.filter(m => /A week overdue: Governor visit report/.test(m.subject));
    ok(esc.length === 1 && esc[0].to.includes("head@oak.sch.uk"), "a week overdue: headteacher told");
    ok(!mail.inbox.some(m => /Attendance letters/.test(m.subject)), "items already overdue on the first run weren't sent all at once");

    // Monday 7am summaries
    const before7 = mail.inbox.length;
    await run(new Date("2026-10-19T05:30:00Z"));   // 06:30 UK on Monday
    await new Promise(r => setTimeout(r, 200));
    ok(!mail.inbox.slice(before7).some(m => /Your week/.test(m.subject)), "Monday before 7am: no weekly emails yet");
    ok(mail.inbox.slice(before7).some(m => /A week overdue: DSL refresher training/.test(m.subject)), "an action that's now a week overdue is escalated");
    state.answers["sg-dsl"] = "met"; state.answers["ct-coherent"] = "part"; schools.replace(code.id, state);
    await run(new Date("2026-10-19T06:30:00Z")); await new Promise(r => setTimeout(r, 300));   // 07:30 UK
    const weekly = mail.inbox.slice(before7).filter(m => /Your week in Evalu8 Compass/.test(m.subject));
    const to = weekly.map(m => m.to[0]);
    ok(to.includes("head@oak.sch.uk") && to.includes("deputy@oak.sch.uk") && to.includes("senco@oak.sch.uk") && !to.includes("dsl@oak.sch.uk"), "Monday 7:30: weekly emails to head, deputy and SENCo; not the DSL, who chose urgent only");
    const senco = weekly.find(m => m.to[0] === "senco@oak.sch.uk");
    ok(/OVERDUE/.test(senco.text) && /Phonics catch-up groups/.test(senco.text) && /Attendance letters/.test(senco.text), "SENCo's email lists their overdue actions");
    const head = weekly.find(m => m.to[0] === "head@oak.sch.uk");
    ok(/THE PLAN AT A GLANCE/.test(head.text) && /AT RISK OR OFF TRACK/.test(head.text) && /SAFEGUARDING LINES NOT YET MET/.test(head.text), "head's summary: plan at a glance, at risk, safeguarding gaps");
    await run(new Date("2026-10-19T09:00:00Z"));
    ok(mail.inbox.filter(m => /Your week/.test(m.subject)).length === weekly.length, "weekly emails sent once per week");
    // Next week shows what changed
    state.answers["ct-coherent"] = "met"; state.answers["sg-culture"] = "part"; schools.replace(code.id, state);
    const b2 = mail.inbox.length;
    await run(new Date("2026-10-26T08:00:00Z")); await new Promise(r => setTimeout(r, 300));
    const head2 = mail.inbox.slice(b2).find(m => /Your week/.test(m.subject) && m.to[0] === "head@oak.sch.uk");
    ok(head2 && /RATINGS CHANGED SINCE LAST WEEK/.test(head2.text) && /Better: .*Partly → Met/.test(head2.text) && /Slipped|Better/.test(head2.text), "next Monday: what got better and what slipped");
    ok(!mail.inbox.some(m => /SECRET-NOTE/.test(m.text) || /SECRET-NOTE/.test(m.html)), "notes are never included in emails");

    // Leadership meetings: the agenda is written and emailed a week before
    const AG = require("../public/js/agenda.js"), criteria = require("../public/js/criteria.js");
    const items = AG.buildAgenda(state, criteria.resolve(state.profile), "2026-10-27");
    ok(items[0].kind === "safeguarding" && items.some(i => i.kind === "risk") && items.some(i => i.kind === "overdue") && items[items.length - 1].kind === "next", "agenda: safeguarding first, then at risk, overdue … next steps last");
    ok(items[0].lines.some(l => /Not yet|Partly/.test(l)), "safeguarding item lists the lines not yet met");
    const withLast = { ...state, answers: { ...state.answers, "ct-coherent": "met" }, meetings: [{ id: "old", status: "done", closedAt: "2026-10-01T16:00:00Z", answersAtClose: { ...state.answers, "ct-coherent": "no" } }] };
    const ch = AG.buildAgenda(withLast, criteria.resolve(state.profile), "2026-10-27").find(i => i.kind === "changes");
    ok(ch && ch.lines.some(l => /^Better: .*Not yet → Met/.test(l)), "the next agenda shows what has changed since the last meeting");
    ok(AG.suggestedDates("2026-09-05").length === 6 && AG.suggestedDates("2026-11-01")[0] === "2026-12-08", "six suggested half-termly dates, only future ones");
    state.meetings = [{ id: "mt1", title: "Leadership meeting: Autumn second half-term", date: "2026-11-02", time: "16:00", status: "planned", attendees: ["m1", "m3", "m5"], agenda: [], minutes: {}, actions: [] }];
    schools.replace(code.id, state);
    const bm = mail.inbox.length;
    await run(D("2026-10-20")); await new Promise(r => setTimeout(r, 200));
    ok(!mail.inbox.slice(bm).some(m => /Agenda:/.test(m.subject)), "more than a week before: no agenda yet");
    await run(D("2026-10-26")); await new Promise(r => setTimeout(r, 300));
    const ag = mail.inbox.slice(bm).filter(m => /Agenda: Leadership meeting/.test(m.subject));
    ok(ag.length === 1 && ag[0].to.includes("head@oak.sch.uk") && ag[0].to.includes("dsl@oak.sch.uk") && ag[0].to.length === 2, "a week before: agenda emailed to attendees with email addresses");
    ok(/1\. Safeguarding/.test(ag[0].text) && /Overdue/.test(ag[0].text), "agenda email lists the items");
    const saved = schools.get(code.id).state.meetings[0];
    ok(saved.agenda.length >= 3 && saved.agendaBy === "auto", "the written agenda is saved to the meeting so leaders can edit it");
    await run(D("2026-10-27")); await new Promise(r => setTimeout(r, 200));
    ok(mail.inbox.filter(m => /Agenda: Leadership meeting/.test(m.subject)).length === 1, "agenda emailed once");
    // Minutes
    const meetings = require("../lib/meetings");
    const st2 = schools.get(code.id).state, m2 = { ...st2.meetings[0], status: "done", minutes: { [st2.meetings[0].agenda[0].id]: "DSL to audit 10 records by half-term" }, actions: [{ id: "a1", item: st2.meetings[0].agenda[0].id }] };
    const n = await meetings.sendMeeting("Oak Primary", st2, m2, "minutes"); await new Promise(r => setTimeout(r, 200));
    const mins = mail.inbox.find(m => /Minutes: Leadership meeting/.test(m.subject));
    ok(n === 2 && mins && /Decided: DSL to audit 10 records/.test(mins.text) && /Action: Phonics catch-up groups/.test(mins.text), "minutes emailed with decisions and new actions");

    // Test email
    const tr = await alerts.test("Oak Primary", team[3]); await new Promise(r => setTimeout(r, 200));
    ok(tr.ok && mail.inbox.some(m => /Test email/.test(m.subject) && m.to[0] === "senco@oak.sch.uk"), "test email works");

    // Email server down: tried again next time
    mail.close();
    state.answers["sg-safer"] = "no"; schools.replace(code.id, state);
    await run(D("2026-10-27"));
    mail = await require("./fake-mail").start(SMTP);
    await run(D("2026-10-27")); await new Promise(r => setTimeout(r, 200));
    ok(mail.inbox.some(m => /Safeguarding: a line rated Not yet/.test(m.subject)), "if the email server was down, the urgent alert is sent on the next run");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally {
    if (mail) mail.close();
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    setTimeout(() => process.exit(), 100);
  }
})();
