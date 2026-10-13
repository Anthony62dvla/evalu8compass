/* Governors and trustees: read-only access, termly report, challenge log. Run: node scripts/test-governors.js
 * Starts the server with a fake email server; backs up and restores the data files it touches. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["access.json"].map(f => path.join(DATA, f));
fs.mkdirSync(path.join(DATA, "schools"), { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const before = new Set(fs.readdirSync(path.join(DATA, "schools")));
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PORT = 3991, SMTP = 3986, base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms || 250));
const env = { ...process.env, PORT, ANTHROPIC_API_KEY: "", ACCESS_REQUIRED: "", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", SITE_URL: base, MAIL_OUTBOX: "", ALERT_DELAY_MS: "600000", SIGNUP_LIMIT_PER_MIN: "200", LOGIN_LIMIT_PER_MIN: "200" };
const req = (p, opt = {}) => fetch(base + p, { redirect: "manual", ...opt, headers: { "content-type": "application/json", ...(opt.headers || {}) } });
const post = (p, body, cookie) => req(p, { method: "POST", body: JSON.stringify(body || {}), headers: cookie ? { cookie } : {} });
const cookieOf = r => (r.headers.get("set-cookie") || "").split(";")[0];

let srv, mail;
(async () => {
  try {
    mail = await require("./fake-mail").start(SMTP);
    const access = require("../lib/access"), schools = require("../lib/schools"), BR = require("../public/js/briefs.js"), criteria = require("../public/js/criteria.js");
    const sch = access.add("Oak Primary", 365);
    const profile = { name: "Oak Primary", type: "maintained", phases: ["ks1", "ks2"] };
    const state = {
      profile, answers: { "sg-culture": "met", "sg-dsl": "part", "ct-coherent": "no", "ct-breadth": "met", "ct-knowledge": "part" },
      notes: { "sg-dsl": "SECRET-NOTE: training lapsed for named staff" },
      team: [
        { id: "m1", name: "Pat Head", role: "head", email: "head@oak.sch.uk", alerts: "weekly" },
        { id: "m2", name: "Dee Puty", role: "deputy", email: "deputy@oak.sch.uk", alerts: "weekly" },
        { id: "g1", name: "Chris Chair", role: "gov", email: "chair@gov.test", alerts: "weekly" },
        { id: "g2", name: "Toni Trustee", role: "trustee", email: "trustee@gov.test", alerts: "weekly" },
      ],
      actions: [{ id: "a1", title: "Reading fluency", status: "doing", rag: "risk", owner: "Deputy head", due: "2026-12-01" }, { id: "a2", title: "Phonics training", status: "done", impact: "Year 1 screening up 8 points", doneAt: "2026-10-01T10:00:00Z" }],
      leads: { ab: { commentary: "", indicators: { attendance: { now: "95.1", last: "94.2" }, pa: { now: "14", last: "17" } } } },
      monitoring: [{ id: "r1", type: "walk", date: "2026-10-08", by: "Dee Puty", areaId: "ct", focus: "Reading in Year 3", found: "SECRET-FINDING", next: "share", judge: "strong", status: "done" },
        { id: "r2", type: "sg", check: "records", date: "2026-10-09", by: "Pat Head", areaId: "sg", found: "SECRET-SG", judge: "dev", status: "done" }],
      challenges: [], govReports: [],
    };
    schools.replace(sch.id, state);
    const areas = criteria.resolve(profile);

    // The report itself
    const doc = BR.govReport(state, areas, { commentary: "A strong half-term for reading.", today: "2026-10-13" });
    const txt = BR.toText(doc);
    ok(/Headteacher's report to governors: Autumn term 2026/.test(doc.title), "report titled for the term");
    ok(/A strong half-term for reading/.test(txt) && /AT A GLANCE/.test(txt) && /DSL's termly checks: 1 of 8 done/.test(txt) && /Attendance this term/.test(txt) && /95.1%/.test(txt), "report: commentary, self-evaluation, safeguarding checks and key figures");
    ok(/1 at risk/.test(txt) && /Year 1 screening up 8 points/.test(txt) && /Reading in Year 3/.test(txt), "report: priorities, impact and monitoring");
    ok(!/SECRET/.test(txt), "no evidence notes or monitoring findings in the governors' report");
    ok(/QUESTIONS GOVERNORS MAY WANT TO ASK/.test(txt) && /Reading fluency/.test(txt), "report suggests challenge questions");
    ok(doc.scores.ct === 50, "the report keeps area scores for next time");
    const doc2 = BR.govReport({ ...state, answers: { ...state.answers, "ct-knowledge": "no" } }, areas, { prev: doc.scores, today: "2027-01-20" });
    ok(doc2.sections.find(s => /at a glance/.test(s.head)).table.cols.includes("Last report") && /gone down since the last report/.test(BR.toText(doc2)), "next report compares with the last one");

    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "ignore", "inherit"] });
    await wait(900);
    // Leader signs in
    const lr = await post("/api/access", { code: sch.code });
    const L = cookieOf(lr);
    ok(lr.status === 200 && L.startsWith("hwwd_access="), "leader signed in");
    let acc = await (await req("/api/access", { headers: { cookie: L } })).json();
    ok(acc.gov && acc.gov.on === false, "governors' access is off to start with");
    // Create the governors' code and email it
    const gc = await post("/api/school/governors/code", { action: "new", email: true }, L);
    const gj = await gc.json(); await wait();
    ok(gc.status === 200 && /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(gj.code) && gj.sent === 3, "governors' code created and emailed (2 governors and the head)");
    const codeMail = mail.inbox.find(m => /governors' access/.test(m.subject));
    ok(codeMail && codeMail.to.includes("chair@gov.test") && codeMail.to.includes("trustee@gov.test") && !codeMail.to.includes("deputy@oak.sch.uk") && codeMail.text.includes(gj.code), "the code email goes to governors and the head");
    ok(!fs.readFileSync(path.join(DATA, "access.json"), "utf8").includes(gj.code.replace(/-/g, "")), "the governors' code is stored only as a hash");
    acc = await (await req("/api/access", { headers: { cookie: L } })).json();
    ok(acc.gov.on === true, "access shows as on");
    // Governor signs in
    const gr = await post("/api/access", { code: gj.code });
    const grj = await gr.json(); const G = cookieOf(gr);
    ok(gr.status === 200 && grj.governor === true && G.startsWith("hwwd_gov="), "governor signs in with their own cookie");
    const ga = await (await req("/api/access", { headers: { cookie: G } })).json();
    ok(ga.ok === false && ga.governor === true && ga.school === "Oak Primary", "a governor is not signed in as the school");
    ok((await req("/checklist.html", { headers: { cookie: G } })).status === 302, "governor can't open the checklist");
    ok((await req("/api/school", { headers: { cookie: G } })).status === 401, "governor can't read the school's working data");
    ok((await req("/api/school", { method: "PUT", body: JSON.stringify({ state: {} }), headers: { cookie: G } })).status === 401, "governor can't change anything");
    ok((await post("/api/w", { profile: { type: "academy", phases: ["ks3"] } }, G)).status === 401, "governor can't start a workshop");
    ok((await post("/api/school/governors/code", { action: "off" }, G)).status === 401, "governor can't manage codes");
    ok((await req("/governors.html", { headers: { cookie: G } })).status === 200, "governor opens the governors' page");
    ok((await req("/governors.html")).status === 302, "signed-out visitors are sent to sign in");
    // What they see
    let v = await (await req("/api/gov/view", { headers: { cookie: G } })).json();
    ok(v.school === "Oak Primary" && v.reports.length === 0 && v.today.sections.length >= 2 && v.leader === false, "governor view: no report yet, the school today");
    ok(!/SECRET/.test(JSON.stringify(v)), "governor view has no notes or findings");
    // Leader issues a report (a draft isn't shown)
    const cur = await (await req("/api/school", { headers: { cookie: L } })).json();
    const st = cur.state;
    st.govReports = [{ id: "draft1", term: "2026-autumn", commentary: "draft words", status: "draft" }, { id: "rep1", term: "2026-autumn", commentary: "x", status: "issued", issuedAt: "2026-10-13T09:00:00Z", doc }];
    ok((await req("/api/school", { method: "PUT", body: JSON.stringify({ state: st }), headers: { cookie: L } })).status === 200, "leader saves the issued report");
    v = await (await req("/api/gov/view", { headers: { cookie: G } })).json();
    ok(v.reports.length === 1 && v.reports[0].doc.title === doc.title && !JSON.stringify(v).includes("draft words"), "governors see the issued report only, not drafts");
    const sr = await post("/api/school/govreports/rep1/send", {}, L); const srj = await sr.json(); await wait();
    const rm = mail.inbox.find(m => /Headteacher's report to governors/.test(m.subject));
    ok(sr.status === 200 && srj.sent === 3 && rm && rm.to.includes("chair@gov.test") && /A strong half-term for reading/.test(rm.text) && !/SECRET/.test(rm.text), "issued report emailed to governors and the head");
    ok((await post("/api/school/govreports/draft1/send", {}, L)).status === 400, "a draft can't be emailed");
    // A governor asks a question
    ok((await post("/api/gov/challenge", { by: "", question: "Why?" }, G)).status === 400, "a question needs a name");
    ok((await req("/api/gov/challenge", { method: "POST", body: JSON.stringify({ by: "Chris", question: "Why is reading at risk?" }), headers: { cookie: G, origin: "https://evil.test" } })).status === 403, "cross-site question refused");
    const q = await post("/api/gov/challenge", { by: "Chris Chair", question: "Why is reading fluency at risk, and what will be different by Christmas?", areaId: "ct" }, G);
    const qj = await q.json(); await wait();
    ok(q.status === 200 && qj.challenge.status === "open" && qj.challenge.source === "governor", "governor's question saved");
    const qm = mail.inbox.find(m => /A governor has asked a question/.test(m.subject));
    ok(qm && qm.to.includes("head@oak.sch.uk") && qm.to.includes("deputy@oak.sch.uk") && !qm.to.includes("chair@gov.test") && /reading fluency/.test(qm.text), "head and deputy told straight away");
    const cur2 = await (await req("/api/school", { headers: { cookie: L } })).json();
    ok(cur2.state.challenges.length === 1 && cur2.state.challenges[0].question.includes("Christmas"), "the question is in the school's challenge log");
    // Leader answers; governors see it
    cur2.state.challenges[0].response = "Two staff absences slowed it; catch-up groups restart next week."; cur2.state.challenges[0].status = "answered"; cur2.state.challenges[0].respondedAt = "2026-10-14T10:00:00Z";
    await req("/api/school", { method: "PUT", body: JSON.stringify({ state: cur2.state }), headers: { cookie: L } });
    v = await (await req("/api/gov/view", { headers: { cookie: G } })).json();
    ok(v.challenges[0].status === "answered" && /catch-up groups/.test(v.challenges[0].response), "governors see the answer");
    ok(/Responses to governors' questions/i.test(BR.toText(BR.govReport(cur2.state, areas, { since: "2026-10-01" }))), "answers go into the next termly report");
    // Leaders can preview the governors' view
    v = await (await req("/api/gov/view", { headers: { cookie: L } })).json();
    ok(v.leader === true, "leaders can see what governors see");
    // Replace the code: the old one and its sign-ins stop working
    const gc2 = await (await post("/api/school/governors/code", { action: "new" }, L)).json();
    ok((await req("/api/gov/view", { headers: { cookie: G } })).status === 401, "a new code signs governors out");
    ok((await post("/api/access", { code: gj.code })).status === 401, "the old code no longer works");
    const G2 = cookieOf(await post("/api/access", { code: gc2.code }));
    ok((await req("/api/gov/view", { headers: { cookie: G2 } })).status === 200, "the new code works");
    await post("/api/school/governors/code", { action: "off" }, L);
    ok((await req("/api/gov/view", { headers: { cookie: G2 } })).status === 401, "switched off: governors can't get in");
    // Sign out clears both
    const so = await post("/api/access/logout", {}, G2);
    ok(/hwwd_gov=;/.test(so.headers.get("set-cookie")), "signing out clears the governors' cookie");
  } catch (e) { console.error(e); ok(false, "threw: " + e.message); }
  finally {
    if (srv) srv.kill(); if (mail) mail.close();
    await wait(200);
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    process.exit();
  }
})();
