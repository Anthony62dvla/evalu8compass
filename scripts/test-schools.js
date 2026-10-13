/* End-to-end check of each school's saved self-evaluation and snapshots.
 * Run: node scripts/test-schools.js
 * Uses the real data/ folder, so it backs up and restores access.json and removes what it creates. */
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const D = require("../public/js/statediff.js");
const DATA = path.join(__dirname, "..", "data");
const FILE = path.join(DATA, "access.json");
const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE) : null;
const PORT = 3996, base = `http://127.0.0.1:${PORT}`;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
{ // A saved list item edited again in place must still count as a change (the saved copy mustn't share objects with the screen)
  let base = { actions: [], meetings: [] }; const state = { actions: [{ id: "a1", title: "x" }], meetings: [{ id: "m1", status: "planned" }] };
  base = D.apply(base, D.diff(base, state));
  state.actions[0].title = "changed"; state.meetings[0].status = "live";
  const p2 = D.diff(base, state);
  ok(p2.actions && p2.actions.upsert[0].title === "changed" && p2.meetings && p2.meetings.upsert[0].status === "live", "a second edit to the same action or meeting is saved");
}
const ids = [];

const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "", ACCESS_REQUIRED: "" }, stdio: "ignore" });
const req = (p, opt = {}) => fetch(base + p, { redirect: "manual", ...opt });
const J = (cookie, method, body) => ({ method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

async function signIn(name) {
  const out = execFileSync(process.execPath, [path.join(__dirname, "access.js"), "add", name]).toString();
  const code = out.match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
  const r = await req("/api/access", J("", "POST", { code }));
  ids.push(JSON.parse(fs.readFileSync(FILE, "utf8")).codes.find(c => c.name === name).id);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}

setTimeout(async () => {
  try {
    const A = await signIn("Athena School"), B = await signIn("Beacon Academy");
    ok((await req("/api/school")).status === 401, "no access code: refused");

    let r = await (await req("/api/school", { headers: { cookie: A } })).json();
    ok(r.rev === 0 && r.state === null && r.school === "Athena School", "new school starts empty");

    const first = { profile: { name: "Athena School", type: "independent", phases: ["ks3", "ks4"], special: true }, answers: { "sg-dsl": "met", "c-intent": "part" }, notes: { "sg-dsl": "DSL trained May" }, actions: [{ id: "a1", title: "Audit curriculum", status: "todo" }] };
    r = await (await req("/api/school", J(A, "PUT", { state: first }))).json();
    ok(r.rev === 1 && r.state.answers["sg-dsl"] === "met", "first upload saved (rev 1)");

    // Two leaders edit at the same time from rev 1
    const head = D.diff(r.state, { ...r.state, answers: { ...r.state.answers, "c-intent": "met" } });
    const deputy = D.diff(r.state, { ...r.state, notes: { ...r.state.notes, "c-intent": "Maps done" }, actions: [...r.state.actions, { id: "a2", title: "Reading CPD", status: "doing" }] });
    const h = await (await req("/api/school", J(A, "PATCH", { baseRev: 1, patch: head }))).json();
    const d = await (await req("/api/school", J(A, "PATCH", { baseRev: 1, patch: deputy }))).json();
    ok(h.rev === 2 && !h.state, "head's save accepted without a catch-up");
    ok(d.rev === 3 && d.state, "deputy's save accepted, with the latest copy to catch up");
    ok(d.state.answers["c-intent"] === "met" && d.state.notes["c-intent"] === "Maps done" && d.state.actions.length === 2, "both leaders' changes kept");

    r = await (await req("/api/school?rev=3", { headers: { cookie: A } })).json();
    ok(r.same === true, "polling with the current rev reports no change");
    r = await (await req("/api/school?rev=2", { headers: { cookie: A } })).json();
    ok(r.rev === 3 && r.state, "polling with an old rev returns the latest copy");

    r = await (await req("/api/school", { headers: { cookie: B } })).json();
    ok(r.state === null, "another school can't see Athena's work");

    // Bad input is cleaned, not stored
    r = await (await req("/api/school", J(A, "PATCH", { baseRev: 3, patch: { set: { "answers.x": "brilliant", "profile.logo": "javascript:alert(1)", "evil.k": 1, "answers.__proto__": "met" } } }))).json();
    const cur = (await (await req("/api/school", { headers: { cookie: A } })).json()).state;
    ok(!cur.answers.x && !cur.profile.logo && !cur.evil && !Object.prototype.met, "invalid ratings, unsafe logo and unknown fields dropped");
    const big = await req("/api/school", J(A, "PATCH", { baseRev: 4, patch: { set: { "notes.a": "x".repeat(4000), ...Object.fromEntries(Array.from({ length: 500 }, (_, i) => ["ai.k" + i, { s: "y".repeat(4000) }])) } } }));
    ok(big.status === 413, "oversized save refused with a clear message");

    const xs = await req("/api/school", { method: "PATCH", headers: { cookie: A, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ baseRev: 4, patch: { set: { "answers.sg-dsl": "no" } } }) });
    ok(xs.status === 403, "cross-site save refused");

    // Snapshots
    const s1 = await req("/api/school/snapshots", J(A, "POST", { name: "Autumn 2026" }));
    const s1d = await s1.json();
    ok(s1.status === 201 && s1d.name === "Autumn 2026" && s1d.counts.met === 2, "snapshot saved with counts");
    await req("/api/school", J(A, "PATCH", { baseRev: 0, patch: { set: { "answers.sg-dsl": "part" } } }));
    const snap = await (await req("/api/school/snapshots/" + s1d.id, { headers: { cookie: A } })).json();
    ok(snap.state.answers["sg-dsl"] === "met", "snapshot keeps the ratings as they were");
    const list = await (await req("/api/school/snapshots", { headers: { cookie: B } })).json();
    ok(list.snapshots.length === 0, "other schools don't see the snapshot");
    ok((await req("/api/school/snapshots/" + s1d.id, { headers: { cookie: B } })).status === 404, "other schools can't open it by id");
    ok((await req("/api/school/snapshots/" + s1d.id, { method: "DELETE", headers: { cookie: A } })).status === 200, "snapshot deleted");
    ok(((await (await req("/api/school/snapshots", { headers: { cookie: A } })).json()).snapshots.length === 0), "and gone from the list");

    // Revoking a code stops access to its saved work straight away, but keeps the data
    execFileSync(process.execPath, [path.join(__dirname, "access.js"), "revoke", ids[0]]);
    await new Promise(r => setTimeout(r, 50));
    ok((await req("/api/school", { headers: { cookie: A } })).status === 401, "revoked code: saved work no longer reachable");
    ok(fs.existsSync(path.join(DATA, "schools", ids[0], "state.json")), "the saved work itself is kept (can be reactivated)");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally {
    srv.kill();
    for (const id of ids) fs.rmSync(path.join(DATA, "schools", id), { recursive: true, force: true });
    if (backup) fs.writeFileSync(FILE, backup); else fs.rmSync(FILE, { force: true });
  }
}, 700);
