/* Demo staff for trying a workshop (superadmin only). Run: node scripts/test-demo.js
 * Backs up and restores data/admin.json, audit.log and access.json. */
const { spawn } = require("child_process"); const fs = require("fs"), path = require("path");
const APP = path.join(__dirname, ".."), DATA = APP + "/data";
const FILES = ["admin.json", "audit.log", "access.json"].map(f => path.join(DATA, f)); const bk = FILES.map(f => fs.existsSync(f) ? fs.readFileSync(f) : null); FILES.forEach(f => fs.rmSync(f, { force: true }));
const admin = require(path.join(APP, "lib", "admin"));
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const srv = spawn(process.execPath, [APP + "/server.js"], { env: { ...process.env, PORT: 3982, ANTHROPIC_API_KEY: "" }, stdio: "ignore" });
const B = "http://127.0.0.1:3982", J = (h, m, b) => ({ method: m, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined });
setTimeout(async () => { let codes = []; try {
  const { secret } = admin.setup("correct horse battery staple");
  const A = (await fetch(B + "/api/admin/login", J({}, "POST", { password: "correct horse battery staple", code: admin.totp(secret, Math.floor(Date.now() / 30000)) }))).headers.get("set-cookie").split(";")[0];
  const w = await (await fetch(B + "/api/w", J({ cookie: A }, "POST", { profile: { name: "Demo Academy", type: "academy", phases: ["ks3", "ks4"] }, areaIds: ["inc", "ct", "ab"] }))).json(); codes.push(w.code);
  ok((await fetch(B + `/api/w/${w.code}/demo`, J({ "x-facilitator-key": w.key }, "POST", {}))).status === 403, "facilitator without superadmin sign-in can't add demo staff");
  const r = await fetch(B + `/api/w/${w.code}/demo`, J({ "x-facilitator-key": w.key, cookie: A }, "POST", {}));
  ok(r.status === 200 && (await r.json()).added === 10, "superadmin adds 10 demo staff");
  const res = await (await fetch(B + `/api/w/${w.code}/results`, { headers: { "x-facilitator-key": w.key } })).json();
  const items = res.areas.flatMap(a => a.items);
  ok(res.participants === 10, "10 participants");
  ok(items.filter(i => Object.keys(i.roles || {}).length >= 2).length >= items.length * 0.7, "role breakdowns visible on most lines (groups of 3+)"); console.log("   lines:", items.length);
  const score = id => res.areas.find(a => a.id === id).score;
  console.log("   area scores:", res.areas.map(a => `${a.name} ${a.score}%`).join(" · "));
  ok(items.some(i => i.split) && items.some(i => i.gap), `some lines split (${items.filter(i => i.split).length}) and some leader gaps (${items.filter(i => i.gap).length})`);
  ok(items.reduce((t, i) => t + i.comments.length, 0) >= 5, "comments present: " + items.reduce((t, i) => t + i.comments.length, 0));
  const info = await (await fetch(B + `/api/w/${w.code}`)).json();
  ok(info.demo === true, "workshop marked as demo data");
} catch (e) { console.error(e); process.exitCode = 1; } finally { srv.kill(); codes.forEach(c => fs.rmSync(DATA + "/sessions/" + c + ".json", { force: true })); await new Promise(r => setTimeout(r, 300)); FILES.forEach((f, i) => bk[i] ? fs.writeFileSync(f, bk[i]) : fs.rmSync(f, { force: true })); } }, 700);
