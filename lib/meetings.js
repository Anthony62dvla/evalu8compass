/*
 * Leadership meeting emails: the agenda (a week before, automatically, or on
 * request) and the minutes (when the meeting finishes). Sent to attendees.
 */
const mail = require("./mail");
const B = require("./billing");
const L = require("../public/js/leaders.js");
const BR = require("../public/js/briefs.js");
const criteria = require("../public/js/criteria.js");

const nice = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";
const esc = B.esc;

function recipients(state, m) {
  const team = (state && state.team) || [];
  return team.filter(t => (m.attendees || []).includes(t.id) && L.validEmail(t.email));
}

/** A report or paper (from briefs.js) as an email body. */
function docHtml(doc) {
  const cell = "padding:5px 8px;border-bottom:1px solid #d5e3df;text-align:left;vertical-align:top;font-size:13px";
  return doc.sections.map(s => `<h3 style="color:#0F6E56;font-size:16px;margin:18px 0 6px">${esc(s.head)}</h3>` +
    (s.para ? `<p style="margin:0 0 8px;white-space:pre-wrap">${esc(s.para)}</p>` : "") +
    ((s.lines || []).length ? `<ul style="margin:0 0 8px;padding-left:18px;font-size:14px">${s.lines.map(l => `<li style="margin-bottom:3px">${esc(l)}</li>`).join("")}</ul>` : "") +
    (s.table ? `<table style="border-collapse:collapse;width:100%"><thead><tr>${s.table.cols.map(c => `<th style="${cell};color:#5b6b67">${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map(c => `<td style="${cell}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "")).join("");
}
async function sendDoc(school, doc, to, intro, link) {
  if (!mail.configured()) throw Object.assign(new Error("Emails aren't switched on for this service yet."), { status: 503 });
  if (!to.length) throw Object.assign(new Error("Nobody to send it to. Add email addresses in the Team tab."), { status: 400 });
  await mail.send({ to: to.map(t => t.email), subject: `[${school}] ${doc.title}`,
    text: [intro, "", BR.toText(doc), "", `Open in Evalu8 Compass: ${link}`].join("\n"),
    html: B.wrap(doc.title, B.para(esc(intro)) + docHtml(doc) + B.btn(link, "Open in Evalu8 Compass")) });
  return to.length;
}

/** A key leader's report for one area: to the area's leaders and the head. */
async function sendReport(school, state, areaId) {
  const areas = criteria.resolve(state.profile || {});
  const doc = BR.areaReport(state, areas, areaId);
  if (!doc) throw Object.assign(new Error("That area isn't part of your self-evaluation."), { status: 404 });
  const team = state.team || [];
  const to = team.filter(t => t.role !== "sip" && ((t.areas || []).includes(areaId) || t.role === "head") && L.validEmail(t.email));
  return sendDoc(school, doc, to, `The latest leader's report for ${doc.area}, written from ${school}'s self-evaluation and improvement plan.`, `${B.site()}/checklist.html#reports`);
}

/** The discussion paper for a SIP or consultant visit. internal: leave out the adviser (the automatic draft a week before). */
async function sendPaper(school, state, m, internal) {
  const areas = criteria.resolve(state.profile || {});
  const doc = BR.sipPaper(state, areas, { focus: m.focus, visit: m.title });
  const team = state.team || [];
  const to = recipients(state, m).filter(t => !internal || t.role !== "sip");
  const when = `${nice(m.date)}${m.time ? " at " + m.time : ""}`;
  const intro = internal
    ? `The discussion paper for ${m.title} (${when}) is ready. Check it, then send it to your adviser from the Meetings tab.`
    : `Ahead of ${m.title} on ${when}, here is ${school}'s discussion paper, written from our self-evaluation and improvement plan.`;
  if (!internal && !to.some(t => t.role === "sip") && !team.some(t => t.role === "sip")) throw Object.assign(new Error("Add your SIP or consultant in the Team tab first, then tick them as an attendee."), { status: 400 });
  if (!internal && !to.some(t => t.role === "sip")) throw Object.assign(new Error("Tick your SIP or consultant as an attendee (with an email address) first."), { status: 400 });
  return sendDoc(school, doc, to, intro, `${B.site()}/checklist.html#meetings`);
}

/** kind: "agenda" | "minutes" | "paper". Returns the number of people emailed. */
async function sendMeeting(school, state, m, kind) {
  if (!mail.configured()) throw Object.assign(new Error("Emails aren't switched on for this service yet."), { status: 503 });
  if (kind === "paper") return sendPaper(school, state, m, false);
  const to = recipients(state, m);
  if (!to.length) throw Object.assign(new Error("Choose attendees with email addresses first (set them up in the Team tab)."), { status: 400 });
  const items = m.agenda || [];
  if (!items.length) throw Object.assign(new Error("Write the agenda first."), { status: 400 });
  const actions = (state.actions || []);
  const actsFor = itemId => (m.actions || []).filter(x => x.item === itemId).map(x => actions.find(a => a.id === x.id)).filter(Boolean);
  const when = `${nice(m.date)}${m.time ? " at " + m.time : ""}`;
  const link = `${B.site()}/checklist.html#meetings`;
  const people = to.map(t => t.name || L.SHORT[t.role]).join(", ");
  const minutes = kind === "minutes";
  const title = minutes ? `Minutes: ${m.title}` : `Agenda: ${m.title}`;

  const text = [title, when, `Attendees: ${people}`, "",
    ...items.flatMap((it, i) => {
      const acts = minutes ? actsFor(it.id) : [];
      const note = minutes ? ((m.minutes || {})[it.id] || "").trim() : "";
      return [`${i + 1}. ${it.title}`, ...(!minutes && it.prompt ? ["   " + it.prompt] : []), ...(it.lines || []).map(l => "   • " + l),
        ...(note ? ["   Decided: " + note.replace(/\n/g, "\n   ")] : []), ...acts.map(a => `   Action: ${a.title}${a.owner ? " (" + a.owner + ")" : ""}${a.due ? ", due " + a.due : ""}`), ""];
    }),
    minutes ? "New actions are in the improvement plan." : "The agenda is written from the school's improvement plan and self-evaluation. Add your own items in Evalu8 Compass.",
    `Open in Evalu8 Compass: ${link}`].join("\n");

  const html = B.wrap(title, `<p style="margin:0 0 4px"><b>${esc(when)}</b></p><p style="margin:0 0 14px;color:#5b6b67">Attendees: ${esc(people)}</p>` +
    `<ol style="margin:0 0 12px;padding-left:22px">${items.map(it => {
      const acts = minutes ? actsFor(it.id) : [];
      const note = minutes ? ((m.minutes || {})[it.id] || "").trim() : "";
      return `<li style="margin-bottom:14px"><b style="color:#04342C">${esc(it.title)}</b>` +
        (!minutes && it.prompt ? `<div style="color:#5b6b67;font-size:14px">${esc(it.prompt)}</div>` : "") +
        ((it.lines || []).length ? `<ul style="margin:6px 0;padding-left:18px;font-size:14px">${it.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : "") +
        (note ? `<div style="background:#E1F5EE;border-radius:8px;padding:8px 10px;margin-top:6px;white-space:pre-wrap"><b>Decided:</b> ${esc(note)}</div>` : "") +
        (acts.length ? `<ul style="margin:6px 0;padding-left:18px">${acts.map(a => `<li><b>Action:</b> ${esc(a.title)}${a.owner ? " (" + esc(a.owner) + ")" : ""}${a.due ? ", due " + esc(a.due) : ""}</li>`).join("")}</ul>` : "") + `</li>`;
    }).join("")}</ol>` + B.para(minutes ? "New actions are in the improvement plan." : "The agenda is written from the school's improvement plan and self-evaluation.") + B.btn(link, "Open in Evalu8 Compass"));

  await mail.send({ to: to.map(t => t.email), subject: `[${school}] ${title} (${nice(m.date)})`, text, html });
  return to.length;
}

module.exports = { sendMeeting, sendReport, sendPaper, sendDoc, docHtml, recipients };
