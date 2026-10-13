/*
 * Governors and trustees: their read-only view, the challenge log and emails.
 * Governors sign in with the school's governors' code (see lib/access.js govCode);
 * they can read issued termly reports and a live summary, and ask questions.
 * They can never change the school's self-evaluation or plan.
 */
const crypto = require("crypto");
const mail = require("./mail");
const B = require("./billing");
const schools = require("./schools");
const L = require("../public/js/leaders.js");
const BR = require("../public/js/briefs.js");
const criteria = require("../public/js/criteria.js");
const { docHtml } = require("./meetings");

const esc = B.esc;
const GOV_ROLES = ["gov", "trustee"];
const governors = state => ((state && state.team) || []).filter(m => GOV_ROLES.includes(m.role) && L.validEmail(m.email));
const leaders = (state, roles) => ((state && state.team) || []).filter(m => roles.includes(m.role) && L.validEmail(m.email));
const err = (status, message) => Object.assign(new Error(message), { status });
const link = () => `${B.site()}/governors.html`;

/** What a governor sees: issued reports, the school today, and the challenge log. */
function view(id, name) {
  const st = schools.get(id).state || {};
  const areas = criteria.resolve(st.profile || {});
  return {
    school: name,
    areas: areas.map(a => ({ id: a.id, name: a.name })),
    reports: (st.govReports || []).filter(r => r.status === "issued" && r.doc).sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt))).map(r => ({ id: r.id, issuedAt: r.issuedAt, doc: r.doc })),
    today: BR.govGlance(st, areas),
    challenges: (st.challenges || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(c => ({ id: c.id, asked: c.asked, by: c.by, areaId: c.areaId, question: c.question, response: c.response, respondedAt: c.respondedAt, status: c.status, source: c.source })),
  };
}

/** A governor asks a question. Saved to the challenge log; the head and deputy are told. */
async function ask(id, name, b) {
  const question = String((b && b.question) || "").trim().slice(0, 1500);
  const by = String((b && b.by) || "").trim().slice(0, 100);
  if (question.length < 5) throw err(400, "Write your question first.");
  if (!by) throw err(400, "Add your name, so leaders know who asked.");
  const cur = schools.get(id);
  const st = cur.state || {};
  const areas = criteria.resolve(st.profile || {});
  const areaId = areas.some(a => a.id === b.areaId) ? b.areaId : "";
  if ((st.challenges || []).filter(c => c.status === "open" && c.source === "governor").length >= 100) throw err(429, "There are already 100 open questions. Leaders need to answer some first.");
  const ch = { id: crypto.randomBytes(5).toString("hex"), asked: new Date().toISOString().slice(0, 10), by, source: "governor", areaId, question, response: "", respondedBy: "", respondedAt: "", status: "open", actionId: "", createdAt: new Date().toISOString() };
  schools.patch(id, cur.rev, { challenges: { upsert: [ch], del: [] } });
  if (mail.configured()) {
    const to = leaders(st, ["head", "deputy"]);
    const area = areaId ? areas.find(a => a.id === areaId).name : "";
    if (to.length) {
      const title = "A governor has asked a question";
      const where = `${B.site()}/checklist.html#reports`;
      try {
        await mail.send({ to: to.map(t => t.email), subject: `[${name}] ${title}`,
          text: [title, "", `${by} asked${area ? " about " + area : ""}:`, question, "", `Reply in Evalu8 Compass (Reports tab, Challenge log): ${where}`].join("\n"),
          html: B.wrap(title, B.para(`<b>${esc(by)}</b> asked${area ? " about " + esc(area) : ""}:`) + `<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:4px solid #5DCAA5;background:#E1F5EE;white-space:pre-wrap">${esc(question)}</blockquote>` + B.para("Your reply is shown to governors in their view, and in the next termly report.") + B.btn(where, "Reply in Evalu8 Compass")) });
      } catch (e) { console.error("Governor question email failed:", e.message); }
    }
  }
  return ch;
}

/** Email a new governors' code to the school's governors and trustees (and the head, for their records). */
async function sendCode(name, state, code) {
  if (!mail.configured()) throw err(503, "Emails aren't switched on for this service yet.");
  const to = [...governors(state), ...leaders(state, ["head"])];
  if (!governors(state).length) throw err(400, "Add your governors or trustees (with email addresses) in the Team tab first.");
  const title = "Your governors' access to Evalu8 Compass";
  await mail.send({ to: [...new Set(to.map(t => t.email))], subject: `[${name}] ${title}`,
    text: [title, "", `${name} has given its governors and trustees read-only access to its school improvement work: the headteacher's termly reports, where the school stands today, and a log of governors' questions and leaders' answers.`, "", `Your code: ${code}`, "", `Sign in: ${B.site()}/enter.html?next=%2Fgovernors.html`, "", "Keep this code to yourself and the board. If it's shared by mistake, the headteacher can replace it."].join("\n"),
    html: B.wrap(title, B.para(`<b>${esc(name)}</b> has given its governors and trustees read-only access to its school improvement work: the headteacher's termly reports, where the school stands today, and a log of governors' questions and leaders' answers.`) +
      `<p style="font-size:22px;font-weight:bold;letter-spacing:2px;background:#E1F5EE;color:#04342C;padding:12px 16px;border-radius:8px;display:inline-block">${esc(code)}</p>` +
      B.btn(`${B.site()}/enter.html?next=%2Fgovernors.html`, "Sign in") + B.para("Keep this code to yourself and the board. If it's shared by mistake, the headteacher can replace it.")) });
  return to.length;
}

/** Email an issued termly report to governors and trustees, and the head. */
async function sendReport(name, state, rep) {
  if (!mail.configured()) throw err(503, "Emails aren't switched on for this service yet.");
  if (!rep || rep.status !== "issued" || !rep.doc) throw err(400, "Issue the report first.");
  const govs = governors(state);
  if (!govs.length) throw err(400, "Add your governors or trustees (with email addresses) in the Team tab first.");
  const to = [...new Set([...govs, ...leaders(state, ["head"])].map(t => t.email))];
  const intro = `The headteacher's report for ${rep.doc.title.replace(/^Headteacher's report to governors: /, "")}. Governors can read it, see where the school stands today and ask questions in Evalu8 Compass.`;
  await mail.send({ to, subject: `[${name}] ${rep.doc.title}`,
    text: [intro, "", BR.toText(rep.doc), "", `Open the governors' view: ${link()}`].join("\n"),
    html: B.wrap(rep.doc.title, B.para(esc(intro)) + docHtml(rep.doc) + B.btn(link(), "Open the governors' view")) });
  return to.length;
}

module.exports = { view, ask, sendCode, sendReport, governors };
