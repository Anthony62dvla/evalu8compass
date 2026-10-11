/* Buying extra AI requests. Run: node scripts/test-topups.js
 * Uses a fake email server, and backs up and restores the data files it touches. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["admin.json", "access.json", "audit.log", "invoices.jsonl", "billing.json", "usage.json"].map(f => path.join(DATA, f));
fs.mkdirSync(path.join(DATA, "schools"), { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PORT = 3986, SMTP = 3985, base = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>",
  ADMIN_EMAIL: "owner@example.org", OPERATOR_NAME: "Test Operator", OPERATOR_ADDRESS: "1 High Street, Town", BANK_SORT_CODE: "12-34-56", BANK_ACCOUNT_NUMBER: "12345678",
  SITE_URL: "https://evalu8compass.test", AI_MONTHLY_REQUESTS: "200", AI_TOPUP_PACKS: "50:10,150:25", MAIL_OUTBOX: "", VAT_NUMBER: "" });
const post = (p, body, cookie) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(base + p, { headers: cookie ? { cookie } : {} });
const wait = ms => new Promise(r => setTimeout(r, ms));

let srv, mail;
(async () => {
  try {
    /* ---------- the meter itself ---------- */
    const usage = require("../lib/usage");
    const saved = process.env.AI_MONTHLY_REQUESTS; delete process.env.AI_MONTHLY_REQUESTS;
    ok(usage.limitFor("brand-new-school") === 50, "the default monthly allowance is 50 AI requests");
    process.env.AI_MONTHLY_REQUESTS = saved;
    usage.setLimit("u1", 2);
    ok(usage.reserve("u1") && usage.reserve("u1") && usage.reserve("u1") === null, "allowance of 2: the third request is refused");
    usage.addCredits("u1", 3);
    let st = usage.status("u1");
    ok(st.left === 0 && st.credits === 3, "3 extra requests added");
    const t = usage.reserve("u1");
    ok(t && t.credit && usage.status("u1").credits === 2, "once the allowance is used, extra requests are used");
    usage.settle(t, null);
    ok(usage.status("u1").credits === 3, "a request that never reached the AI gives its extra request back");
    usage.reserve("u1"); usage.reserve("u1"); usage.reserve("u1");
    ok(usage.reserve("u1") === null && usage.status("u1").credits === 0, "when the extra requests run out too, AI requests are refused");
    usage.setLimit("u2", 0); usage.addCredits("u2", 5);
    ok(usage.reserve("u2") === null && usage.status("u2").credits === 0, "AI switched off for a school: extra requests aren't used");
    let threw = false; try { usage.addCredits("u1", "lots"); } catch (e) { threw = true; }
    ok(threw, "credits must be a whole number");
    usage.flush();
    fs.rmSync(FILES[5], { force: true });

    /* ---------- buying, through the app ---------- */
    mail = await require("./fake-mail").start(SMTP);
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" }, stdio: ["ignore", "ignore", "inherit"] });
    await wait(800);
    const access = require("../lib/access");
    const school = access.add("Oak Primary", 365, { email: "head@oak.sch.uk" });
    const login = await post("/api/access", { code: school.code });
    const sc = (login.headers.get("set-cookie") || "").split(";")[0];
    let a = await (await get("/api/access", sc)).json();
    ok(a.ai.left === 200 && a.ai.topup && a.ai.topup.canBuy === false && a.ai.topup.packs.length === 2, "with 200 left: can't buy yet; two packs on offer");
    const early = await post("/api/school/topup", { pack: 0, billingName: "Jo", billingEmail: "jo@oak.sch.uk", address: "Oak Road, Town", agree: true }, sc);
    ok(early.status === 409 && /10 or fewer/.test((await early.json()).error), "buying before 10 or fewer are left is refused");

    const admin = require("../lib/admin");
    const { secret } = admin.setup("correct horse battery staple");
    const al = await post("/api/admin/login", { password: "correct horse battery staple", code: admin.totp(secret, Math.floor(Date.now() / 30000)) });
    const ac = (al.headers.get("set-cookie") || "").split(";")[0];
    await post(`/api/admin/codes/${school.id}/allowance`, { limit: 8 }, ac);
    a = await (await get("/api/access", sc)).json();
    ok(a.ai.left === 8 && a.ai.topup.canBuy, "8 left: the school can buy more");
    ok((await post("/api/school/topup", { pack: 0, billingName: "Jo Bursar", billingEmail: "bad", address: "Oak Road, Town", agree: true }, sc)).status === 400, "invoice email checked");
    ok((await post("/api/school/topup", { pack: 9, billingName: "Jo Bursar", billingEmail: "jo@oak.sch.uk", address: "Oak Road, Town", agree: true }, sc)).status === 400, "unknown pack refused");
    const req = await post("/api/school/topup", { pack: 1, billingName: "Jo Bursar", billingEmail: "jo@oak.sch.uk", address: "Oak Road\nTown AB1 2CD", po: "PO-9", agree: true }, sc);
    await wait(300);
    ok(req.status === 200 && (await req.json()).requests === 150, "school asks for 150 extra requests");
    ok(mail.to("owner@example.org", /AI top-up request: Oak Primary/).length === 1, "owner notified");
    ok(mail.to("jo@oak.sch.uk", /extra AI requests/).length === 1 && mail.to("jo@oak.sch.uk")[0].to.includes("head@oak.sch.uk"), "school gets a confirmation (copied to the head)");
    a = await (await get("/api/access", sc)).json();
    ok(a.ai.topup.pending && a.ai.topup.pending.requests === 150 && !a.ai.topup.canBuy && a.ai.credits === 0, "shown as ordered; nothing added until approved");
    ok((await post("/api/school/topup", { pack: 0, billingName: "Jo Bursar", billingEmail: "jo@oak.sch.uk", address: "Oak Road, Town", agree: true }, sc)).status === 409, "only one request at a time");

    const ov = await (await get("/api/admin/billing", ac)).json();
    const tu = ov.topups.find(x => x.school === "Oak Primary");
    ok(tu && tu.status === "requested" && tu.price === 25, "admin sees the request: 150 for £25");
    ok((await post(`/api/admin/codes/${school.id}/topups/${tu.id}/approve`, {}, sc)).status === 401, "a school can't approve its own request");
    const ap = await (await post(`/api/admin/codes/${school.id}/topups/${tu.id}/approve`, { requests: "160", price: "25" }, ac)).json();
    await wait(400);
    ok(ap.credits === 160 && /^EC-\d{4}-\d{4}$/.test(ap.invoice), "admin approves, adjusting it to 160 requests; invoice made");
    const inv = mail.to("jo@oak.sch.uk", /Invoice EC-/)[0];
    ok(inv && /160 extra AI requests/.test(inv.text) && /£25/.test(inv.text) && /PO-9|Oak Road/.test(inv.html), "invoice emailed: 160 extra AI requests, £25");
    ok(mail.to("jo@oak.sch.uk", /160 extra AI requests added/).length === 1, "school told the requests have been added");
    a = await (await get("/api/access", sc)).json();
    ok(a.ai.credits === 160 && !a.ai.topup.pending && !a.ai.topup.canBuy, "school now has 160 extra requests, and can't buy more until it's low again");
    ok((await post(`/api/admin/codes/${school.id}/topups/${tu.id}/approve`, {}, ac)).status === 409, "can't approve twice");
    ok((await post(`/api/admin/codes/${school.id}/topups/${tu.id}/paid`, { date: new Date().toISOString().slice(0, 10) }, ac)).status === 200, "mark the invoice paid");
    const page = await (await get(`/invoice/${ap.invoice}`, ac)).text();
    ok(/Paid /.test(page), "the invoice page shows it paid");

    // Manual adjustment
    const man = await (await post(`/api/admin/codes/${school.id}/credits`, { add: -10 }, ac)).json();
    ok(man.credits === 150, "admin can take extra requests away (160 − 10 = 150)");
    ok((await post(`/api/admin/codes/${school.id}/credits`, { add: "x" }, ac)).status === 400, "manual change must be a number");

    // Decline
    await post(`/api/admin/codes/${school.id}/allowance`, { limit: 0 }, ac);
    a = await (await get("/api/access", sc)).json();
    ok(!a.ai.topup, "AI switched off for the school: no top-ups offered");
    await post(`/api/admin/codes/${school.id}/allowance`, { limit: 5 }, ac);
    await post(`/api/admin/codes/${school.id}/credits`, { add: -150 }, ac);
    await post("/api/school/topup", { pack: 0, billingName: "Jo Bursar", billingEmail: "jo@oak.sch.uk", address: "Oak Road, Town", agree: true }, sc);
    const ov2 = await (await get("/api/admin/billing", ac)).json();
    const tu2 = ov2.topups.find(x => x.status === "requested");
    const dc = await post(`/api/admin/codes/${school.id}/topups/${tu2.id}/decline`, { reason: "Please use your remaining allowance first." }, ac);
    await wait(300);
    ok(dc.status === 200 && mail.to("jo@oak.sch.uk").some(m => /weren't able to approve/.test(m.text)), "declined, with the reason emailed");
    a = await (await get("/api/access", sc)).json();
    ok(a.ai.topup.canBuy && a.ai.credits === 0, "after a decline the school can ask again");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally {
    if (srv) srv.kill();
    if (mail) mail.close();
    await wait(200);
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    setTimeout(() => process.exit(), 100);
  }
})();
