/*
 * Staff workshop API
 * ------------------------------------------------------------
 * Facilitator:  creates a session, gets a 6-character join code and a secret
 *               facilitator key (needed for every control action).
 * Staff:        join with the code and a role only — no names, no accounts.
 *               Each device gets a participant id + token so only it can
 *               change its own answers.
 * Live updates: Server-Sent Events. Facilitators always get collated results;
 *               staff get them only when the facilitator shares them.
 */
const store = require("./store");
const { aggregate, itemsFor, ROLES } = require("./aggregate");
const ai = require("./ai");
const C = require("../public/js/criteria.js");
const prompts = require("../public/js/prompts.js");

const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS || 300);
const STATUSES = ["met", "part", "no", "na"];
const clients = new Map();   // code -> Set<{ res, kind }>
const pending = new Map();   // code -> debounce timer

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const need = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };

function load(code) {
  const s = store.get(code);
  need(s, 404, "No workshop with that code. Check the code and try again.");
  return s;
}
function isFacilitator(s, key) { return !!key && store.safeEqual(key, s.facilitatorKey); }
function requireFacilitator(s, key) { need(isFacilitator(s, key), 403, "Only the facilitator can do that."); }
function requireParticipant(s, pid, tok) {
  const p = s.participants[pid];
  need(p && tok && store.safeEqual(store.hash(tok), p.tokenHash), 403, "Your place in this workshop has expired. Rejoin with the code.");
  return p;
}
function cleanProfile(p) {
  p = p || {};
  const type = C.SCHOOL_TYPES.some(t => t.id === p.type) ? p.type : "maintained";
  const phases = (Array.isArray(p.phases) ? p.phases : []).filter(x => C.PHASES.some(ph => ph.id === x));
  need(phases.length, 400, "Choose at least one phase.");
  const logo = typeof p.logo === "string" && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(p.logo) && p.logo.length < 290000 ? p.logo : "";
  return { name: String(p.name || "").slice(0, 120), type, phases, special: !!p.special, logo };
}
function publicInfo(s) {
  return {
    code: s.code, status: s.status, share: s.share,
    profile: { name: s.profile.name, type: s.profile.type, phases: s.profile.phases, special: s.profile.special, logo: s.profile.logo || "" },
    areas: itemsFor(s).map(a => ({ id: a.id, icon: a.icon, name: a.name, sub: a.sub, items: a.items })),
    participants: Object.keys(s.participants).length,
  };
}
function staffPlan(plan) {
  if (!plan) return null;
  return { summary: plan.summary, staffMessage: plan.staffMessage, quickWins: plan.quickWins,
    priorities: (plan.priorities || []).map(p => ({ title: p.title, area: p.area, why: p.why, actions: (p.actions || []).map(a => ({ action: a.action, by: a.by })) })) };
}

/* ---------- live updates (SSE) ---------- */
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

function broadcast(code, now = false) {
  clearTimeout(pending.get(code));
  const run = () => {
    const set = clients.get(code); if (!set || !set.size) return;
    const s = store.get(code); if (!s) return;
    const results = aggregate(s);
    const state = { status: s.status, share: s.share, participants: results.participants, completion: results.completion };
    for (const c of set) {
      try {
        send(c.res, "state", state);
        if (c.kind === "fac" || s.share.results) send(c.res, "results", results);
        if (c.kind === "fac") send(c.res, "ai", { report: s.report, themes: s.themes, plan: s.plan, context: s.context });
        else send(c.res, "plan", s.share.plan ? staffPlan(s.plan) : null);
      } catch (e) {}
    }
  };
  if (now) return run();
  pending.set(code, setTimeout(run, 300));
}

function events(req, res, s, q) {
  const fac = isFacilitator(s, q.get("key"));
  if (!fac) requireParticipant(s, q.get("pid"), q.get("token"));
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write("retry: 3000\n\n");
  const client = { res, kind: fac ? "fac" : "staff" };
  if (!clients.has(s.code)) clients.set(s.code, new Set());
  clients.get(s.code).add(client);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); clients.get(s.code)?.delete(client); });
  broadcast(s.code, true);
}

/* ---------- routes ---------- */
async function handle(req, res, url, readBody, json) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","w",code?,action?]
  const [code, action] = [parts[2], parts[3]];
  const q = url.searchParams;
  const body = async () => { try { return JSON.parse((await readBody(req, action === "report" ? 25 * 1024 * 1024 : !code ? 400 * 1024 : 200 * 1024)) || "{}"); } catch (e) { throw new HttpError(400, "Couldn't read that request."); } };

  try {
    // Create a workshop
    if (!code && req.method === "POST") {
      const b = await body();
      const profile = cleanProfile(b.profile);
      const valid = C.resolve(profile).map(a => a.id);
      const areaIds = (Array.isArray(b.areaIds) ? b.areaIds : valid).filter(id => valid.includes(id));
      need(areaIds.length, 400, "Choose at least one area for the workshop.");
      const s = store.create({ profile, areaIds });
      return json(res, 201, { code: s.code, key: s.facilitatorKey });
    }

    const s = load(code);

    if (!action && req.method === "GET") return json(res, 200, publicInfo(s));

    if (action === "events" && req.method === "GET") return events(req, res, s, q);

    if (action === "join" && req.method === "POST") {
      const b = await body();
      need(s.status === "open", 409, "This workshop has closed to new responses.");
      need(ROLES[b.role], 400, "Choose your role.");
      need(Object.keys(s.participants).length < MAX_PARTICIPANTS, 409, "This workshop is full.");
      const pid = store.token(8), tok = store.token(16);
      s.participants[pid] = { role: b.role, joinedAt: new Date().toISOString(), tokenHash: store.hash(tok) };
      s.responses[pid] = {};
      store.save(s); broadcast(s.code);
      return json(res, 201, { pid, token: tok });
    }

    if (action === "mine" && req.method === "GET") {
      const p = requireParticipant(s, q.get("pid"), q.get("token"));
      return json(res, 200, { role: p.role, responses: s.responses[q.get("pid")] || {} });
    }

    if (action === "answer" && req.method === "PUT") {
      const b = await body();
      requireParticipant(s, b.pid, b.token);
      need(s.status === "open", 409, "The facilitator has closed responses.");
      const valid = new Set(itemsFor(s).flatMap(a => a.items.map(i => i.id)));
      const list = Array.isArray(b.answers) ? b.answers.slice(0, 200) : [b];
      for (const a of list) {
        if (!valid.has(a.itemId)) continue;
        const mine = s.responses[b.pid] || (s.responses[b.pid] = {});
        const st = STATUSES.includes(a.s) ? a.s : null;
        const c = typeof a.c === "string" ? a.c.slice(0, 600) : (mine[a.itemId] && mine[a.itemId].c) || "";
        if (!st && !c) delete mine[a.itemId]; else mine[a.itemId] = { s: st, c };
      }
      store.save(s); broadcast(s.code);
      return json(res, 200, { ok: true });
    }

    if (action === "results" && req.method === "GET") {
      need(isFacilitator(s, q.get("key") || req.headers["x-facilitator-key"]) || s.share.results, 403, "Results haven't been shared yet.");
      return json(res, 200, aggregate(s));
    }

    /* ----- facilitator only below ----- */
    const key = q.get("key") || req.headers["x-facilitator-key"];

    if (action === "control" && req.method === "POST") {
      requireFacilitator(s, key);
      const b = await body();
      switch (b.action) {
        case "shareResults": s.share.results = !!b.value; break;
        case "sharePlan": need(!b.value || s.plan, 409, "Generate a plan first."); s.share.plan = !!b.value; break;
        case "status": s.status = b.value === "closed" ? "closed" : "open"; break;
        case "agree": {
          need(typeof b.itemId === "string", 400, "Missing line.");
          if (!b.s && !b.note) delete s.agreed[b.itemId];
          else s.agreed[b.itemId] = { s: STATUSES.includes(b.s) ? b.s : null, note: String(b.note || "").slice(0, 600) };
          break;
        }
        case "agreeAll": {
          for (const a of aggregate(s).areas) for (const i of a.items) if (!s.agreed[i.id] && i.mode) s.agreed[i.id] = { s: i.mode, note: "" };
          break;
        }
        case "context": s.context = { text: String(b.text || "").slice(0, 8000) }; break;
        default: throw new HttpError(400, "Unknown action.");
      }
      store.save(s); broadcast(s.code, true);
      return json(res, 200, { ok: true });
    }

    if (action === "report" && req.method === "POST") {
      requireFacilitator(s, key);
      const b = await body();
      const hasPdf = typeof b.pdf === "string" && b.pdf.length > 100;
      need(hasPdf || (typeof b.text === "string" && b.text.trim().length > 200), 400, "Upload the report as a PDF or paste its text.");
      const text = prompts.reportPrompt({ ctx: s.profile, areas: itemsFor(s), hasPdf, text: b.text });
      const content = hasPdf
        ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b.pdf.replace(/^data:[^,]+,/, "") } }, { type: "text", text }]
        : text;
      const result = await ai.askJson({ system: prompts.SYSTEM, content, maxTokens: 4000 });
      s.report = { ...result, filename: String(b.filename || "").slice(0, 200), at: new Date().toISOString() };
      store.save(s); broadcast(s.code, true);
      return json(res, 200, { report: s.report });
    }

    if (action === "themes" && req.method === "POST") {
      requireFacilitator(s, key);
      const results = aggregate(s);
      const result = await ai.askJson({ system: prompts.SYSTEM, content: prompts.themesPrompt({ ctx: s.profile, results }), maxTokens: 3000 });
      s.themes = { ...result, at: new Date().toISOString() };
      store.save(s); broadcast(s.code, true);
      return json(res, 200, { themes: s.themes });
    }

    if (action === "plan" && req.method === "POST") {
      requireFacilitator(s, key);
      const results = aggregate(s);
      const result = await ai.askJson({
        system: prompts.SYSTEM,
        content: prompts.planPrompt({ ctx: s.profile, results, context: s.context.text, report: s.report, themes: s.themes }),
        maxTokens: 6000,
      });
      s.plan = { ...result, at: new Date().toISOString() };
      s.share.plan = false; // a new plan is never shared until the facilitator chooses to
      store.save(s); broadcast(s.code, true);
      return json(res, 200, { plan: s.plan });
    }

    if (action === "export" && req.method === "GET") {
      requireFacilitator(s, key);
      const { facilitatorKey, participants, responses, ...rest } = s;
      return json(res, 200, { ...rest, results: aggregate(s) });
    }

    throw new HttpError(404, "Not found.");
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message, code: e.code });
    if (e instanceof ai.AIError) return json(res, e.status, { error: friendlyAI(e), code: e.code });
    console.error(e);
    return json(res, 500, { error: "Something went wrong on the server." });
  }
}

function friendlyAI(e) {
  return ({
    no_key: "The AI isn't set up on this server. Add ANTHROPIC_API_KEY to .env.",
    rate_limited: "The AI service is busy. Try again in a minute.",
    invalid_json: "The AI reply couldn't be read. Try again.",
  })[e.code] || "The AI couldn't answer just now. Try again in a moment.";
}

module.exports = { handle };
