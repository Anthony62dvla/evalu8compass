/*
 * How Well Are We Doing? — server
 * ------------------------------------------------------------
 * Zero dependencies (Node 18+). Serves the app from /public and exposes:
 *
 *   GET  /api/health                → { ok, ai }
 *   POST /api/inspector             → single-user AI inspector (self-assessment page)
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
const ai = require("./lib/ai");
const workshop = require("./lib/workshop");
const store = require("./lib/store");
const access = require("./lib/access");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1"; // only reachable through your web server; use 0.0.0.0 to accept direct connections
const PUBLIC = path.join(__dirname, "public");
const LIMITS = {
  ai: Number(process.env.RATE_LIMIT_PER_MIN || 20),   // AI calls per IP per minute
  api: Number(process.env.API_LIMIT_PER_MIN || 600),  // other API calls per IP per minute
  login: 10,                                          // access-code attempts per IP per minute
};
// Pages that need a school access code (staff joining a workshop never do)
const PROTECTED_PAGES = new Set(["/checklist.html", "/report.html"]);
const AI_TASKS = ["item", "review", "action", "draft"];
const hits = new Map();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    if (p === "/api/health") return json(res, 200, { ok: true, ai: ai.hasKey(), model: ai.hasKey() ? ai.model() : null });

    if (p.startsWith("/api/")) {
      const isAI = p === "/api/inspector" || /\/(report|themes|plan)$/.test(p);
      if (limited(req, isAI ? "ai" : "api")) return json(res, 429, { code: "rate_limited", error: "Too many requests. Wait a minute and try again." });
      if (p === "/api/access") return accessRoute(req, res);
      if (p === "/api/access/logout" && req.method === "POST") { access.logout(req, res); return json(res, 200, { ok: true }); }
      if (p === "/api/inspector" && req.method === "POST") {
        if (!access.who(req)) return json(res, 401, { code: "access_required", error: "Enter your school access code to use the AI inspector." });
        return inspector(req, res);
      }
      if (p === "/api/w" && req.method === "POST" && !access.who(req)) return json(res, 401, { code: "access_required", error: "Enter your school access code to start a workshop." });
      if (p === "/api/w" || p.startsWith("/api/w/")) return workshop.handle(req, res, url, readBody, json);
      return json(res, 404, { error: "Not found" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
    // Friendly join links: /join/ABC123 → workshop page
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
server.listen(PORT, HOST, () => {
  console.log(`How Well Are We Doing? running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(ai.hasKey() ? `AI inspector on (${ai.model()})` : "AI inspector off: set ANTHROPIC_API_KEY in .env to turn it on");
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { store.flushAll(); process.exit(0); });

/* Single-user AI inspector used by the self-assessment page */
async function inspector(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Invalid JSON body" }); }
  const { task, data } = body || {};
  if (!data || !data.ctx || !AI_TASKS.includes(task)) return json(res, 400, { error: "Expected { task: " + AI_TASKS.join("|") + ", data }" });
  const build = { item: prompts.itemPrompt, review: prompts.reviewPrompt, action: prompts.actionPrompt, draft: prompts.draftPrompt }[task];
  try {
    const result = await ai.askJson({
      system: prompts.SYSTEM,
      content: build(data),
      maxTokens: { item: 1500, review: 3000, action: 1200, draft: 4000 }[task],
    });
    return json(res, 200, { result });
  } catch (e) {
    return json(res, e.status || 502, { code: e.code || "upstream_error", error: e.message });
  }
}

/* School access: GET → status, POST {code} → sign in */
async function accessRoute(req, res) {
  if (req.method === "GET") {
    const w = access.who(req);
    return json(res, 200, { required: access.required(), ok: !!w, school: w && w.name ? w.name : "" });
  }
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (limited(req, "login")) return json(res, 429, { code: "rate_limited", error: "Too many attempts. Wait a minute and try again." });
  let body;
  try { body = JSON.parse(await readBody(req, 4096)); } catch { return json(res, 400, { error: "Invalid request" }); }
  const c = access.login(req, res, body && body.code);
  if (!c) return json(res, 401, { code: "bad_code", error: "That access code isn't recognised. Check it and try again." });
  return json(res, 200, { ok: true, school: c.name });
}

/* ---------- helpers ---------- */
function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname); } catch { return json(res, 400, { error: "Bad path" }); }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "cache-control": path.extname(file) === ".html" ? "no-cache" : "public, max-age=300",
    });
    res.end(buf);
  });
}

function readBody(req, max = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > max) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
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
