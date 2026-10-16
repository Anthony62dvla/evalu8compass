/* Individual sign-ins, roles, change history, and the trust view. Run: node scripts/test-signins.js
 * Starts the server with a fake email server; backs up and restores the data files it touches. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["access.json", "admin.json", "audit.log", "trusts.json"].map(f => path.join(DATA, f));
fs.mkdirSync(path.join(DATA, "schools"), { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const before = new Set(fs.readdirSync(path.join(DATA, "schools")));
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PORT = 3996, SMTP = 3999, base = `http://127.0.0.1:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms || 250));
const env = { ...process.env, PORT, ANTHROPIC_API_KEY: "", ACCESS_REQUIRED: "", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>", ADMIN_EMAIL: "owner@example.org", SITE_URL: base, MAIL_OUTBOX: "", ALERT_DELAY_MS: "600000", SIGNUP_LIMIT_PER_MIN: "500", LOGIN_LIMIT_PER_MIN: "500" };
const req = (p, opt = {}) => fetch(base + p, { redirect: "manual", ...opt, headers: { "content-type": "application/json", ...(opt.headers || {}) } });
const post = (p, body, cookie) => req(p, { method: "POST", body: JSON.stringify(body || {}), headers: cookie ? { cookie } : {} });
const cookieOf = r => (r.headers.get("set-cookie") || "").split(/,(?=\s*hwwd_)/).map(x => x.split(";")[0]).filter(x => /=./.test(x)).join("; ");
const codeIn = (mail, to) => { const m = mail.inbox.filter(x => x.to.includes(to) && /sign-in code/.test(x.subject)).pop(); return m && (m.subject.match(/(\d{6})/) || [])[1]; };

let srv, mail;
(async () => {
  try {
    mail = await require("./fake-mail").start(SMTP);
    const access = require("../lib/access"), schools = require("../lib/schools");
    const oak = access.add("Oak Primary", 365), elm = access.add("Elm Academy", 365);
    const team = [
      { id: "h", name: "Pat Head", role: "head", email: "head@oak.sch.uk" }, { id: "s", name: "Sam Senco", role: "senco", email: "senco@oak.sch.uk" },
      { id: "g", name: "Gill Governor", role: "gov", email: "gov@oak.sch.uk" }, { id: "x", name: "Adviser", role: "sip", email: "adviser@diocese.test" },
      { id: "c", name: "Chris Ceo", role: "other", email: "ceo@trust.org.uk" },
    ];
    schools.replace(oak.id, { profile: { name: "Oak Primary", type: "academy", phases: ["ks1", "ks2"] }, team, answers: { "sg-dsl": "no", "sg-culture": "met" }, notes: { "sg-dsl": "SECRET-NOTE" }, actions: [{ id: "a1", title: "Phonics", status: "doing", rag: "risk" }] });
    schools.replace(elm.id, { profile: { name: "Elm Academy", type: "academy", phases: ["ks3", "ks4"] }, team: [{ id: "h2", name: "Elle Head", role: "head", email: "head@elm.sch.uk" }], answers: { "sg-dsl": "met" } });
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "ignore", "inherit"] });
    await wait(900);

    // Email sign-in
    let r = await post("/api/login/email", { email: "nobody@nowhere.test" }); let j = await r.json(); await wait();
    ok(r.status === 200 && j.sent && !mail.inbox.length, "unknown email: same answer, no email sent");
    await post("/api/login/email", { email: "gov@oak.sch.uk" }); await post("/api/login/email", { email: "adviser@diocese.test" }); await wait();
    ok(!mail.inbox.length, "governors and external advisers can't sign in this way");
    await post("/api/login/email", { email: "SENCO@oak.sch.uk " }); await wait();
    const sc = codeIn(mail, "senco@oak.sch.uk");
    ok(/^\d{6}$/.test(sc || ""), "a team member gets a 6-digit code by email");
    r = await post("/api/login/code", { email: "senco@oak.sch.uk", code: "000000" === sc ? "111111" : "000000" });
    ok(r.status === 400, "a wrong code is refused");
    r = await post("/api/login/code", { email: "senco@oak.sch.uk", code: sc }); j = await r.json();
    const S = cookieOf(r);
    ok(r.status === 200 && j.ok && j.kind === "school" && /hwwd_access=/.test(S), "the right code signs them in to their school");
    ok((await post("/api/login/code", { email: "senco@oak.sch.uk", code: sc })).status === 400, "a code works once");
    let a = await (await req("/api/access", { headers: { cookie: S } })).json();
    ok(a.ok && a.school === "Oak Primary" && a.user.name === "Sam Senco" && a.user.role === "senco" && a.canAdmin === false, "signed in as themselves, not the head");
    // Roles
    const cur = await (await req("/api/school", { headers: { cookie: S } })).json();
    r = await req("/api/school", { method: "PATCH", body: JSON.stringify({ baseRev: cur.rev, patch: { set: { "answers.sg-dsl": "part" }, actions: { upsert: [{ id: "a2", title: "SEND profiles", status: "todo" }], del: [] } } }), headers: { cookie: S } });
    ok(r.status === 200, "a leader can rate lines and add actions");
    r = await req("/api/school", { method: "PATCH", body: JSON.stringify({ baseRev: cur.rev, patch: { team: { upsert: [{ id: "z", name: "Me", role: "head", email: "me@x.test" }], del: [] } } }), headers: { cookie: S } });
    ok(r.status === 403, "but can't change the team");
    r = await req("/api/school", { method: "PATCH", body: JSON.stringify({ baseRev: cur.rev, patch: { set: { "profile.type": "independent" } } }), headers: { cookie: S } });
    ok(r.status === 403, "or the school's settings");
    ok((await post("/api/school/governors/code", { action: "new" }, S)).status === 403, "or governors' access");
    // The head
    await post("/api/login/email", { email: "head@oak.sch.uk" }); await wait();
    r = await post("/api/login/code", { email: "head@oak.sch.uk", code: codeIn(mail, "head@oak.sch.uk") }); const H = cookieOf(r);
    a = await (await req("/api/access", { headers: { cookie: H } })).json();
    ok(a.user.name === "Pat Head" && a.canAdmin === true, "the head can do everything");
    // History
    const hist = await (await req("/api/school/history", { headers: { cookie: H } })).json();
    ok(hist.history[0].by === "Sam Senco" && /1 rating/.test(hist.history[0].what) && /1 action/.test(hist.history[0].what), "changes are recorded by name: " + hist.history[0].what);
    // Invitations
    r = await post("/api/school/team/invite", {}, H); j = await r.json(); await wait();
    ok(r.status === 200 && j.sent === 3 && mail.inbox.some(m => /Sign in to Evalu8 Compass with your email/.test(m.subject) && m.to.includes("ceo@trust.org.uk")) && !mail.inbox.some(m => /Sign in to Evalu8/.test(m.subject) && m.to.includes("gov@oak.sch.uk")), "head emails sign-in instructions to the team (not governors or advisers)");
    ok((await post("/api/school/team/invite", {}, S)).status === 403, "leaders can't send invitations");
    // Shared code
    const shared = cookieOf(await post("/api/access", { code: oak.code }));
    ok((await post("/api/school/sharedcode", { on: false }, shared)).status === 403, "the shared code can't switch itself off");
    ok((await post("/api/school/sharedcode", { on: false }, S)).status === 403, "only the head or deputy can switch it off");
    r = await post("/api/school/sharedcode", { on: false }, H);
    ok(r.status === 200 && (await r.json()).codeOff === true, "the head switches the shared code off");
    ok((await req("/api/school", { headers: { cookie: shared } })).status === 401, "sessions using the shared code end");
    r = await post("/api/access", { code: oak.code }); j = await r.json();
    ok(r.status === 403 && j.code === "use_email", "the shared code now says to sign in with your email");
    ok((await req("/api/school", { headers: { cookie: H } })).status === 200, "individual sign-ins still work");
    await post("/api/school/sharedcode", { on: true }, H);
    ok((await post("/api/access", { code: oak.code })).status === 200, "and it can be switched back on");
    // Removed from the team: signed out
    const cur2 = await (await req("/api/school", { headers: { cookie: H } })).json();
    await req("/api/school", { method: "PATCH", body: JSON.stringify({ baseRev: cur2.rev, patch: { team: { upsert: [], del: ["s"] } } }), headers: { cookie: H } });
    ok((await req("/api/school", { headers: { cookie: S } })).status === 401, "someone removed from the team can't sign in any more");

    // Trusts
    const admin = require("../lib/admin"); const { secret } = admin.setup("a long admin password for tests");
    const A = cookieOf(await post("/api/admin/login", { password: "a long admin password for tests", code: admin.totp(secret, Math.floor(Date.now() / 30000)) }));
    r = await post("/api/admin/trusts", { name: "Forest Learning Trust" }, A); const T = await r.json();
    ok(r.status === 200 && T.id, "superadmin creates a trust");
    ok((await post(`/api/admin/trusts/${T.id}/member`, { name: "Chris Ceo", email: "ceo@trust.org.uk", role: "ceo" }, A)).status === 200, "adds a trust leader");
    const before3 = mail.inbox.length;
    await post(`/api/admin/trusts/${T.id}/school`, { school: oak.id }, A); await post(`/api/admin/trusts/${T.id}/school`, { school: elm.id }, A); await wait(400);
    ok(mail.inbox.slice(before3).some(m => /Forest Learning Trust has asked to see/.test(m.subject) && m.to.includes("head@oak.sch.uk")), "the head is told and asked");
    // Chris is on Oak's team AND a trust leader: chooses where to sign in
    await post("/api/login/email", { email: "ceo@trust.org.uk" }); await wait();
    const cc = codeIn(mail, "ceo@trust.org.uk");
    j = await (await post("/api/login/code", { email: "ceo@trust.org.uk", code: cc })).json();
    ok(Array.isArray(j.choose) && j.choose.length === 2 && j.choose.some(x => x.kind === "trust"), "someone in a school and a trust chooses where to sign in");
    r = await post("/api/login/code", { email: "ceo@trust.org.uk", code: cc, choice: `trust:${T.id}` }); j = await r.json();
    const TC = cookieOf(r);
    ok(j.ok && j.kind === "trust" && /hwwd_trust=/.test(TC), "signed in to the trust");
    let tv = await (await req("/api/trust/view", { headers: { cookie: TC } })).json();
    ok(tv.trust.name === "Forest Learning Trust" && tv.schools.length === 0 && tv.pending.length === 2, "before heads agree, the trust sees nothing");
    ok((await req(`/api/trust/school/${oak.id}`, { headers: { cookie: TC } })).status === 404, "and can't open a school");
    ok((await req("/api/school", { headers: { cookie: TC } })).status === 401, "a trust sign-in can't open a school's working data");
    let st = await (await req("/api/school/trust", { headers: { cookie: H } })).json();
    ok(st.trust.status === "pending" && st.trust.name === "Forest Learning Trust", "the school sees the request");
    await post("/api/login/email", { email: "head@elm.sch.uk" }); await wait();
    const E = cookieOf(await post("/api/login/code", { email: "head@elm.sch.uk", code: codeIn(mail, "head@elm.sch.uk") }));
    ok((await post("/api/school/trust/confirm", {}, H)).status === 200 && (await post("/api/school/trust/decline", {}, E)).status === 200, "Oak agrees; Elm declines");
    tv = await (await req("/api/trust/view", { headers: { cookie: TC } })).json();
    const row = tv.schools[0];
    ok(tv.schools.length === 1 && row.name === "Oak Primary" && row.safeguarding.gaps === 1 && row.plan.risk === 1 && tv.pending.length === 0, "the trust sees Oak only, with its figures");
    const sd = await (await req(`/api/trust/school/${oak.id}`, { headers: { cookie: TC } })).json();
    ok(/summary for the trust/.test(sd.doc.title) && !JSON.stringify(sd).includes("SECRET"), "Oak's summary for the trust, with no evidence notes");
    ok((await post("/api/school/trust/leave", {}, H)).status === 200 && (await (await req("/api/trust/view", { headers: { cookie: TC } })).json()).schools.length === 0, "the head can stop sharing at any time");
    ok((await req("/trust.html", { headers: { cookie: TC } })).status === 200 && (await req("/trust.html")).status === 302, "the trust page needs a trust sign-in");
  } catch (e) { console.error(e); ok(false, "threw: " + e.message); }
  finally {
    if (srv) srv.kill(); if (mail) mail.close();
    await wait(200);
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!before.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    process.exit();
  }
})();
