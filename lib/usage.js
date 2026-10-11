/*
 * AI allowance and usage, per school, per calendar month (UK time)
 * ------------------------------------------------------------
 * Every AI request is counted against the school that made it (its access code
 * id; workshops count against the school that started them). Each school gets
 * AI_MONTHLY_REQUESTS a month (default 200), which the superadmin can change
 * per school: a number, 0 to switch AI off for that school, or unlimited.
 * Token counts are kept too, so the admin console can show what AI is costing.
 *
 * Schools can also buy extra requests (credits) when they run low. Credits are
 * used only once the month's allowance has run out, and don't expire at the
 * end of the month.
 *
 * data/usage.json  { months: { "2026-10": { <id>: { requests, input, output } } },
 *                    limits: { <id>: number | "unlimited" }, credits: { <id>: number } }
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "usage.json");
const KEEP_MONTHS = 13;
const UNLIMITED_IDS = new Set(["admin"]);
let db = null, timer = null, dirty = false;

function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { db = {}; }
  db.months = db.months || {}; db.limits = db.limits || {}; db.credits = db.credits || {};
  return db;
}
function save(now) {
  clearTimeout(timer); dirty = true;
  const write = () => {
    dirty = false;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
      fs.renameSync(tmp, FILE);
    } catch (e) { console.error("Couldn't save AI usage", e.message); }
  };
  if (now) write(); else timer = setTimeout(write, 500);
}
function flush() { if (db && dirty) save(true); }

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" });
function monthKey(d) { const p = Object.fromEntries(fmt.formatToParts(d || new Date()).map(x => [x.type, x.value])); return `${p.year}-${p.month}`; }
function prevMonthKey() { const [y, m] = monthKey().split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; }
function resetsOn() {
  const [y, m] = monthKey().split("-").map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10);
}

function defaultLimit() {
  const v = String(process.env.AI_MONTHLY_REQUESTS || "").trim().toLowerCase();
  if (v === "unlimited") return Infinity;
  const n = Number(v);
  return v !== "" && Number.isFinite(n) && n >= 0 ? n : 200;
}
/** The school's monthly allowance: a number (0 = AI off) or Infinity. */
function limitFor(id) {
  if (UNLIMITED_IDS.has(id)) return Infinity;
  const l = load().limits[id];
  if (l === "unlimited") return Infinity;
  return typeof l === "number" ? l : defaultLimit();
}
function row(id, key) { const m = load().months[key || monthKey()] || {}; return m[id] || { requests: 0, input: 0, output: 0 }; }

const creditsOf = id => Math.max(0, Number(load().credits[id]) || 0);
/** Status for a school: { used, limit (null = unlimited), left (this month's allowance), credits (bought, don't expire), resetsOn, custom } */
function status(id) {
  const r = row(id), limit = limitFor(id);
  const fromAllowance = r.requests - (r.fromCredits || 0);
  return { used: r.requests, limit: limit === Infinity ? null : limit, left: limit === Infinity ? null : Math.max(0, limit - fromAllowance), credits: limit === 0 ? 0 : creditsOf(id), resetsOn: resetsOn(), custom: id in load().limits };
}

/** Reserve one request before calling the AI. Returns a ticket, or null if the allowance is used up. */
function reserve(id) {
  const key = monthKey(), d = load(), limit = limitFor(id);
  const cur = row(id, key), fromAllowance = cur.requests - (cur.fromCredits || 0);
  let credit = false;
  if (fromAllowance >= limit) {
    if (limit === 0 || creditsOf(id) < 1) return null;   // AI switched off, or nothing left at all
    d.credits[id] = creditsOf(id) - 1; credit = true;
  }
  const m = (d.months[key] = d.months[key] || {});
  const r = (m[id] = m[id] || { requests: 0, input: 0, output: 0 });
  r.requests++;
  if (credit) r.fromCredits = (r.fromCredits || 0) + 1;
  save();
  return { id, key, credit };
}
/** After the call: record tokens used, or hand the request back if the AI was never reached. */
function settle(ticket, usage) {
  if (!ticket) return;
  const r = (load().months[ticket.key] || {})[ticket.id];
  if (!r) return;
  if (!usage) {
    r.requests = Math.max(0, r.requests - 1);
    if (ticket.credit) { r.fromCredits = Math.max(0, (r.fromCredits || 0) - 1); load().credits[ticket.id] = creditsOf(ticket.id) + 1; }
    save(); return;
  }
  r.input += Number(usage.input_tokens || 0) + Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
  r.output += Number(usage.output_tokens || 0);
  save();
}

/** Superadmin: set a school's allowance (number ≥ 0, "unlimited", or null for the default). */
function setLimit(id, value) {
  const d = load();
  if (value === null || value === "" || value === undefined) delete d.limits[id];
  else if (String(value).toLowerCase() === "unlimited") d.limits[id] = "unlimited";
  else { const n = Math.floor(Number(value)); if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error("Enter a number of AI requests, 0 to switch AI off, or unlimited."); d.limits[id] = n; }
  save(true);
  return status(id);
}

/** Superadmin: add (or with a negative number, remove) bought AI requests. Returns the new status. */
function addCredits(id, n) {
  n = Math.trunc(Number(n));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100000) throw new Error("Enter a whole number of AI requests to add.");
  const d = load(); d.credits[id] = Math.max(0, creditsOf(id) + n);
  if (!d.credits[id]) delete d.credits[id];
  save(true);
  return status(id);
}

/** Forget a deleted school's AI allowance setting. Its past monthly counts stay in the totals but name no one. */
function forget(id) { const d = load(); if (id in d.limits || id in d.credits) { delete d.limits[id]; delete d.credits[id]; save(true); } }

/** Everything the admin console needs: this month and last month, per school and in total. */
function overview() {
  const d = load(), cur = monthKey(), prev = prevMonthKey();
  // Tidy old months
  Object.keys(d.months).sort().slice(0, -KEEP_MONTHS).forEach(k => delete d.months[k]);
  const sum = key => Object.values(d.months[key] || {}).reduce((t, r) => ({ requests: t.requests + r.requests, input: t.input + r.input, output: t.output + r.output }), { requests: 0, input: 0, output: 0 });
  const priceIn = Number(process.env.AI_PRICE_INPUT_PER_MTOK || 0), priceOut = Number(process.env.AI_PRICE_OUTPUT_PER_MTOK || 0);
  const cost = t => priceIn || priceOut ? Math.round((t.input / 1e6 * priceIn + t.output / 1e6 * priceOut) * 100) / 100 : null;
  const tc = sum(cur), tp = sum(prev);
  return {
    month: cur, resetsOn: resetsOn(), defaultLimit: defaultLimit() === Infinity ? null : defaultLimit(),
    total: { ...tc, cost: cost(tc) }, lastMonth: { ...tp, cost: cost(tp) }, currency: process.env.AI_PRICE_CURRENCY || "$",
    perSchool: id => ({ ...status(id), input: row(id).input, output: row(id).output, cost: cost(row(id)), lastMonth: row(id, prev).requests }),
  };
}

module.exports = { reserve, settle, status, setLimit, addCredits, overview, limitFor, flush, monthKey, forget };
