/* End-to-end check of the workshop API with simulated staff. Run: node scripts/test-workshop.js (starts its own server) */
const { spawn } = require("child_process");
const path = require("path");
const PORT = 3999, base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "", MIN_GROUP_SIZE: "3" }, stdio: "ignore" });
const call = async (method, p, body, key) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(key ? { "x-facilitator-key": key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
setTimeout(async () => {
  try {
    const c = await call("POST", "/api/w", { profile: { name: "Test School", type: "academy", phases: ["ks3", "ks4"], special: false }, areaIds: ["sg", "ab"] });
    ok(c.status === 201 && c.body.code.length === 6, "create workshop " + c.body.code);
    const { code, key } = c.body;
    const info = await call("GET", `/api/w/${code}`);
    ok(info.body.areas.length === 2, "public info has 2 areas");
    const item = info.body.areas[0].items[0].id;

    // SSE as facilitator
    const evRes = await fetch(`${base}/api/w/${code}/events?key=${key}`);
    const reader = evRes.body.getReader(); let sse = "";
    (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; sse += new TextDecoder().decode(value); } })();

    const roles = ["teacher", "teacher", "teacher", "ta", "slt", "slt", "slt"];
    const people = [];
    for (const role of roles) people.push((await call("POST", `/api/w/${code}/join`, { role })).body);
    ok(people.every(p => p.pid && p.token), "7 staff joined");
    const ratings = ["no", "no", "part", "no", "met", "met", "met"];
    for (let i = 0; i < people.length; i++) {
      await call("PUT", `/api/w/${code}/answer`, { pid: people[i].pid, token: people[i].token, itemId: item, s: ratings[i], c: i === 3 ? "We never get told the outcome of concerns" : "" });
    }
    const bad = await call("PUT", `/api/w/${code}/answer`, { pid: people[0].pid, token: "wrong", itemId: item, s: "met" });
    ok(bad.status === 403, "wrong token rejected");
    const staffResults = await call("GET", `/api/w/${code}/results`);
    ok(staffResults.status === 403, "staff can't see results before sharing");
    const r = await call("GET", `/api/w/${code}/results?key=${key}`);
    const it = r.body.areas[0].items[0];
    ok(it.counts.n === 7 && it.counts.no === 3 && it.counts.met === 3, "counts collated");
    ok(it.roles.teacher && it.roles.slt && !it.roles.ta, "TA group (1 person) hidden, teachers and SLT shown");
    ok(it.comments.length === 1 && it.comments[0].role === null, "comment from small group is unlabelled");
    ok(it.split === true, "split flagged");
    ok(it.gap && it.gap.leaders === 100, "perception gap leaders vs staff flagged");
    await call("POST", `/api/w/${code}/control`, { action: "shareResults", value: true }, key);
    ok((await call("GET", `/api/w/${code}/results`)).status === 200, "staff can see results once shared");
    await call("POST", `/api/w/${code}/control`, { action: "agreeAll" }, key);
    const r2 = await call("GET", `/api/w/${code}/results?key=${key}`);
    ok(r2.body.areas[0].items[0].agreed.s === "no" || r2.body.areas[0].items[0].agreed.s === "met", "agree all uses most common answer");
    const fakeCtl = await call("POST", `/api/w/${code}/control`, { action: "status", value: "closed" }, "nope");
    ok(fakeCtl.status === 403, "control needs facilitator key");
    const plan = await call("POST", `/api/w/${code}/plan`, {}, key);
    ok(plan.status === 503 && /ANTHROPIC_API_KEY/.test(plan.body.error), "plan explains missing API key");
    await new Promise(r => setTimeout(r, 500));
    ok(/event: results/.test(sse) && /event: state/.test(sse), "facilitator received live results");
    const exp = await call("GET", `/api/w/${code}/export?key=${key}`);
    ok(exp.status === 200 && !exp.body.facilitatorKey && !exp.body.responses, "export hides keys and raw responses");
    ok((await call("GET", "/api/w/ZZZZZZ")).status === 404, "unknown code 404");
    ok((await fetch(`${base}/join/${code}`)).status === 200, "join link serves page");
    require("fs").unlinkSync(path.join(__dirname, "..", "data", "sessions", code + ".json"));
  } catch (e) { console.error(e); process.exitCode = 1; }
  srv.kill(); process.exit();
}, 700);
