/* End-to-end check of school access codes. Run: node scripts/test-access.js
 * Uses the real data/ folder, so it backs up and restores any existing access.json. */
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILE = path.join(DATA, "access.json");
const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE) : null;
const PORT = 3998, base = `http://127.0.0.1:${PORT}`;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };

if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "", ACCESS_REQUIRED: "" }, stdio: "ignore" });
const get = (p, opt = {}) => fetch(base + p, { redirect: "manual", ...opt });

setTimeout(async () => {
  try {
    ok((await get("/checklist.html")).status === 200, "no codes yet: checklist open (fresh install isn't locked out)");
    const out = execFileSync(process.execPath, [path.join(__dirname, "access.js"), "add", "Athena School"]).toString();
    const code = (out.match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/) || [])[0];
    ok(!!code, "code created: " + code);
    ok(!fs.readFileSync(FILE, "utf8").includes(code.replace(/-/g, "")), "code stored only as a hash");

    const r1 = await get("/checklist.html");
    ok(r1.status === 302 && /enter\.html\?next=%2Fchecklist\.html/.test(r1.headers.get("location")), "checklist now redirects to enter page");
    ok((await get("/")).status === 200 && (await get("/workshop.html")).status === 200, "front page and workshop page stay open");
    const ins = await get("/api/inspector", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "item", data: { ctx: {} } }) });
    ok(ins.status === 401, "AI inspector refused without code");
    const cr = await get("/api/w", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: { type: "academy", phases: ["ks3"] } }) });
    ok(cr.status === 401, "starting a workshop refused without code");

    const bad = await get("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "WRNG-CODE-XXXX" }) });
    ok(bad.status === 401, "wrong code rejected");
    const good = await get("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.toLowerCase().replace(/-/g, " ") }) });
    const cookie = (good.headers.get("set-cookie") || "").split(";")[0];
    ok(good.status === 200 && /HttpOnly/.test(good.headers.get("set-cookie")), "right code accepted (any case/spacing), HttpOnly cookie set");
    const H = { cookie };
    ok((await get("/checklist.html", { headers: H })).status === 200, "checklist opens with cookie");
    const st = await (await get("/api/access", { headers: H })).json();
    ok(st.ok && st.school === "Athena School", "status shows school name");
    const w = await get("/api/w", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ profile: { type: "academy", phases: ["ks3"] }, areaIds: ["sg"] }) });
    const wd = await w.json();
    ok(w.status === 201, "workshop starts with cookie");
    const join = await get(`/api/w/${wd.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "teacher" }) });
    ok(join.status === 201, "staff join without any access code");

    const forged = cookie.replace(/.$/, c => (c === "A" ? "B" : "A"));
    ok((await get("/checklist.html", { headers: { cookie: forged } })).status === 302, "tampered cookie rejected");

    const id = JSON.parse(fs.readFileSync(FILE, "utf8")).codes[0].id;
    execFileSync(process.execPath, [path.join(__dirname, "access.js"), "revoke", id]);
    await new Promise(r => setTimeout(r, 50));
    // once every code is revoked the site opens again, so add a second code to check revocation alone
    execFileSync(process.execPath, [path.join(__dirname, "access.js"), "add", "Other School"]);
    ok((await get("/checklist.html", { headers: H })).status === 302, "revoked code's cookie stops working straight away");

    let limited = false;
    for (let i = 0; i < 12; i++) { const r = await get("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: "{\"code\":\"ZZZZ-ZZZZ-ZZZZ\"}" }); if (r.status === 429) limited = true; }
    ok(limited, "repeated wrong guesses are rate-limited");
    fs.rmSync(path.join(DATA, "sessions", wd.code + ".json"), { force: true });
  } catch (e) { console.error(e); process.exitCode = 1; }
  srv.kill();
  if (backup) fs.writeFileSync(FILE, backup); else fs.rmSync(FILE, { force: true });
  process.exit();
}, 700);
