/*
 * Takes the screenshots for the user guide from the real app.
 * The AI is replaced by a stand-in that returns the example answers in mock-ai.js,
 * so no API key is needed and no real school data is used.
 * Called by scripts/build-guide.js. Needs Playwright (dev only).
 */
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const MOCK = require("./mock-ai");

const APP = path.join(__dirname, "..", "..");
const DATA = path.join(APP, "data");
const PORT = 3977, AI_PORT = 3976, BASE = `http://127.0.0.1:${PORT}`;
const KEEP = ["admin.json", "audit.log", "access.json", "usage.json"].map(f => path.join(DATA, f));

module.exports = async function shots(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const backup = KEEP.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  KEEP.forEach(f => fs.rmSync(f, { force: true }));
  const mock = http.createServer((q, r) => {
    let b = ""; q.on("data", c => (b += c)); q.on("end", () => {
      const text = JSON.stringify(JSON.parse(b).messages);
      r.writeHead(200, { "content-type": "application/json" });
      r.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(MOCK.answer(text)) }], usage: { input_tokens: 1000, output_tokens: 500 } }));
    });
  }).listen(AI_PORT);
  const srv = spawn(process.execPath, [path.join(APP, "server.js")], { env: { ...process.env, PORT, HOST: "127.0.0.1", ANTHROPIC_API_KEY: "guide", ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}`, ACCESS_REQUIRED: "" }, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  const made = [];
  let schoolId, wcode;
  const snap = async (page, name, sel, opts = {}) => {
    const file = path.join(outDir, name + ".jpg");
    const el = sel ? page.locator(sel).first() : null;
    if (el) await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const q = { type: "jpeg", quality: 74 };
    if (el) {
      // Element shots, cut to a sensible height for the page
      const box = await el.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });
      const maxH = opts.maxH || 1100;
      await page.screenshot({ path: file, ...q, fullPage: true, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, maxH) } });
    } else await page.screenshot({ path: file, ...q, ...opts });
    made.push(name);
  };
  try {
    const out = execFileSync(process.execPath, [path.join(APP, "scripts", "access.js"), "add", "Oakfield Academy", "--email", "head@oakfield.example"]).toString();
    const code = out.match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
    schoolId = JSON.parse(fs.readFileSync(path.join(DATA, "access.json"), "utf8")).codes.find(c => c.name === "Oakfield Academy").id;

    /* ---------- front page and signing in ---------- */
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE + "/index.html");
    await snap(p, "front", null);
    await p.goto(BASE + "/enter.html?next=/checklist.html");
    await p.fill("#code", "OAKF-IELD-2026");
    await snap(p, "enter", ".enter-box");
    await p.fill("#code", code); await p.click("#go");
    await p.waitForURL(/checklist/); await p.waitForSelector(".item");
    await p.addStyleTag({ content: ".summary, .brandbar { position: static !important } .toast { display: none !important }" }); // no sticky bars over element shots

    /* ---------- checklist ---------- */
    await p.click('[data-type="academy"]');
    for (const ph of ["ks3", "ks4"]) if ((await p.getAttribute(`[data-phase="${ph}"]`, "aria-pressed")) !== "true") await p.click(`[data-phase="${ph}"]`);
    if ((await p.getAttribute('[data-phase="p16"]', "aria-pressed")) === "true") await p.click('[data-phase="p16"]');
    if (await p.isChecked("#pSpecial")) await p.click("#pSpecial");
    await p.fill("#pBy", "Sarah Khan, Deputy Head");
    await p.fill("#pDate", "2026-10-05");
    await snap(p, "setup", "section.setup");
    await p.click("#ofstedBox summary"); await p.fill("#ofText", MOCK.REPORT_TEXT); await p.click("#ofRead");
    await p.waitForSelector(".of-grades", { timeout: 15000 });
    await snap(p, "ofsted", "#ofstedBox");
    const rate = { "sg-culture": "met", "sg-dsl": "met", "sg-follow": "part", "sg-earlyhelp": "met", "sg-scr": "met", "sg-s128": "met", "sg-filter": "part", "sg-pupils": "met" };
    for (const [id, v] of Object.entries(rate)) await p.click(`[data-set="${id}"][data-v="${v}"]`);
    await p.fill("#n-sg-dsl", "DSL and two deputies trained Sept 2025; refresher booked for Sept 2027.");
    await p.fill("#n-sg-follow", "CPOMS used well by pastoral team; some subject staff log concerns late.");
    await p.fill("#n-sg-filter", "Filtering in place; monitoring reports not yet reviewed by governors.");
    await p.waitForTimeout(1200);
    await snap(p, "rate", "#a-sg", { maxH: 900 });
    await p.click('[data-ask="sg-follow"]');
    await p.waitForSelector("#adv-sg-follow .advice");
    await snap(p, "advice", '.item[data-k="sg-follow"]');
    // more ratings elsewhere so review, plan and progress have content
    const more = { "inc-identify": "part", "inc-senco": "met", "ct-send": "no", "ct-coherent": "met", "ab-attreg": "met", "ab-pa": "part", "ab-policy": "met", "pd-rshe": "met", "lg-vision": "met", "lg-qa": "part" };
    for (const [id, v] of Object.entries(more)) { const b = p.locator(`[data-set="${id}"][data-v="${v}"]`); if (await b.count()) await b.first().click(); }
    await p.waitForTimeout(1200);
    await snap(p, "summary", ".summary");
    await p.click("#reviewBtn"); await p.waitForSelector("#closeReview");
    await snap(p, "review", "section.review");

    /* ---------- action plan ---------- */
    await p.click('[data-view="planView"]');
    await p.click("#planGaps"); await p.waitForSelector(".action");
    const first = p.locator(".action").first();
    const aid = await first.getAttribute("data-aid");
    await p.fill(`#ao-${aid}`, "DSL"); await p.fill(`#ae-${aid}`, "2026-11-20");
    await p.fill(`#as-${aid}`, "Every concern is logged the same day; spot-check of 20 records shows no delays.");
    await p.click(`[data-astatus="${aid}"][data-v="doing"]`);
    await p.waitForTimeout(1200);
    await snap(p, "plan", "#planView", { maxH: 950 });

    /* ---------- progress ---------- */
    await p.click('[data-view="progressView"]'); await p.waitForSelector("#snapName");
    await p.fill("#snapName", "Start of autumn term"); await p.click("#snapSave"); await p.waitForSelector(".snap");
    await p.click('[data-view="evalView"]');
    for (const [id, v] of Object.entries({ "sg-follow": "met", "ct-send": "part", "sg-filter": "met" })) await p.click(`[data-set="${id}"][data-v="${v}"]`);
    await p.waitForTimeout(1500);
    await p.click('[data-view="progressView"]'); await p.waitForSelector(".cmp .moves");
    await p.fill("#snapName", "");
    await snap(p, "progress", "#progressView", { maxH: 1050 });

    /* ---------- leading improvement through the year ---------- */
    p.on("dialog", d => d.accept());
    await p.waitForTimeout(1500);
    await p.evaluate(async () => {
      const cur = await (await fetch("api/school")).json();
      const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      const team = [
        { id: "t1", name: "Daniel Price", role: "head", email: "head@oakfield.example", alerts: "weekly", areas: ["lg"] },
        { id: "t2", name: "Sarah Khan", role: "deputy", email: "deputy@oakfield.example", alerts: "weekly", areas: ["ct", "ach"] },
        { id: "t3", name: "Amira Hussain", role: "dsl", email: "dsl@oakfield.example", alerts: "weekly", areas: ["sg"] },
        { id: "t4", name: "Tom Reid", role: "senco", email: "senco@oakfield.example", alerts: "weekly", areas: ["inc"] },
        { id: "t5", name: "Jo Evans", role: "attendance", email: "attendance@oakfield.example", alerts: "weekly", areas: ["ab"] },
        { id: "t6", name: "Margaret Lowe", role: "gov", email: "chair@oakfield.example", alerts: "urgent", areas: [] },
        { id: "t7", name: "Alan Brooks", role: "sip", email: "alan@adviser.example", alerts: "urgent", areas: [] },
      ];
      const acts = (cur.state.actions || []).slice(0, 2).map((a, i) => ({ ...a, rag: i ? "on" : "risk", milestones: i ? [] : [{ id: "ms1", text: "Audit 20 concern records", due: d(10), done: false }, { id: "ms2", text: "Brief subject staff on same-day logging", due: d(-3), done: true }] }));
      const monitoring = [
        { id: "mo1", type: "sg", check: "staffknow", date: d(-12), by: "Amira Hussain", areaId: "sg", focus: "Staff safeguarding knowledge", found: "Teachers confident about reporting concerns. Two lunchtime supervisors unsure how to raise a low-level concern about an adult.", next: "Brief lunchtime staff on low-level concerns; recheck in spring.", judge: "dev", status: "done", actionIds: [] },
        { id: "mo2", type: "sg", check: "pupilsafe", date: d(-8), by: "Amira Hussain", areaId: "sg", focus: "Pupil voice: feeling safe", found: "Pupils in Years 7 and 9 say they feel safe and know who to talk to.", next: "", judge: "strong", status: "done", actionIds: [] },
        { id: "mo3", type: "walk", date: d(-6), by: "Sarah Khan", areaId: "ct", lineId: "ct-coherent", focus: "Reading in Year 8 English", found: "Consistent use of the new reading routine; most pupils could explain new vocabulary.", next: "Share the routine with humanities in the next CPD session.", judge: "strong", status: "done", actionIds: [] },
        { id: "mo4", type: "work", date: d(-3), by: "Tom Reid", areaId: "inc", focus: "Books of pupils with SEND, Year 9 science", found: "Adaptations visible in half the books; pupil profiles not always used in planning.", next: "Profiles to be used in planning; revisit after half-term.", judge: "dev", status: "done", actionIds: [] },
        { id: "mo5", type: "pupil", date: d(9), by: "Jo Evans", areaId: "ab", focus: "Pupil voice on attendance rewards", status: "planned", actionIds: [] },
      ];
      const subjects = [
        { id: "s1", subject: "English: reading", leader: "Hannah Cole", ratings: { sequence: "met", teaching: "met", assess: "part", work: "met", send: "part", staff: "met" }, strengths: "Clear reading curriculum; routines consistent.", next: "Sharpen checks for understanding in Year 9.", updatedAt: new Date().toISOString() },
        { id: "s2", subject: "Mathematics", leader: "Ravi Patel", ratings: { sequence: "met", teaching: "part", assess: "part", work: "part", send: "no", staff: "met" }, strengths: "Well-sequenced schemes of work.", next: "Adapt teaching for pupils with SEND; retrieval practice in every lesson.", updatedAt: new Date().toISOString() },
      ];
      const patch = {
        team: { upsert: team, del: [] }, actions: { upsert: acts, del: [] }, monitoring: { upsert: monitoring, del: [] }, subjects: { upsert: subjects, del: [] },
        set: {
          "leads.sg": { commentary: "Our culture of vigilance is strong and pupils say they feel safe. Recording by some subject staff is still too slow; the audit this half-term will check the new same-day expectation.", indicators: { concerns: { now: "46", last: "39" }, referrals: { now: "3", last: "5" }, earlyhelp: { now: "7", last: "6" }, trained: { now: "96", last: "100" } } },
          "leads.ab": { commentary: "", indicators: { attendance: { now: "93.6", last: "92.4" }, pa: { now: "17.2", last: "19.8" }, suspensions: { now: "11", last: "14" } } },
        },
      };
      await fetch("api/school", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRev: cur.rev, patch }) });
    });
    await p.reload(); await p.waitForSelector(".item", { state: "attached" }); await p.waitForTimeout(800);
    await p.addStyleTag({ content: ".summary, .brandbar { position: static !important } .toast { display: none !important }" });

    // Team
    await p.click('[data-view="teamView"]'); await p.waitForSelector(".member");
    await snap(p, "team", "#teamView", { maxH: 1000 });
    // Monitoring
    await p.click("#monTab"); await p.waitForSelector(".sg-list");
    await p.click('[data-mtoggle="mo3"]'); await p.waitForSelector(".mon-body");
    await snap(p, "monitoring", "#monList", { maxH: 1150 });
    await snap(p, "monitoring-record", '[data-mid="mo3"]');
    // Leadership meeting
    await p.click("#meetTab"); await p.click("#meetAdd"); await p.waitForSelector(".meeting");
    await p.locator(".meeting [data-agbuild]").first().click(); await p.waitForSelector(".ag-item");
    await p.waitForTimeout(800);
    await snap(p, "meeting", ".meeting", { maxH: 1150 });
    await p.locator(".meeting [data-mstart]").first().click(); await p.waitForSelector(".meeting.live");
    await p.locator(".meeting.live textarea").first().fill("Audit of concern records to go ahead this half-term. DSL to report findings at the next meeting.");
    await snap(p, "meeting-live", ".meeting.live .ag-item", { maxH: 900 });
    // Leaders' reports
    await p.click("#leadTab"); await p.waitForSelector(".lead-card");
    await snap(p, "reports", ".lead-grid");
    await p.click("[data-lopen=sg]"); await p.waitForSelector(".lead-report");
    await snap(p, "lead-report", ".lead-report", { maxH: 1150 });
    await p.click("[data-lback]"); await p.click("[data-lopen=ct]"); await p.waitForSelector(".subj");
    await snap(p, "subjects", ".subjects", { maxH: 1000 });
    await p.click("[data-lback]");
    // SIP or consultant visit
    await p.click("#meetTab"); await p.click("#meetSip"); await p.waitForTimeout(400);
    const sip = p.locator(".meeting", { has: p.locator(".meet-kind") }).first();
    await sip.locator("textarea[data-mfld$='|focus']").fill("Test our view of the curriculum for pupils with SEND, and how well subject leaders check the impact of their work.");
    await sip.locator("details.paper-doc summary").click();
    await p.waitForTimeout(400);
    await p.locator(".meeting:has(.meet-kind)").first().scrollIntoViewIfNeeded(); await p.waitForTimeout(800);
    await snap(p, "sip", ".meeting:has(.meet-kind)", { maxH: 1300 });
    // Governors
    await p.click("#leadTab"); await p.waitForSelector("#gCom");
    await p.fill("#gCom", "A positive start to the year. Attendance and persistent absence have both improved, and pupils tell us they feel safe. Our priority is the curriculum for pupils with SEND, where our monitoring shows adaptations aren't yet consistent. We'd welcome a link governor visit to see this work this half-term.");
    await p.locator("[data-gdet] summary").click(); await p.waitForTimeout(400);
    await snap(p, "gov-draft", "#govBox", { maxH: 1300 });
    await p.click("[data-gissue]"); await p.waitForSelector("[data-gsend]");
    const gcode = await p.evaluate(async () => (await (await fetch("api/school/governors/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "new" }) })).json()).code);
    await p.waitForTimeout(1500);
    const gctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
    const g = await gctx.newPage();
    await g.goto(BASE + "/enter.html?next=/governors.html"); await g.fill("#code", gcode); await g.click("#go");
    await g.waitForURL(/governors/); await g.waitForSelector(".gov-rep");
    await g.addStyleTag({ content: ".toast { display: none !important }" });
    await snap(g, "gov-view", "main", { maxH: 1300 });
    await g.click("#gtab-ask"); await g.fill("#askBy", "Margaret Lowe (Chair)"); await g.selectOption("#askArea", "inc");
    await g.fill("#askQ", "The report says adaptations for pupils with SEND aren't yet consistent. What will be different by Christmas, and how will governors know?");
    await g.click("#askGo"); await g.waitForSelector(".chal");
    await snap(g, "gov-ask", "#gAsk", { maxH: 1100 });
    await gctx.close();
    await p.reload(); await p.waitForSelector(".item", { state: "attached" }); await p.waitForTimeout(800); await p.addStyleTag({ content: ".summary, .brandbar { position: static !important } .toast { display: none !important }" });
    await p.click("#leadTab"); await p.waitForSelector(".chal");
    await p.fill("textarea[data-cres]", "SEND profiles are now part of every department's planning check. The SENCo will sample books again in December and report to the next full governing board.");
    await snap(p, "challenge", ".gov-chal", { maxH: 1000 });

    /* ---------- report ---------- */
    await p.goto(BASE + "/report.html"); await p.waitForSelector(".paper h1");
    await p.setViewportSize({ width: 1180, height: 1200 });
    await snap(p, "report", null, { clip: { x: 0, y: 0, width: 1180, height: 1000 } });
    await ctx.close();

    /* ---------- workshop (as the superadmin, so demo staff can be added) ---------- */
    const admin = require(path.join(APP, "lib", "admin"));
    const { secret } = admin.setup("guide screenshots only");
    const fctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
    const f = await fctx.newPage();
    await f.goto(BASE + "/admin.html"); await f.fill("#pw", "guide screenshots only");
    await f.fill("#otp", admin.totp(secret, Math.floor(Date.now() / 30000))); await f.keyboard.press("Enter");
    await f.waitForSelector("#console:not(.hide)");
    f.on("load", () => f.addStyleTag({ content: ".toast { display: none !important }" }).catch(() => {}));
    await f.goto(BASE + "/workshop.html"); await f.waitForTimeout(1500);
    if (process.env.GUIDE_DEBUG) { await f.screenshot({ path: path.join(outDir, "debug.png"), fullPage: true }); console.log(await f.evaluate(() => fetch("api/access").then(r => r.text()))); }
    await f.fill("#cName", "Oakfield Academy");
    await f.click('#cTypes [data-ctype="academy"]');
    for (const ph of ["ks3", "ks4"]) await f.click(`#cPhases [data-cphase="${ph}"]`);
    await f.waitForSelector("#cAreas label");
    for (const id of ["sg", "ach", "pd", "lg", "cm", "p16", "ey"]) { const box = f.locator(`#cAreas [data-carea="${id}"]`); if (await box.count() && await box.isChecked()) await box.click({ force: true }); }
    await snap(f, "ws-start", "#createForm");
    const w = await f.evaluate(async () => (await fetch("api/w", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: { name: "Oakfield Academy", type: "academy", phases: ["ks3", "ks4"] }, areaIds: ["inc", "ct", "ab"] }) })).json());
    wcode = w.code;
    await f.goto(`${BASE}/workshop.html?code=${w.code}#key=${w.key}`); await f.waitForSelector("#fac:not(.hide)");
    await f.waitForTimeout(600);
    await snap(f, "ws-join", ".joinbar");

    // a member of staff on a phone
    const sctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const s = await sctx.newPage();
    await s.goto(`${BASE}/workshop.html?code=${w.code}`);
    await s.waitForSelector("#roles button");
    await s.click('#roles [data-role="teacher"]');
    await snap(s, "staff-join", "#joinForm");
    await s.click("#joinBtn"); await s.waitForSelector("#staff:not(.hide)");
    await s.waitForTimeout(500);
    for (const [i, v] of [[0, "met"], [1, "part"], [2, "met"]]) await s.locator(`#s-answer .item`).nth(i).locator(`[data-v="${v}"]`).click();
    await s.locator("#s-answer .item").nth(1).locator("textarea").fill("Profiles exist but aren't always used when planning lessons.");
    await s.waitForTimeout(600);
    await snap(s, "staff-answer", null);

    // demo staff fill the rest
    await f.evaluate(async w => { await fetch(`api/w/${w.code}/demo`, { method: "POST", headers: { "x-facilitator-key": w.key } }); }, w);
    await f.waitForFunction(() => Number(document.getElementById("fPeople").textContent) >= 10, null, { timeout: 8000 });
    await f.waitForTimeout(800);
    await f.click('[data-ff="flag"]'); await f.waitForTimeout(400);
    await snap(f, "ws-findings", "#f-results", { maxH: 1000 });
    await f.click('[data-ff="all"]');
    await f.click("#fAgreeAll"); await f.waitForTimeout(800);

    // improvement plan
    await f.click('[data-tab="f-plan"]');
    await f.fill("#fContext", "11–16 academy, 940 pupils. 31% disadvantaged, 16% SEND (22 EHC plans). New SENCo since September. Attendance 92.4% last year and improving. Part of a small multi-academy trust.");
    await f.click("#fSaveContext"); await f.waitForTimeout(300);
    await f.click("summary:has-text('paste the report text')");
    await f.fill("#fReportText", MOCK.REPORT_TEXT);
    await f.click("#fReadReport"); await f.waitForSelector("#fReport .out, #fReport ul", { timeout: 10000 }).catch(() => {});
    await f.click("#fThemes"); await f.waitForTimeout(1200);
    await f.click("#fPlanBtn"); await f.waitForFunction(() => /Priority|priorit/i.test(document.getElementById("fPlan").textContent), null, { timeout: 10000 });
    await f.waitForTimeout(500);
    await snap(f, "ws-report", "#fReport");
    await snap(f, "ws-plan", "#fPlan", { maxH: 1150 });
    await sctx.close(); await fctx.close();
  } finally {
    await browser.close(); srv.kill(); mock.close();
    await new Promise(r => setTimeout(r, 400));
    if (schoolId) fs.rmSync(path.join(DATA, "schools", schoolId), { recursive: true, force: true });
    if (wcode) fs.rmSync(path.join(DATA, "sessions", wcode + ".json"), { force: true });
    KEEP.forEach((f, i) => (backup[i] ? fs.writeFileSync(f, backup[i]) : fs.rmSync(f, { force: true })));
  }
  return made;
};
