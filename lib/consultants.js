/*
 * Consultant and school improvement partner (SIP) register
 * ------------------------------------------------------------
 * Consultants apply on /consultant-apply.html. The superadmin checks identity,
 * enhanced DBS (on the DBS Update Service), the teacher prohibition list (TRA),
 * insurance and references, records the date of each check, and approves.
 * Approval emails a £49 listing-fee invoice; the listing goes live once it's
 * marked paid. Every year the checks are repeated for £18. Listings are hidden
 * when insurance expires or the annual check is over 30 days late.
 *
 * Only signed-in schools can search the register (by postcode distance, region
 * and expertise) and send an enquiry, which is emailed to the consultant.
 * Consultants manage their listing from a private link; changes to what schools
 * see are checked before they're published.
 *
 * We store only the date and outcome of each check, never DBS certificate
 * details. Data lives in data/consultants.json.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const access = require("./access");
const mail = require("./mail");
const billing = require("./billing");
const geo = require("./geo");

const DATA = path.join(__dirname, "..", "data");
const FILE = path.join(DATA, "consultants.json");
const ENQ = path.join(DATA, "consultant-enquiries.jsonl");
const LISTING_FEE = 49, ANNUAL_FEE = 18, ANNUAL_GRACE = 30;

const REGIONS = ["North East", "North West", "Yorkshire and the Humber", "East Midlands", "West Midlands", "East of England", "London", "South East", "South West", "Wales", "Scotland", "Northern Ireland"];
const EXPERTISE = [
  ["sg", "Safeguarding"], ["inc", "Inclusion and SEND"], ["ct", "Curriculum and teaching"], ["ach", "Achievement and assessment"],
  ["ab", "Attendance and behaviour"], ["pd", "Personal development and wellbeing"], ["ey", "Early years"], ["p16", "Post-16"],
  ["lg", "Leadership and governance"], ["cm", "Statutory compliance"], ["iss", "Independent school standards"],
  ["insp", "Inspection preparation"], ["coach", "Leadership coaching and mentoring"], ["new", "Opening a new school"],
];
const EXP = Object.fromEntries(EXPERTISE);
const PHASES = [["ey", "Early years"], ["primary", "Primary"], ["secondary", "Secondary"], ["p16", "Post-16"], ["special", "Special and alternative provision"]];
const TYPES = [["maintained", "Maintained"], ["academy", "Academies and trusts"], ["independent", "Independent"]];
const CHECKS = [
  ["identity", "Identity"], ["dbs", "Enhanced DBS (child workforce), on the DBS Update Service"], ["tra", "Teacher prohibition check (Teaching Regulation Agency)"],
  ["insurance", "Professional indemnity and public liability insurance"], ["references", "Two professional references"],
];
const CHECK_LABEL = Object.fromEntries(CHECKS);

class ConsultantError extends Error { constructor(status, message) { super(message); this.status = status; } }
const B = billing, { clip, esc, today, addDays, addYear, longDate, validDate } = billing;
const para = B.para;

/* ---------- storage ---------- */
let cache = null, cacheMtime = 0;
function load() {
  let m = 0; try { m = fs.statSync(FILE).mtimeMs; } catch (e) {}
  if (cache && m === cacheMtime) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch (e) {
    if (e.code !== "ENOENT") { cache = null; throw new ConsultantError(500, "The consultant register couldn't be read. Nothing has been changed."); }
    cache = { list: [] };
  }
  cacheMtime = m;
  if (!Array.isArray(cache.list)) cache.list = [];
  return cache;
}
function save() {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = FILE + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  cacheMtime = fs.statSync(FILE).mtimeMs;
}
function reload() { cache = null; cacheMtime = 0; return load(); }
const find = id => load().list.find(c => c.id === id) || null;
/** Change one record. fn works on a copy, so nothing changes if it throws. */
function change(id, fn) {
  const db = load(), i = db.list.findIndex(c => c.id === id);
  if (i < 0) throw new ConsultantError(404, "No consultant with that id.");
  const c = JSON.parse(JSON.stringify(db.list[i])), old = db.list[i];
  fn(c); c.updatedAt = new Date().toISOString();
  db.list[i] = c;
  try { save(); } catch (e) { db.list[i] = old; throw e; }
  return c;
}

/* ---------- private manage link ---------- */
const token = (id, v) => access.sign("consultant:" + id + ":" + (v || 0));
const manageLink = id => { const c = find(id); return `${B.site()}/consultant.html?id=${id}&t=${token(id, c && c.linkV)}`; };
function byToken(id, t) {
  const c = find(String(id || ""));
  if (!c) return null;
  const a = Buffer.from(String(t || "")), e = Buffer.from(token(c.id, c.linkV));
  return a.length === e.length && crypto.timingSafeEqual(a, e) ? c : null;
}

/* ---------- visibility ---------- */
const checked = (c, k) => !!(c.checks && c.checks[k] && c.checks[k].at);
function insuranceOk(c) { return !!(c.insurance && c.insurance.expires && c.insurance.expires >= today()); }
function annualOk(c) { return !c.checksDue || today() < addDays(c.checksDue, ANNUAL_GRACE); }
/** Shown to schools only when live, every check is recorded, insurance is current and the annual check isn't overdue. */
function visible(c) { return c.status === "live" && CHECKS.every(([k]) => checked(c, k)) && insuranceOk(c) && annualOk(c); }
function stateOf(c) {
  if (c.status === "live" && !insuranceOk(c)) return { key: "hidden", label: "Hidden: insurance has expired" };
  if (c.status === "live" && !annualOk(c)) return { key: "hidden", label: "Hidden: annual check overdue" };
  return {
    applied: { key: "applied", label: "Application received: checks in progress" },
    approved: { key: "approved", label: "Approved: listing fee to pay" },
    live: { key: "live", label: c.checksDue && today() >= addDays(c.checksDue, -30) ? `Live: annual check due ${longDate(c.checksDue)}` : "Live" },
    rejected: { key: "rejected", label: "Not approved" },
    suspended: { key: "suspended", label: "Suspended" },
  }[c.status] || { key: c.status, label: c.status };
}

/* ---------- validation ---------- */
const pickList = (v, allowed, max) => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && allowed.includes(x)))].slice(0, max) : [];
function profileFrom(b, errors) {
  const p = {
    name: clip(b.name, 100), headline: clip(b.headline, 120), town: clip(b.town, 60),
    region: REGIONS.includes(b.region) ? b.region : "", travel: Math.max(0, Math.min(300, Math.round(Number(b.travel) || 0))), remote: !!b.remote,
    expertise: pickList(b.expertise, EXPERTISE.map(e => e[0]), 8), phases: pickList(b.phases, PHASES.map(e => e[0]), 5), types: pickList(b.types, TYPES.map(e => e[0]), 3),
    background: clip(b.background, 300), qualifications: clip(b.qualifications, 300),
    bio: (typeof b.bio === "string" ? b.bio : "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500),
  };
  if (p.name.length < 3) errors.push(["name", "Enter your full name."]);
  if (p.headline.length < 10) errors.push(["headline", "Add a one-line summary of what you offer (at least 10 characters)."]);
  if (p.bio.length < 100) errors.push(["bio", "Write a short bio of your expertise and experience (at least 100 characters)."]);
  if (p.town.length < 2) errors.push(["town", "Enter the town or city you work from."]);
  if (!p.region) errors.push(["region", "Choose your region."]);
  if (p.travel < 5 && !p.remote) errors.push(["travel", "Say how far you'll travel (at least 5 miles), or tick that you work remotely."]);
  if (!p.expertise.length) errors.push(["expertise", "Choose at least one area of expertise."]);
  if (!p.phases.length) errors.push(["phases", "Choose at least one phase."]);
  if (!p.types.length) errors.push(["types", "Choose at least one type of school."]);
  return p;
}

/* ---------- applying ---------- */
async function apply(b, ip, hooks) {
  b = b || {};
  if (b.website) return { ok: true };
  if (!mail.configured()) throw new ConsultantError(503, "Applications aren't open right now. Email support@evalu8compass.app.");
  const errors = [];
  const profile = profileFrom(b, errors);
  const email = clip(b.email, 200).toLowerCase(), phone = clip(b.phone, 30);
  const address = (typeof b.address === "string" ? b.address : "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, 300);
  if (!mail.validEmail(email)) errors.push(["email", "Enter a valid email address."]);
  else if (require("./botcheck").isDisposable(email)) errors.push(["email", "Use a permanent email address. We can't accept temporary email services."]);
  if (address.length < 8) errors.push(["address", "Enter your postal address for invoices."]);
  const trn = clip(b.trn, 10).replace(/\D/g, "");
  if (trn && trn.length !== 7) errors.push(["trn", "A teacher reference number (TRN) has 7 digits. Leave it blank if you don't have one."]);
  if (!b.updateService) errors.push(["updateService", "You need an enhanced DBS certificate (child workforce) on the DBS Update Service to join."]);
  const insurance = { provider: clip(b.insProvider, 100), expires: typeof b.insExpires === "string" ? b.insExpires : "" };
  if (insurance.provider.length < 2) errors.push(["insProvider", "Enter your insurer."]);
  if (!validDate(insurance.expires) || insurance.expires <= today()) errors.push(["insExpires", "Enter the date your current insurance ends."]);
  const referees = [0, 1].map(i => { const r = (Array.isArray(b.referees) && b.referees[i]) || {}; return { name: clip(r.name, 100), role: clip(r.role, 120), email: clip(r.email, 200).toLowerCase() }; });
  referees.forEach((r, i) => { if (r.name.length < 2 || r.role.length < 2 || !mail.validEmail(r.email)) errors.push([`ref${i + 1}`, `Enter referee ${i + 1}'s name, role and email.`]); });
  if (referees[0].email && referees[0].email === referees[1].email) errors.push(["ref2", "Give two different referees."]);
  if (!b.agree || !b.consent || !b.accurate) errors.push(["agree", "Tick all three boxes at the end."]);
  if (errors.length) throw Object.assign(new ConsultantError(400, errors[0][1]), { fields: errors });
  if (B.tooMany("capply:" + ip, Number(process.env.SIGNUP_LIMIT_PER_HOUR || 5), 3600e3)) throw new ConsultantError(429, "Too many applications from here. Try again later.");

  // Already applied with this email? Send their private link again rather than creating a duplicate.
  const existing = load().list.find(c => c.contact.email === email && !["rejected"].includes(c.status));
  if (existing) {
    await sendManageLink(existing).catch(e => console.error("Consultant link email failed:", e.message));
    return { ok: true };
  }
  const loc = await geo.lookupDistrict(b.postcode);   // district centre only; throws a friendly error if it isn't real or the lookup is down
  const c = {
    id: crypto.randomBytes(5).toString("hex"), status: "applied", createdAt: new Date().toISOString(),
    profile: { ...profile, district: loc.district }, geo: { lat: loc.lat, lon: loc.lon },
    contact: { email, phone, address }, trn, updateService: true, insurance, referees, checks: {}, fees: {}, sent: {},
  };
  load().list.push(c); save();
  hooks && hooks.audit && hooks.audit("consultant.apply", `${profile.name} (${c.id}), ${loc.district}`);
  try {
    await mail.send({ to: email, subject: "Your application to the Evalu8 Compass consultant register", replyTo: mail.adminEmail() || undefined,
      text: [`Hello ${profile.name},`, "", "Thank you for applying to join the Evalu8 Compass register of consultants and school improvement partners.", "",
        "What happens next:", "1. We'll contact you to see your enhanced DBS certificate and check its status on the DBS Update Service, with your consent.",
        "2. We check your identity, the teacher prohibition list, your insurance and your two references.",
        `3. When everything is in place we'll approve your listing and send an invoice for the one-off £${LISTING_FEE} listing fee. Your listing goes live once it's paid.`, "",
        `Check your application or update your profile at any time: ${manageLink(c.id)}`, "(Keep this link private: it lets you change your listing.)", "", "Evalu8 Compass"].join("\n"),
      html: B.wrap("Thank you for applying", para(`Hello ${esc(profile.name)},`) + para("Thank you for applying to join the Evalu8 Compass register of consultants and school improvement partners.") +
        para("<b>What happens next</b>") + "<ol style=\"margin:0 0 12px;padding-left:20px\"><li>We'll contact you to see your enhanced DBS certificate and check its status on the DBS Update Service, with your consent.</li><li>We check your identity, the teacher prohibition list, your insurance and your two references.</li><li>When everything is in place we approve your listing and send an invoice for the one-off £" + LISTING_FEE + " listing fee. Your listing goes live once it's paid.</li></ol>" +
        B.btn(manageLink(c.id), "View your application") + para("Keep this link private: it lets you change your listing.")) });
  } catch (e) { console.error("Consultant application email failed:", e.message); }
  await B.notifyAdmin(`Consultant application: ${profile.name}`, [`Name: ${profile.name}`, `Email: ${email}${phone ? ", phone " + phone : ""}`, `Location: ${profile.town} (${loc.district}), ${profile.region}`,
    `Expertise: ${profile.expertise.map(x => EXP[x]).join(", ")}`, `TRN: ${trn || "not given"}`, `Insurance: ${insurance.provider}, to ${insurance.expires}`,
    `Referees: ${referees.map(r => `${r.name} (${r.role}) <${r.email}>`).join("; ")}`, "", "Record the checks and approve in the admin console (Consultants)."]);
  return { ok: true };
}

async function sendManageLink(c) {
  await mail.send({ to: c.contact.email, subject: "Your Evalu8 Compass consultant listing", text: `Hello ${c.profile.name},\n\nHere is the private link to your listing:\n${manageLink(c.id)}\n\nIf you didn't ask for this, you can ignore this email.\n\nEvalu8 Compass`,
    html: B.wrap("Your consultant listing", para(`Hello ${esc(c.profile.name)},`) + B.btn(manageLink(c.id), "Manage your listing") + para("If you didn't ask for this, you can ignore this email.")) });
}
/** "Lost my link": always answers the same way. */
async function resendLink(email, ip) {
  email = clip(email, 200).toLowerCase();
  if (!mail.validEmail(email)) throw new ConsultantError(400, "Enter a valid email address.");
  if (B.tooMany("clink:" + ip, 5, 3600e3) || B.tooMany("clinke:" + email, 3, 864e5)) throw new ConsultantError(429, "Too many requests. Try again later.");
  const c = load().list.find(x => x.contact.email === email && x.status !== "rejected");
  if (c) await sendManageLink(c).catch(e => console.error("Consultant link email failed:", e.message));
  return { ok: true };
}

/* ---------- what consultants and schools see ---------- */
const monthYear = d => d ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
function publicCard(c, extra) {
  const p = c.profile;
  return {
    id: c.id, name: p.name, headline: p.headline, bio: p.bio, town: p.town, district: p.district, region: p.region, travel: p.travel, remote: p.remote,
    expertise: p.expertise.map(x => EXP[x] || x), expertiseIds: p.expertise, phases: p.phases.map(x => (PHASES.find(e => e[0] === x) || [])[1]).filter(Boolean),
    types: p.types.map(x => (TYPES.find(e => e[0] === x) || [])[1]).filter(Boolean), background: p.background, qualifications: p.qualifications,
    checks: CHECKS.map(([k, label]) => ({ label, at: monthYear(c.checks[k] && c.checks[k].at), until: k === "insurance" && c.insurance ? longDate(c.insurance.expires) : undefined })),
    listedSince: monthYear(c.liveAt), ...(extra || {}),
  };
}
function forConsultant(c) {
  const st = stateOf(c);
  return {
    id: c.id, status: st.key, label: st.label, profile: c.profile, pending: c.pending ? c.pending.profile : null, email: c.contact.email, phone: c.contact.phone,
    checks: CHECKS.map(([k, label]) => ({ key: k, label, at: c.checks[k] ? longDate(c.checks[k].at.slice(0, 10)) : null })),
    insuranceUntil: c.insurance ? longDate(c.insurance.expires) : null, checksDue: c.checksDue ? longDate(c.checksDue) : null,
    fees: { listing: c.fees.listing || null, annual: c.fees.annual || null }, visible: visible(c), listingFee: LISTING_FEE, annualFee: ANNUAL_FEE,
    options: { regions: REGIONS, expertise: EXPERTISE, phases: PHASES, types: TYPES },
  };
}

/** Consultant edits their profile: text schools see waits for review once the listing has been approved. */
async function update(c, b, hooks) {
  if (c.status === "rejected") throw new ConsultantError(409, "This application wasn't approved, so it can't be changed. Email support@evalu8compass.app.");
  const errors = [];
  const base = c.pending ? c.pending.profile : c.profile;
  const profile = profileFrom({ ...base, ...b }, errors);
  if (errors.length) throw Object.assign(new ConsultantError(400, errors[0][1]), { fields: errors });
  let district = base.district, g = c.pending && c.pending.geo ? c.pending.geo : c.geo;
  if (b.postcode && String(b.postcode).trim()) {
    const pc = geo.parse(b.postcode);
    if (!pc) throw Object.assign(new ConsultantError(400, "Enter a UK postcode, for example LS6 3QS, or just the first part, LS6."), { fields: [["postcode", ""]] });
    if (pc.district !== district) { const loc = await geo.lookupDistrict(pc.district); district = loc.district; g = { lat: loc.lat, lon: loc.lon }; }
  }
  const next = { ...profile, district };
  const phone = b.phone != null ? clip(b.phone, 30) : c.contact.phone;
  const reviewed = c.status !== "applied";
  const before = JSON.stringify(c.pending ? c.pending.profile : null);
  const saved = change(c.id, x => {
    x.contact.phone = phone;
    if (!reviewed) { x.profile = next; x.geo = g; }
    else if (JSON.stringify(next) === JSON.stringify(x.profile)) delete x.pending;          // back to what's live
    else x.pending = { profile: next, geo: g, at: new Date().toISOString() };
  });
  if (reviewed && saved.pending && JSON.stringify(saved.pending.profile) !== before) {
    hooks && hooks.audit && hooks.audit("consultant.changes", `${c.profile.name} (${c.id}) asked to change their listing`);
    await B.notifyAdmin(`Consultant listing changes to review: ${c.profile.name}`, ["Review and approve the changes in the admin console (Consultants)."]);
  }
  return forConsultant(saved);
}
function withdraw(c, hooks) {
  const db = load(); db.list = db.list.filter(x => x.id !== c.id); save();
  hooks && hooks.audit && hooks.audit("consultant.withdraw", `${c.profile.name} (${c.id}) withdrew and their details were deleted`);
  return { ok: true };
}

/* ---------- searching (signed-in schools) ---------- */
/** Areas this school most needs help with, from its own ratings. */
function suggestFor(state) {
  const score = {};
  for (const [id, v] of Object.entries((state && state.answers) || {})) {
    const area = id.split("-")[0];
    if (v === "no") score[area] = (score[area] || 0) + 2;
    if (v === "part") score[area] = (score[area] || 0) + 1;
  }
  const top = Object.entries(score).filter(([a]) => EXP[a]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
  const p = (state && state.profile) || {};
  if (p.newSchool) top.unshift("new");
  if (p.type === "independent" && (score.cm || 0) > 0 && !top.includes("iss")) top.push("iss");
  return [...new Set(top)].slice(0, 4).map(id => ({ id, label: EXP[id] }));
}
async function search(q) {
  q = q || {};
  const want = pickList(q.expertise, EXPERTISE.map(e => e[0]), 14);
  const phase = PHASES.some(e => e[0] === q.phase) ? q.phase : "", type = TYPES.some(e => e[0] === q.type) ? q.type : "";
  const region = REGIONS.includes(q.region) ? q.region : "";
  const from = q.postcode ? await geo.lookup(q.postcode) : null;
  const rows = [];
  for (const c of load().list) {
    if (!visible(c)) continue;
    const p = c.profile;
    if (phase && !p.phases.includes(phase)) continue;
    if (type && !p.types.includes(type)) continue;
    const matches = want.filter(x => p.expertise.includes(x)).length;
    if (want.length && !matches) continue;
    let dist = null, local = true;
    if (from) { dist = Math.round(geo.miles(from, c.geo)); local = dist <= p.travel; if (!local && !p.remote) continue; }
    else if (region && p.region !== region && !p.remote) continue;
    else if (region && p.region !== region) local = false;
    rows.push({ c, matches, dist, local });
  }
  rows.sort((a, b) => (b.local - a.local) || (b.matches - a.matches) || ((a.dist == null ? 1e9 : a.dist) - (b.dist == null ? 1e9 : b.dist)) || a.c.profile.name.localeCompare(b.c.profile.name));
  return { from: from ? from.district : null, results: rows.slice(0, 50).map(r => publicCard(r.c, { miles: r.dist, remoteOnly: !r.local })) };
}

/** A school sends an enquiry: emailed to the consultant, copied to the school. */
async function contact(id, b, school, hooks) {
  const c = find(id);
  if (!c || !visible(c)) throw new ConsultantError(404, "That consultant isn't on the register any more.");
  b = b || {};
  const name = clip(b.name, 100), role = clip(b.role, 100), email = clip(b.email, 200).toLowerCase(), phone = clip(b.phone, 30);
  const message = (typeof b.message === "string" ? b.message : "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, 2000);
  if (name.length < 2) throw new ConsultantError(400, "Enter your name.");
  if (!mail.validEmail(email)) throw new ConsultantError(400, "Enter a valid email address so the consultant can reply.");
  if (message.length < 20) throw new ConsultantError(400, "Tell the consultant briefly what you'd like help with.");
  if (B.tooMany("cenq:" + school.id, 10, 864e5)) throw new ConsultantError(429, "Your school has sent 10 enquiries today. Try again tomorrow.");
  const text = [`Hello ${c.profile.name},`, "", `${name}${role ? ", " + role : ""} at ${school.name} has sent you an enquiry through the Evalu8 Compass consultant register:`, "", message, "",
    `Reply to: ${email}${phone ? ` · Phone: ${phone}` : ""}`, "", "Any work is agreed directly between you and the school. Please reply within five working days, even if you can't help.", "", "Evalu8 Compass"].join("\n");
  await mail.send({ to: c.contact.email, replyTo: email, subject: `Enquiry from ${school.name} via Evalu8 Compass`, text,
    html: B.wrap(`Enquiry from ${school.name}`, para(`Hello ${esc(c.profile.name)},`) + para(`<b>${esc(name)}</b>${role ? ", " + esc(role) : ""} at <b>${esc(school.name)}</b> has sent you an enquiry through the Evalu8 Compass consultant register:`) +
      `<blockquote style="margin:0 0 12px;padding:10px 14px;background:#E1F5EE;border-radius:8px;white-space:pre-wrap">${esc(message)}</blockquote>` +
      para(`Reply to: <a href="mailto:${esc(email)}">${esc(email)}</a>${phone ? ` · Phone: ${esc(phone)}` : ""}`) + para("Any work is agreed directly between you and the school. Please reply within five working days, even if you can't help.")) });
  try {
    await mail.send({ to: email, subject: `Your enquiry to ${c.profile.name}`, text: `We've sent your enquiry to ${c.profile.name}. They'll reply to you at ${email}.\n\nYour message:\n${message}\n\nBefore any work in school, carry out your own checks as Keeping children safe in education requires.\n\nEvalu8 Compass`,
      html: B.wrap("Enquiry sent", para(`We've sent your enquiry to <b>${esc(c.profile.name)}</b>. They'll reply to you at ${esc(email)}.`) + `<blockquote style="margin:0 0 12px;padding:10px 14px;background:#E1F5EE;border-radius:8px;white-space:pre-wrap">${esc(message)}</blockquote>` + para("Before any work in school, carry out your own checks as <i>Keeping children safe in education</i> requires.")) });
  } catch (e) { console.error("Enquiry copy failed:", e.message); }
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(ENQ, JSON.stringify({ at: new Date().toISOString(), consultant: c.id, school: school.id }) + "\n", { mode: 0o600 });
  hooks && hooks.audit && hooks.audit("consultant.enquiry", `${school.name} → ${c.profile.name} (${c.id})`);
  return { ok: true };
}

/* ---------- superadmin ---------- */
function enquiryCounts() {
  const n = {};
  try { for (const l of fs.readFileSync(ENQ, "utf8").split("\n")) { if (!l) continue; try { const r = JSON.parse(l); n[r.consultant] = (n[r.consultant] || 0) + 1; } catch (e) {} } } catch (e) {}
  return n;
}
function adminList() {
  const counts = enquiryCounts();
  return {
    list: load().list.map(c => ({ ...c, state: stateOf(c), visible: visible(c), enquiries: counts[c.id] || 0, manageLink: manageLink(c.id) }))
      .sort((a, b) => ({ applied: 0, approved: 1 }[a.status] ?? 2) - ({ applied: 0, approved: 1 }[b.status] ?? 2) || a.profile.name.localeCompare(b.profile.name)),
    checks: CHECKS, expertise: EXPERTISE, fees: { listing: LISTING_FEE, annual: ANNUAL_FEE }, canInvoice: B.canInvoice(),
  };
}
/** Make (or reuse an unpaid) invoice of this kind, save it on the record first, then email it. Returns it, or null if invoices aren't set up. */
async function invoiceFor(c, kind) {
  if (!B.canInvoice()) return null;
  const cur = c.fees && c.fees[kind];
  const sameCycle = kind === "listing" || (cur && cur.cycle === c.checksDue);
  let inv;
  if (cur && cur.number && !cur.paidAt && sameCycle) inv = cur;
  else {
    const net = kind === "listing" ? LISTING_FEE : ANNUAL_FEE;
    const description = kind === "listing" ? "Evalu8 Compass consultant register: one-off listing fee" : `Evalu8 Compass consultant register: annual compliance check (${longDate(c.checksDue)})`;
    const made = B.makeOtherInvoice({ ref: c.id, kind: "consultant-" + kind, name: c.profile.name, description, net, billTo: { name: c.profile.name, address: c.contact.address || c.profile.town } });
    inv = { number: made.number, issuedAt: made.issuedAt, dueAt: made.dueAt, total: made.total, cycle: kind === "annual" ? c.checksDue : undefined };
    change(c.id, x => { x.fees[kind] = inv; });
  }
  await B.sendOtherInvoice(inv.number, c.contact.email);
  change(c.id, x => { if (x.fees[kind] && x.fees[kind].number === inv.number) x.fees[kind].sentAt = new Date().toISOString(); });
  return inv;
}
async function adminAction(id, act, b, hooks) {
  b = b || {};
  const c = find(id);
  if (!c) throw new ConsultantError(404, "No consultant with that id.");
  const date = d => { if (d == null || d === "") return today(); if (!validDate(d)) throw new ConsultantError(400, "Enter dates as YYYY-MM-DD."); if (d > today()) throw new ConsultantError(400, "A check can't be dated in the future."); return d; };
  switch (act) {
    case "check": {
      if (typeof b.check !== "string" || !Object.hasOwn(CHECK_LABEL, b.check)) throw new ConsultantError(400, "Unknown check.");
      const at = date(b.date), note = clip(b.note, 200);
      if (b.check === "insurance" && b.expires != null && (!validDate(b.expires) || b.expires <= today())) throw new ConsultantError(400, "Enter the insurance end date as YYYY-MM-DD, in the future.");
      const out = change(id, x => { x.checks[b.check] = { at, note }; if (b.check === "insurance" && b.expires) x.insurance.expires = b.expires; });
      return { ok: true, visible: visible(out) };
    }
    case "approve": {
      const missing = CHECKS.filter(([k]) => !checked(c, k)).map(([, l]) => l);
      if (missing.length) throw new ConsultantError(409, "Record every check first. Still to do: " + missing.join("; ") + ".");
      if (c.status !== "applied" && c.status !== "suspended") throw new ConsultantError(409, "Already approved.");
      if (c.status === "suspended" && c.approvedAt) {
        // Reinstating: back to where they were before the suspension
        change(id, x => { x.status = c.fees.listing && c.fees.listing.paidAt ? "live" : "approved"; delete x.suspended; });
        try { await mail.send({ to: c.contact.email, subject: "Your consultant listing has been reinstated", text: `Hello ${c.profile.name},\n\nYour listing has been reinstated${c.fees.listing && c.fees.listing.paidAt ? " and is visible to schools again" : ""}.\n\nManage your listing: ${manageLink(c.id)}\n\nEvalu8 Compass`, replyTo: mail.adminEmail() || undefined }); } catch (e) {}
        return { ok: true };
      }
      change(id, x => { x.status = "approved"; x.approvedAt = new Date().toISOString(); delete x.suspended; });
      let inv = null;
      try { inv = await invoiceFor(find(id), "listing"); } catch (e) { console.error("Listing invoice failed:", e.message); }
      try {
        await mail.send({ to: c.contact.email, subject: "Your consultant listing has been approved", text: `Hello ${c.profile.name},\n\nYour checks are complete and your listing has been approved.\n\n${inv ? `The invoice for the one-off £${LISTING_FEE} listing fee (${inv.number}) has been emailed to you.` : `We'll email the invoice for the one-off £${LISTING_FEE} listing fee shortly.`} Your listing goes live for schools as soon as it's paid.\n\nManage your listing: ${manageLink(c.id)}\n\nEvalu8 Compass`,
          html: B.wrap("Your listing is approved", para(`Hello ${esc(c.profile.name)},`) + para("Your checks are complete and your listing has been approved.") + para(`${inv ? `The invoice for the one-off £${LISTING_FEE} listing fee (${esc(inv.number)}) has been emailed to you.` : `We'll email the invoice for the one-off £${LISTING_FEE} listing fee shortly.`} Your listing goes live for schools as soon as it's paid.`) + B.btn(manageLink(c.id), "Manage your listing")) });
      } catch (e) { console.error("Approval email failed:", e.message); }
      return { ok: true, invoice: inv && inv.number };
    }
    case "send-invoice": {
      const kind = b.kind === "annual" ? "annual" : "listing";
      if (!B.canInvoice()) throw new ConsultantError(409, "Add OPERATOR_NAME and bank details to .env first.");
      if (kind === "listing" && !["approved", "live"].includes(c.status)) throw new ConsultantError(409, "Approve the consultant first.");
      if (kind === "listing" && c.fees.listing && c.fees.listing.paidAt) throw new ConsultantError(409, "The listing fee has already been paid.");
      if (kind === "annual" && (c.status !== "live" || !c.checksDue)) throw new ConsultantError(409, "The annual check only applies to live listings.");
      if (kind === "annual" && c.fees.annual && c.fees.annual.paidAt && c.fees.annual.cycle === c.checksDue) throw new ConsultantError(409, "This year's annual check fee has already been paid.");
      const inv = await invoiceFor(c, kind);
      return { ok: true, invoice: inv.number };
    }
    case "listing-paid": {
      if (c.status !== "approved" && c.status !== "live") throw new ConsultantError(409, "Approve the consultant first.");
      const paidAt = date(b.date);
      const out = change(id, x => { x.fees.listing = { ...(x.fees.listing || {}), paidAt }; if (x.status === "approved") { x.status = "live"; x.liveAt = new Date().toISOString(); x.checksDue = addYear(today()); } });
      try {
        await mail.send({ to: c.contact.email, subject: "Your consultant listing is live", text: `Hello ${c.profile.name},\n\nThank you for your payment. Your listing is now live, and schools signed in to Evalu8 Compass can find you and send you enquiries.\n\nYour annual compliance check (£${ANNUAL_FEE}) is due on ${longDate(out.checksDue)}. We'll remind you a month before.\n\nManage your listing: ${manageLink(c.id)}\n\nEvalu8 Compass`,
          html: B.wrap("Your listing is live", para(`Hello ${esc(c.profile.name)},`) + para("Thank you for your payment. Your listing is now live, and schools signed in to Evalu8 Compass can find you and send you enquiries.") + para(`Your annual compliance check (£${ANNUAL_FEE}) is due on ${esc(longDate(out.checksDue))}. We'll remind you a month before.`) + B.btn(manageLink(c.id), "Manage your listing")) });
      } catch (e) { console.error("Live email failed:", e.message); }
      return { ok: true, visible: visible(out) };
    }
    case "annual-done": {
      if (c.status !== "live" || !c.checksDue) throw new ConsultantError(409, "This listing isn't live.");
      if (c.checksDue > addDays(today(), 60)) throw new ConsultantError(409, `This year's check is already done. The next one is due ${longDate(c.checksDue)}.`);
      const recent = d => d && d >= addDays(today(), -60);
      if (!recent(c.checks.dbs && c.checks.dbs.at)) throw new ConsultantError(409, "Record this year's DBS Update Service check first (within the last 60 days).");
      if (!insuranceOk(c)) throw new ConsultantError(409, "Record the consultant's current insurance first.");
      const paidAt = date(b.date);
      const out = change(id, x => { x.fees.annual = { ...(x.fees.annual || {}), paidAt }; x.history = [...(x.history || []), { checksDue: x.checksDue, annual: x.fees.annual }].slice(-10); x.checksDue = addYear(x.checksDue); x.fees.annual = null; });
      return { ok: true, checksDue: out.checksDue, visible: visible(out) };
    }
    case "reject": case "suspend": {
      const reason = clip(b.reason, 500);
      if (reason.length < 5) throw new ConsultantError(400, "Give a short reason. It's included in the email to the consultant.");
      change(id, x => { if (act === "reject") { x.status = "rejected"; x.rejectedAt = new Date().toISOString(); } else { x.status = "suspended"; x.suspended = { at: new Date().toISOString(), reason }; } });
      try {
        await mail.send({ to: c.contact.email, subject: act === "reject" ? "Your consultant register application" : "Your consultant listing has been suspended",
          text: `Hello ${c.profile.name},\n\n${act === "reject" ? "Thank you for applying. We're unable to approve your listing." : "Your listing has been suspended and isn't visible to schools."}\n\n${reason}\n\nIf you have any questions, reply to this email.\n\nEvalu8 Compass`, replyTo: mail.adminEmail() || undefined });
      } catch (e) { console.error("Consultant email failed:", e.message); }
      return { ok: true };
    }
    case "approve-changes": case "reject-changes": {
      if (!c.pending) throw new ConsultantError(409, "No changes waiting.");
      change(id, x => { if (act === "approve-changes") { x.profile = x.pending.profile; x.geo = x.pending.geo || x.geo; } delete x.pending; });
      try { await mail.send({ to: c.contact.email, subject: act === "approve-changes" ? "Your listing changes are live" : "Your listing changes weren't published", text: `Hello ${c.profile.name},\n\n${act === "approve-changes" ? "Your changes have been checked and are now live." : "We weren't able to publish your latest changes. " + (clip(b.reason, 500) || "Reply to this email if you'd like to talk about it.")}\n\nEvalu8 Compass`, replyTo: mail.adminEmail() || undefined }); } catch (e) {}
      return { ok: true };
    }
    case "send-link": {
      // A new link: the old one stops working (for example if it was shared by mistake)
      const fresh = change(id, x => { x.linkV = (x.linkV || 0) + 1; });
      await sendManageLink(fresh); return { ok: true };
    }
    case "delete": { withdraw(c, hooks); return { ok: true }; }
  }
  throw new ConsultantError(404, "Not found");
}

/* ---------- reminders and tidying (run with the school reminders) ---------- */
async function reminders(hooks) {
  if (!mail.configured()) return 0;
  const t = today(); let sent = 0;
  for (const c0 of load().list) {
    const c = find(c0.id); if (!c || c.status !== "live") continue;
    const once = async (key, subject, paras, invoice) => {
      if (c.sent && c.sent[key]) return;
      change(c.id, x => { x.sent = { ...(x.sent || {}), [key]: new Date().toISOString() }; });
      try {
        let inv = null;
        if (invoice) inv = await invoiceFor(find(c.id), "annual");
        const lines = inv ? [...paras, `The invoice for £${ANNUAL_FEE} (${inv.number}) has been emailed separately.`] : paras;
        await mail.send({ to: c.contact.email, subject, replyTo: mail.adminEmail() || undefined, text: [`Hello ${c.profile.name},`, "", ...lines.flatMap(x => [x, ""]), `Manage your listing: ${manageLink(c.id)}`, "", "Evalu8 Compass"].join("\n"),
          html: B.wrap(subject, lines.map(x => para(esc(x))).join("") + B.btn(manageLink(c.id), "Manage your listing")) });
        sent++; hooks && hooks.audit && hooks.audit("consultant.reminder", `${c.profile.name} (${c.id}): ${key.split(":")[0]}`);
      } catch (e) { console.error("Consultant reminder failed:", e.message); change(c.id, x => { delete x.sent[key]; }); }
    };
    if (c.checksDue && t >= addDays(c.checksDue, -30) && t < c.checksDue)
      await once(`annual:${c.checksDue}`, "Your annual compliance check is due", [`Your Evalu8 Compass listing's annual compliance check is due on ${longDate(c.checksDue)}.`, "We'll check your DBS certificate's status on the Update Service again, with your consent. Please also send us your current insurance certificate by replying to this email."], true);
    if (c.checksDue && t >= c.checksDue && t < addDays(c.checksDue, ANNUAL_GRACE))
      await once(`annuallate:${c.checksDue}`, "Your annual compliance check is overdue", [`Your annual compliance check was due on ${longDate(c.checksDue)}. Your listing stays visible until ${longDate(addDays(c.checksDue, ANNUAL_GRACE - 1))}; after that it's hidden from schools until the check is complete.`]);
    if (c.checksDue && t >= addDays(c.checksDue, ANNUAL_GRACE))
      await once(`annualhidden:${c.checksDue}`, "Your listing is hidden from schools", ["Your annual compliance check hasn't been completed, so your listing is hidden from schools. Reply to this email to arrange it and we'll make it visible again."]);
    if (c.insurance && c.insurance.expires && t >= addDays(c.insurance.expires, -30) && t <= c.insurance.expires)
      await once(`ins:${c.insurance.expires}`, "Your insurance is due for renewal", [`Our records show your insurance ends on ${longDate(c.insurance.expires)}. Please reply with your renewed certificate so your listing stays visible to schools.`]);
    if (c.insurance && c.insurance.expires && t > c.insurance.expires)
      await once(`insgone:${c.insurance.expires}`, "Your listing is hidden: insurance", ["Your insurance on our records has ended, so your listing is hidden from schools. Reply with your renewed certificate and we'll make it visible again."]);
  }
  return sent;
}
/** Retention: rejected applications go after 6 months; hidden or suspended listings after 12 months. */
function cleanup(hooks) {
  const db = load(), before = db.list.length;
  const old = (iso, days) => iso && Date.parse(iso) < Date.now() - days * 864e5;
  db.list = db.list.filter(c => {
    if (c.status === "rejected" && old(c.rejectedAt, 183)) return false;
    if (c.status === "suspended" && old(c.suspended && c.suspended.at, 365)) return false;
    if (c.status === "live" && c.checksDue && old(c.checksDue + "T00:00:00Z", 365 + ANNUAL_GRACE)) return false;
    if (c.status === "applied" && old(c.createdAt, 365)) return false;
    if (c.status === "approved" && old(c.approvedAt, 365)) return false;   // approved but the fee was never paid
    return true;
  });
  // Enquiry records (date, school, consultant) are kept for two years
  try {
    const cutoffIso = new Date(Date.now() - 730 * 864e5).toISOString();
    const lines = fs.readFileSync(ENQ, "utf8").split("\n").filter(Boolean);
    const keep = lines.filter(l => { try { return JSON.parse(l).at >= cutoffIso; } catch (e) { return false; } });
    if (keep.length !== lines.length) fs.writeFileSync(ENQ, keep.join("\n") + (keep.length ? "\n" : ""), { mode: 0o600 });
  } catch (e) {}
  if (db.list.length !== before) { save(); hooks && hooks.audit && hooks.audit("data.retention_delete", `${before - db.list.length} consultant record(s) removed under the retention policy`); }
}

module.exports = {
  REGIONS, EXPERTISE, PHASES, TYPES, CHECKS, LISTING_FEE, ANNUAL_FEE, ConsultantError,
  apply, resendLink, byToken, forConsultant, update, withdraw, suggestFor, search, contact, adminList, adminAction, reminders, cleanup, visible, find, reload, manageLink,
  invoicePaid: num => { for (const c of load().list) for (const f of [c.fees.listing, c.fees.annual, ...((c.history || []).map(h => h.annual))]) if (f && f.number === num) return f.paidAt || null; return null; },
};
