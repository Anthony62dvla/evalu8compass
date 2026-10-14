/* Sign-up, free term, subscribing, invoices and reminders. Run: node scripts/test-billing.js
 * Uses a fake email server, and backs up and restores the data files it touches. */
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["admin.json", "access.json", "audit.log", "invoices.jsonl", "billing.json", "enquiries.jsonl"].map(f => path.join(DATA, f));
fs.mkdirSync(DATA, { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const schoolsBefore = new Set(fs.existsSync(path.join(DATA, "schools")) ? fs.readdirSync(path.join(DATA, "schools")) : []);

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PORT = 3994, SMTP = 3993, base = `http://127.0.0.1:${PORT}`;
const ENV = { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_USER: "support@evalu8compass.test", SMTP_PASS: "secret-pass",
  MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", ADMIN_EMAIL: "owner@example.org", OPERATOR_NAME: "Test Operator", OPERATOR_ADDRESS: "1 High Street, Town, AB1 2CD",
  BANK_SORT_CODE: "12-34-56", BANK_ACCOUNT_NUMBER: "12345678", SIGNUP_LIMIT_PER_MIN: "200", SIGNUP_LIMIT_PER_HOUR: "50", SMTP_ALLOW_PLAIN: "1", LOGIN_LIMIT_PER_MIN: "200", SITE_URL: "https://evalu8compass.test", VAT_NUMBER: "", MAIL_OUTBOX: "" };
Object.assign(process.env, ENV);

/* ---------- a fake SMTP server that records what it's sent ---------- */
const inbox = [];
let authOk = false;
const smtp = net.createServer(sock => {
  let mode = "cmd", data = "", rcpt = [], step = 0;
  sock.write("220 fake ESMTP\r\n");
  sock.on("data", chunk => {
    if (mode === "data") {
      data += chunk.toString();
      if (data.endsWith("\r\n.\r\n")) { inbox.push(parse(data.slice(0, -5), rcpt)); mode = "cmd"; data = ""; rcpt = []; sock.write("250 queued\r\n"); }
      return;
    }
    for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
      if (step === 1) { step = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; }
      if (step === 2) { step = 0; authOk = Buffer.from(line, "base64").toString() === "secret-pass"; sock.write(authOk ? "235 ok\r\n" : "535 no\r\n"); continue; }
      if (/^EHLO/.test(line)) sock.write("250-fake\r\n250-SIZE 1000000\r\n250 AUTH LOGIN\r\n");
      else if (/^AUTH LOGIN/.test(line)) { step = 1; sock.write("334 VXNlcm5hbWU6\r\n"); }
      else if (/^MAIL FROM/.test(line)) sock.write("250 ok\r\n");
      else if (/^RCPT TO:<(.+)>/.test(line)) { rcpt.push(line.match(/<(.+)>/)[1]); sock.write("250 ok\r\n"); }
      else if (line === "DATA") { mode = "data"; sock.write("354 go\r\n"); }
      else if (line === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
      else sock.write("250 ok\r\n");
    }
  });
});
function parse(raw, rcpt) {
  const subject = ((raw.match(/^Subject: (.*)$/m) || [])[1] || "").replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (m, b) => Buffer.from(b, "base64").toString());
  const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(m => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString());
  return { to: rcpt, subject, text: parts[0] || "", html: parts[1] || "", raw };
}
const last = () => inbox[inbox.length - 1];
const mailTo = (addr, re) => inbox.filter(m => m.to.includes(addr) && (!re || re.test(m.subject)));
const codeIn = m => (m.text.match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/) || [])[0];

const post = async (p, body, cookie) => {
  if ((p === "/api/signup" || p === "/api/consultants/apply") && body && body.ft === undefined) body = { ...body, ft: (await (await fetch(base + "/api/form-token")).json()).t };
  return fetch(base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
};
process.env.FORM_MIN_SECONDS = "0";
const get = (p, cookie) => fetch(base + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
const readCodes = () => JSON.parse(fs.readFileSync(FILES[1], "utf8"));
const writeCodes = db => fs.writeFileSync(FILES[1], JSON.stringify(db, null, 1));

let srv;
(async () => {
  try {
    /* ---------- dates: the free-term rule ---------- */
    const billing = require("../lib/billing");
    const F = (d, want, m) => ok(billing.freeUntil(d) === want, `${m}: joining ${d} → paying from ${want} (got ${billing.freeUntil(d)})`);
    F("2026-09-07", "2027-01-01", "early autumn: free to the end of the autumn term");
    F("2026-10-10", "2027-01-01", "before autumn half-term");
    F("2026-11-02", "2027-04-12", "after autumn half-term: spring term free too");
    F("2027-01-11", "2027-04-12", "early spring");
    F("2027-03-01", "2027-09-01", "after spring half-term: summer free too");
    F("2027-04-20", "2027-09-01", "early summer");
    F("2027-06-14", "2028-01-01", "after summer half-term: autumn free too");
    F("2027-08-10", "2028-01-01", "summer holidays: the autumn term is free");
    ok(billing.easter(2026) === "2026-04-05" && billing.easter(2027) === "2027-03-28" && billing.easter(2028) === "2028-04-16", "Easter dates are right");
    ok(billing.summerStart(2026) === "2026-04-13" && billing.summerStart(2028) === "2028-04-24", "summer term starts after the Easter holidays");
    ok(billing.tierFor("independent", "secondary") === "independent" && billing.tierFor("academy", "secondary") === "secondary" && billing.tierFor("maintained", "primary") === "primary", "tiers: independent any phase, others by phase");
    ok(billing.addYear("2027-01-01") === "2028-01-01", "a paid year is 12 months");
    ok(billing.startOf("2027-01-01") === "2027-01-01T00:00:00.000Z" && billing.startOf("2027-06-01") === "2027-05-31T23:00:00.000Z", "access ends at UK midnight, in GMT and in BST");
    ok(billing.validDate("2027-02-28") && !billing.validDate("2027-02-30") && !billing.validDate("2026-13-01") && !billing.validDate(["2026-10-01"]), "only real dates accepted");

    await new Promise(r => smtp.listen(SMTP, "127.0.0.1", r));
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "", TRUST_PROXY: "0" }, stdio: ["ignore", "ignore", "inherit"] });
    await wait(800);

    /* ---------- pricing ---------- */
    const pr = await (await get("/api/pricing")).json();
    ok(pr.tiers.find(t => t.id === "primary").price === 149 && pr.tiers.find(t => t.id === "secondary").price === 199 && pr.tiers.find(t => t.id === "independent").price === 99, "prices: £99, £149, £199");
    ok(/No VAT is charged/.test(pr.vat) && pr.freeNow.until === billing.freeUntil(billing.today()), "pricing says no VAT charged (not registered) and today's free period");
    const front = await (await get("/")).text();
    ok(/£99/.test(front) && /£149/.test(front) && /£199/.test(front) && /signup\.html/.test(front), "front page shows the prices and links to sign-up");
    const terms = await (await get("/terms.html")).text();
    ok(/id="pricing"/.test(terms) && /No VAT is charged/.test(terms) && !/\{\{VAT_LINE\}\}/.test(terms), "terms include the pricing section, with the VAT wording filled in");

    /* ---------- sign-up ---------- */
    const bad = await post("/api/signup", { school: "Oak", type: "academy", name: "Sam", email: "sam@oak.sch.uk", agree: true });
    ok(bad.status === 400 && /primary or secondary/.test((await bad.json()).error), "academy without a phase: asked to choose primary or secondary");
    ok((await post("/api/signup", { school: "Oak Academy", type: "academy", phase: "primary", name: "Sam", email: "not-an-email", agree: true })).status === 400, "bad email refused");
    ok((await post("/api/signup", { school: "Oak Academy", type: "academy", phase: "primary", name: "Sam", email: "sam@oak.sch.uk" })).status === 400, "must agree to the terms");
    const n0 = inbox.length;
    ok((await post("/api/signup", { school: "Bot School", type: "independent", name: "Bot", email: "bot@spam.test", agree: true, website: "http://spam" })).status === 200 && inbox.length === n0, "bot (hidden field filled): looks fine, but nothing is created or sent");

    const r1 = await post("/api/signup", { school: "Hillside Primary", type: "maintained", phase: "primary", urn: "123456", name: "Pat Head", role: "Headteacher", email: "head@hillside.sch.uk", agree: true });
    ok(r1.status === 200 && (await r1.json()).kind === "code", "maintained primary signs up");
    await wait(300);
    const welcome = mailTo("head@hillside.sch.uk", /access code/)[0];
    const code1 = welcome && codeIn(welcome);
    ok(!!code1 && authOk, "access code emailed (signed in to the email server)");
    ok(/£149 a year/.test(welcome.text) && /free period covers the rest of the/.test(welcome.text) && /<html/.test(welcome.html), "welcome email: price, free period, and an HTML version");
    ok(mailTo("owner@example.org", /New sign-up: Hillside Primary/).length === 1, "owner notified of the sign-up");
    const db1 = readCodes(), h = db1.codes.find(c => c.name === "Hillside Primary");
    ok(h && h.tier === "primary" && h.urn === "123456" && h.contact.name === "Pat Head" && h.trialEndsAt === billing.freeUntil(billing.today()), "code stored with plan, URN, contact and free-term end");
    ok(!fs.readFileSync(FILES[1], "utf8").includes(code1.replace(/-/g, "")), "code stored only as a hash");
    ok(h.expiresAt === billing.startOf(billing.addDays(h.trialEndsAt, 14)), "access set to pause 14 days after the free term ends");
    const st = JSON.parse(fs.readFileSync(path.join(DATA, "schools", h.id, "state.json"), "utf8"));
    ok(st.state.profile.name === "Hillside Primary" && st.state.profile.type === "maintained", "checklist starts with the school's name and type");

    const login = await post("/api/access", { code: code1 });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    ok(login.status === 200, "the emailed code signs in");
    const acc = await (await get("/api/access", cookie)).json();
    ok(acc.plan && acc.plan.status === "trial" && acc.plan.price === 149 && acc.plan.daysLeft > 0, "signed-in school sees its plan: free term, £149, days left");

    // Same email again: no second school, a fresh code instead
    const before = readCodes().codes.length;
    await post("/api/signup", { school: "Hillside Primary School", type: "maintained", phase: "primary", name: "Pat Head", email: "head@hillside.sch.uk", agree: true });
    await wait(300);
    const again = mailTo("head@hillside.sch.uk", /access code/);
    const code2 = codeIn(again[again.length - 1]);
    ok(readCodes().codes.length === before && code2 && code2 !== code1, "signing up again with the same email sends a new code, no duplicate school");
    ok((await post("/api/access", { code: code2 })).status === 200 && (await post("/api/access", { code: code1 })).status === 200, "both the old and new codes work");

    // Lost code
    const lostBefore = inbox.length;
    ok((await post("/api/signup/resend", { email: "nobody@nowhere.test" })).status === 200 && inbox.length === lostBefore, "lost code for an unknown email: same answer, nothing sent");
    await post("/api/signup/resend", { email: "head@hillside.sch.uk" }); await wait(300);
    ok(inbox.length === lostBefore + 1 && /new access code/.test(last().text), "lost code: a new code emailed to the registered address");

    // Independent and secondary
    await post("/api/signup", { school: "Brook House School", type: "independent", name: "Lee", email: "lee@brook.org", agree: true });
    await post("/api/signup", { school: "Valley Academy", type: "academy", phase: "secondary", name: "Kim", email: "kim@valley.org", agree: true });
    await wait(300);
    const t = readCodes().codes;
    ok(t.find(c => c.name === "Brook House School").tier === "independent" && t.find(c => c.name === "Valley Academy").tier === "secondary", "independent → £99 plan; secondary academy → £199 plan");
    ok(/£99 a year/.test(mailTo("lee@brook.org")[0].text), "independent welcome email says £99");

    // Trust
    const tr = await post("/api/signup", { school: "Northern Lights Trust", type: "trust", schools: "7", name: "Chris CEO", role: "CEO", email: "ceo@nlt.org", message: "Interested for all our schools", agree: true });
    await wait(300);
    ok((await tr.json()).kind === "enquiry" && !readCodes().codes.some(c => c.name === "Northern Lights Trust"), "trust: enquiry, no code created");
    ok(mailTo("ceo@nlt.org", /enquiry/).length === 1 && mailTo("owner@example.org", /Trust enquiry: Northern Lights Trust/).length === 1, "trust: acknowledgement sent and owner notified");

    /* ---------- the free term ends: the code pauses ---------- */
    const db2 = readCodes(); const hc = db2.codes.find(c => c.name === "Hillside Primary");
    hc.trialEndsAt = billing.addDays(billing.today(), -20); hc.expiresAt = billing.startOf(billing.addDays(hc.trialEndsAt, 14)); writeCodes(db2);
    await wait(50);
    const paused = await post("/api/access", { code: code1 });
    const pj = await paused.json();
    ok(paused.status === 403 && pj.code === "paused" && pj.subscribe && /work is kept/.test(pj.error), "after the free term: code paused, with a message to subscribe");
    ok((await get("/api/school", cookie)).status === 401, "an existing sign-in stops working too");

    /* ---------- subscribing ---------- */
    const q = await (await post("/api/subscribe/quote", { code: code1 })).json();
    ok(q.school === "Hillside Primary" && q.price === 149 && q.status === "trial_ended" && /no VAT/.test(q.vatNote), "quote: school, £149, free term ended");
    ok((await post("/api/subscribe/quote", { code: "AAAA-BBBB-CCCC" })).status === 404, "unknown code: no quote");
    ok((await post("/api/subscribe", { code: code1, billingName: "Jo Bursar", billingEmail: "finance@hillside.sch.uk", address: "Hill Road, Town, AB1 2CD", agree: false })).status === 400, "must agree to subscribe");
    const sub = await post("/api/subscribe", { code: code1, billingName: "Jo Bursar", billingEmail: "finance@hillside.sch.uk", address: "Hill Road\nTown AB1 2CD", po: "PO-777", agree: true });
    const sj = await sub.json();
    await wait(400);
    ok(sub.status === 200 && sj.resumed && /^EC-\d{4}-0001$/.test(sj.invoice), "subscribed: access resumes, invoice EC-…-0001");
    ok((await post("/api/access", { code: code1 })).status === 200, "the same code works again straight away");
    const invMail = mailTo("finance@hillside.sch.uk", /Invoice EC-/)[0];
    ok(invMail && invMail.to.includes("head@hillside.sch.uk"), "invoice emailed to finance, copied to the head");
    ok(/£149/.test(invMail.text) && /12-34-56/.test(invMail.text) && /12345678/.test(invMail.text) && /VAT not charged/.test(invMail.text), "invoice: £149, bank details, VAT not charged");
    ok(/PO-777/.test(invMail.html) && /Test Operator/.test(invMail.html), "invoice shows the PO number and who it's from");
    const link = (invMail.text.match(/https:\/\/evalu8compass\.test(\/invoice\/[^\s]+)/) || [])[1];
    ok(!!link && (await get(link)).status === 200, "invoice link opens the printable invoice");
    ok((await get(link.replace(/t=.+$/, "t=forged"))).status === 404 && (await get(link.split("?")[0])).status === 404, "invoice can't be opened without the signed link");
    ok(mailTo("owner@example.org", /Subscription: Hillside Primary/).length === 1, "owner notified of the subscription");
    const hs = readCodes().codes.find(c => c.name === "Hillside Primary");
    ok(hs.sub.periodStart === billing.today() && hs.sub.periodEnd === billing.addYear(billing.today()) && hs.expiresAt === billing.startOf(billing.addDays(hs.sub.periodEnd, 30)), "paid year: today for 12 months, access until 30 days after");
    const resub = await post("/api/subscribe", { code: code1, billingName: "Jo", billingEmail: "finance@hillside.sch.uk", address: "Hill Road, Town", agree: true });
    ok(resub.status === 409, "can't subscribe twice for the same year");

    // Subscribing during the free term: the paid year starts when it ends
    const bcode = codeIn(mailTo("lee@brook.org")[0]);
    const bs = await (await post("/api/subscribe", { code: bcode, billingName: "Bursar", billingEmail: "bursar@brook.org", address: "Brook Lane, Town", agree: true })).json();
    const brook = readCodes().codes.find(c => c.name === "Brook House School");
    ok(!bs.resumed && brook.sub.periodStart === brook.trialEndsAt && brook.sub.invoice.dueAt >= brook.trialEndsAt, "subscribing in the free term: paid year starts when it ends; payment not due before then");
    ok(brook.sub.price === 99 && brook.sub.invoice.number.endsWith("0002"), "independent invoice: £99, next invoice number");

    /* ---------- admin console ---------- */
    const admin = require("../lib/admin");
    const { secret } = admin.setup("correct horse battery staple");
    const al = await post("/api/admin/login", { password: "correct horse battery staple", code: admin.totp(secret, Math.floor(Date.now() / 30000)) });
    const ac = (al.headers.get("set-cookie") || "").split(";")[0];
    ok((await get("/api/admin/billing")).status === 401, "billing overview needs the superadmin");
    const ov = await (await get("/api/admin/billing", ac)).json();
    ok(ov.rows.length === 3 && ov.totals.subscribed === 2 && ov.mail && ov.canInvoice && ov.enquiries.length === 1, "admin overview: 3 schools, 2 subscribed, email and invoicing on, 1 trust enquiry");
    ok(ov.totals.outstanding === 248, "unpaid total £248 (£149 + £99)");
    const hid = hs.id;
    ok((await post(`/api/admin/codes/${hid}/billing/mark-paid`, { date: billing.today() }, ac)).status === 200, "mark paid");
    await wait(300);
    ok(mailTo("finance@hillside.sch.uk", /Payment received/).length === 1 && /Paid /.test(last().html), "receipt emailed, invoice shows Paid");
    const ov2 = await (await get("/api/admin/billing", ac)).json();
    ok(ov2.rows.find(r => r.id === hid).status.key === "paid" && ov2.totals.outstanding === 99, "status Paid; unpaid total now £99");
    ok((await get(link.split("?")[0], ac)).status === 200, "superadmin can open invoices without the signed link");
    ok((await post(`/api/admin/codes/${hid}/billing/send-invoice`, {}, ac)).status === 200, "resend invoice");
    ok((await post(`/api/admin/codes/${hid}/billing/set-trial`, { date: "2026-13-01" }, ac)).status === 400, "impossible date refused");
    ok((await get("/api/admin/billing", ac)).status === 200 && readCodes().codes.find(c => c.id === hid).trialEndsAt !== "2026-13-01", "a refused date changes nothing");
    ok((await post(`/api/admin/codes/${hid}/billing/mark-paid`, { date: ["2026-10-01"] }, ac)).status === 400, "mark paid with a non-date refused");
    ok((await get(link.replace(/t=.+$/, "t=" + "é".repeat(43)))).status === 404, "odd invoice tokens give 404, not a crash");
    ok((await fetch(base + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: "null" })).status === 400, "a null request body is refused cleanly");
    ok((await post("/api/signup", { school: ["x"], type: "independent", name: { a: 1 }, email: "x@y.org", agree: true })).status === 400, "non-text fields refused cleanly");

    /* ---------- the 30-day renewal grace (Hillside is paid) ---------- */
    const g1 = readCodes(); const hg = g1.codes.find(c => c.id === hid);
    const oldEnd = billing.addDays(billing.today(), -5);
    hg.sub.periodStart = billing.addDays(oldEnd, -365); hg.sub.periodEnd = oldEnd; hg.expiresAt = billing.startOf(billing.addDays(oldEnd, 30)); writeCodes(g1); await wait(50);
    const gl = await post("/api/access", { code: code1 });
    const gcookie = (gl.headers.get("set-cookie") || "").split(";")[0];
    ok(gl.status === 200, "5 days after the paid year ends: access continues");
    const gp = (await (await get("/api/access", gcookie)).json()).plan;
    ok(gp.status === "grace" && gp.canRenew && gp.daysLeft === 25 && gp.nextStart === billing.longDate(oldEnd), "dashboard: ended, 25 days of grace left, new year from the old end date");
    ok((await post("/api/subscribe/quote", {})).status === 400, "subscribing without a code or sign-in is refused");
    const gq = await (await post("/api/subscribe/quote", {}, gcookie)).json();
    ok(gq.school === "Hillside Primary" && gq.status === "grace" && gq.startsLabel === billing.longDate(oldEnd), "signed in: the subscribe page knows the school without the code");
    await billing.reminders({}); await wait(200);
    ok(mailTo("head@hillside.sch.uk", /subscription has ended/).length === 1 && /continues until/.test(mailTo("head@hillside.sch.uk", /subscription has ended/)[0].text), "grace email: ended, access continues until …");
    const gr = await post("/api/subscribe", { billingName: "Jo Bursar", billingEmail: "finance@hillside.sch.uk", address: "Hill Road, Town", agree: true }, gcookie);
    const grj = await gr.json(); await wait(300);
    const hg2 = readCodes().codes.find(c => c.id === hid);
    ok(gr.status === 200 && !grj.resumed && hg2.sub.periodStart === oldEnd && hg2.sub.periodEnd === billing.addYear(oldEnd), "renewing in the grace: the new year starts on the old end date (the grace counts)");
    ok(hg2.history.length === 1 && hg2.history[0].paidAt, "the paid year is kept in the history");
    ok(((await (await get("/api/access", gcookie)).json()).plan || {}).status === "invoiced", "dashboard now shows the new year as invoiced");

    /* ---------- the 14-day grace after the free term ---------- */
    const g2 = readCodes(); const vg = g2.codes.find(c => c.name === "Valley Academy");
    // (Valley subscribes and cancels later in this test; here it's still only in its free term)
    const vEnd = billing.addDays(billing.today(), -3);
    vg.trialEndsAt = vEnd; vg.expiresAt = billing.startOf(billing.addDays(vEnd, 14)); writeCodes(g2); await wait(50);
    const vcode0 = codeIn(mailTo("kim@valley.org")[0]);
    const vl = await post("/api/access", { code: vcode0 });
    const vcookie = (vl.headers.get("set-cookie") || "").split(";")[0];
    const vp = (await (await get("/api/access", vcookie)).json()).plan;
    ok(vl.status === 200 && vp.status === "trial_grace" && vp.daysLeft === 11 && vp.canSubscribe, "3 days after the free term: access continues, 11 days left, can subscribe");
    await billing.reminders({}); await wait(200);
    ok(mailTo("kim@valley.org", /free term has ended/).length === 1, "email: free term ended, access continues while you subscribe");
    const vq = await (await post("/api/subscribe/quote", {}, vcookie)).json();
    ok(vq.startsLabel === billing.longDate(vEnd), "subscribing in the grace: the paid year starts when the free term ended");
    // put it back in its free term for the later checks
    const g3 = readCodes(); const vb = g3.codes.find(c => c.name === "Valley Academy"); vb.trialEndsAt = billing.freeUntil(billing.today()); vb.expiresAt = billing.startOf(billing.addDays(vb.trialEndsAt, 14)); vb.sent = {}; writeCodes(g3); await wait(50);

    /* ---------- reminders ---------- */
    const db3 = readCodes(); const v = db3.codes.find(c => c.name === "Valley Academy");
    v.trialEndsAt = billing.addDays(billing.today(), 10); writeCodes(db3);
    await wait(50);
    const sent1 = await billing.reminders({});
    const sent2 = await billing.reminders({});
    await wait(200);
    ok(sent1 >= 1 && sent2 === 0 && mailTo("kim@valley.org", /free term ends/).length === 1, "two weeks before the free term ends: one reminder, sent once");

    // Overdue invoice and pausing state
    const db4 = readCodes(); const b4 = db4.codes.find(c => c.name === "Brook House School");
    b4.trialEndsAt = billing.addDays(billing.today(), -60); b4.sub.periodStart = b4.trialEndsAt; b4.sub.periodEnd = billing.addYear(b4.trialEndsAt); b4.sub.invoice.dueAt = billing.addDays(billing.today(), -10); writeCodes(db4);
    await wait(50);
    ok(billing.status(readCodes().codes.find(c => c.name === "Brook House School")).key === "overdue", "unpaid after the due date: Overdue");
    await billing.reminders({}); await wait(200);
    ok(mailTo("lee@brook.org", /overdue/).length === 1, "overdue reminder sent a week after the due date");

    // Renewing with an unpaid invoice is refused, so the debt isn't lost
    const db4b = readCodes(); const b4b = db4b.codes.find(c => c.name === "Brook House School"); b4b.sub.periodEnd = billing.addDays(billing.today(), 20); writeCodes(db4b); await wait(50);
    const rn = await post("/api/subscribe", { code: bcode, billingName: "Bursar", billingEmail: "bursar@brook.org", address: "Brook Lane, Town", agree: true });
    ok(rn.status === 409 && /hasn't been paid/.test((await rn.json()).error), "renewal refused while the invoice is unpaid");
    const qn = await (await post("/api/subscribe/quote", { code: bcode })).json();
    ok(qn.unpaid === true, "the subscribe page is told the invoice is unpaid");

    // Cancelling during the free term keeps the free term
    const vcode = codeIn(mailTo("kim@valley.org")[0]);
    await post("/api/subscribe", { code: vcode, billingName: "VB", billingEmail: "vb@valley.org", address: "Valley Road, Town", agree: true });
    const vid = readCodes().codes.find(c => c.name === "Valley Academy").id;
    await post(`/api/admin/codes/${vid}/billing/cancel`, {}, ac); await wait(50);
    const vc = readCodes().codes.find(c => c.id === vid);
    ok(vc.expiresAt === billing.startOf(billing.addDays(vc.trialEndsAt, 14)) && billing.status(vc).key === "trial", "cancel during the free term: access continues to the end of it");
    ok((await post("/api/access", { code: vcode })).status === 200, "the code still works in the free term after cancelling");

    // Cancel
    ok((await post(`/api/admin/codes/${b4.id}/billing/cancel`, {}, ac)).status === 200, "cancel a subscription");
    await wait(50);
    ok((await post("/api/access", { code: bcode })).status === 403, "cancelled: access pauses");

    // Retention: contact details removed long after access ends
    const access = require("../lib/access");
    const db5 = readCodes(); const b5 = db5.codes.find(c => c.name === "Brook House School"); b5.expiresAt = new Date(Date.now() - 400 * 864e5).toISOString(); writeCodes(db5);
    access.scrubEnded(365);
    const b6 = readCodes().codes.find(c => c.name === "Brook House School");
    ok(!b6.email && !b6.contact && !b6.sub.billing, "retention: contact and invoice contact details removed after access ended");
    ok(fs.readFileSync(FILES[3], "utf8").split("\n").filter(Boolean).length === 4, "invoices kept for the accounts (including the renewal)");

    /* ---------- no password over an unencrypted connection ---------- */
    const mail = require("../lib/mail");
    delete process.env.SMTP_ALLOW_PLAIN;
    let refused = null; try { await mail.send({ to: "x@example.org", subject: "t", text: "t" }); } catch (e) { refused = e.message; }
    ok(refused && /didn't offer encryption/.test(refused), "won't send the email password if the server offers no encryption");
    process.env.SMTP_ALLOW_PLAIN = "1";

    /* ---------- email off ---------- */
    srv.kill(); await wait(300);
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "", SMTP_HOST: "" }, stdio: "ignore" });
    await wait(700);
    const off = await post("/api/signup", { school: "New School", type: "independent", name: "Al", email: "al@new.org", agree: true });
    ok(off.status === 503 && /support@/.test((await off.json()).error), "without email set up, sign-up explains how to get a code instead");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally {
    if (srv) srv.kill();
    smtp.close();
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    const dir = path.join(DATA, "schools");
    if (fs.existsSync(dir)) for (const d of fs.readdirSync(dir)) if (!schoolsBefore.has(d)) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
    setTimeout(() => process.exit(), 100);
  }
})();
