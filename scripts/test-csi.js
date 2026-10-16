/* Catholic schools inspection. Run: node scripts/test-csi.js
 * Uses a fake email server and a stand-in AI; backs up and restores the data files it touches. */
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["access.json"].map(f => path.join(DATA, f));
fs.mkdirSync(path.join(DATA, "schools"), { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const before = new Set(fs.readdirSync(path.join(DATA, "schools")));
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const SMTP = 3990;
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", SITE_URL: "https://evalu8compass.test", MAIL_OUTBOX: "" });
const wait = ms => new Promise(r => setTimeout(r, ms || 250));
const grades = (o) => Object.fromEntries(Object.entries(o).map(([k, g]) => [k, { grade: g, evidence: "", next: "" }]));

let mail, srv, fake;
(async () => {
  try {
    const CS = require("../public/js/csi.js"), SI = require("../public/js/siams.js"), AG = require("../public/js/agenda.js"), BR = require("../public/js/briefs.js"), criteria = require("../public/js/criteria.js"), schools = require("../lib/schools");
    ok(CS.isCatholic({ type: "academy", church: "catholic" }) && !CS.isCatholic({ type: "maintained", church: "cofe" }) && !SI.isChurch({ type: "maintained", church: "catholic" }), "Catholic schools get CSI, not SIAMS");
    ok(CS.subIds().length === 9 && CS.subIds()[0] === "clm_po" && CS.subIds()[8] === "cw_le", "three key areas, each pupil outcomes, provision and leadership");
    // The overall grade follows the handbook
    const all = g => ({ csi: { ...grades(Object.fromEntries(CS.subIds().map(k => [k, g]))) } });
    ok(CS.status(all(2)).overall === 2 && CS.status(all(2)).areas[0].suggested === 2, "all good: good");
    ok(CS.status({ csi: { ...all(1).csi, comp: { time: "yes", red: "yes", diocese: "yes" } } }).overall === 1, "all outstanding, fully compliant: outstanding");
    ok(CS.status(all(1)).overall === 2, "all outstanding but compliance not confirmed: good, not outstanding");
    const mixed = all(2); mixed.csi.re_pr.grade = 4; mixed.csi.re_po.grade = 3;
    ok(CS.status(mixed).areas[1].suggested === 3 && CS.status(mixed).overall === 3, "a key area requiring improvement: overall requires improvement");
    const worst = all(2); worst.csi.key_cw = { grade: 4 };
    ok(CS.status(worst).overall === 4, "any key area inadequate: inadequate");
    const afi = { csi: { ...all(2).csi, last: { areas: "Improve RE assessment\nDevelop pupil-led worship" }, afi: { 0: "fully", 1: "partially" } } };
    ok(CS.status(afi).overall === 3 && CS.status(afi).afiList.length === 2, "an area for improvement only partly addressed: requires improvement");
    afi.csi.afi[1] = "fully"; ok(CS.status(afi).overall === 2, "all addressed: good");
    ok(CS.nextDue({ csi: { last: { date: "2022-06-15", overall: 2 } } }) === "2027-06-15" && CS.nextDue({ csi: { last: { date: "2022-06-15", overall: 3 } } }) === "2025-06-15", "next inspection: five years if good or better, three otherwise");

    const profile = { name: "St Joseph's Catholic Primary", type: "academy", phases: ["ks1", "ks2"], church: "catholic" };
    const areas = criteria.resolve(profile);
    const state = { profile, actions: [{ id: "a1", title: "RE assessment", status: "doing", csi: "re_pr" }],
      team: [{ id: "h", name: "Pat Head", role: "head", email: "head@stjosephs.sch.uk" }, { id: "s", name: "Diocesan adviser", role: "sip", email: "adviser@diocese.test" }],
      csi: { ...grades({ clm_po: 1, clm_pr: 2, clm_le: 2, re_po: 2, re_pr: 3, re_le: 2, cw_po: 2, cw_pr: 2, cw_le: 2 }), roll: "315", catholicPct: "72",
        ctx: { mission: "Learning and growing together in the love of Christ" }, comp: { time: "yes", red: "partly", diocese: "yes" },
        last: { date: "2021-11-10", overall: 2, areas: "Improve assessment in RE" }, afi: { 0: "partially" } },
      monitoring: [{ id: "m1", type: "re", csi: "re_pr", date: "2026-10-05", by: "RE lead", focus: "Year 5 RE", judge: "dev", status: "done" }] };
    state.csi.re_pr.next = "Make assessment consistent across key stage 2.";
    const doc = BR.toText(CS.csed(state));
    ok(/315 pupils on roll, 72% baptised Catholic/.test(doc) && /Learning and growing together/.test(doc), "CSED: our school and mission");
    ok(/Religious education \| Good \| Requires improvement \| Good \| Good/.test(doc), "CSED: grades at a glance");
    ok(/RELIGIOUS EDUCATION: PROVISION \(REQUIRES IMPROVEMENT\)/.test(doc) && /Monitoring: 5 Oct · RE lesson visit or learning walk: Year 5 RE/.test(doc) && /Areas to develop: Make assessment consistent/.test(doc), "CSED: each part with evidence and monitoring");
    ok(/Religious Education Directory.*: Partly/.test(doc) && /Improve assessment in RE: Partially addressed/.test(doc) && /points to: Requires improvement/.test(doc), "CSED: compliance, areas for improvement and overall");
    const ag = AG.buildAgenda(state, areas, "2026-10-16").find(i => i.kind === "csi");
    ok(ag && /Catholic life Good; RE Good; Worship Good; overall Requires improvement/.test(ag.lines[0]) && ag.actionIds.includes("a1"), "meeting agenda item for Catholic schools");
    ok(!AG.buildAgenda(state, areas, "2026-10-16").some(i => i.kind === "siams"), "no SIAMS item for a Catholic school");
    ok(/CATHOLIC LIFE AND MISSION, RE AND COLLECTIVE WORSHIP/.test(BR.toText(BR.govReport(state, areas, {}))) && /OUR CATHOLIC LIFE AND MISSION/.test(BR.toText(BR.sipPaper(state, areas, {}))), "governors' report and adviser's paper include it");
    const saved = schools.clean(state);
    ok(saved.csi.re_pr.grade === 3 && saved.csi.comp.red === "partly" && saved.csi.afi[0] === "partially" && saved.monitoring[0].csi === "re_pr", "saved");

    mail = await require("./fake-mail").start(SMTP);
    const n = await require("../lib/meetings").sendCsi("St Joseph's", state); await wait();
    ok(n === 2 && mail.inbox.some(m => /Catholic self-evaluation \(CSED\)/.test(m.subject) && m.to.includes("adviser@diocese.test")), "CSED emailed to the head and adviser");

    // Reading the last report (stand-in AI)
    const http = require("http"), { spawn } = require("child_process");
    fake = http.createServer((q, r) => { let b = ""; q.on("data", c => (b += c)); q.on("end", () => { r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ inspectionDate: "2021-11-10", overall: 2, clm: 1, re: 2, cw: 2, mission: "Learning and growing together", summary: "A welcoming school.", strengths: ["Strong chaplaincy"], areas: ["Improve assessment in RE", "Develop pupil-led worship"], findings: [{ sub: "re_pr", type: "development", finding: "Assessment is inconsistent." }, { sub: "xx", type: "strength", finding: "bad" }] }) }], usage: { input_tokens: 5, output_tokens: 5 } })); }); }).listen(3994);
    const access = require("../lib/access"); const code = access.add("St Joseph's", 365);
    schools.replace(code.id, { ...state, csi: {} });
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: "3995", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "http://127.0.0.1:3994", ALERT_DELAY_MS: "600000" }, stdio: ["ignore", "ignore", "inherit"] });
    await wait(900);
    const base = "http://127.0.0.1:3995";
    const ck = ((await fetch(base + "/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.code }) })).headers.get("set-cookie") || "").split(";")[0];
    const rr = await fetch(base + "/api/school/csi/read", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ text: "CSI report. ".repeat(40) }) });
    const rj = await rr.json();
    ok(rr.status === 200 && rj.last.overall === 2 && rj.last.clm === 1 && /Develop pupil-led worship/.test(rj.last.areas) && rj.last.date === "2021-11-10", "report read: grades, date and areas for improvement");
    ok(rj.last.reading.findings[0].sub === "re_pr" && rj.last.reading.findings[1].sub === null, "findings mapped to the nine parts");
  } catch (e) { console.error(e); ok(false, "threw: " + e.message); }
  finally {
    if (mail) mail.close(); if (srv) srv.kill(); if (fake) fake.close();
    await wait(200);
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    process.exit();
  }
})();
