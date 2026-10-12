/*
 * Automatic emails to each school's leadership team
 * ------------------------------------------------------------
 * Straight away, to the headteacher, deputy and DSL (and the action's owner):
 *   - a safeguarding line is rated Not yet
 *   - an action is marked At risk or Off track
 *   - an action linked to safeguarding goes overdue
 * A week overdue: the headteacher is told about any action over 7 days late.
 * Monday at 7am (UK): each person gets their actions and milestones due this
 * week and anything overdue; the headteacher and deputy also get a summary.
 *
 * Who's who comes from the school's Team tab (state.team). Emails never include
 * notes or comments, only action titles and checklist lines. What has been sent
 * is remembered in data/schools/<id>/alerts.json so nothing is sent twice.
 */
const fs = require("fs");
const path = require("path");
const schools = require("./schools");
const access = require("./access");
const mail = require("./mail");
const B = require("./billing");
const criteria = require("../public/js/criteria.js");
const L = require("../public/js/leaders.js");

const DIR = path.join(__dirname, "..", "data", "schools");
const fileFor = id => path.join(DIR, id, "alerts.json");
function loadState(id) { try { return JSON.parse(fs.readFileSync(fileFor(id), "utf8")); } catch (e) { return { sent: {}, sg: {}, rag: {} }; } }
function saveState(id, s) {
  try { fs.mkdirSync(path.join(DIR, id), { recursive: true }); const tmp = fileFor(id) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 }); fs.renameSync(tmp, fileFor(id)); }
  catch (e) { console.error("Couldn't save alert state", e.message); }
}

/* ---------- time (UK) ---------- */
function uk(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now || new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, monday: p.weekday === "Mon" };
}
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const nice = ymd => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/* ---------- emails ---------- */
const esc = B.esc;
function lineTexts(profile) {
  const out = {};
  try { for (const a of criteria.resolve(profile || {})) for (const i of a.items) out[i.id] = { text: i.text, area: a.name }; } catch (e) {}
  return out;
}
function footer(school) { return `You get these emails because ${school} added you to its leadership team in Evalu8 Compass. To change them, open the checklist's Team tab.`; }
function compose(school, title, sections, linkHash) {
  const link = `${B.site()}/checklist.html${linkHash || "#plan"}`;
  const text = [title, "", ...sections.flatMap(s => [s.head ? s.head.toUpperCase() : "", ...(s.lines || []).map(l => "• " + l), s.para || "", ""]).filter((x, i, a) => !(x === "" && a[i - 1] === "")), `Open Evalu8 Compass: ${link}`, "", footer(school)].join("\n");
  const html = B.wrap(title, sections.map(s => (s.head ? `<h2 style="font-size:16px;margin:16px 0 6px;color:#04342C">${esc(s.head)}</h2>` : "") + (s.para ? B.para(esc(s.para)) : "") +
      ((s.lines || []).length ? `<ul style="margin:0 0 12px;padding-left:20px">${s.lines.map(l => `<li style="margin-bottom:4px">${esc(l)}</li>`).join("")}</ul>` : "")).join("") +
    B.btn(link, "Open Evalu8 Compass") + `<p style="color:#5b6b67;font-size:12px">${esc(footer(school))}</p>`);
  return { text, html };
}
const describe = (a, t) => `${a.title || "Untitled action"}${a.owner ? ` (${a.owner})` : ""}${a.due ? `: due ${nice(a.due)}` : ""}${a.due && a.due < t && a.status !== "done" ? `, ${Math.round((Date.parse(t) - Date.parse(a.due)) / 864e5)} days overdue` : ""}`;

/* ---------- one school ---------- */
async function runSchool(id, name, now, opts) {
  if (!mail.configured()) return 0;
  const cur = schools.get(id).state;
  if (!cur) return 0;
  const team = (cur.team || []).filter(m => L.validEmail(m.email));
  if (!team.length) return 0;
  const t = uk(now).date, u = uk(now);
  const s = loadState(id), first = !s.init;
  const texts = lineTexts(cur.profile);
  const keys = L.keyLeaders(cur.team), heads = team.filter(m => m.role === "head");
  const actions = (cur.actions || []).filter(a => a && a.id);
  const ownersOf = a => L.owners(team, a.owner);
  const out = [];   // { to: [members], subject, title, sections, hash, undo }
  const emails = list => [...new Set(list.map(m => m.email))];

  // 1. Safeguarding lines newly rated Not yet
  const sgNow = Object.fromEntries(Object.entries(cur.answers || {}).filter(([k]) => k.startsWith("sg-")));
  const newlyNo = Object.keys(sgNow).filter(k => sgNow[k] === "no" && (s.sg || {})[k] !== "no");
  const prevSg = s.sg; s.sg = sgNow;
  if (!first && newlyNo.length && keys.length)
    out.push({ to: keys, subject: `Safeguarding: ${newlyNo.length === 1 ? "a line" : newlyNo.length + " lines"} rated Not yet`, title: "Safeguarding needs attention",
      sections: [{ para: `${name}'s self-evaluation now rates ${newlyNo.length === 1 ? "this safeguarding line" : "these safeguarding lines"} as Not yet:` , lines: newlyNo.map(k => (texts[k] || {}).text || k) },
        { para: "Check the evidence, agree what needs to happen and add an action with an owner and date." }], hash: "", undo: () => { s.sg = { ...s.sg }; newlyNo.forEach(k => { s.sg[k] = (prevSg || {})[k]; }); } });

  // 2. Actions newly marked At risk or Off track
  const ragNow = Object.fromEntries(actions.filter(a => a.status !== "done" && a.rag).map(a => [a.id, a.rag]));
  for (const a of actions) {
    if (a.status === "done" || !["risk", "off"].includes(a.rag) || (s.rag || {})[a.id] === a.rag || first) continue;
    const to = [...keys, ...ownersOf(a)];
    if (!to.length) continue;
    const prev = (s.rag || {})[a.id];
    out.push({ to, subject: `${a.rag === "off" ? "Off track" : "At risk"}: ${a.title || "an action"}`, title: `An action is ${a.rag === "off" ? "off track" : "at risk"}`,
      sections: [{ para: `This action in ${name}'s improvement plan has been marked ${a.rag === "off" ? "Off track" : "At risk"}:`, lines: [describe(a, t)] }, { para: "Agree what will get it back on track, and update its milestones." }],
      undo: () => { s.rag[a.id] = prev; } });
  }
  s.rag = ragNow;

  // 3. Safeguarding actions overdue, and 4. anything a week overdue
  s.sent = s.sent || {};
  for (const a of actions) {
    if (a.status === "done" || !a.due || a.due >= t) continue;
    const sg = String(a.itemId || "").startsWith("sg-");
    const k1 = `sgover:${a.id}:${a.due}`, k2 = `esc:${a.id}:${a.due}`;
    if (sg && !s.sent[k1]) {
      s.sent[k1] = new Date().toISOString();
      if (!first && keys.length) out.push({ to: [...keys, ...ownersOf(a)], subject: `Safeguarding action overdue: ${a.title || "action"}`, title: "A safeguarding action is overdue",
        sections: [{ lines: [describe(a, t)] }, { para: "Safeguarding actions can't wait. Agree a new date and who will make sure it happens." }], undo: () => { delete s.sent[k1]; } });
    }
    if (addDays(a.due, 7) <= t && !s.sent[k2]) {
      s.sent[k2] = new Date().toISOString();
      if (!first && heads.length) out.push({ to: [...heads, ...ownersOf(a)], subject: `A week overdue: ${a.title || "action"}`, title: "An action is more than a week overdue",
        sections: [{ lines: [describe(a, t)] }, { para: "Check in with the owner and agree a new date, or mark it done if it has happened." }], undo: () => { delete s.sent[k2]; } });
    }
  }

  // 5. Monday at 7am: each person's week, and a summary for the head and deputy
  const week = (() => { const d = new Date(Date.parse(t + "T12:00:00Z")); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); })();
  if ((u.monday && u.hour >= 7 || (opts && opts.forceWeekly)) && s.week !== week) {
    const prevWeek = s.week; s.week = week;
    const end = addDays(t, 6);
    for (const m of team) {
      if (m.alerts === "urgent") continue;
      const mine = actions.filter(a => a.status !== "done" && ownersOf(a).some(x => x.id === m.id));
      const due = mine.filter(a => a.due && a.due >= t && a.due <= end), late = mine.filter(a => a.due && a.due < t);
      const ms = mine.flatMap(a => (a.milestones || []).filter(x => !x.done && x.due && x.due <= end).map(x => `${x.text || "Milestone"} (${a.title || "action"}): ${x.due < t ? "late, was due " : "due "}${nice(x.due)}`));
      const sections = [];
      if (late.length) sections.push({ head: "Overdue", lines: late.map(a => describe(a, t)) });
      if (due.length) sections.push({ head: "Due this week", lines: due.map(a => describe(a, t)) });
      if (ms.length) sections.push({ head: "Milestones", lines: ms });
      if (["head", "deputy"].includes(m.role)) {
        const open = actions.filter(a => a.status !== "done");
        const risk = open.filter(a => a.rag === "risk" || a.rag === "off");
        const lateAll = open.filter(a => a.due && a.due < t);
        const sgGaps = Object.entries(sgNow).filter(([, v]) => v === "no" || v === "part").map(([k, v]) => `${(texts[k] || {}).text || k} (${v === "no" ? "Not yet" : "Partly"})`);
        const before = s.lastAnswers || null, nowA = cur.answers || {};
        const order = { no: 0, part: 1, met: 2 };
        const changed = before ? Object.keys({ ...before, ...nowA }).filter(k => before[k] !== nowA[k] && order[nowA[k]] != null && order[before[k]] != null) : [];
        const up = changed.filter(k => order[nowA[k]] > order[before[k]]), down = changed.filter(k => order[nowA[k]] < order[before[k]]);
        const label = v => ({ met: "Met", part: "Partly", no: "Not yet" })[v];
        sections.push({ head: "The plan at a glance", lines: [`${open.length} open action${open.length === 1 ? "" : "s"}, ${actions.length - open.length} done`, `${risk.length} at risk or off track`, `${lateAll.length} overdue`] });
        if (risk.length) sections.push({ head: "At risk or off track", lines: risk.map(a => describe(a, t)) });
        if (sgGaps.length) sections.push({ head: "Safeguarding lines not yet met", lines: sgGaps });
        if (up.length || down.length) sections.push({ head: "Ratings changed since last week", lines: [...up.map(k => `Better: ${(texts[k] || {}).text || k} (${label(before[k])} → ${label(nowA[k])})`), ...down.map(k => `Slipped: ${(texts[k] || {}).text || k} (${label(before[k])} → ${label(nowA[k])})`)] });
        const next = (cur.meetings || []).filter(x => x.date && x.date >= t && x.status !== "done").sort((a, b) => a.date.localeCompare(b.date))[0];
        if (next) sections.push({ head: "Next leadership meeting", lines: [`${nice(next.date)}${next.time ? " at " + next.time : ""}`] });
      }
      if (!sections.length) continue;
      out.push({ to: [m], subject: `Your week in Evalu8 Compass: ${name}`, title: `Your week, ${m.name ? m.name.split(" ")[0] : "hello"}`, sections, undo: () => { s.week = prevWeek; } });
    }
    s.lastAnswers = { ...(cur.answers || {}) };
  }
  s.init = true;
  saveState(id, s);   // record first, so a slow or failing mail server can't cause repeats

  let sent = 0, failed = false;
  for (const e of out) {
    const to = emails(e.to);
    if (!to.length) continue;
    const { text, html } = compose(name, e.title, e.sections, e.hash);
    try { await mail.send({ to, subject: `[${name}] ${e.subject}`, text, html, replyTo: undefined }); sent++; }
    catch (err) { console.error("Alert email failed:", err.message); if (e.undo) { e.undo(); failed = true; } }
  }
  if (failed) saveState(id, s);   // try those again next time
  return sent;
}

/* ---------- all schools ---------- */
let running = false;
async function runAll(now, opts) {
  if (running || !mail.configured()) return 0;
  running = true; let n = 0;
  try {
    const t = Date.now();
    for (const c of access.list()) {
      if (c.revoked || (c.expiresAt && Date.parse(c.expiresAt) < t)) continue;
      try { n += await runSchool(c.id, c.name, now, opts); } catch (e) { console.error("Alerts for", c.id, e.message); }
    }
  } finally { running = false; }
  return n;
}
/** Run one school's checks shortly after it saves (so urgent alerts go within a minute). */
const timers = new Map();
function soon(id) {
  if (!mail.configured() || !id || id === "admin" || id === "open") return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    const c = access.list().find(x => x.id === id);
    if (c && !c.revoked) runSchool(id, c.name).catch(e => console.error("Alerts:", e.message));
  }, Number(process.env.ALERT_DELAY_MS || 45000)).unref());
}
async function test(school, m) {
  if (!mail.configured()) throw Object.assign(new Error("Emails aren't switched on for this service yet."), { status: 503 });
  if (!L.validEmail(m.email)) throw Object.assign(new Error("Add a valid email address first."), { status: 400 });
  const { text, html } = compose(school, "Test email", [{ para: `Hello${m.name ? " " + m.name.split(" ")[0] : ""}, this is a test from Evalu8 Compass. If you can read it, ${school}'s alerts will reach you.` },
    { para: L.KEY.includes(m.role) ? "As " + L.LABEL[m.role] + ", you'll get immediate alerts about safeguarding and actions at risk." : "You'll get emails about the actions you own." }], "#team");
  await mail.send({ to: m.email, subject: `[${school}] Test email from Evalu8 Compass`, text, html });
  return { ok: true, to: m.email };
}

module.exports = { runAll, runSchool, soon, test, uk };
