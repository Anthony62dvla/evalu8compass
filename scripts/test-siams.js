/* SIAMS for Church schools. Run: node scripts/test-siams.js
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
const SMTP = 3988;
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", SITE_URL: "https://evalu8compass.test", MAIL_OUTBOX: "" });
const wait = () => new Promise(r => setTimeout(r, 250));

let mail;
(async () => {
  try {
    const SI = require("../public/js/siams.js"), AG = require("../public/js/agenda.js"), BR = require("../public/js/briefs.js"), criteria = require("../public/js/criteria.js"), schools = require("../lib/schools");
    // Who it applies to
    ok(!SI.isChurch({ type: "maintained" }) && SI.isChurch({ type: "maintained", church: "cofe" }) && SI.isChurch({ type: "academy", church: "methodist" }) && !SI.isChurch({ type: "independent", church: "cofe" }), "SIAMS is for maintained and academy Church schools");
    ok(SI.iqsFor({ designation: "vc" }).length === 6 && SI.iqsFor({ designation: "va" }).length === 7 && SI.iqsFor({ designation: "fva" }).length === 7, "IQ7 only for voluntary aided and former voluntary aided");
    ok(SI.iqsFor({ designation: "fvc" }).length === 6 && SI.iqsFor({ designation: "fvc", denomRE: true }).length === 7, "former VC academies get IQ7 only if they teach denominational RE");
    ok(SI.IQS[0].q === "How does the school's theologically rooted Christian vision enable pupils and adults to flourish?" && SI.IQS[2].q.startsWith("How is daily collective worship"), "the Inspection Questions match the framework");
    const clean = schools.clean({ profile: { type: "independent", church: "cofe" } });
    ok(clean.profile.church === "", "independent schools can't be set as SIAMS Church schools");

    const profile = { name: "St Mary's CE Primary", type: "academy", phases: ["ks1", "ks2"], church: "cofe", designation: "fva" };
    const areas = criteria.resolve(profile);
    const state = {
      profile, answers: {}, actions: [{ id: "a1", title: "Pupil worship leaders", status: "doing", siams: "iq3" }],
      team: [{ id: "h", name: "Pat Head", role: "head", email: "head@stmarys.sch.uk" }, { id: "d", name: "Dee Puty", role: "deputy", email: "deputy@stmarys.sch.uk" }, { id: "s", name: "Rev Alex", role: "sip", email: "adviser@diocese.test" }],
      siams: {
        last: { date: "2022-03-10", outcome: "J1", areas: "Deepen pupils' understanding of spirituality\nDevelop pupil leadership of worship" }, roll: "210",
        ctx1: { pupils: "Diverse community; 30% EAL." }, ctx2: { vision: "Let your light shine (Matthew 5:16)", theology: "We are each made in God's image and called to shine." },
        iq1: { evidence: "Pupils explain how the vision shapes choices.", judge: "yes" },
        iq3: { evidence: "Daily worship led by pupils twice a week.", next: "Develop reflection spaces in every class.", judge: "partly" },
        iq7: { judge: "notyet", next: "Assessment in RE isn't yet consistent." },
      },
      monitoring: [{ id: "m1", type: "cw", iq: "iq3", date: "2026-10-05", by: "Pat Head", focus: "Class-led worship", judge: "strong", status: "done" }, { id: "m2", type: "cw", iq: "iq3", date: "2026-10-06", status: "planned" }],
    };
    const stt = SI.status(state);
    ok(stt.total === 7 && stt.yes === 1 && stt.rated === 3 && stt.gaps.map(x => x.q.id).join() === "iq3,iq7" && !stt.ready, "where we stand: 1 yes, two gaps");
    ok(SI.nextDue(state) === "2027-03-10", "next inspection expected about five years on");
    const sef = BR.toText(SI.sef(state));
    ok(/WHO ARE WE\?/.test(sef) && /210 pupils on roll/.test(sef) && /Diverse community/.test(sef), "self-evaluation: who are we");
    ok(/Let your light shine/.test(sef) && /made in God's image/.test(sef), "self-evaluation: vision and its theology");
    ok(/IQ3: How is daily collective worship/i.test(sef) && /Our view: Partly/.test(sef) && /Monitoring: 5 Oct · Collective worship: Class-led worship/.test(sef) && !/6 Oct/.test(sef), "self-evaluation: each IQ with its evidence and linked monitoring");
    ok(/IQ7: What is the quality of religious education/i.test(sef) && /Area for development: Develop pupil leadership of worship/.test(sef), "self-evaluation: IQ7 and the last report's areas for development");
    ok(!/IQ7/.test(BR.toText(SI.sef({ ...state, profile: { ...profile, designation: "vc", type: "maintained" } }))), "no IQ7 for a voluntary controlled school");
    // Joined up
    const ag = AG.buildAgenda(state, areas, "2026-10-16");
    const it = ag.find(i => i.kind === "siams");
    ok(it && /1 of 7/.test(it.lines[0]) && it.lines.some(l => /IQ3 Collective worship: Partly · Next: Develop reflection/.test(l)) && it.actionIds.includes("a1"), "leadership meeting agenda: a SIAMS item for Church schools");
    ok(!AG.buildAgenda({ ...state, profile: { ...profile, church: "" } }, areas, "2026-10-16").some(i => i.kind === "siams"), "no SIAMS item for other schools");
    ok(/LIVING UP TO OUR FOUNDATION AS A CHURCH SCHOOL \(SIAMS\)/.test(BR.toText(BR.govReport(state, areas, {}))), "governors' report includes SIAMS");
    ok(/OUR CHURCH SCHOOL FOUNDATION \(SIAMS\)/.test(BR.toText(BR.sipPaper(state, areas, {}))) && /Let your light shine/.test(BR.toText(BR.sipPaper(state, areas, {}))), "SIP or diocesan adviser paper includes SIAMS");
    // Saving
    const saved = schools.clean(state);
    ok(saved.siams.iq3.judge === "partly" && saved.siams.ctx2.vision.startsWith("Let") && saved.monitoring[0].iq === "iq3" && saved.siams.roll === "210", "SIAMS work is saved");
    // Email
    mail = await require("./fake-mail").start(SMTP);
    const M = require("../lib/meetings");
    const n = await M.sendSiams("St Mary's CE Primary", state); await wait();
    const m = mail.inbox.find(x => /SIAMS self-evaluation/.test(x.subject));
    ok(n === 2 && m && m.to.includes("head@stmarys.sch.uk") && m.to.includes("adviser@diocese.test") && !m.to.includes("deputy@stmarys.sch.uk") && /Let your light shine/.test(m.text), "self-evaluation emailed to the head and the diocesan adviser");
    let err = null; try { await M.sendSiams("X", { ...state, profile: { ...profile, church: "" } }); } catch (e) { err = e; } ok(err && err.status === 400, "only for Church schools");

    // Reading the last SIAMS report with the AI (a stand-in AI answers)
    const http = require("http"), { spawn } = require("child_process");
    let asked = "";
    const fake = http.createServer((q, r) => { let b = ""; q.on("data", c => (b += c)); q.on("end", () => { asked = b; r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ inspectionDate: "2023-11-02", outcome: "J2", earlierGrades: [], vision: "Let your light shine", summary: "A caring school whose vision is well known.", strengths: ["Pupils live out the vision in their care for others"], areas: ["Develop collective worship so it enables spiritual flourishing", "Strengthen RE assessment"], findings: [{ iq: "iq3", type: "development", finding: "Worship is not yet consistently inspiring." }, { iq: "iq9", type: "strength", finding: "bad id" }] }) }], usage: { input_tokens: 10, output_tokens: 10 } })); }); }).listen(3989);
    const access = require("../lib/access"); const code = access.add("St Mary's CE Primary", 365);
    schools.replace(code.id, { ...state, siams: {} });
    const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: "3993", ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:3989", ALERT_DELAY_MS: "600000" }, stdio: ["ignore", "ignore", "inherit"] });
    await new Promise(r => setTimeout(r, 900));
    try {
      const base = "http://127.0.0.1:3993";
      const lr = await fetch(base + "/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.code }) });
      const ck = (lr.headers.get("set-cookie") || "").split(";")[0];
      const rr = await fetch(base + "/api/school/siams/read", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ text: "SIAMS report. ".repeat(40) }) });
      const rj = await rr.json();
      ok(rr.status === 200 && rj.last.date === "2023-11-02" && rj.last.outcome === "J2" && /Strengthen RE assessment/.test(rj.last.areas), "SIAMS report read: date, outcome and areas for development filled in");
      ok(rj.last.reading.findings.length === 2 && rj.last.reading.findings[1].iq === null && rj.last.reading.findings[0].iq === "iq3", "findings mapped to Inspection Questions (unknown ids dropped)");
      ok(/iq7: What is the quality of religious education/.test(asked) && /J1/.test(asked), "the AI is given this school's Inspection Questions");
      const after = JSON.parse(fs.readFileSync(path.join(DATA, "schools", code.id, "state.json"), "utf8")).state.siams.last;
      ok(after.reading.summary === "A caring school whose vision is well known.", "the reading is saved with the school's work");
      const nr = await fetch(base + "/api/school/siams/read", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ text: "short" }) });
      ok(nr.status === 400, "needs the PDF or the full text");
    } finally { srv.kill(); fake.close(); }
  } catch (e) { console.error(e); ok(false, "threw: " + e.message); }
  finally {
    if (mail) mail.close();
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    setTimeout(() => process.exit(), 50);
  }
})();
