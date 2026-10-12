/*
 * Leadership meeting emails: the agenda (a week before, automatically, or on
 * request) and the minutes (when the meeting finishes). Sent to attendees.
 */
const mail = require("./mail");
const B = require("./billing");
const L = require("../public/js/leaders.js");

const nice = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";
const esc = B.esc;

function recipients(state, m) {
  const team = (state && state.team) || [];
  return team.filter(t => (m.attendees || []).includes(t.id) && L.validEmail(t.email));
}

/** kind: "agenda" | "minutes". Returns the number of people emailed. */
async function sendMeeting(school, state, m, kind) {
  if (!mail.configured()) throw Object.assign(new Error("Emails aren't switched on for this service yet."), { status: 503 });
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

module.exports = { sendMeeting, recipients };
