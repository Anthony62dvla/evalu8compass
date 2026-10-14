/* Keeping bots out of sign-up and consultant applications. Run: node scripts/test-botcheck.js
 * Starts the server with a fake email server; backs up and restores the data files it touches. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["admin.json", "access.json", "audit.log", "consultants.json"].map(f => path.join(DATA, f));
fs.mkdirSync(DATA, { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const before = new Set(fs.existsSync(path.join(DATA, "schools")) ? fs.readdirSync(path.join(DATA, "schools")) : []);
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PORT = 3992, SMTP = 3987, base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
Object.assign(process.env, { FORM_MIN_SECONDS: "2" });
const env = { ...process.env, PORT, ANTHROPIC_API_KEY: "", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", ADMIN_EMAIL: "owner@example.org", SITE_URL: base, MAIL_OUTBOX: "", SIGNUP_LIMIT_PER_MIN: "200", SIGNUP_LIMIT_PER_HOUR: "200", FORM_MIN_SECONDS: "2", TRUST_PROXY: "0" };
const post = (p, body, cookie) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const token = async () => (await (await fetch(base + "/api/form-token")).json()).t;
const school = (over) => ({ school: "Oak Tree Primary School", type: "maintained", phase: "primary", name: "Pat Head", role: "Headteacher", email: "head@oaktree.sch.uk", urn: "123456", agree: true, website: "", ...over });

let srv, mail;
(async () => {
  try {
    const B = require("../lib/botcheck");
    // Unit checks
    ok(B.check("") === "missing" && B.check("123.abc") === "missing", "no token, or a forged one, is refused");
    ok(B.check(B.token()) === "fast", "a form sent straight back is too fast");
    const access = require("../lib/access"); const old = String(Date.now() - 25 * 3600e3);
    ok(B.check(`${old}.${access.sign("form:" + old)}`) === "stale", "a page open over a day must be refreshed");
    ok(B.isDisposable("x@mailinator.com") && B.isDisposable("x@yopmail.com") && !B.isDisposable("head@oaktree.sch.uk") && !B.isDisposable("x@gmail.com"), "throwaway email services recognised");
    ok(B.signupFlags({ school: "Oak Tree Primary School", email: "head@oaktree.sch.uk", urn: "123456", type: "maintained" }).length === 0, "a normal school sign-up isn't flagged");
    const f1 = B.signupFlags({ school: "Best Cheap Loans www.spam.com", email: "bob@gmail.com", urn: "", type: "academy" });
    ok(f1.length === 3 && /personal email/.test(f1[0]) && /no URN/.test(f1[1]) && /doesn't look like a school/.test(f1[2]), "spammy sign-up flagged three ways");
    ok(B.signupFlags({ school: "St Mary's C of E", email: "office@stmarys.org.uk", urn: "1234567", type: "maintained" }).length === 0, "church school names are recognised");
    ok(B.signupFlags({ school: "Riverside Montessori", email: "office@riverside.co.uk", urn: "", type: "independent" }).join() === "no URN given", "no URN alone is just noted");

    mail = await require("./fake-mail").start(SMTP);
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "ignore", "inherit"] });
    await wait(900);
    // No token
    let r = await post("/api/signup", school());
    let j = await r.json();
    ok(r.status === 400 && j.code === "refresh" && /Refresh the page/.test(j.error), "sign-up without a page token: asked to refresh");
    // Too fast: looks like success, but nothing is created or sent
    r = await post("/api/signup", school({ ft: await token() })); j = await r.json(); await wait(300);
    ok(r.status === 200 && j.ok && !access.list().length && !mail.inbox.length, "too-fast sign-up: looks accepted, but no school is created and no email sent");
    // Throwaway email
    let t = await token(); await wait(2100);
    r = await post("/api/signup", school({ email: "head@mailinator.com", ft: t })); j = await r.json();
    ok(r.status === 400 && /school email address/.test(j.error), "throwaway email refused");
    // A real-looking sign-up
    t = await token(); await wait(2100);
    r = await post("/api/signup", school({ ft: t })); await wait(400);
    let c = access.list().find(x => x.name === "Oak Tree Primary School");
    ok(r.status === 200 && c && !c.check && mail.inbox.some(m => m.to.includes("head@oaktree.sch.uk")), "a real school signs up and gets its code");
    ok(mail.inbox.some(m => /^\[?.*New sign-up: Oak Tree Primary School/.test(m.subject) && m.to.includes("owner@example.org")), "you're told about it as normal");
    // A suspicious one: created, but flagged
    t = await token(); await wait(2100);
    r = await post("/api/signup", school({ school: "Cheap SEO services", email: "promo4u@gmail.com", urn: "", ft: t })); await wait(400);
    c = access.list().find(x => x.name === "Cheap SEO services");
    ok(r.status === 200 && c && c.check && c.check.reasons.length === 3, "a suspicious sign-up is flagged with its reasons");
    const note = mail.inbox.find(m => /Check this sign-up: Cheap SEO services/.test(m.subject));
    ok(note && /CHECK THIS SIGN-UP/.test(note.text) && /personal email address/.test(note.text), "your notification says to check it, and why");
    // Admin: Looks fine clears the flag
    const admin = require("../lib/admin");
    const { secret } = admin.setup("a long admin password for tests");
    const lr = await post("/api/admin/login", { password: "a long admin password for tests", code: admin.totp(secret, Math.floor(Date.now() / 30000)) });
    const ac = (lr.headers.get("set-cookie") || "").split(";")[0];
    const ov = await (await fetch(base + "/api/admin/overview", { headers: { cookie: ac } })).json();
    ok(ov.codes.find(x => x.id === c.id).check.reasons.length === 3, "admin page shows the flag");
    r = await post(`/api/admin/codes/${c.id}/checked`, {}, ac);
    ok(r.status === 200 && !access.list().find(x => x.id === c.id).check, "Looks fine clears it");
    // Consultant applications
    r = await post("/api/consultants/apply", { email: "a@b.test" }); j = await r.json();
    ok(r.status === 400 && j.code === "refresh", "consultant application without a page token: asked to refresh");
    r = await post("/api/consultants/apply", { email: "a@b.test", ft: await token() }); j = await r.json();
    ok(r.status === 200 && j.ok, "too-fast consultant application: looks accepted");
    t = await token(); await wait(2100);
    r = await post("/api/consultants/apply", { email: "me@yopmail.com", ft: t }); j = await r.json();
    ok(r.status === 400 && (j.fields || []).some(f => f[0] === "email" && /permanent email/.test(f[1])), "consultant with a throwaway email refused");
    const audit = fs.readFileSync(path.join(DATA, "audit.log"), "utf8");
    ok((audit.match(/bot\.blocked/g) || []).length === 2, "blocked bots are recorded in recent activity");
  } catch (e) { console.error(e); ok(false, "threw: " + e.message); }
  finally {
    if (srv) srv.kill(); if (mail) mail.close();
    await wait(200);
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    if (fs.existsSync(path.join(DATA, "schools"))) for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    process.exit();
  }
})();
