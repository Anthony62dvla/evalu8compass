/*
 * Pricing, free first term, sign-up and subscriptions
 * ------------------------------------------------------------
 * Prices (a year, excluding VAT):  independent school £99, primary £149,
 * secondary £199, trusts with two or more schools by arrangement.
 *
 * Free first term: free until the end of the term a school joins in. A school
 * that joins after that term's half-term also gets the next term free.
 * Term dates follow typical English school terms:
 *   autumn  1 Sep  (half-term point 1 Nov)  → spring 1 Jan (half-term point 22 Feb)
 *   → summer, which starts after the Easter holidays (half-term point 1 Jun).
 *
 * Schools sign up on /signup.html and get their access code by email. When the
 * free term ends the code pauses (saved work is kept). Subscribing on
 * /subscribe.html reactivates it at once for 12 months, and an invoice payable
 * within 30 days is emailed. The superadmin marks invoices paid in the console.
 *
 * Everything is stored on the access code (data/access.json); invoices are also
 * appended to data/invoices.jsonl, kept for the 6 years HMRC requires.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const access = require("./access");
const mail = require("./mail");

const DATA = path.join(__dirname, "..", "data");
const INVOICES = path.join(DATA, "invoices.jsonl");
const COUNTER = path.join(DATA, "billing.json");
const ENQUIRIES = path.join(DATA, "enquiries.jsonl");

const TIERS = {
  independent: { label: "Independent school", price: 99 },
  primary: { label: "Primary school", price: 149 },
  secondary: { label: "Secondary school", price: 199 },
  trust: { label: "Academy trust (two or more schools)", price: null },
};
const PAYMENT_DAYS = 30;
const env = k => String(process.env[k] || "").trim();
const site = () => (env("SITE_URL") || "https://evalu8compass.app").replace(/\/$/, "");

class BillingError extends Error { constructor(status, message) { super(message); this.status = status; } }

/* ---------- dates (UK) ---------- */
const DAY = 864e5;
/** Today's date in the UK as YYYY-MM-DD. */
function today(now) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now || new Date()); }
const toDate = ymd => new Date(ymd + "T12:00:00Z");
const fmt = d => d.toISOString().slice(0, 10);
const addDays = (ymd, n) => fmt(new Date(toDate(ymd).getTime() + n * DAY));
function addYear(ymd) { const [y, m, d] = ymd.split("-").map(Number); return m === 2 && d === 29 ? `${y + 1}-03-01` : `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function longDate(ymd) { return toDate(ymd).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
/** A real calendar date in YYYY-MM-DD form. */
const validDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(toDate(d)) && fmt(toDate(d)) === d;
/** Midnight at the start of this day in the UK (GMT or BST), as an ISO time. Access ends then. */
function startOf(ymd) {
  const guess = new Date(ymd + "T00:00:00Z");
  const off = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(guess).find(x => x.type === "timeZoneName").value;
  const m = off.match(/GMT([+-]\d+)?/), hours = m && m[1] ? Number(m[1]) : 0;
  return new Date(guess.getTime() - hours * 3600e3).toISOString();
}

function easter(y) { // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** Typical first day of the summer term: the Easter holidays usually run for two
 *  weeks after an early Easter, and either side of a later one. */
function summerStart(y) { const e = easter(y); return addDays(e, e <= `${y}-04-01` ? 15 : 8); }

/** The term a date falls in (holidays count with the term before them). */
function termOf(ymd) {
  const y = Number(ymd.slice(0, 4));
  if (ymd >= `${y}-09-01`) return { name: "autumn", start: `${y}-09-01`, half: `${y}-11-01`, next: `${y + 1}-01-01` };
  const ss = summerStart(y);
  if (ymd < ss) return { name: "spring", start: `${y}-01-01`, half: `${y}-02-22`, next: ss };
  return { name: "summer", start: ss, half: `${y}-06-01`, next: `${y}-09-01` };
}
const TERM_LABEL = { autumn: "autumn term", spring: "spring term", summer: "summer term" };

/** First day a school joining on `ymd` starts paying (its free period ends the day before). */
function freeUntil(ymd) {
  const t = termOf(ymd);
  return ymd >= t.half ? termOf(t.next).next : t.next;
}
/** Wording for the free period, e.g. "the rest of the autumn term and all of the spring term". */
function freeWording(ymd) {
  const t = termOf(ymd), late = ymd >= t.half;
  return late ? `the rest of the ${TERM_LABEL[t.name]} and all of the ${TERM_LABEL[termOf(t.next).name]}` : `the rest of the ${TERM_LABEL[t.name]}`;
}

/* ---------- prices and VAT ---------- */
function tierFor(type, phase) {
  if (type === "trust") return "trust";
  if (type === "independent") return "independent";
  return phase === "secondary" ? "secondary" : "primary";
}
function vat() { const n = env("VAT_NUMBER"); return n ? { number: n, rate: Number(env("VAT_RATE") || 20) } : null; }
const money = n => "£" + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
function pricing() {
  const v = vat();
  return {
    tiers: Object.entries(TIERS).map(([id, t]) => ({ id, ...t })),
    vat: v ? `Prices exclude VAT, which is added at ${v.rate}%.` : "Prices exclude VAT. No VAT is charged at present.",
    vatRegistered: !!v, paymentDays: PAYMENT_DAYS,
    freeNow: { until: freeUntil(today()), untilLabel: longDate(addDays(freeUntil(today()), -1)), wording: freeWording(today()) },
  };
}

/* ---------- status shown to schools and in the admin console ---------- */
function status(c, now) {
  const t = today(now);
  const s = c.sub, inv = s && s.invoice;
  if (c.revoked) return { key: "revoked", label: "Access removed" };
  if (s && s.status === "cancelled" && !(c.trialEndsAt && t < c.trialEndsAt)) return { key: "cancelled", label: `Subscription cancelled${s.cancelledAt ? " " + longDate(s.cancelledAt.slice(0, 10)) : ""}` };
  if (s && s.status !== "cancelled" && t < s.periodEnd) {
    const unpaid = !s.paidAt;
    const overdue = unpaid && inv && t > inv.dueAt;
    return {
      key: overdue ? "overdue" : unpaid ? (inv ? "invoiced" : "invoice_to_send") : "paid",
      label: overdue ? `Invoice ${inv.number} overdue (due ${longDate(inv.dueAt)})` : unpaid ? (inv ? `Invoiced, due ${longDate(inv.dueAt)}` : "Subscribed, invoice to send") : `Paid until ${longDate(addDays(s.periodEnd, -1))}`,
      periodStart: s.periodStart, periodEnd: s.periodEnd, renewFrom: addDays(s.periodEnd, -30),
      upcoming: t < s.periodStart,
    };
  }
  if (c.trialEndsAt && t < c.trialEndsAt) return { key: "trial", label: `Free until ${longDate(addDays(c.trialEndsAt, -1))}`, trialEndsAt: c.trialEndsAt };
  if (s && t >= s.periodEnd) return { key: "lapsed", label: `Subscription ended ${longDate(addDays(s.periodEnd, -1))}` };
  if (c.trialEndsAt) return { key: "trial_ended", label: `Free term ended ${longDate(addDays(c.trialEndsAt, -1))}` };
  return { key: "none", label: c.expiresAt ? "Set up by hand, with an end date" : "Set up by hand" };
}
/** What a signed-in school sees about its plan (no billing contact details). */
function forSchool(c) {
  if (!c || !c.tier) return null;
  const st = status(c), t = TIERS[c.tier] || {};
  const daysLeft = st.trialEndsAt ? Math.round((toDate(st.trialEndsAt) - toDate(today())) / DAY) : st.periodEnd ? Math.round((toDate(st.periodEnd) - toDate(today())) / DAY) : null;
  return { tier: c.tier, tierLabel: t.label, price: c.sub ? c.sub.price : t.price, status: st.key, label: st.label, daysLeft, canRenew: st.key === "trial" || ((st.key === "paid" || st.key === "invoiced" || st.key === "overdue") && today() >= st.renewFrom) };
}

/* ---------- abuse limits for the public forms ---------- */
const recent = new Map();
function tooMany(key, max, ms) {
  const now = Date.now(), list = (recent.get(key) || []).filter(t => now - t < ms);
  list.push(now); recent.set(key, list);
  return list.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of recent) if (!v.some(t => now - t < 864e5)) recent.delete(k); }, 3600e3).unref();

const clip = (v, n) => (typeof v === "string" || typeof v === "number" ? String(v) : "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- emails ---------- */
function wrap(title, bodyHtml) {
  return `<!doctype html><html lang="en-GB"><body style="margin:0;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;color:#1d2b28">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="background:#04342C;color:#fff;border-radius:12px 12px 0 0;padding:16px 20px;font-size:18px;font-weight:bold">Evalu8 Compass</div>
<div style="background:#fff;border:1px solid #d5e3df;border-top:0;border-radius:0 0 12px 12px;padding:22px 20px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 12px;color:#04342C">${esc(title)}</h1>${bodyHtml}
<p style="margin-top:22px;color:#5b6b67;font-size:13px">Questions? Reply to this email or write to support@evalu8compass.app.</p></div></div></body></html>`;
}
const p = s => `<p style="margin:0 0 12px">${s}</p>`;
const btn = (href, label) => `<p style="margin:16px 0"><a href="${esc(href)}" style="background:#0F6E56;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:bold;display:inline-block">${esc(label)}</a></p>`;
const codeBox = code => `<p style="font-family:Consolas,Menlo,monospace;font-size:24px;letter-spacing:3px;background:#E1F5EE;color:#04342C;padding:14px;border-radius:8px;text-align:center;margin:14px 0">${esc(code)}</p>`;

async function notifyAdmin(subject, lines) {
  const to = mail.adminEmail();
  if (!to || !mail.configured()) return;
  try { await mail.send({ to, subject: "[Evalu8 Compass] " + subject, text: lines.join("\n") }); } catch (e) { console.error("Admin email failed:", e.message); }
}

function welcomeEmail(c, code, wording) {
  const t = TIERS[c.tier];
  const last = longDate(addDays(c.trialEndsAt, -1));
  const text = [
    `Hello ${c.contact.name},`, "",
    `Thank you for signing ${c.name} up to Evalu8 Compass. Your school access code is:`, "", `    ${code}`, "",
    `Sign in at ${site()}/enter.html. Share the code only with colleagues who lead your self-evaluation; staff joining a workshop don't need it.`, "",
    `Your free period covers ${wording}, until ${last}. After that, the ${t.label.toLowerCase()} subscription is ${money(t.price)} a year (excluding VAT), invoiced and payable within ${PAYMENT_DAYS} days. We'll remind you two weeks before your free period ends. Nothing is charged unless you subscribe.`, "",
    `The how-to guide: ${site()}/guide/evalu8-compass-user-guide.pdf`, "",
    "Evalu8 Compass",
  ].join("\n");
  const html = wrap("Your school access code", p(`Hello ${esc(c.contact.name)},`) + p(`Thank you for signing <b>${esc(c.name)}</b> up to Evalu8 Compass. Your school access code is:`) + codeBox(code) +
    btn(`${site()}/enter.html`, "Sign in") + p("Share the code only with colleagues who lead your self-evaluation. Staff joining a workshop don't need it.") +
    p(`Your free period covers ${esc(wording)}, until <b>${esc(last)}</b>. After that, the ${esc(t.label.toLowerCase())} subscription is <b>${money(t.price)} a year</b> (excluding VAT), invoiced and payable within ${PAYMENT_DAYS} days. We'll remind you two weeks before your free period ends. Nothing is charged unless you subscribe.`) +
    p(`New to Evalu8 Compass? Start with the <a href="${esc(site())}/guide/evalu8-compass-user-guide.pdf" style="color:#0F6E56">how-to guide</a>.`));
  return { to: c.email, subject: `Your Evalu8 Compass access code for ${c.name}`, text, html };
}

/* ---------- sign-up ---------- */
/**
 * body = { school, type: independent|maintained|academy|trust, phase: primary|secondary,
 *          name, role, email, urn?, schools? (trusts), message? (trusts), agree, website (must be empty) }
 * Always answers the same way whether or not the email is already registered.
 */
async function signup(body, ip, hooks) {
  const b = body || {};
  if (b.website) return { ok: true, kind: "code" };                       // a bot filled the hidden field
  const school = clip(b.school, 120), name = clip(b.name, 100), role = clip(b.role, 100), email = clip(b.email, 200).toLowerCase();
  const type = ["independent", "maintained", "academy", "trust"].includes(b.type) ? b.type : null;
  const phase = ["primary", "secondary"].includes(b.phase) ? b.phase : null;
  const urn = clip(b.urn, 10).replace(/\D/g, "");
  if (school.length < 3) throw new BillingError(400, "Enter your school's name.");
  if (!type) throw new BillingError(400, "Choose your type of school.");
  if (type !== "independent" && type !== "trust" && !phase) throw new BillingError(400, "Choose primary or secondary.");
  if (name.length < 2) throw new BillingError(400, "Enter your name.");
  if (!mail.validEmail(email)) throw new BillingError(400, "Enter a valid email address.");
  if (urn && (urn.length < 6 || urn.length > 7)) throw new BillingError(400, "A URN has 6 or 7 digits. Leave it blank if you don't know it.");
  if (!b.agree) throw new BillingError(400, "Tick the box to agree to the terms and privacy notice.");
  if (!mail.configured()) throw new BillingError(503, "Sign-up isn't available right now. Email support@evalu8compass.app and we'll set you up.");
  if (tooMany("ip:" + ip, Number(env("SIGNUP_LIMIT_PER_HOUR") || 5), 3600e3) || tooMany("email:" + email, 3, 864e5)) throw new BillingError(429, "Too many sign-ups from here. Try again later, or email support@evalu8compass.app.");

  if (type === "trust") {
    const rec = { at: new Date().toISOString(), trust: school, schools: clip(b.schools, 10), name, role, email, message: clip(b.message, 1500) };
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(ENQUIRIES, JSON.stringify(rec) + "\n", { mode: 0o600 });
    await mail.send({ to: email, subject: "Your Evalu8 Compass enquiry", replyTo: mail.adminEmail() || undefined,
      text: `Hello ${name},\n\nThank you for your enquiry about Evalu8 Compass for ${school}. We'll be in touch within two working days to talk about pricing for your trust's schools.\n\nIf a school wants to start straight away, it can sign up for its free term at ${site()}/signup.html.\n\nEvalu8 Compass`,
      html: wrap("Thank you for your enquiry", p(`Hello ${esc(name)},`) + p(`Thank you for your enquiry about Evalu8 Compass for <b>${esc(school)}</b>. We'll be in touch within two working days to talk about pricing for your trust's schools.`) + p(`If a school wants to start straight away, it can <a href="${esc(site())}/signup.html" style="color:#0F6E56">sign up for its free term</a>.`)) });
    await notifyAdmin(`Trust enquiry: ${school}`, [`Trust: ${school}`, `Schools: ${rec.schools || "not given"}`, `Contact: ${name}${role ? ", " + role : ""}`, `Email: ${email}`, "", rec.message || "(no message)"]);
    hooks && hooks.audit && hooks.audit("signup.trust_enquiry", `${school} (${email})`);
    return { ok: true, kind: "enquiry" };
  }

  // Already registered with this email? Send a fresh code for that school instead (the old one keeps working).
  const existing = access.list().find(c => !c.revoked && c.email && c.email.toLowerCase() === email && c.tier);
  if (existing) {
    if (!tooMany("remail:" + email, 3, 864e5)) await resend(email, ip, hooks, true);
    await notifyAdmin(`Repeat sign-up: ${existing.name}`, [`Someone signed up again with ${email}, which is already registered to ${existing.name} (${existing.id}). A new code was emailed to that address.`]);
    return { ok: true, kind: "code" };
  }

  const tier = tierFor(type, phase);
  const t0 = today(), trialEndsAt = freeUntil(t0), wording = freeWording(t0);
  const dupes = access.list().filter(c => (urn && c.urn === urn) || norm(c.name) === norm(school));
  const entry = access.add(school, 0, {
    email, expiresAt: startOf(trialEndsAt),
    billing: { tier, schoolType: type, phase: phase || undefined, urn: urn || undefined, contact: { name, role }, trialEndsAt, source: "signup" },
  });
  try {
    await mail.send(welcomeEmail({ ...entry, contact: { name, role } }, entry.code, wording));
  } catch (e) {
    access.update(entry.id, c => { c.revoked = new Date().toISOString(); c.notes = "Sign-up email failed: " + e.message.slice(0, 200); });
    console.error("Sign-up email failed:", e.message);
    throw new BillingError(502, "We couldn't send your access code by email. Check the address, or email support@evalu8compass.app.");
  }
  hooks && hooks.prefill && hooks.prefill(entry.id, { name: school, type: type === "maintained" ? "maintained" : type === "academy" ? "academy" : "independent" });
  hooks && hooks.audit && hooks.audit("signup.code", `${school} (${entry.id}), ${TIERS[tier].label}, free until ${addDays(trialEndsAt, -1)}${dupes.length ? `; POSSIBLE DUPLICATE of ${dupes.map(d => d.name + " (" + d.id + ")").join(", ")}` : ""}`);
  await notifyAdmin(`New sign-up: ${school}${dupes.length ? " (possible duplicate)" : ""}`, [
    `School: ${school}`, `Type: ${TIERS[tier].label} (${type}${phase ? ", " + phase : ""})`, `URN: ${urn || "not given"}`,
    `Contact: ${name}${role ? ", " + role : ""} <${email}>`, `Free until: ${longDate(addDays(trialEndsAt, -1))}`,
    dupes.length ? `\nPOSSIBLE DUPLICATE of: ${dupes.map(d => `${d.name} (${d.id}${d.urn ? ", URN " + d.urn : ""})`).join("; ")}. Check in the admin console.` : "",
  ]);
  return { ok: true, kind: "code" };
}

/** Lost code: send a new code to the registered email. Always answers the same way. */
async function resend(email, ip, hooks, fromSignup) {
  email = clip(email, 200).toLowerCase();
  if (!mail.validEmail(email)) throw new BillingError(400, "Enter a valid email address.");
  if (!mail.configured()) throw new BillingError(503, "Email isn't available right now. Write to support@evalu8compass.app.");
  if (!fromSignup && (tooMany("rip:" + ip, 5, 3600e3) || tooMany("remail:" + email, 3, 864e5))) throw new BillingError(429, "Too many requests. Try again later.");
  const matches = access.list().filter(c => !c.revoked && c.email && c.email.toLowerCase() === email);
  for (const c of matches) {
    const code = access.addCode(c.id);
    if (!code) { await notifyAdmin(`Code limit reached: ${c.name}`, [`${c.name} (${c.id}) asked for another code but already has 10 extra codes. Contact ${email} and issue one by hand.`]); continue; }
    const st = status(c);
    const note = st.key === "trial_ended" || st.key === "lapsed" ? `Your school's access is paused because ${st.key === "trial_ended" ? "its free term has ended" : "its subscription has ended"}. Your saved work is kept. Subscribe at ${site()}/subscribe.html to carry on.` : "";
    try {
      await mail.send({ to: email, subject: `Your Evalu8 Compass access code for ${c.name}`,
        text: `Hello,\n\nHere is a new access code for ${c.name}:\n\n    ${code}\n\nSign in at ${site()}/enter.html. Your previous code still works too.${note ? "\n\n" + note : ""}\n\nIf you didn't ask for this, you can ignore this email.\n\nEvalu8 Compass`,
        html: wrap("Your access code", p(`Here is a new access code for <b>${esc(c.name)}</b>:`) + codeBox(code) + btn(`${site()}/enter.html`, "Sign in") + p("Your previous code still works too.") + (note ? p(esc(note)) : "") + p("If you didn't ask for this, you can ignore this email.")) });
      hooks && hooks.audit && hooks.audit("signup.resend", `${c.name} (${c.id})`);
    } catch (e) { console.error("Resend failed:", e.message); }
  }
  return { ok: true };
}

/* ---------- invoices ---------- */
function nextInvoiceNumber() {
  let n = 1;
  try { n = JSON.parse(fs.readFileSync(COUNTER, "utf8")).next || 1; } catch (e) {}
  // Never reuse a number, even if billing.json is lost
  for (const r of allInvoices()) { const k = Number(String(r.number).split("-").pop()); if (k >= n) n = k + 1; }
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(COUNTER, JSON.stringify({ next: n + 1 }), { mode: 0o600 });
  return `EC-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
}
function canInvoice() { return !!(env("OPERATOR_NAME") && env("BANK_ACCOUNT_NUMBER") && env("BANK_SORT_CODE")); }
const invoiceToken = num => access.sign("invoice:" + num);
const invoiceLink = num => `${site()}/invoice/${encodeURIComponent(num)}?t=${invoiceToken(num)}`;

function makeInvoice(c, s) {
  const v = vat(), net = s.price, tax = v ? Math.round(net * v.rate) / 100 : 0;
  const issued = today();
  const inv = {
    number: nextInvoiceNumber(), issuedAt: issued,
    dueAt: [addDays(issued, PAYMENT_DAYS), s.periodStart].sort()[1],   // 30 days, or the start of the paid year if later
    net, vat: tax, vatRate: v ? v.rate : 0, total: Math.round((net + tax) * 100) / 100,
  };
  const rec = { ...inv, codeId: c.id, school: c.name, tier: s.tier, periodStart: s.periodStart, periodEnd: s.periodEnd, billTo: { name: s.billing.name, address: s.billing.address, po: s.billing.po || "" } };
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(INVOICES, JSON.stringify(rec) + "\n", { mode: 0o600 });
  return inv;
}
function findInvoice(num) {
  try {
    const lines = fs.readFileSync(INVOICES, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) { try { const r = JSON.parse(lines[i]); if (r.number === num) return r; } catch (e) {} }
  } catch (e) {}
  return null;
}
function allInvoices() {
  try { return fs.readFileSync(INVOICES, "utf8").trim().split("\n").map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; }
}
/** The invoice as a printable web page (also the email's HTML body). */
function invoiceHtml(r, paidAt) {
  const v = r.vatRate ? vat() : null;
  const op = esc(env("OPERATOR_NAME") || "Evalu8 Compass"), opAddr = esc(env("OPERATOR_ADDRESS")).replace(/,\s*/g, "<br>");
  const row = (a, b, strong) => `<tr><td style="padding:6px 0;${strong ? "font-weight:bold;border-top:2px solid #04342C" : ""}">${a}</td><td style="padding:6px 0;text-align:right;${strong ? "font-weight:bold;border-top:2px solid #04342C" : ""}">${b}</td></tr>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice ${esc(r.number)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#1d2b28;background:#f4f7f6;margin:0}main{max-width:720px;margin:24px auto;background:#fff;border:1px solid #d5e3df;border-radius:12px;padding:32px 28px}h1{color:#04342C;margin:0 0 4px;font-size:28px}table{width:100%;border-collapse:collapse}.grid{display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between;margin:20px 0}.muted{color:#5b6b67;font-size:13px}.box{background:#E1F5EE;border-radius:8px;padding:14px 16px;margin-top:20px}${paidAt ? ".paid{color:#0F6E56;font-weight:bold;font-size:18px}" : ""}@media print{body{background:#fff}main{border:0;margin:0}}</style></head>
<body><main>
<div class="grid"><div><h1>Invoice</h1><div class="muted">${esc(r.number)}</div>${paidAt ? `<p class="paid">Paid ${esc(longDate(paidAt))}, thank you</p>` : ""}</div>
<div style="text-align:right"><b>${op}</b><br>${opAddr}${v ? `<br>VAT number ${esc(v.number)}` : ""}<br>support@evalu8compass.app</div></div>
<div class="grid"><div><div class="muted">Bill to</div><b>${esc(r.billTo.name)}</b><br>${esc(r.school)}<br>${esc(r.billTo.address).replace(/\n/g, "<br>")}${r.billTo.po ? `<br>Purchase order: ${esc(r.billTo.po)}` : ""}</div>
<div><table><tr><td class="muted" style="padding-right:12px">Invoice date</td><td>${esc(longDate(r.issuedAt))}</td></tr><tr><td class="muted" style="padding-right:12px">Payment due</td><td><b>${esc(longDate(r.dueAt))}</b></td></tr></table></div></div>
<table><tr><th style="text-align:left;border-bottom:1px solid #d5e3df;padding:6px 0">Description</th><th style="text-align:right;border-bottom:1px solid #d5e3df;padding:6px 0">Amount</th></tr>
${row(`Evalu8 Compass annual subscription: ${esc((TIERS[r.tier] || {}).label || r.tier)}<br><span class="muted">${esc(longDate(r.periodStart))} to ${esc(longDate(addDays(r.periodEnd, -1)))}</span>`, money(r.net))}
${r.vatRate ? row(`VAT at ${r.vatRate}%`, money(r.vat)) : ""}${row("Total due", money(r.total), true)}</table>
${r.vatRate ? "" : `<p class="muted">VAT is not charged on this invoice.</p>`}
<div class="box"><b>How to pay</b><br>Bank transfer to ${esc(env("BANK_ACCOUNT_NAME") || env("OPERATOR_NAME"))}${env("BANK_NAME") ? ", " + esc(env("BANK_NAME")) : ""}<br>Sort code <b>${esc(env("BANK_SORT_CODE"))}</b> · Account number <b>${esc(env("BANK_ACCOUNT_NUMBER"))}</b><br>Please use <b>${esc(r.number)}</b> as the payment reference.</div>
<p class="muted" style="margin-top:20px">Payment is due within ${PAYMENT_DAYS} days of the invoice date, or by the start of the subscription year if that is later. Terms: ${esc(site())}/terms.html</p>
</main></body></html>`;
}
async function sendInvoice(c, s) {
  const r = findInvoice(s.invoice.number);
  const to = [s.billing.email], cc = c.email && c.email !== s.billing.email ? [c.email] : [];
  await mail.send({ to, cc, subject: `Invoice ${r.number} — Evalu8 Compass subscription for ${c.name}`, replyTo: mail.adminEmail() || undefined,
    text: [`Invoice ${r.number}`, "", `${c.name}: Evalu8 Compass annual subscription (${TIERS[r.tier].label}), ${longDate(r.periodStart)} to ${longDate(addDays(r.periodEnd, -1))}.`, "",
      `Amount: ${money(r.net)}${r.vatRate ? ` + VAT ${money(r.vat)} = ${money(r.total)}` : " (VAT not charged)"}`, `Payment due: ${longDate(r.dueAt)}`, "",
      `Pay by bank transfer to ${env("BANK_ACCOUNT_NAME") || env("OPERATOR_NAME")}, sort code ${env("BANK_SORT_CODE")}, account ${env("BANK_ACCOUNT_NUMBER")}, reference ${r.number}.`, "",
      `View or print the invoice: ${invoiceLink(r.number)}`, "", "Evalu8 Compass"].join("\n"),
    html: invoiceHtml(r) });
}

/* ---------- subscribing ---------- */
/** body = { code, billingName, billingEmail, address, po?, agree } */
async function subscribe(body, ip, hooks) {
  const b = body || {};
  if (tooMany("sub:" + ip, 10, 3600e3)) throw new BillingError(429, "Too many attempts. Try again later.");
  const c = access.lookup(b.code);
  if (!c) throw new BillingError(400, "That access code isn't recognised. It's in the email you got when you signed up.");
  if (c.revoked) throw new BillingError(403, "This code has been switched off. Email support@evalu8compass.app.");
  if (!c.tier || c.tier === "trust") throw new BillingError(409, "Your school's subscription is arranged directly with us. Email support@evalu8compass.app.");
  const st = status(c);
  if ((st.key === "paid" || st.key === "invoiced" || st.key === "overdue" || st.key === "invoice_to_send") && today() < st.renewFrom)
    throw new BillingError(409, `You're already subscribed until ${longDate(addDays(st.periodEnd, -1))}. You can renew from ${longDate(st.renewFrom)}.`);
  // An unpaid subscription (current, ended or cancelled) has to be settled with us first, so no debt is lost
  if (c.sub && !c.sub.paidAt)
    throw new BillingError(409, `${c.sub.invoice ? `Invoice ${c.sub.invoice.number}` : "Your last subscription"} hasn't been paid yet, so we can't renew online. Email support@evalu8compass.app and we'll sort it out.`);
  const billing = { name: clip(b.billingName, 100), email: clip(b.billingEmail, 200).toLowerCase(), address: (typeof b.address === "string" ? b.address : "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, 400), po: clip(b.po, 40) };
  if (billing.name.length < 2) throw new BillingError(400, "Enter the name to put on the invoice (for example your school business manager).");
  if (!mail.validEmail(billing.email)) throw new BillingError(400, "Enter a valid email address for the invoice.");
  if (billing.address.length < 8) throw new BillingError(400, "Enter the school's postal address for the invoice.");
  if (!b.agree) throw new BillingError(400, "Tick the box to agree to the terms.");
  if (!mail.configured()) throw new BillingError(503, "Subscribing online isn't available right now. Email support@evalu8compass.app.");

  const t = today();
  // The paid year starts when the free term (or the current year) ends, or today if access has already paused.
  const periodStart = c.trialEndsAt && t < c.trialEndsAt ? c.trialEndsAt : st.periodEnd && t < st.periodEnd ? st.periodEnd : t;
  const s = { status: "active", tier: c.tier, price: TIERS[c.tier].price, periodStart, periodEnd: addYear(periodStart), requestedAt: new Date().toISOString(), billing };
  if (canInvoice()) s.invoice = makeInvoice(c, s);
  const saved = access.update(c.id, x => {
    if (x.sub) x.history = [...(x.history || []), x.sub].slice(-10);
    x.sub = s; x.expiresAt = startOf(s.periodEnd);
  });
  hooks && hooks.audit && hooks.audit("billing.subscribe", `${c.name} (${c.id}): ${TIERS[c.tier].label}, ${s.periodStart} to ${s.periodEnd}${s.invoice ? ", invoice " + s.invoice.number : ", invoice to send"}`);

  const resumed = !(c.trialEndsAt && t < c.trialEndsAt) && !(st.periodEnd && t < st.periodEnd);
  let invoiceSent = false;
  if (s.invoice) {
    try { await sendInvoice(saved, s); invoiceSent = true; access.update(c.id, x => { x.sub.invoice.sentAt = new Date().toISOString(); }); }
    catch (e) { console.error("Invoice email failed:", e.message); }
  }
  const lines = [`Thank you. ${c.name}'s Evalu8 Compass subscription runs from ${longDate(s.periodStart)} to ${longDate(addDays(s.periodEnd, -1))}.`,
    resumed ? "Your access code works again now, with all your saved work." : "",
    invoiceSent ? `The invoice (${s.invoice.number}) has been sent to ${billing.email}. It's payable within ${PAYMENT_DAYS} days.` : `We'll email the invoice to ${billing.email} within two working days. It's payable within ${PAYMENT_DAYS} days.`];
  try {
    if (c.email && c.email !== billing.email) await mail.send({ to: c.email, subject: `Subscription confirmed for ${c.name}`, text: lines.filter(Boolean).join("\n\n") + "\n\nEvalu8 Compass", html: wrap("Subscription confirmed", lines.filter(Boolean).map(l => p(esc(l))).join("")) });
  } catch (e) { console.error("Subscription email failed:", e.message); }
  await notifyAdmin(`Subscription: ${c.name}${invoiceSent ? "" : " — INVOICE TO SEND"}`, [
    `School: ${c.name} (${c.id})`, `Plan: ${TIERS[c.tier].label}, ${money(s.price)} a year`, `Period: ${longDate(s.periodStart)} to ${longDate(addDays(s.periodEnd, -1))}`,
    `Invoice to: ${billing.name} <${billing.email}>`, `Address: ${billing.address.replace(/\n/g, ", ")}`, `PO: ${billing.po || "none"}`,
    invoiceSent ? `Invoice ${s.invoice.number} sent, due ${longDate(s.invoice.dueAt)}.` : s.invoice ? `Invoice ${s.invoice.number} was created but the email FAILED. Use Send invoice in the admin console.` : "No invoice sent automatically: add OPERATOR_NAME and bank details to .env, then use Send invoice in the admin console.",
  ]);
  return { ok: true, school: c.name, periodStart: s.periodStart, periodEndLabel: longDate(addDays(s.periodEnd, -1)), invoice: invoiceSent ? s.invoice.number : null, billingEmail: billing.email, resumed, message: lines.filter(Boolean).join(" ") };
}

/** For the subscribe page: what a code would subscribe to (no personal details). */
function quote(code) {
  const c = access.lookup(code);
  if (!c || c.revoked) return null;
  const st = status(c), t = TIERS[c.tier];
  if (!t || c.tier === "trust") return { school: c.name, manual: true };
  const v = vat();
  return { school: c.name, tier: c.tier, tierLabel: t.label, price: t.price, vatNote: v ? `plus VAT at ${v.rate}%` : "no VAT charged", status: st.key, label: st.label,
    startsLabel: longDate(c.trialEndsAt && today() < c.trialEndsAt ? c.trialEndsAt : st.periodEnd && today() < st.periodEnd ? st.periodEnd : today()),
    already: ["paid", "invoiced", "overdue", "invoice_to_send"].includes(st.key) && today() < st.renewFrom ? longDate(st.renewFrom) : null,
    unpaid: !!(c.sub && !c.sub.paidAt) };
}

/* ---------- superadmin actions ---------- */
async function adminAction(id, act, b) {
  const c = access.list().find(x => x.id === id);
  if (!c) throw new BillingError(404, "No code with that id.");
  if (act === "send-invoice") {
    if (!c.sub || c.sub.status === "cancelled") throw new BillingError(409, "This school doesn't have a current subscription.");
    if (!c.sub.billing) throw new BillingError(409, "The invoice contact details have been removed under the retention policy.");
    if (!canInvoice()) throw new BillingError(409, "Add OPERATOR_NAME, BANK_SORT_CODE and BANK_ACCOUNT_NUMBER to .env and restart, so invoices show how to pay.");
    let s = c.sub;
    if (!s.invoice) { const inv = makeInvoice(c, s); access.update(id, x => { x.sub.invoice = inv; }); s = { ...s, invoice: inv }; }
    await sendInvoice(c, s);
    access.update(id, x => { x.sub.invoice.sentAt = new Date().toISOString(); });
    return { ok: true, invoice: s.invoice.number };
  }
  if (act === "mark-paid") {
    if (!c.sub) throw new BillingError(409, "This school hasn't subscribed.");
    if (b.date != null && b.date !== "" && !validDate(b.date)) throw new BillingError(400, "Enter the date as YYYY-MM-DD.");
    const paidAt = b.date ? b.date : today();
    access.update(id, x => { x.sub.paidAt = paidAt; });
    if (c.sub.invoice && b.receipt !== false) {
      const r = findInvoice(c.sub.invoice.number);
      try { await mail.send({ to: c.sub.billing ? c.sub.billing.email : c.email, subject: `Payment received — invoice ${r.number}`, text: `Thank you. We've received payment of ${money(r.total)} for invoice ${r.number} (${c.name}).\n\nReceipted invoice: ${invoiceLink(r.number)}\n\nEvalu8 Compass`, html: invoiceHtml(r, paidAt) }); } catch (e) { console.error("Receipt email failed:", e.message); }
    }
    return { ok: true };
  }
  if (act === "mark-unpaid") { access.update(id, x => { if (x.sub) delete x.sub.paidAt; }); return { ok: true }; }
  if (act === "cancel") {
    // Ends the subscription now: access pauses (saved work is kept for the retention period)
    // If the free term is still running, the school keeps it
    access.update(id, x => { if (x.sub) { x.sub.status = "cancelled"; x.sub.cancelledAt = new Date().toISOString(); } x.expiresAt = x.trialEndsAt && today() < x.trialEndsAt ? startOf(x.trialEndsAt) : new Date().toISOString(); });
    return { ok: true };
  }
  if (act === "set-trial") {
    const d = b.date;
    if (!validDate(d)) throw new BillingError(400, "Enter a real date as YYYY-MM-DD.");
    access.update(id, x => { x.trialEndsAt = d; if (!x.sub || x.sub.status === "cancelled" || today() >= x.sub.periodEnd) x.expiresAt = startOf(d); if (!x.tier) x.tier = ["independent", "primary", "secondary"].includes(b.tier) ? b.tier : "primary"; });
    return { ok: true };
  }
  throw new BillingError(404, "Not found");
}

/* ---------- reminders (run a few times a day) ---------- */
let remindersRunning = false;
async function reminders(hooks) {
  if (!mail.configured() || remindersRunning) return 0;
  remindersRunning = true;
  try { return await remindAll(hooks); } finally { remindersRunning = false; }
}
async function remindAll(hooks) {
  const t = today(); let sent = 0;
  const mark = (id, key) => access.update(id, x => { x.sent = { ...(x.sent || {}), [key]: new Date().toISOString() }; });
  for (const c of access.list()) {
    if (c.revoked || !c.tier || c.tier === "trust" || !c.email) continue;
    let st; try { st = status(c); } catch (e) { console.error("Reminders: skipped", c.id, e.message); continue; }
    const sentAlready = k => c.sent && c.sent[k];
    const go = async (key, subject, title, paras, link) => {
      if (sentAlready(key)) return;
      mark(c.id, key);   // mark first, so a failing mail server can't cause repeats
      try {
        await mail.send({ to: c.email, cc: c.sub && c.sub.billing && c.sub.billing.email !== c.email && /^(renew|lapsed|overdue)/.test(key) ? [c.sub.billing.email] : [], subject, replyTo: mail.adminEmail() || undefined,
          text: [`Hello${c.contact && c.contact.name ? " " + c.contact.name : ""},`, "", ...paras.flatMap(x => [x, ""]), link ? `${link[1]}: ${link[0]}\n` : "", "Evalu8 Compass"].join("\n"),
          html: wrap(title, paras.map(x => p(esc(x))).join("") + (link ? btn(link[0], link[1]) : "")) });
        sent++; hooks && hooks.audit && hooks.audit("billing.reminder", `${c.name} (${c.id}): ${key.split(":")[0]}`);
      } catch (e) {
        console.error("Reminder failed:", e.message);
        access.update(c.id, x => { if (x.sent) delete x.sent[key]; });   // try again next time
      }
    };
    const price = TIERS[c.tier].price, sub = `${site()}/subscribe.html`;
    if (st.key === "trial" && t >= addDays(c.trialEndsAt, -14))
      await go(`trial14:${c.trialEndsAt}`, `Your free term ends on ${longDate(addDays(c.trialEndsAt, -1))}`, "Your free term is ending soon",
        [`${c.name}'s free term with Evalu8 Compass ends on ${longDate(addDays(c.trialEndsAt, -1))}.`, `To carry on, subscribe for ${money(price)} a year (excluding VAT). Your access continues without a break, the paid year starts when the free term ends, and the invoice is payable within ${PAYMENT_DAYS} days.`, "If you don't subscribe, access pauses. Your saved work is kept, so you can pick up where you left off if you subscribe later."], [sub, "Subscribe"]);
    if (st.key === "trial_ended")
      await go(`trialend:${c.trialEndsAt}`, "Your free term has ended", "Your free term has ended",
        [`${c.name}'s free term with Evalu8 Compass has ended, so your access code is paused.`, `Your saved work is kept. Subscribe for ${money(price)} a year (excluding VAT) and your code works again straight away.`], [sub, "Subscribe"]);
    if (["paid", "invoiced", "overdue", "invoice_to_send"].includes(st.key) && t >= st.renewFrom)
      await go(`renew30:${st.periodEnd}`, `Renew your Evalu8 Compass subscription`, "Time to renew",
        [`${c.name}'s Evalu8 Compass subscription ends on ${longDate(addDays(st.periodEnd, -1))}.`, `Renew for another year for ${money(c.sub.price)} (excluding VAT). Subscriptions don't renew automatically.`], [sub, "Renew"]);
    if (st.key === "overdue" && c.sub.invoice && t >= addDays(c.sub.invoice.dueAt, 7))
      await go(`overdue:${c.sub.invoice.number}`, `Invoice ${c.sub.invoice.number} is overdue`, "Payment reminder",
        [`Invoice ${c.sub.invoice.number} for ${c.name}'s Evalu8 Compass subscription was due on ${longDate(c.sub.invoice.dueAt)} and we haven't received payment yet.`, "If you've already paid, thank you, and please ignore this reminder."], [invoiceLink(c.sub.invoice.number), "View the invoice"]);
    if (st.key === "lapsed")
      await go(`lapsed:${c.sub.periodEnd}`, "Your Evalu8 Compass subscription has ended", "Your subscription has ended",
        [`${c.name}'s Evalu8 Compass subscription has ended, so your access code is paused.`, "Your saved work is kept. Renew and your code works again straight away."], [sub, "Renew"]);
  }
  return sent;
}

/* ---------- admin overview ---------- */
function overview() {
  const codes = access.list().filter(c => c.tier);
  const rows = codes.map(c => ({ id: c.id, name: c.name, tier: c.tier, email: c.email || "", urn: c.urn || "", contact: c.contact || null, createdAt: c.createdAt, trialEndsAt: c.trialEndsAt || null, sub: c.sub || null, status: status(c) }));
  const year = new Date().getFullYear();
  const inv = allInvoices();
  const paid = new Set(codes.filter(c => c.sub && c.sub.paidAt && c.sub.invoice).map(c => c.sub.invoice.number));
  return {
    rows, canInvoice: canInvoice(), mail: mail.configured(), adminEmail: mail.adminEmail(), vat: !!vat(),
    totals: {
      trial: rows.filter(r => r.status.key === "trial").length,
      subscribed: rows.filter(r => ["paid", "invoiced", "overdue", "invoice_to_send"].includes(r.status.key)).length,
      toInvoice: rows.filter(r => r.status.key === "invoice_to_send").length,
      overdue: rows.filter(r => r.status.key === "overdue").length,
      invoicedThisYear: inv.filter(r => r.issuedAt.startsWith(String(year))).reduce((t, r) => t + r.total, 0),
      outstanding: inv.filter(r => !paid.has(r.number) && codes.some(c => c.sub && c.sub.invoice && c.sub.invoice.number === r.number && c.sub.status !== "cancelled")).reduce((t, r) => t + r.total, 0),
    },
    enquiries: (() => { try { return fs.readFileSync(ENQUIRIES, "utf8").trim().split("\n").map(l => JSON.parse(l)).reverse().slice(0, 20); } catch (e) { return []; } })(),
  };
}

module.exports = {
  TIERS, PAYMENT_DAYS, BillingError, today, startOf, validDate, termOf, freeUntil, freeWording, summerStart, easter, addYear, addDays, longDate, tierFor, pricing,
  status, forSchool, signup, resend, subscribe, quote, adminAction, reminders, overview, findInvoice, invoiceHtml, invoiceToken, canInvoice,
};
