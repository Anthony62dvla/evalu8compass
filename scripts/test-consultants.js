/* The consultant register: applying, checks, fees, search, enquiries. Run: node scripts/test-consultants.js
 * Uses fake email and postcode servers, and backs up and restores the data files it touches. */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const FILES = ["admin.json", "access.json", "audit.log", "invoices.jsonl", "billing.json", "consultants.json", "consultant-enquiries.jsonl"].map(f => path.join(DATA, f));
fs.mkdirSync(path.join(DATA, "schools"), { recursive: true });
const backups = FILES.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
FILES.forEach(f => fs.rmSync(f, { force: true }));
const schoolsBefore = new Set(fs.readdirSync(path.join(DATA, "schools")));

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PORT = 3990, SMTP = 3989, PC = 3988, base = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_SECURE: "0", SMTP_ALLOW_PLAIN: "1", MAIL_FROM: "Evalu8 Compass <support@evalu8compass.test>",
  ADMIN_EMAIL: "owner@example.org", OPERATOR_NAME: "Test Operator", OPERATOR_ADDRESS: "1 High Street, Town", BANK_SORT_CODE: "12-34-56", BANK_ACCOUNT_NUMBER: "12345678",
  SITE_URL: "https://evalu8compass.test", POSTCODES_API: `http://127.0.0.1:${PC}`, SIGNUP_LIMIT_PER_HOUR: "50", SIGNUP_LIMIT_PER_MIN: "500", LOGIN_LIMIT_PER_MIN: "500", MAIL_OUTBOX: "", VAT_NUMBER: "" });

/* Fake postcodes.io */
const PLACES = { "LS6 3QS": [53.8255, -1.5832, "LS6", "Leeds"], "LS6": [53.8200, -1.5770, "LS6", "Leeds"], "LS1 1AA": [53.7970, -1.5470, "LS1", "Leeds"],
  "M1": [53.4790, -2.2380, "M1", "Manchester"], "M1 1AE": [53.4790, -2.2380, "M1", "Manchester"], "SW1A 1AA": [51.5010, -0.1416, "SW1A", "Westminster"], "SW1A": [51.5010, -0.1416, "SW1A", "Westminster"], "BD1": [53.7950, -1.7530, "BD1", "Bradford"] };
const pcServer = http.createServer((req, res) => {
  const m = req.url.match(/^\/(postcodes|outcodes)\/(.+)$/), key = m && decodeURIComponent(m[2]).toUpperCase();
  const p = key && PLACES[key];
  if (!p) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ status: 404, error: "Not found" })); }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: 200, result: m[1] === "postcodes" ? { latitude: p[0], longitude: p[1], outcode: p[2], admin_district: p[3] } : { latitude: p[0], longitude: p[1], outcode: p[2], admin_district: [p[3]] } }));
});

const post = async (p, body, cookie) => {
  if ((p === "/api/signup" || p === "/api/consultants/apply") && body && body.ft === undefined) body = { ...body, ft: (await (await fetch(base + "/api/form-token")).json()).t };
  return fetch(base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
};
process.env.FORM_MIN_SECONDS = "0";
const get = (p, cookie) => fetch(base + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
const readDb = () => JSON.parse(fs.readFileSync(FILES[5], "utf8"));
const writeDb = db => fs.writeFileSync(FILES[5], JSON.stringify(db));
const future = days => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const past = days => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

function application(o) {
  return Object.assign({
    name: "Alex Morgan", headline: "Former primary head and SIP: curriculum, early reading and leadership",
    bio: "I led two primary schools for twelve years and have supported over forty schools as a school improvement partner, with a focus on early reading, curriculum design and developing middle leaders.",
    background: "Headteacher 2008–2020; SIP since 2020", qualifications: "QTS, NPQH", expertise: ["ct", "lg", "ey"], phases: ["ey", "primary"], types: ["maintained", "academy"],
    town: "Leeds", postcode: "LS6 3QS", region: "Yorkshire and the Humber", travel: 30, remote: false,
    email: "alex@consult.test", phone: "07700 900000", address: "2 Park Lane\nLeeds LS6 1AA", updateService: true, trn: "1234567", insProvider: "Hiscox", insExpires: future(200),
    referees: [{ name: "Jo Smith", role: "Headteacher, Oak Primary", email: "jo@oak.test" }, { name: "Sam Lee", role: "CEO, River Trust", email: "sam@river.test" }],
    accurate: true, consent: true, agree: true,
  }, o || {});
}

let srv, mail;
(async () => {
  try {
    mail = await require("./fake-mail").start(SMTP);
    await new Promise(r => pcServer.listen(PC, "127.0.0.1", r));
    srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, ANTHROPIC_API_KEY: "" }, stdio: ["ignore", "ignore", "inherit"] });
    await wait(800);

    const geo = require("../lib/geo");
    ok(geo.parse("ls6 3qs").full === "LS6 3QS" && geo.parse("ls6").district === "LS6" && geo.parse("hello") === null, "postcodes tidied: full postcode or district");
    ok(Math.abs(geo.miles({ lat: 53.82, lon: -1.577 }, { lat: 53.479, lon: -2.238 }) - 35) < 3, "Leeds to Manchester is about 35 miles");

    ok((await post("/api/consultants/search", {})).status === 401 && (await get("/api/consultants/suggest")).status === 401, "the register is closed even before any access codes exist");

    /* ---------- applying ---------- */
    const opt = await (await get("/api/consultants/options")).json();
    ok(opt.fees.listing === 49 && opt.fees.annual === 18 && opt.regions.length === 12 && opt.expertise.length >= 10, "options: £49 listing, £18 annual, regions and expertise");
    ok((await get("/for-consultants.html")).status === 200 && (await get("/consultant-apply.html")).status === 200 && (await get("/consultant-terms.html")).status === 200, "consultant pages are public");
    const r0 = await post("/api/consultants/apply", application({ updateService: false }));
    ok(r0.status === 400 && /Update Service/.test((await r0.json()).error), "no DBS Update Service: refused, with the reason");
    const r0b = await post("/api/consultants/apply", application({ bio: "Too short." }));
    const j0b = await r0b.json();
    ok(r0b.status === 400 && j0b.fields && j0b.fields[0][0] === "bio", "short bio: refused, pointing at the field");
    ok((await post("/api/consultants/apply", application({ insExpires: past(1) }))).status === 400, "expired insurance refused");
    ok((await post("/api/consultants/apply", application({ referees: [{ name: "Jo", role: "Head", email: "jo@oak.test" }, { name: "Jo", role: "Head", email: "jo@oak.test" }] }))).status === 400, "the same referee twice refused");
    const rpc = await post("/api/consultants/apply", application({ postcode: "ZZ9 9ZZ" }));
    ok(rpc.status === 400 && /couldn't find that postcode/i.test((await rpc.json()).error), "unknown postcode refused");

    const ra = await post("/api/consultants/apply", application());
    ok(ra.status === 200, "Alex (Leeds, travels 30 miles) applies");
    await post("/api/consultants/apply", application({ name: "Bea Khan", email: "bea@consult.test", town: "Manchester", postcode: "M1", region: "North West", travel: 10, remote: true, expertise: ["sg", "inc"], phases: ["secondary"], types: ["academy"], headline: "Safeguarding and SEND reviews for secondary schools", referees: [{ name: "A B", role: "Head, X", email: "ab@x.test" }, { name: "C D", role: "Head, Y", email: "cd@y.test" }] }));
    await post("/api/consultants/apply", application({ name: "Cal Ford", email: "cal@consult.test", town: "London", postcode: "SW1A 1AA", region: "London", travel: 20, expertise: ["ct"], referees: [{ name: "E F", role: "Head, X", email: "ef@x.test" }, { name: "G H", role: "Head, Y", email: "gh@y.test" }] }));
    await wait(400);
    let db = readDb();
    const A = db.list.find(c => c.contact.email === "alex@consult.test"), Bc = db.list.find(c => c.contact.email === "bea@consult.test"), C = db.list.find(c => c.contact.email === "cal@consult.test");
    ok(db.list.length === 3 && A.status === "applied" && A.profile.district === "LS6" && !JSON.stringify(A).includes("3QS"), "stored with the postcode district only, never the full postcode");
    ok(A.geo.lat === 53.82 && A.geo.lon === -1.577, "location stored is the district's centre, not the home postcode's");
    const welcome = mail.to("alex@consult.test", /application/)[0];
    const link = welcome && (welcome.text.match(/https:\/\/evalu8compass\.test(\/consultant\.html\?id=[a-f0-9]+&t=[^\s]+)/) || [])[1];
    ok(!!link && /£49/.test(welcome.text), "applicant emailed: what happens next, the £49 fee and their private link");
    ok(mail.to("owner@example.org", /Consultant application: Alex Morgan/).length === 1, "owner notified of the application");
    const dupBefore = readDb().list.length;
    await post("/api/consultants/apply", application()); await wait(200);
    ok(readDb().list.length === dupBefore && mail.to("alex@consult.test", /listing/).length >= 1, "applying again with the same email: link resent, no duplicate");

    const q = new URL("https://x" + link).searchParams;
    const me = await post("/api/consultants/me", { id: q.get("id"), t: q.get("t") });
    const mj = await me.json();
    ok(me.status === 200 && mj.status === "applied" && mj.checks.every(c => !c.at), "private link: status and checks to do");
    ok((await post("/api/consultants/me", { id: q.get("id"), t: "forged" })).status === 403, "a forged link is refused");
    const up = await (await post("/api/consultants/me/update", { id: q.get("id"), t: q.get("t"), profile: { ...mj.profile, travel: 40 } })).json();
    ok(up.profile.travel === 40 && !up.pending, "before approval, changes save straight away");
    const badPc = await post("/api/consultants/me/update", { id: q.get("id"), t: q.get("t"), profile: { ...mj.profile, postcode: "nonsense" } });
    ok(badPc.status === 400 && /postcode/i.test((await badPc.json()).error), "a mistyped postcode in an edit is refused, not ignored");

    /* ---------- schools only ---------- */
    const access = require("../lib/access");
    const school = access.add("Oak Primary", 30);
    const schools = require("../lib/schools");
    schools.replace(school.id, { profile: { name: "Oak Primary", type: "maintained", phases: ["ks1", "ks2"] }, answers: { "sg-dsl": "no", "sg-scr": "no", "sg-culture": "part", "ct-coherent": "part", "lg-vision": "met" } });
    ok((await post("/api/consultants/search", {})).status === 401, "search needs a school sign-in");
    ok((await get("/consultants.html")).status === 302, "the Find a consultant page needs a school sign-in");
    const login = await post("/api/access", { code: school.code });
    const sc = (login.headers.get("set-cookie") || "").split(";")[0];
    ok(login.status === 200, "school signs in");
    const sug = await (await get("/api/consultants/suggest", sc)).json();
    ok(sug.suggested[0].id === "sg" && sug.suggested.some(s => s.id === "ct") && sug.type === "maintained", "suggestions come from the school's own gaps: safeguarding first, then curriculum");
    let s1 = await (await post("/api/consultants/search", {}, sc)).json();
    ok(s1.results.length === 0, "nobody shows until approved and paid");

    /* ---------- admin checks and approval ---------- */
    const admin = require("../lib/admin");
    const { secret } = admin.setup("correct horse battery staple");
    const al = await post("/api/admin/login", { password: "correct horse battery staple", code: admin.totp(secret, Math.floor(Date.now() / 30000)) });
    const ac = (al.headers.get("set-cookie") || "").split(";")[0];
    ok((await get("/api/admin/consultants")).status === 401, "admin list needs the superadmin");
    const ap0 = await post(`/api/admin/consultants/${A.id}/approve`, {}, ac);
    ok(ap0.status === 409 && /Record every check/.test((await ap0.json()).error), "can't approve before every check is recorded");
    ok((await post(`/api/admin/consultants/${A.id}/check`, { check: "dbs", date: future(2) }, ac)).status === 400, "a check can't be dated in the future");
    for (const id of [A.id, Bc.id]) for (const k of ["identity", "dbs", "tra", "insurance", "references"])
      await post(`/api/admin/consultants/${id}/check`, { check: k, date: past(3), note: k === "dbs" ? "certificate seen, status current" : "" }, ac);
    const apA = await (await post(`/api/admin/consultants/${A.id}/approve`, {}, ac)).json();
    await post(`/api/admin/consultants/${Bc.id}/approve`, {}, ac);
    await wait(400);
    ok(/^EC-\d{4}-\d{4}$/.test(apA.invoice) && mail.to("alex@consult.test", /Invoice EC-/).some(m => /£49/.test(m.text) && /listing fee/.test(m.text)), "approval emails the £49 listing invoice");
    ok(mail.to("alex@consult.test", /approved/).length === 1, "approval email sent");
    s1 = await (await post("/api/consultants/search", {}, sc)).json();
    ok(s1.results.length === 0, "approved but unpaid: still not shown");
    await post(`/api/admin/consultants/${A.id}/listing-paid`, {}, ac);
    await post(`/api/admin/consultants/${Bc.id}/listing-paid`, {}, ac);
    await wait(300);
    ok(mail.to("alex@consult.test", /is live/).length === 1, "listing fee paid: 'your listing is live' email");
    const invPage = await get(`/invoice/${apA.invoice}`, ac);
    ok(/Paid /.test(await invPage.text()), "the listing invoice shows as paid");

    /* ---------- searching ---------- */
    let s2 = await (await post("/api/consultants/search", { postcode: "LS1 1AA" }, sc)).json();
    const a2 = s2.results.find(r => r.name === "Alex Morgan"), b2 = s2.results.find(r => r.name === "Bea Khan");
    ok(s2.from === "LS1" && a2 && a2.miles <= 3 && !a2.remoteOnly, "near Leeds: Alex shown, about " + (a2 && a2.miles) + " miles away");
    ok(b2 && b2.remoteOnly && s2.results[0].name === "Alex Morgan", "Bea (Manchester, 10 miles) shown only as remote support, after Alex");
    ok(!s2.results.some(r => r.name === "Cal Ford"), "Cal (not approved) never shown");
    ok(!JSON.stringify(s2).includes("alex@consult.test") && !JSON.stringify(s2).includes("07700") && !JSON.stringify(s2).includes("Park Lane"), "schools never see a consultant's email, phone or address");
    ok(a2.checks.length === 5 && a2.checks.every(c => c.at) && a2.checks.find(c => /insurance/i.test(c.label)).until, "each check shown with its date, and insurance end date");
    const s3 = await (await post("/api/consultants/search", { postcode: "LS1 1AA", expertise: ["sg"] }, sc)).json();
    ok(s3.results.length === 1 && s3.results[0].name === "Bea Khan", "safeguarding expertise: only Bea");
    const s4 = await (await post("/api/consultants/search", { region: "North West" }, sc)).json();
    ok(s4.results.length === 1 && s4.results[0].name === "Bea Khan", "region North West: Bea only (Alex is in Yorkshire and doesn't work remotely)");
    const s5 = await (await post("/api/consultants/search", { phase: "secondary" }, sc)).json();
    ok(s5.results.length === 1 && s5.results[0].name === "Bea Khan", "phase filter");
    const sbad = await post("/api/consultants/search", { postcode: "ZZ9 9ZZ" }, sc);
    ok(sbad.status === 400, "unknown school postcode: clear message");

    /* ---------- enquiries ---------- */
    const en0 = await post(`/api/consultants/${A.id}/contact`, { name: "Pat", email: "bad", message: "Hello there, we would like help." }, sc);
    ok(en0.status === 400, "enquiry needs a valid email");
    const en = await post(`/api/consultants/${A.id}/contact`, { name: "Pat Head", role: "Headteacher", email: "pat@oak.sch.uk", message: "We'd like support with our early reading curriculum this term." }, sc);
    await wait(300);
    const got = mail.to("alex@consult.test", /Enquiry from Oak Primary/)[0];
    ok(en.status === 200 && got && got.replyTo === "pat@oak.sch.uk" && /early reading/.test(got.text), "enquiry emailed to the consultant, with Reply-To set to the school");
    ok(mail.to("pat@oak.sch.uk", /Your enquiry to Alex Morgan/).length === 1 && /Keeping children safe/.test(mail.to("pat@oak.sch.uk")[0].text), "school gets a copy reminding it to do its own KCSIE checks");
    ok(!fs.readFileSync(FILES[6], "utf8").includes("early reading"), "the enquiry log keeps no message text");
    ok((await post(`/api/consultants/${Cal()}/contact`, { name: "Pat", email: "pat@oak.sch.uk", message: "We'd like some help please with this." }, sc)).status === 404, "can't contact someone who isn't listed");
    function Cal() { return C.id; }

    /* ---------- changes after approval wait for review ---------- */
    const mj2 = await (await post("/api/consultants/me", { id: q.get("id"), t: q.get("t") })).json();
    const up2 = await (await post("/api/consultants/me/update", { id: q.get("id"), t: q.get("t"), profile: { ...mj2.profile, headline: "NEW HEADLINE: reading specialist and SIP" } })).json();
    ok(up2.pending && up2.pending.headline.startsWith("NEW"), "after approval, changes wait for review");
    let s6 = await (await post("/api/consultants/search", {}, sc)).json();
    ok(s6.results.find(r => r.name === "Alex Morgan").headline.startsWith("Former"), "schools still see the approved version");
    await post(`/api/admin/consultants/${A.id}/approve-changes`, {}, ac);
    s6 = await (await post("/api/consultants/search", {}, sc)).json();
    ok(s6.results.find(r => r.name === "Alex Morgan").headline.startsWith("NEW"), "published after review");

    /* ---------- insurance and annual check ---------- */
    const consultants = require("../lib/consultants");
    db = readDb(); db.list.find(c => c.id === Bc.id).insurance.expires = past(1); writeDb(db); consultants.reload();
    srvReload();
    await wait(50);
    let s7 = await (await post("/api/consultants/search", {}, sc)).json();
    ok(!s7.results.some(r => r.name === "Bea Khan"), "insurance expired: hidden from schools");
    await post(`/api/admin/consultants/${Bc.id}/check`, { check: "insurance", date: past(0), expires: future(365) }, ac);
    s7 = await (await post("/api/consultants/search", {}, sc)).json();
    ok(s7.results.some(r => r.name === "Bea Khan"), "new insurance recorded: visible again");

    db = readDb(); const a8 = db.list.find(c => c.id === A.id); a8.checksDue = future(20); a8.checks.dbs.at = past(100); writeDb(db); consultants.reload();
    const sent = await consultants.reminders({}); await wait(300);
    ok(sent >= 1 && mail.to("alex@consult.test", /Invoice EC-/).some(m => /£18/.test(m.text) && /annual compliance check/.test(m.text)), "a month before: annual check reminder and £18 invoice");
    ok((await consultants.reminders({})) === 0, "the reminder is sent once");
    const ad0 = await post(`/api/admin/consultants/${A.id}/annual-done`, {}, ac);
    ok(ad0.status === 409 && /DBS/.test((await ad0.json()).error), "annual check can't be marked done without a fresh DBS status check");
    await post(`/api/admin/consultants/${A.id}/check`, { check: "dbs", date: past(0) }, ac);
    const ad = await (await post(`/api/admin/consultants/${A.id}/annual-done`, {}, ac)).json();
    ok(ad.ok && ad.checksDue === require("../lib/billing").addYear(future(20)), "annual check done: next one due a year after the last due date");
    ok((await post(`/api/admin/consultants/${A.id}/annual-done`, {}, ac)).status === 409, "clicking 'annual check done' twice doesn't skip a year");

    db = readDb(); const a9 = db.list.find(c => c.id === A.id); a9.checksDue = past(31); writeDb(db); consultants.reload();
    let s8 = await (await post("/api/consultants/search", {}, sc)).json();
    ok(!s8.results.some(r => r.name === "Alex Morgan"), "annual check over 30 days late: hidden");

    /* ---------- a new private link stops the old one ---------- */
    await post(`/api/admin/consultants/${A.id}/send-link`, {}, ac); await wait(200);
    ok((await post("/api/consultants/me", { id: q.get("id"), t: q.get("t") })).status === 403, "after a new link is sent, the old link stops working");
    const newLink = mail.to("alex@consult.test", /Your Evalu8 Compass consultant listing/).pop().text.match(/consultant\.html\?id=([a-f0-9]+)&t=([^\s]+)/);
    q.set("t", newLink[2]);
    ok((await post("/api/consultants/me", { id: q.get("id"), t: q.get("t") })).status === 200, "the new link works");

    /* ---------- leaving ---------- */
    const wd = await post("/api/consultants/me/withdraw", { id: q.get("id"), t: q.get("t") });
    ok(wd.status === 200 && !readDb().list.some(c => c.id === A.id), "a consultant can leave: their record is deleted");
    ok(fs.readFileSync(FILES[3], "utf8").includes(apA.invoice), "their invoices are kept for the accounts");

    function srvReload() { /* the server reads consultants.json once; edits above go through its cache via an admin call */ }
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally {
    if (srv) srv.kill();
    if (mail) mail.close();
    pcServer.close();
    FILES.forEach((f, i) => { if (backups[i]) fs.writeFileSync(f, backups[i]); else fs.rmSync(f, { force: true }); });
    for (const d of fs.readdirSync(path.join(DATA, "schools"))) if (!schoolsBefore.has(d)) fs.rmSync(path.join(DATA, "schools", d), { recursive: true, force: true });
    setTimeout(() => process.exit(), 100);
  }
})();
