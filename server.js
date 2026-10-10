/*
 * How Well Are We Doing? — server
 * ------------------------------------------------------------
 * Zero dependencies (Node 18+). Serves the app from /public and exposes:
 *
 *   GET  /api/health                → { ok, ai }
 *   POST /api/inspector             → single-user AI inspector (self-assessment page)
 *   /api/school...                  → each school's saved checklist, action plan and snapshots
 *   /api/w/...                      → staff workshops (see lib/workshop.js)
 *
 * The Anthropic API key stays on the server and is never sent to browsers.
 * Run:  node server.js   (settings in .env — see .env.example)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

loadEnv(path.join(__dirname, ".env"));
const prompts = require("./public/js/prompts.js");
const criteria = require("./public/js/criteria.js");
const ai = require("./lib/ai");
const workshop = require("./lib/workshop");
const store = require("./lib/store");
const access = require("./lib/access");
const admin = require("./lib/admin");
const schools = require("./lib/schools");
const usage = require("./lib/usage");
const evals = require("./lib/evals");
const billing = require("./lib/billing");
access.setAdminCheck(req => admin.who(req));

const PORT = Number(process.env.PORT || 3000);
const SCHOOL_RETENTION_DAYS = Number(process.env.SCHOOL_RETENTION_DAYS || 365); // saved work is deleted this long after a school's access ends
const HOST = process.env.HOST || "127.0.0.1"; // only reachable through your web server; use 0.0.0.0 to accept direct connections
const PUBLIC = path.join(__dirname, "public");
const LIMITS = {
  ai: Number(process.env.RATE_LIMIT_PER_MIN || 20),   // AI calls per IP per minute
  api: Number(process.env.API_LIMIT_PER_MIN || 600),  // other API calls per IP per minute
  login: 10,                                          // access-code attempts per IP per minute
  admin: 5,                                           // superadmin sign-in attempts per IP per minute
  signup: Number(process.env.SIGNUP_LIMIT_PER_MIN || 20), // sign-up and subscribe form posts per IP per minute (hourly limits in lib/billing.js)
};
// Pages that need a school access code (staff joining a workshop never do)
const PROTECTED_PAGES = new Set(["/checklist.html", "/report.html"]);
const AI_TASKS = ["item", "review", "action", "draft", "first"];
const hits = new Map();
// Browser security headers for every response. Scripts may only come from this site
// (no inline scripts, no third-party anything): fonts are served from this site too.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "font-src 'self'", "img-src 'self' data: blob:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
function securityHeaders(req, res) {
  res.setHeader("content-security-policy", CSP);
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  if (req.headers["x-forwarded-proto"] === "https") res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    securityHeaders(req, res);

    if (p === "/api/health") return json(res, 200, { ok: true, ai: ai.hasKey(), model: ai.hasKey() ? ai.model() : null });

    if (p.startsWith("/api/")) {
      const isAI = p === "/api/inspector" || /\/(report|themes|plan)$/.test(p);
      if (limited(req, isAI ? "ai" : "api")) return json(res, 429, { code: "rate_limited", error: "Too many requests. Wait a minute and try again." });
      if (p === "/api/access") return accessRoute(req, res);
      if (p === "/api/pricing" || p.startsWith("/api/signup") || p.startsWith("/api/subscribe")) return billingRoute(req, res, p);
      if (p === "/api/access/logout" && req.method === "POST") { access.logout(req, res); return json(res, 200, { ok: true }); }
      if (p === "/api/inspector" && req.method === "POST") {
        const w = access.who(req);
        if (!w) return json(res, 401, { code: "access_required", error: "Enter your school access code to use the AI inspector." });
        return inspector(req, res, w.open ? "open" : w.id);
      }
      if (p.startsWith("/api/admin")) return adminRoute(req, res, p);
      if (p === "/api/school" || p.startsWith("/api/school/")) return schoolRoute(req, res, p, url);
      if (p === "/api/w" && req.method === "POST") {
        req.hwwdWho = access.who(req);
        if (!req.hwwdWho) return json(res, 401, { code: "access_required", error: "Enter your school access code to start a workshop." });
      }
      if (p === "/api/w" || p.startsWith("/api/w/")) { req.hwwdIsAdmin = !!admin.who(req); return workshop.handle(req, res, url, readBody, json); }
      return json(res, 404, { error: "Not found" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
    // Friendly join links: /join/ABC123 → workshop page
    const inv = p.match(/^\/invoice\/(EC-\d{4}-\d{4,})$/);
    if (inv) return invoicePage(req, res, inv[1], url.searchParams.get("t") || "");
    if (/^\/join\/[A-Za-z0-9]{6}$/.test(p)) { res.writeHead(302, { location: "/workshop.html?code=" + p.slice(6).toUpperCase() }); return res.end(); }
    if (PROTECTED_PAGES.has(p) && !access.who(req)) {
      res.writeHead(302, { location: "/enter.html?next=" + encodeURIComponent(p + url.search) }); return res.end();
    }
    return serveStatic(p, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
  }
});
server.requestTimeout = 10 * 60 * 1000; // an AI quality check reading a full report can take a few minutes
server.listen(PORT, HOST, () => {
  console.log(`How Well Are We Doing? running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(ai.hasKey() ? `AI inspector on (${ai.model()})` : "AI inspector off: set ANTHROPIC_API_KEY in .env to turn it on");
});
// Retention: delete saved work for schools whose access ended over SCHOOL_RETENTION_DAYS ago
function retention() {
  const codes = access.list();
  const gone = schools.cleanup(id => {
    const c = codes.find(x => x.id === id);
    if (!c) return undefined;
    if (c.revoked) return c.revoked;
    if (c.expiresAt && Date.parse(c.expiresAt) < Date.now()) return c.expiresAt;
    return null;
  }, SCHOOL_RETENTION_DAYS);
  gone.forEach(id => admin.audit("data.retention_delete", `saved work for ${id} (access ended over ${SCHOOL_RETENTION_DAYS} days ago)`, null));
  const scrubbed = access.scrubEnded(SCHOOL_RETENTION_DAYS);
  if (scrubbed) admin.audit("data.retention_delete", `contact details removed from ${scrubbed} ended code${scrubbed === 1 ? "" : "s"}`, null);
  admin.trimAudit(730);
}
setTimeout(retention, 5000).unref();
setInterval(retention, 24 * 3600e3).unref();
// Free-term, renewal and payment reminder emails (each is sent once)
function reminders() { billing.reminders({ audit: (a, d) => admin.audit(a, d, null) }).catch(e => console.error("Reminders:", e.message)); }
setTimeout(reminders, 60e3).unref();
setInterval(reminders, 3 * 3600e3).unref();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { store.flushAll(); usage.flush(); process.exit(0); });

/* Single-user AI inspector used by the self-assessment page */
async function inspector(req, res, account) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Invalid JSON body" }); }
  const { task, data } = body || {};
  if (!data || !data.ctx || !AI_TASKS.includes(task)) return json(res, 400, { error: "Expected { task: " + AI_TASKS.join("|") + ", data }" });
  const build = { item: prompts.itemPrompt, review: prompts.reviewPrompt, action: prompts.actionPrompt, draft: prompts.draftPrompt, first: prompts.firstPrompt }[task];
  try {
    const result = await ai.askJson({
      system: prompts.SYSTEM,
      content: build(data),
      maxTokens: { item: 1500, review: 3000, action: 1200, draft: 4000, first: 5000 }[task],
      account,
    });
    return json(res, 200, { result, allowance: usage.status(account) });
  } catch (e) {
    return json(res, e.status || 502, { code: e.code || "upstream_error", error: e.message });
  }
}

/* School access: GET → status, POST {code} → sign in */
async function accessRoute(req, res) {
  if (req.method === "GET") {
    const w = access.who(req);
    const entry = w && w.id && !w.admin ? access.list().find(c => c.id === w.id) : null;
    return json(res, 200, { required: access.required(), ok: !!w, school: w && w.name && !w.admin ? w.name : "", ai: w && ai.hasKey() ? usage.status(w.open ? "open" : w.id) : null, plan: billing.forSchool(entry) });
  }
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (limited(req, "login")) return json(res, 429, { code: "rate_limited", error: "Too many attempts. Wait a minute and try again." });
  let body;
  try { body = JSON.parse(await readBody(req, 4096)); } catch { return json(res, 400, { error: "Invalid request" }); }
  const c = access.login(req, res, body && body.code);
  if (!c) {
    // A known code whose free term or subscription has ended: explain, and point to subscribing
    const known = access.lookup(body && body.code);
    if (known && !known.revoked && known.tier && known.tier !== "trust") {
      const st = billing.status(known);
      if (["trial_ended", "lapsed", "cancelled"].includes(st.key)) return json(res, 403, { code: "paused", subscribe: true, error: `${known.name}'s ${st.key === "trial_ended" ? "free term has ended" : "subscription has ended"}, so this code is paused. Your saved work is kept: subscribe and the code works again straight away.` });
    }
    if (known && !known.revoked) return json(res, 403, { code: "expired", error: "This access code has expired. Email support@evalu8compass.app to renew it." });
    return json(res, 401, { code: "bad_code", error: "That access code isn't recognised. Check it and try again." });
  }
  return json(res, 200, { ok: true, school: c.name });
}

/* Each school's saved self-evaluation (see lib/schools.js) */
async function schoolRoute(req, res, p, url) {
  const w = access.who(req);
  if (!w) return json(res, 401, { code: "access_required", error: "Your sign-in has ended. Enter your school access code again." });
  const id = w.open ? "open" : w.id;
  if (req.method !== "GET" && !sameSite(req)) return json(res, 403, { error: "Cross-site request refused." });
  const body = async () => JSON.parse((await readBody(req, schools.MAX_BYTES + 64 * 1024)) || "{}");
  try {
    if (p === "/api/school" && req.method === "GET") {
      const cur = schools.get(id);
      // Quick check used for polling: ?rev=N answers {same:true} when nothing has changed
      if (url.searchParams.has("rev") && Number(url.searchParams.get("rev")) === cur.rev) return json(res, 200, { rev: cur.rev, same: true });
      return json(res, 200, { ...cur, owner: id, school: w.admin ? "" : w.name || "" });
    }
    if (p === "/api/school" && req.method === "PATCH") {
      const b = await body();
      return json(res, 200, schools.patch(id, b.baseRev, b.patch));
    }
    if (p === "/api/school" && req.method === "PUT") {
      const b = await body();
      if (!b.state || typeof b.state !== "object") return json(res, 400, { error: "Nothing to save" });
      return json(res, 200, schools.replace(id, b.state));
    }
    // Read the school's latest Ofsted report with the AI and save the reading with the school's work
    if (p === "/api/school/ofsted" && req.method === "POST") {
      if (!ai.hasKey()) return json(res, 503, { error: "Reading a report needs the AI, which isn't connected on this server." });
      let b;
      try { b = JSON.parse((await readBody(req, 36 * 1024 * 1024)) || "{}"); } catch (e) { return json(res, 400, { error: "Couldn't read that file. PDFs up to 25 MB." }); }
      const hasPdf = typeof b.pdf === "string" && b.pdf.length > 100;
      if (!hasPdf && !(typeof b.text === "string" && b.text.trim().length > 200)) return json(res, 400, { error: "Choose the report PDF or paste its full text." });
      const cur = schools.get(id);
      const profile = (cur.state && cur.state.profile && cur.state.profile.phases && cur.state.profile.phases.length) ? cur.state.profile : b.profile;
      if (!profile || !Array.isArray(profile.phases) || !profile.phases.length) return json(res, 400, { error: "Set your school type and phases first, so the report can be matched to your checklist." });
      const text = prompts.reportPrompt({ ctx: profile, areas: criteria.resolve(profile), hasPdf, text: b.text });
      const content = hasPdf ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b.pdf.replace(/^data:[^,]+,/, "") } }, { type: "text", text }] : text;
      const reading = await ai.askJson({ system: prompts.SYSTEM, content, maxTokens: 8000, account: id });
      const rec = { reading, filename: String(b.filename || "").slice(0, 200), at: new Date().toISOString() };
      const r = schools.patch(id, cur.rev, { set: { ofsted: rec } });
      return json(res, 200, { ofsted: rec, rev: r.rev });
    }
    if (p === "/api/school/snapshots" && req.method === "GET") return json(res, 200, { snapshots: schools.snapshots(id) });
    if (p === "/api/school/snapshots" && req.method === "POST") {
      const b = await body();
      return json(res, 201, schools.addSnapshot(id, b.name));
    }
    const m = p.match(/^\/api\/school\/snapshots\/([a-f0-9]{8})$/);
    if (m && req.method === "GET") { const s = schools.snapshot(id, m[1]); return s ? json(res, 200, s) : json(res, 404, { error: "That snapshot no longer exists." }); }
    if (m && req.method === "DELETE") return schools.deleteSnapshot(id, m[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "That snapshot no longer exists." });
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e instanceof schools.SchoolError) return json(res, e.status, { error: e.message });
    if (e instanceof ai.AIError) return json(res, e.status, { error: e.message, code: e.code });
    if (e instanceof SyntaxError) return json(res, 400, { error: "Invalid request" });
    if (e && e.message === "too large") return json(res, 413, { error: "This self-evaluation is too large to save." });
    throw e;
  }
}
function sameSite(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

/* Pricing, sign-up and subscribing (see lib/billing.js) */
function clientIp(req) { return (process.env.TRUST_PROXY === "1" && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?"; }
const billingHooks = req => ({
  audit: (a, d) => admin.audit(a, d, req),
  // Start the school's checklist with its name and type, so leaders don't type them twice
  prefill: (id, profile) => { try { if (!schools.get(id).state) schools.replace(id, { profile }); } catch (e) {} },
});
async function billingRoute(req, res, p) {
  if (p === "/api/pricing" && req.method === "GET") return json(res, 200, billing.pricing());
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (!sameSite(req)) return json(res, 403, { error: "Cross-site request refused." });
  if (limited(req, "signup")) return json(res, 429, { error: "Too many attempts. Wait a minute and try again." });
  let b;
  try { b = JSON.parse((await readBody(req, 16384)) || "{}"); } catch (e) { return json(res, 400, { error: "Invalid request" }); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return json(res, 400, { error: "Invalid request" });
  try {
    if (p === "/api/signup") return json(res, 200, await billing.signup(b, clientIp(req), billingHooks(req)));
    if (p === "/api/signup/resend") return json(res, 200, await billing.resend(b.email, clientIp(req), billingHooks(req)));
    if (p === "/api/subscribe/quote") {
      if (limited(req, "login")) return json(res, 429, { error: "Too many attempts. Wait a minute and try again." });
      const q = billing.quote(b.code);
      return q ? json(res, 200, q) : json(res, 404, { error: "That access code isn't recognised. It's in the email you got when you signed up." });
    }
    if (p === "/api/subscribe") return json(res, 200, await billing.subscribe(b, clientIp(req), billingHooks(req)));
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e instanceof billing.BillingError) return json(res, e.status, { error: e.message });
    console.error(e);
    return json(res, 500, { error: "Something went wrong. Try again, or email support@evalu8compass.app." });
  }
}
/* An invoice as a printable page: the link in the invoice email carries a signature */
function invoicePage(req, res, num, t) {
  const expect = billing.invoiceToken(num);
  const a = Buffer.from(t), e = Buffer.from(expect);
  const okSig = a.length === e.length && require("crypto").timingSafeEqual(a, e);
  const r = okSig || admin.who(req) ? billing.findInvoice(num) : null;
  if (!r) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("Invoice not found."); }
  const c = access.list().find(x => x.id === r.codeId);
  const sub = c ? [c.sub, ...(c.history || [])].find(x => x && x.invoice && x.invoice.number === num) : null;
  const paidAt = sub ? sub.paidAt : null;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
  res.end(billing.invoiceHtml(r, paidAt));
}

/* Superadmin console API (see lib/admin.js) */
async function adminRoute(req, res, p) {
  const body = async () => { try { return JSON.parse((await readBody(req, 8192)) || "{}"); } catch { return null; } };
  // Same-site requests only for anything that changes state
  if (req.method === "POST" && !sameSite(req)) return json(res, 403, { error: "Cross-site request refused." });
  if (p === "/api/admin/me") return json(res, 200, { configured: admin.configured(), signedIn: !!admin.who(req) });
  if (p === "/api/admin/login" && req.method === "POST") {
    if (limited(req, "admin")) return json(res, 429, { error: "Too many attempts. Wait a minute and try again." });
    const b = await body();
    if (!admin.configured()) return json(res, 409, { error: "The superadmin isn't set up yet. On the server run: hwwd-access admin" });
    if (!b || !admin.login(req, res, b.password || "", b.code || "")) return json(res, 401, { error: "That password or authenticator code isn't right." });
    return json(res, 200, { ok: true });
  }
  if (p === "/api/admin/logout" && req.method === "POST") { admin.logout(req, res); return json(res, 200, { ok: true }); }
  if (!admin.who(req)) return json(res, 401, { error: "Sign in as superadmin." });

  if (p === "/api/admin/overview" && req.method === "GET") {
    const ws = store.summaries(), saved = schools.summaries(), use = usage.overview(), now = Date.now();
    const codes = access.list().map(c => {
      const mine = ws.filter(w => w.createdBy === c.id);
      const state = c.revoked ? "revoked" : c.expiresAt && Date.parse(c.expiresAt) < now ? "expired" : "active";
      return { ...c, state, workshops: mine.length, participants: mine.reduce((t, w) => t + w.participants, 0), lastWorkshop: mine.map(w => w.updatedAt).sort().pop() || null, saved: saved[c.id] || null, ai: use.perSchool(c.id) };
    });
    const recent = ws.filter(w => now - Date.parse(w.createdAt) < 30 * 864e5);
    return json(res, 200, {
      codes, audit: admin.recentAudit(40),
      stats: {
        activeCodes: codes.filter(c => c.state === "active").length,
        schoolsSignedIn30: codes.filter(c => c.lastUsedAt && now - Date.parse(c.lastUsedAt) < 30 * 864e5).length,
        workshops: ws.length, workshops30: recent.length, schoolsSaving: Object.keys(saved).filter(k => k !== "admin" && k !== "open").length, participants: ws.reduce((t, w) => t + w.participants, 0),
      },
      ai: { month: use.month, resetsOn: use.resetsOn, defaultLimit: use.defaultLimit, total: use.total, lastMonth: use.lastMonth, currency: use.currency },
      system: { ai: ai.hasKey(), model: ai.hasKey() ? ai.model() : null, accessRequired: access.required(), node: process.version, uptimeHours: Math.round(process.uptime() / 360) / 10 },
    });
  }
  if (p === "/api/admin/codes" && req.method === "POST") {
    const b = await body();
    const name = b && String(b.name || "").trim();
    if (!name) return json(res, 400, { error: "Enter the school's name." });
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return json(res, 400, { error: "That email address doesn't look right." });
    const days = Math.max(0, Math.min(3650, Number(b.days) || 0));
    const c = access.add(name, days, { email: b.email, notes: b.notes });
    admin.audit("code.create", `${c.name} (${c.id})${days ? `, expires in ${days} days` : ""}`, req);
    return json(res, 201, { code: c.code, id: c.id, name: c.name, expiresAt: c.expiresAt || null });
  }
  const er = p.match(/^\/api\/admin\/codes\/([a-f0-9]{8})\/erase$/);
  if (er && req.method === "POST") {
    const c = access.list().find(x => x.id === er[1]);
    if (!c) return json(res, 404, { error: "No code with that id." });
    const had = schools.erase(c.id), ws = store.removeByCreator(c.id);
    admin.audit("data.erase", `${c.name} (${c.id}): ${had ? "saved work and snapshots" : "no saved work"}, ${ws} workshop${ws === 1 ? "" : "s"}`, req);
    return json(res, 200, { ok: true, erased: had, workshops: ws });
  }
  if (p.startsWith("/api/admin/evals")) return evalRoute(req, res, p);
  if (p === "/api/admin/billing" && req.method === "GET") return json(res, 200, billing.overview());
  const bl = p.match(/^\/api\/admin\/codes\/([a-f0-9]{8})\/billing\/(send-invoice|mark-paid|mark-unpaid|cancel|set-trial)$/);
  if (bl && req.method === "POST") {
    const b = (await body()) || {};
    try {
      const r = await billing.adminAction(bl[1], bl[2], b);
      const c = access.list().find(x => x.id === bl[1]);
      admin.audit(`billing.${bl[2]}`, `${c ? c.name : bl[1]} (${bl[1]})${r.invoice ? ", invoice " + r.invoice : ""}${b.date ? ", " + b.date : ""}`, req);
      return json(res, 200, r);
    } catch (e) {
      if (e instanceof billing.BillingError) return json(res, e.status, { error: e.message });
      return json(res, 502, { error: e.message });
    }
  }
  const al = p.match(/^\/api\/admin\/codes\/([a-f0-9]{8})\/allowance$/);
  if (al && req.method === "POST") {
    const c = access.list().find(x => x.id === al[1]);
    if (!c) return json(res, 404, { error: "No code with that id." });
    const b = (await body()) || {};
    try {
      const st = usage.setLimit(c.id, b.limit);
      admin.audit("ai.allowance", `${c.name} (${c.id}): ${st.limit === null ? "unlimited" : st.limit === 0 ? "AI off" : st.limit + " requests a month"}${st.custom ? "" : " (default)"}`, req);
      return json(res, 200, st);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  const m = p.match(/^\/api\/admin\/codes\/([a-f0-9]{8})\/(revoke|reactivate|extend)$/);
  if (m && req.method === "POST") {
    const [, id, act] = m;
    const b = (await body()) || {};
    const exists = access.list().find(c => c.id === id);
    if (!exists) return json(res, 404, { error: "No code with that id." });
    if (act === "revoke") access.revoke(id);
    if (act === "reactivate") access.reactivate(id);
    if (act === "extend") access.extend(id, Math.max(0, Math.min(3650, Number(b.days) || 0)));
    admin.audit(`code.${act}`, `${exists.name} (${id})${act === "extend" ? (Number(b.days) ? `, +${Number(b.days)} days` : ", no expiry") : ""}`, req);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "Not found" });
}

/* Policy pages: details that differ per installation come from .env (see .env.example) */
const POLICY_PAGES = new Set(["privacy.html", "terms.html", "dpia.html", "accessibility.html"]);
const POLICY_DATE = "10 October 2026";
function policyValues() {
  const e = k => String(process.env[k] || "").trim();
  const h = v => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const name = e("OPERATOR_NAME"), addr = e("OPERATOR_ADDRESS"), ico = e("ICO_REGISTRATION"), region = e("HOSTING_REGION"), backup = e("BACKUP_PROVIDER"), mail = e("EMAIL_PROVIDER");
  return {
    OPERATOR: h(name || "Evalu8 Compass"),
    OPERATOR_LINE: h(name ? `Evalu8 Compass is provided by ${name}${addr ? ", " + addr : ""}.` : "Evalu8 Compass is an independent service for schools.") +
      (ico ? h(` We are registered with the Information Commissioner's Office (registration number ${ico}).`) : ""),
    HOSTING: h(region ? `a Hostinger data centre in ${region}` : "a data centre run by our hosting provider, Hostinger"),
    BACKUP: h(backup ? `separate off-site storage provided by ${backup}` : "separate off-site storage"),
    BACKUP_PROVIDER: h(backup || "Our off-site backup storage provider"),
    EMAIL_HOST: h(!mail ? " and sends our emails (access codes, invoices and reminders)" : /hostinger/i.test(mail) ? " and our email, which sends access codes, invoices and reminders" : ` (our email, including access codes, invoices and reminders, is provided by ${mail})`),
    VAT_LINE: h(billing.pricing().vat),
    RETENTION_DAYS: String(SCHOOL_RETENTION_DAYS),
    UPDATED: h(e("POLICY_UPDATED") || POLICY_DATE),
  };
}

/* AI quality check (superadmin only; see lib/evals.js) */
async function evalRoute(req, res, p) {
  try {
    if (p === "/api/admin/evals" && req.method === "GET") {
      return json(res, 200, { reference: evals.REFERENCE, runs: evals.summaries(), promptVersion: evals.PROMPT_VERSION, ai: ai.hasKey(), model: ai.hasKey() ? ai.model() : null });
    }
    if (p === "/api/admin/evals/run" && req.method === "POST") {
      if (!ai.hasKey()) return json(res, 503, { error: "The AI isn't connected on this server, so there's nothing to test yet." });
      let b;
      try { b = JSON.parse(await readBody(req, 36 * 1024 * 1024) || "{}"); } catch (e) { return json(res, 400, { error: "Couldn't read that request (PDFs up to 25 MB)." }); }
      const rec = await evals.run({ refId: b.refId, url: b.url, pdf: b.pdf, profile: b.profile, expected: b.expected }, ai);
      admin.audit("ai.eval", `${rec.report.school}${rec.score ? `: ${rec.score.pct}% of checks passed` : ""}`, req);
      return json(res, 200, rec);
    }
    const m = p.match(/^\/api\/admin\/evals\/([a-f0-9]{8})(\/review)?$/);
    if (m && req.method === "GET" && !m[2]) { const r = evals.get(m[1]); return r ? json(res, 200, r) : json(res, 404, { error: "Not found." }); }
    if (m && req.method === "POST" && m[2]) {
      let b; try { b = JSON.parse(await readBody(req, 16384) || "{}"); } catch (e) { return json(res, 400, { error: "Invalid request" }); }
      const r = evals.review(m[1], b); return r ? json(res, 200, r) : json(res, 404, { error: "Not found." });
    }
    if (m && req.method === "DELETE" && !m[2]) return evals.remove(m[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "Not found." });
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    if (e instanceof ai.AIError) return json(res, e.status, { error: e.message, code: e.code, detail: e.detail || null });
    if (e.status) return json(res, e.status, { error: e.message });
    console.error(e);
    return json(res, 500, { error: "The check couldn't be completed: " + e.message });
  }
}

/* ---------- helpers ---------- */
function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname); } catch { return json(res, 400, { error: "Bad path" }); }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    if (POLICY_PAGES.has(path.basename(file))) {
      const v = policyValues();
      buf = Buffer.from(buf.toString("utf8").replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in v ? v[k] : m)));
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "cache-control": path.extname(file) === ".html" ? "no-cache" : path.extname(file) === ".woff2" ? "public, max-age=2592000, immutable" : "public, max-age=300",
    });
    res.end(buf);
  });
}

function readBody(req, max = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, over = false; const chunks = [];
    // Past the limit, keep reading but discard, so the browser gets a clear "too large" answer
    req.on("data", c => { size += c.length; if (size > max) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); if (size > 30 * 1024 * 1024) req.destroy(); });
    req.on("end", () => over ? reject(new Error("too large")) : resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function limited(req, bucket) {
  const ip = (process.env.TRUST_PROXY === "1" && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
  const k = bucket + ":" + ip, now = Date.now();
  const list = (hits.get(k) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(k, list);
  return list.length > LIMITS[bucket];
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 60000)) hits.delete(k); }, 60000).unref();

function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
}
