/*
 * AI education inspector — connection layer
 * ------------------------------------------------------------
 * Tries three ways to reach the AI, in order:
 *   1. "artifact" — running as a published Claude artifact: uses the viewer's
 *      own Claude account via claude.use("sample"). No API key needed.
 *   2. "server"   — running behind server.js: POST /api/inspector, which calls
 *      the Anthropic API with the key held on the server.
 *   3. "offline"  — no AI available: returns the built-in improvement ideas
 *      from criteria.js so the button still does something useful.
 */
(function (root) {
  const P = () => root.HWWD.prompts;
  let providerPromise = null;

  async function detectArtifact() {
    if (!root.claude || typeof root.claude.use !== "function") return null;
    try {
      const sample = await root.claude.use("sample");
      if (!sample) return null;
      return {
        kind: "artifact",
        label: "AI inspector (your Claude account)",
        run: (task, data) => {
          const build = { item: P().itemPrompt, review: P().reviewPrompt, action: P().actionPrompt, draft: P().draftPrompt }[task];
          return sample.json(P().withSystem(build(data)), { modelTier: task === "review" || task === "draft" ? "complex" : "default", cache: false });
        },
      };
    } catch (e) { return null; }
  }

  async function detectServer() {
    if (!root.fetch || location.protocol === "file:") return null;
    try {
      const r = await fetch("api/health", { headers: { accept: "application/json" } });
      if (!r.ok) return null;
      const info = await r.json();
      if (!info.ai) return null;
      return {
        kind: "server",
        label: "AI inspector",
        run: async (task, data) => {
          const res = await fetch("api/inspector", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task, data }),
          });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) throw { code: out.code || "upstream_error", message: out.error || res.statusText };
          if (out.allowance) root.dispatchEvent(new CustomEvent("hwwd-allowance", { detail: out.allowance }));
          return out.result;
        },
      };
    } catch (e) { return null; }
  }

  function offline() {
    return { kind: "offline", label: "Built-in suggestions (AI not connected)", run: offlineRun };
  }

  function offlineRun(task, data) {
    const C = root.HWWD.criteria;
    const fallbackFor = id => { const a = C.AREAS.find(x => x.items.some(i => i.id === id)); return a ? a.fallback : []; };
    if (task === "action") {
      const steps = (data.line ? fallbackFor(data.line.id) : []).slice(0, 3);
      return Promise.resolve({ offline: true, title: data.action.title, steps: steps.length ? steps : ["Agree what 'done' looks like with the staff involved", "Gather the evidence that already exists", "Fill the gaps and review in half a term"], owner: data.action.owner || "Area lead", dueInWeeks: 6, success: "The expectation is met consistently and the evidence is easy to find.", evidence: data.line ? data.line.evidence : "" });
    }
    if (task === "draft") {
      return Promise.resolve({ offline: true, actions: data.gaps.slice(0, 12).map(g => ({ itemId: g.id, title: g.text, steps: fallbackFor(g.id).slice(0, 3), owner: "Area lead", dueInWeeks: g.status === "no" ? 6 : 12, success: "This line can be rated Met with evidence to hand." })) });
    }
    if (task === "item") {
      const area = C.AREAS.find(a => a.name === data.area);
      return Promise.resolve({
        offline: true,
        summary: "The AI inspector isn't connected, so these are general improvement ideas for this area.",
        activities: (area ? area.fallback : []).map(f => ({ title: f.split(/[,.]/)[0], what: f, lead: "Area lead", when: "This term", evidence: data.item.evidence })),
        quickWin: "Gather the evidence listed for this line and note what is missing.",
      });
    }
    return Promise.resolve({
      offline: true,
      overall: "The AI inspector isn't connected. This summary is worked out from your ratings: areas with the most gaps are listed first.",
      areas: data.areas.map(a => ({ area: a.name, grade: roughGrade(a), why: `${a.counts.met} of ${a.items.length - a.counts.na} applicable lines met.` })),
      priorities: data.areas.filter(a => a.counts.no + a.counts.part > 0)
        .sort((x, y) => (y.counts.no * 2 + y.counts.part) - (x.counts.no * 2 + x.counts.part)).slice(0, 4)
        .map(a => ({ title: a.name, area: a.name, actions: (C.AREAS.find(z => z.id === a.id) || { fallback: [] }).fallback.slice(0, 3), lead: "Area lead", timescale: "This term", successLooksLike: "All lines in this area rated Met with evidence to hand." })),
      strengths: data.areas.filter(a => a.counts.met && !a.counts.no && !a.counts.part).map(a => a.name),
    });
  }

  function roughGrade(a) {
    const assessed = a.counts.met + a.counts.part + a.counts.no;
    if (assessed < Math.ceil((a.items.length - a.counts.na) / 2)) return "Insufficient evidence";
    const score = (a.counts.met + a.counts.part * 0.5) / assessed;
    if (a.judged) return a.counts.no ? "Not met" : score === 1 ? "Met" : "Insufficient evidence";
    if (score >= 0.95) return "Strong standard";
    if (score >= 0.8) return "Expected standard";
    if (score >= 0.55) return "Needs attention";
    return "Urgent improvement";
  }

  /** Resolves the best available provider once and remembers it. */
  function provider() {
    if (!providerPromise) {
      providerPromise = (async () => (await detectArtifact()) || (await detectServer()) || offline())();
    }
    return providerPromise;
  }

  const ERRORS = {
    not_granted: "AI access wasn't allowed for this page. Built-in suggestions are shown instead.",
    sampling_disabled: "AI isn't available on this account. Built-in suggestions are shown instead.",
    rate_limited: "The AI inspector is busy. Wait a minute and try again.",
    invalid_json: "The AI reply couldn't be read. Try again.",
    no_key: "The server has no Anthropic API key set. Add ANTHROPIC_API_KEY to .env.",
    access_required: "Your access has expired. Sign in again with your school access code (go to the home page and open the checklist).",
  };
  function errorText(e) {
    if (e && (e.code === "allowance_reached" || e.code === "ai_disabled") && e.message) return e.message;
    return ERRORS[e && e.code] || "The AI inspector couldn't answer just now. Try again in a moment.";
  }

  /** Ask the inspector. Falls back to offline ideas if AI access is refused. */
  async function ask(task, data) {
    const p = await provider();
    try {
      return await p.run(task, data);
    } catch (e) {
      if (e && (e.code === "allowance_reached" || e.code === "ai_disabled")) {
        // Out of AI for now: give the built-in ideas, and try the AI again next time
        const r = await offlineRun(task, data);
        r.notice = errorText(e);
        return r;
      }
      if (e && (e.code === "not_granted" || e.code === "sampling_disabled" || e.code === "not_declared")) {
        providerPromise = Promise.resolve(offline());
        const r = await offlineRun(task, data);
        r.notice = errorText(e);
        return r;
      }
      throw e;
    }
  }

  const api = { provider, ask, errorText };
  root.HWWD = Object.assign(root.HWWD || {}, { inspector: api });
})(window);
