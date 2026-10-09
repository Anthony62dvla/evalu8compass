/* Calls the Anthropic Messages API and returns the reply parsed as JSON.
 * Pass `account` (the school's access code id) to count the request against
 * that school's monthly AI allowance (see lib/usage.js). */
const usage = require("./usage");
const API_KEY = () => process.env.ANTHROPIC_API_KEY || "";
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const BASE = () => (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, ""); // change only for testing

class AIError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status || 502; } }

function parseJson(text) {
  const tries = [text, (text.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const t of tries) { if (!t) continue; try { return JSON.parse(t); } catch (e) {} }
  return null;
}

/**
 * @param system  persona text
 * @param content string, or an array of Messages API content blocks (e.g. a PDF document block + text)
 * @param account access code id to charge the request to (omit for no metering)
 */
async function askJson({ system, content, maxTokens = 2000, account }) {
  if (!API_KEY()) throw new AIError("no_key", "ANTHROPIC_API_KEY is not set", 503);
  let ticket = null;
  if (account) {
    ticket = usage.reserve(account);
    if (!ticket) {
      const st = usage.status(account);
      const resets = new Date(st.resetsOn + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long" });
      if (st.limit === 0) throw new AIError("ai_disabled", "AI suggestions aren't switched on for your school. Everything else works as normal. Email support@evalu8compass.app to turn them on.", 403);
      throw new AIError("allowance_reached", `Your school has used this month's AI allowance (${st.limit} requests). It resets on ${resets}. Everything else keeps working, and built-in suggestions are used in the meantime.`, 429);
    }
  }
  let r, out;
  try {
    r = await fetch(BASE() + "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY(), "anthropic-version": "2023-06-01",
        // Only needed for an API key that isn't tied to one workspace (see .env.example)
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID.trim() } : {}) },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    });
    out = await r.json();
  } catch (e) {
    usage.settle(ticket, null); // never reached the AI: don't count it
    throw new AIError("upstream_error", "Could not reach the AI service");
  }
  if (!r.ok) {
    usage.settle(ticket, null);
    console.error("Anthropic API error", r.status, out && out.error && out.error.message);
    throw new AIError(r.status === 429 ? "rate_limited" : "upstream_error", (out && out.error && out.error.message) || "AI request failed", r.status === 429 ? 429 : 502);
  }
  usage.settle(ticket, out.usage || {});
  const text = (out.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const result = parseJson(text);
  if (!result) throw new AIError("invalid_json", "AI reply was not valid JSON");
  return result;
}

module.exports = { askJson, AIError, hasKey: () => !!API_KEY(), model: MODEL };
