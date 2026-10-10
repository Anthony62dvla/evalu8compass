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
