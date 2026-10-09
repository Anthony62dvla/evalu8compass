/* Checks the monthly AI allowance, using a stand-in for the Anthropic API (no real AI calls).
 * Run: node scripts/test-ai-allowance.js
 * Backs up and restores data/admin.json, access.json, audit.log and usage.json. */
const { spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["admin.json", "access.json", "audit.log", "usage.json"].map(f => path.join(DATA, f));
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const admin = require("../lib/admin");
const PORT = 3991, MOCK = 3990, base = `http://127.0.0.1:${PORT}`;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const J = (cookie, method, body) => ({ method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

// Stand-in Anthropic API: answers with fixed JSON and token counts, or fails when told to
let fail = false, calls = 0;
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    calls++;
    if (fail) { res.writeHead(500, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "overloaded" } })); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ summary: "Mock advice", activities: [{ title: "Do a thing", what: "Details" }] }) }], usage: { input_tokens: 1200, output_tokens: 300 } }));
  });
}).listen(MOCK);

let srv;
(async () => {
  try {
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}`, AI_MONTHLY_REQUESTS: "3", AI_PRICE_INPUT_PER_MTOK: "3", AI_PRICE_OUTPUT_PER_MTOK: "15" }, stdio: "ignore" });
    const code = execFileSync(process.execPath, [path.join(__dirname, "access.js"), "add", "Athena School"]).toString().match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
    const id = JSON.parse(fs.readFileSync(FILES[1], "utf8")).codes[0].id;
    await new Promise(r => setTimeout(r, 700));
    const login = await fetch(base + "/api/access", J("", "POST", { code }));
    const S = (login.headers.get("set-cookie") || "").split(";")[0];
    const ask = () => fetch(base + "/api/inspector", J(S, "POST", { task: "item", data: { ctx: { type: "academy", phases: ["ks3"] }, area: "Safeguarding", item: { text: "x", evidence: "y" }, status: "no", note: "" } }));

    let st = (await (await fetch(base + "/api/access", { headers: { cookie: S } })).json()).ai;
    ok(st && st.used === 0 && st.limit === 3 && /^\d{4}-\d\d-01$/.test(st.resetsOn), "school sees its allowance: 0 of 3, resets on the 1st");

    const r1 = await (await ask()).json();
    ok(r1.result && r1.result.summary === "Mock advice" && r1.allowance.used === 1, "AI answer returned and counted (1 of 3)");
    fail = true;
    const bad = await ask();
    ok(bad.status === 502, "AI service error passed on");
    fail = false;
    st = (await (await fetch(base + "/api/access", { headers: { cookie: S } })).json()).ai;
    ok(st.used === 1, "a failed AI call isn't counted against the school");
    await ask(); await ask();
    const before = calls;
    const over = await ask(); const od = await over.json();
    ok(over.status === 429 && od.code === "allowance_reached" && /resets on/.test(od.error), "4th request refused with a clear message: " + od.error);
    ok(calls === before, "no call made to the AI once the allowance is used up");

    // Workshop AI counts against the school that started it
    const w = await (await fetch(base + "/api/w", J(S, "POST", { profile: { type: "academy", phases: ["ks3"] }, areaIds: ["sg"] }))).json();
    const wr = await fetch(base + `/api/w/${w.code}/themes`, { method: "POST", headers: { "x-facilitator-key": w.key, "content-type": "application/json" }, body: "{}" });
    ok(wr.status === 429, "workshop AI also stops when the school's allowance is used up");

    // Superadmin raises the allowance
    const { secret } = admin.setup("correct horse battery staple");
    const al = await fetch(base + "/api/admin/login", J("", "POST", { password: "correct horse battery staple", code: admin.totp(secret, Math.floor(Date.now() / 30000)) }));
    const A = (al.headers.get("set-cookie") || "").split(";")[0];
    let ov = await (await fetch(base + "/api/admin/overview", { headers: { cookie: A } })).json();
    const row = ov.codes.find(c => c.id === id).ai;
    ok(row.used === 3 && row.limit === 3 && row.input === 3600 && row.output === 900, "admin sees requests and tokens for the school");
    ok(row.cost === 0.02 && ov.ai.total.requests === 3, "admin sees estimated cost and monthly total");
    const set = await (await fetch(base + `/api/admin/codes/${id}/allowance`, J(A, "POST", { limit: 10 }))).json();
    ok(set.limit === 10 && set.left === 7 && set.custom, "allowance raised to 10 for this school");
    ok((await ask()).status === 200, "school can use AI again straight away");
    const wr2 = await fetch(base + `/api/w/${w.code}/themes`, { method: "POST", headers: { "x-facilitator-key": w.key, "content-type": "application/json" }, body: "{}" });
    ok(wr2.status === 200, "workshop AI works again too");
    await fetch(base + `/api/admin/codes/${id}/allowance`, J(A, "POST", { limit: 0 }));
    const off = await ask(); const offd = await off.json();
    ok(off.status === 403 && offd.code === "ai_disabled", "allowance 0 switches AI off for the school");
    ok((await fetch(base + `/api/admin/codes/${id}/allowance`, J(A, "POST", { limit: "lots" }))).status === 400, "nonsense allowance rejected");
    await fetch(base + `/api/admin/codes/${id}/allowance`, J(A, "POST", { limit: null }));
    ov = await (await fetch(base + "/api/admin/overview", { headers: { cookie: A } })).json();
    ok(ov.codes.find(c => c.id === id).ai.limit === 3 && !ov.codes.find(c => c.id === id).ai.custom, "blank resets the school to the default allowance");
    ok(ov.audit.some(a => a.action === "ai.allowance"), "allowance changes are in the audit log");
    const u = JSON.parse(fs.readFileSync(path.join(DATA, "usage.json"), "utf8"));
    ok(!JSON.stringify(u).includes("Mock advice") && !JSON.stringify(u).includes("Safeguarding"), "usage file holds counts only, no content");
    fs.rmSync(path.join(DATA, "sessions", w.code + ".json"), { force: true });
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally {
    if (srv) srv.kill(); mock.close();
    await new Promise(r => setTimeout(r, 300));
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
  }
})();
