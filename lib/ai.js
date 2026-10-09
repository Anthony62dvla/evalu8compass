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
  // One request to the API. Returns the reply text and why it stopped.
  async function call(max, extraNote) {
    let r, out;
    const messages = [{ role: "user", content }];
    if (extraNote) messages.push({ role: "assistant", content: extraNote.previous }, { role: "user", content: extraNote.text });
    try {
      r = await fetch(BASE() + "/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": API_KEY(), "anthropic-version": "2023-06-01",
          // Only needed for an API key that isn't tied to one workspace (see .env.example)
          ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID.trim() } : {}) },
        body: JSON.stringify({ model: MODEL(), max_tokens: max, system, messages }),
      });
      out = await r.json();
    } catch (e) {
      return { failed: new AIError("upstream_error", "Could not reach the AI service") };
    }
    if (!r.ok) {
      console.error("Anthropic API error", r.status, out && out.error && out.error.message);
      return { failed: new AIError(r.status === 429 ? "rate_limited" : "upstream_error", (out && out.error && out.error.message) || "AI request failed", r.status === 429 ? 429 : 502) };
    }
    return { text: (out.content || []).filter(b => b.type === "text").map(b => b.text).join(""), stop: out.stop_reason, usage: out.usage || {} };
  }

  let first = await call(maxTokens);
  if (first.failed) { usage.settle(ticket, null); throw first.failed; } // never reached the AI: don't count it
  usage.settle(ticket, first.usage);
  let result = parseJson(first.text);
  if (result) return result;

  // Second try: if the reply was cut off, give it twice the room; otherwise ask for the JSON alone.
  console.error(`AI reply not valid JSON (stop: ${first.stop}, ${first.text.length} chars); retrying`);
  const truncated = first.stop === "max_tokens";
  const second = truncated
    ? await call(Math.min(maxTokens * 2, 16000))
    : await call(maxTokens, { previous: first.text || "(empty)", text: "That reply couldn't be read as JSON. Reply again with only the JSON object in the shape asked for: no other text, no code fences." });
  if (!second.failed) {
    usage.settle(ticket, second.usage);
    result = parseJson(second.text);
    if (result) return result;
  }
  const last = second.failed ? first : second;
  const err = new AIError("invalid_json", last.stop === "max_tokens"
    ? "The AI's answer was too long and got cut off. Try again; if it keeps happening, the report may be unusually long."
    : "The AI's reply couldn't be read. Try again in a moment.");
  err.detail = { stop: last.stop, chars: (last.text || "").length, start: String(last.text || "").slice(0, 300), end: String(last.text || "").slice(-300) };
  throw err;
}

module.exports = { askJson, AIError, hasKey: () => !!API_KEY(), model: MODEL };
