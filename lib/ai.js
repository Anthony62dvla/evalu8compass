/* Calls the Anthropic Messages API and returns the reply parsed as JSON. */
const API_KEY = () => process.env.ANTHROPIC_API_KEY || "";
const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

class AIError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status || 502; } }

function parseJson(text) {
  const tries = [text, (text.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const t of tries) { if (!t) continue; try { return JSON.parse(t); } catch (e) {} }
  return null;
}

/**
 * @param system  persona text
 * @param content string, or an array of Messages API content blocks (e.g. a PDF document block + text)
 */
async function askJson({ system, content, maxTokens = 2000 }) {
  if (!API_KEY()) throw new AIError("no_key", "ANTHROPIC_API_KEY is not set", 503);
  let r, out;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    });
    out = await r.json();
  } catch (e) {
    throw new AIError("upstream_error", "Could not reach the AI service");
  }
  if (!r.ok) {
    console.error("Anthropic API error", r.status, out && out.error && out.error.message);
    throw new AIError(r.status === 429 ? "rate_limited" : "upstream_error", (out && out.error && out.error.message) || "AI request failed", r.status === 429 ? 429 : 502);
  }
  const text = (out.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const result = parseJson(text);
  if (!result) throw new AIError("invalid_json", "AI reply was not valid JSON");
  return result;
}

module.exports = { askJson, AIError, hasKey: () => !!API_KEY(), model: MODEL };
