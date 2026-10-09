/* End-to-end check of the superadmin console API. Run: node scripts/test-admin.js
 * Backs up and restores any existing data/admin.json, access.json and audit.log. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["admin.json", "access.json", "audit.log"].map(f => path.join(DATA, f));
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));

const admin = require("../lib/admin");
const PORT = 3997, base = `http://127.0.0.1:${PORT}`;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PW = "correct horse battery staple";
const post = (p, body, cookie, extra) => fetch(base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(extra || {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(base + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
const codeAt = (secret, offset) => admin.totp(secret, Math.floor(Date.now() / 30000) + (offset || 0));

let srv;
(async () => {
  try {
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "" }, stdio: "ignore" });
    await new Promise(r => setTimeout(r, 700));
    let me = await (await get("/api/admin/me")).json();
    ok(me.configured === false, "before setup: console reports not configured");
    ok((await post("/api/admin/login", { password: "x", code: "123456" })).status === 409, "sign-in refused until set up");

    let threw = false; try { admin.setup("short"); } catch (e) { threw = true; }
    ok(threw, "short passwords rejected");
    const { secret } = admin.setup(PW);
    ok(!fs.readFileSync(FILES[0], "utf8").includes(PW), "password not stored in plain text");

    ok((await get("/api/admin/overview")).status === 401, "overview needs sign-in");
    ok((await post("/api/admin/login", { password: "wrong password here", code: codeAt(secret) })).status === 401, "wrong password rejected");
    ok((await post("/api/admin/login", { password: PW, code: "000000" })).status === 401, "wrong authenticator code rejected");
    const good = await post("/api/admin/login", { password: PW, code: codeAt(secret) });
    const sc = good.headers.get("set-cookie") || "";
    const cookie = sc.split(";")[0];
    ok(good.status === 200 && /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Max-Age=28800/.test(sc), "right password + code: strict 8-hour cookie");
    ok((await post("/api/admin/login", { password: PW, code: codeAt(secret) })).status === 401, "the same authenticator code can't be reused");

    const ov = await (await get("/api/admin/overview", cookie)).json();
    ok(ov.stats && ov.system && Array.isArray(ov.codes), "overview loads");

    ok((await post("/api/admin/codes", { name: "Athena School" }, cookie, { origin: "https://evil.example" })).status === 403, "cross-site request refused");
    ok((await post("/api/admin/codes", { name: "" }, cookie)).status === 400, "school name required");
    const cr = await post("/api/admin/codes", { name: "Athena School", email: "head@athena.sch.uk", days: 90, notes: "Pilot" }, cookie);
    const c = await cr.json();
    ok(cr.status === 201 && /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c.code) && c.expiresAt, "code created with expiry: " + c.code);

    const school = await post("/api/access", { code: c.code });
    const schoolCookie = (school.headers.get("set-cookie") || "").split(";")[0];
    ok(school.status === 200, "school can sign in with the new code");
    ok((await get("/api/admin/overview", schoolCookie)).status === 401, "a school's cookie can't open the admin console");
    const w = await post("/api/w", { profile: { type: "academy", phases: ["ks3"] }, areaIds: ["sg"] }, schoolCookie);
    const wd = await w.json();
    const ov2 = await (await get("/api/admin/overview", cookie)).json();
    const row = ov2.codes.find(x => x.id === c.id);
    ok(row && row.workshops === 1 && row.lastUsedAt && row.email === "head@athena.sch.uk", "console shows the school's workshop, last sign-in and email");
    ok(ov2.codes.every(x => !("hash" in x)), "code hashes never sent to the browser");

    ok((await post(`/api/admin/codes/${c.id}/revoke`, {}, cookie)).status === 200, "revoke from console");
    ok((await get("/checklist.html", schoolCookie)).status === 302, "revoked school is signed out straight away");
    ok((await post(`/api/admin/codes/${c.id}/reactivate`, {}, cookie)).status === 200 && (await get("/checklist.html", schoolCookie)).status === 200, "reactivate restores access");
    await post(`/api/admin/codes/${c.id}/extend`, { days: 0 }, cookie);
    const ov3 = await (await get("/api/admin/overview", cookie)).json();
    ok(!ov3.codes.find(x => x.id === c.id).expiresAt, "expiry removed");
    ok((await get("/checklist.html", cookie)).status === 200, "superadmin can open the checklist too");

    const acts = ov3.audit.map(a => a.action);
    ok(["admin.login", "admin.login_failed", "code.create", "code.revoke", "code.reactivate", "code.extend"].every(a => acts.includes(a)), "every action is in the audit log");

    admin.setup(PW + "!");
    ok((await get("/api/admin/overview", cookie)).status === 401, "resetting the password signs out existing admin sessions");

    let limited = false;
    for (let i = 0; i < 8; i++) if ((await post("/api/admin/login", { password: "nope", code: "111111" })).status === 429) limited = true;
    ok(limited, "repeated failed sign-ins are rate-limited");
    fs.rmSync(path.join(DATA, "sessions", wd.code + ".json"), { force: true });
  } catch (e) { console.error(e); process.exitCode = 1; }
  if (srv) srv.kill();
  FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
  process.exit();
})();
