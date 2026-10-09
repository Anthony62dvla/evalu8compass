/*
 * Evalu8 Compass — action plan
 * Each action: { id, title, detail, itemId, owner, due (yyyy-mm-dd), success,
 *                status: "todo" | "doing" | "done", source, createdAt }
 * AI is only used when someone presses an AI button, and only when the
 * school has AI suggestions switched on.
 */
(function (root) {
  const STATUS = { todo: "Not started", doing: "In progress", done: "Done" };
  const STATUS_ICON = { todo: "circle-minus", doing: "circle-half-2", done: "circle-check" };
  const SOURCE = { gap: "From a gap", ai: "AI draft", review: "From inspector review", advice: "From AI suggestion", workshop: "From staff workshop", manual: "Added by you" };
  let H, I, esc, el;            // host helpers, set in init
  let filter = "all";
  const busy = new Set();
  const pending = {};           // id -> AI suggestion waiting to be used or dismissed

  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => new Date().toISOString().slice(0, 10);
  const weeksFromNow = w => { const d = new Date(); d.setDate(d.getDate() + 7 * Math.max(1, Math.min(52, Math.round(Number(w) || 6)))); return d.toISOString().slice(0, 10); };
  const overdue = a => a.due && a.status !== "done" && a.due < today();
  const actions = () => H.state().actions || (H.state().actions = []);

  function lines() { return H.view().flatMap(a => a.items.map(i => ({ ...i, area: a.name }))); }
  function lineFor(id) { return lines().find(l => l.id === id) || null; }
  function lineData(id) {
    const l = lineFor(id); if (!l) return null;
    const st = H.state();
    return { id: l.id, text: l.text, evidence: l.evidence, ref: l.ref, status: st.answers[l.id] || "", note: st.notes[l.id] || "" };
  }

  /* ---------- adding ---------- */
  function add(a, quiet) {
    const action = { id: uid(), title: "", detail: "", itemId: "", owner: "", due: "", success: "", status: "todo", source: "manual", createdAt: new Date().toISOString(), ...a };
    actions().push(action); H.save();
    if (!quiet) { render(); H.toast("Added to the action plan"); }
    return action;
  }
  function addFromGaps() {
    const st = H.state(), have = new Set(actions().map(a => a.itemId).filter(Boolean));
    const gaps = lines().filter(l => ["part", "no"].includes(st.answers[l.id]) && !have.has(l.id));
    if (!gaps.length) return H.toast("Every Partly or Not yet line already has an action.");
    gaps.forEach(g => add({ itemId: g.id, title: g.text, detail: st.notes[g.id] || "", source: "gap", due: weeksFromNow(st.answers[g.id] === "no" ? 6 : 12) }, true));
    render(); H.toast(`Added ${gaps.length} action${gaps.length === 1 ? "" : "s"} from your gaps`);
  }
  function fromAdvice(itemId, idx) {
    const r = H.state().ai[itemId]; const x = r && r.activities && r.activities[idx]; if (!x) return;
    const weeks = { "this week": 1, "this half-term": 6, "this term": 12, "this year": 40 }[String(x.when || "").toLowerCase()] || 8;
    add({ itemId, title: x.title, detail: [x.what, x.evidence ? "Evidence: " + x.evidence : ""].filter(Boolean).join("\n"), owner: x.lead || "", due: weeksFromNow(weeks), source: "advice" });
  }
  function fromReview(idx) {
    const p = H.state().review && H.state().review.priorities && H.state().review.priorities[idx]; if (!p) return;
    add({ title: p.title, detail: (p.actions || []).map(a => "• " + a).join("\n"), owner: p.lead || "", success: p.successLooksLike || "", due: weeksFromNow(12), source: "review" });
  }

  /* ---------- AI ---------- */
  function applySuggestion(a, s) {
    if (s.title) a.title = s.title;
    a.detail = [(s.steps || []).map(x => "• " + x).join("\n"), s.evidence ? "Evidence: " + s.evidence : ""].filter(Boolean).join("\n");
    if (s.owner) a.owner = s.owner;
    if (s.dueInWeeks) a.due = weeksFromNow(s.dueInWeeks);
    if (s.success) a.success = s.success;
  }
  async function suggest(id) {
    if (busy.has(id)) return;
    const a = actions().find(x => x.id === id); if (!a) return;
    busy.add(id); render();
    try {
      pending[id] = await H.ai("action", { ctx: H.ctx(), action: a, line: a.itemId ? lineData(a.itemId) : null });
    } catch (e) { pending[id] = { error: H.errorText(e) }; }
    busy.delete(id); render();
  }
  async function draft() {
    const st = H.state(), have = new Set(actions().map(a => a.itemId).filter(Boolean));
    const gaps = lines().filter(l => ["part", "no"].includes(st.answers[l.id]) && !have.has(l.id))
      .map(l => ({ id: l.id, area: l.area, text: l.text, status: st.answers[l.id], note: st.notes[l.id] || "" }));
    if (!gaps.length) return H.toast("No gaps without an action. Rate some lines Partly or Not yet first.");
    const btn = el("planDraft"); btn.disabled = true;
    el("planStatus").innerHTML = `<div class="thinking">Drafting actions for ${gaps.length} gap${gaps.length === 1 ? "" : "s"}. This can take a minute…</div>`;
    try {
      const r = await H.ai("draft", { ctx: H.ctx(), gaps });
      const list = Array.isArray(r.actions) ? r.actions : [];
      list.forEach(s => { const a = add({ itemId: lineFor(s.itemId) ? s.itemId : "", source: "ai" }, true); applySuggestion(a, s); });
      H.save(); el("planStatus").innerHTML = "";
      render(); H.toast(`Added ${list.length} AI-drafted action${list.length === 1 ? "" : "s"}. Check and edit each one.`);
    } catch (e) { el("planStatus").innerHTML = `<p class="error-text">${esc(H.errorText(e))}</p>`; }
    btn.disabled = false;
  }

  /* ---------- rendering ---------- */
  function counts() {
    const c = { todo: 0, doing: 0, done: 0, overdue: 0, all: actions().length };
    actions().forEach(a => { c[a.status]++; if (overdue(a)) c.overdue++; });
    return c;
  }
  function render() {
    const box = el("planList"); if (!box) return;
    const c = counts();
    el("planTabCount").textContent = c.all ? ` (${c.all})` : "";
    el("planSummary").innerHTML = c.all
      ? `<div class="big">${Math.round(c.done / c.all * 100)}%<small>done · ${c.all} action${c.all === 1 ? "" : "s"}</small></div>
         <div class="stack"><div class="bar">${["done", "doing", "todo"].map(k => c[k] ? `<span style="width:${c[k] / c.all * 100}%;background:${k === "done" ? "var(--met)" : k === "doing" ? "var(--part)" : "var(--na)"}"></span>` : "").join("")}</div>
         <div class="legend"><span><i style="background:var(--met)"></i>Done ${c.done}</span><span><i style="background:var(--part)"></i>In progress ${c.doing}</span><span><i style="background:var(--na)"></i>Not started ${c.todo}</span>${c.overdue ? `<span style="color:var(--no);font-weight:700">${I("alert-triangle", 14)} Overdue ${c.overdue}</span>` : ""}</div></div>`
      : "";
    document.querySelectorAll("[data-pf]").forEach(b => b.setAttribute("aria-pressed", b.dataset.pf === filter));
    const shown = actions().filter(a => filter === "all" || (filter === "overdue" ? overdue(a) : a.status === filter));
    if (!c.all) {
      box.innerHTML = `<div class="plan-empty"><span class="tile">${I("target", 26)}</span><h3>Turn your gaps into actions</h3>
        <p>Add an action yourself, create one for every line you rated Partly or Not yet${H.aiOn() ? ", or let the AI inspector draft a plan for you to edit" : ""}. Each action gets an owner, a deadline and what success looks like.</p></div>`;
      return;
    }
    if (!shown.length) { box.innerHTML = `<div class="plan-empty"><p>No actions match this filter.</p></div>`; return; }
    const opts = lines();
    box.innerHTML = shown.map(a => {
      const p = pending[a.id];
      return `<article class="action${overdue(a) ? " overdue" : ""}" data-aid="${a.id}" data-status="${a.status}">
        <div class="action-top">
          <div class="states">${Object.keys(STATUS).map(s => `<button class="st" data-astatus="${a.id}" data-v="${s}" aria-pressed="${a.status === s}">${I(STATUS_ICON[s], 18)}${STATUS[s]}</button>`).join("")}</div>
          <span class="src src-${a.source}">${esc(SOURCE[a.source] || "")}</span>
          ${overdue(a) ? `<span class="flag gap">${I("alert-triangle", 14)}Overdue</span>` : ""}
          <span class="spacer"></span>
          <button class="iconbtn" data-adel="${a.id}" aria-label="Delete action">${I("x", 18)}</button>
        </div>
        <label class="sr-only" for="at-${a.id}">Action</label>
        <input class="action-title" id="at-${a.id}" data-afield="title" value="${esc(a.title)}" placeholder="What will we do?">
        <div class="action-grid">
          <div class="field wide"><label for="ad-${a.id}">Steps and details</label><textarea id="ad-${a.id}" data-afield="detail" rows="3" placeholder="The steps, who's involved, resources">${esc(a.detail)}</textarea></div>
          <div class="field"><label for="ao-${a.id}">Owner</label><input type="text" id="ao-${a.id}" data-afield="owner" value="${esc(a.owner)}" placeholder="e.g. DSL, SENCo"></div>
          <div class="field"><label for="ae-${a.id}">Due</label><input type="date" id="ae-${a.id}" data-afield="due" value="${esc(a.due)}"></div>
          <div class="field wide"><label for="as-${a.id}">Success looks like</label><textarea id="as-${a.id}" data-afield="success" rows="2" placeholder="What staff, pupils or an inspector would see when it's done">${esc(a.success)}</textarea></div>
          <div class="field wide"><label for="al-${a.id}">Checklist line</label><select id="al-${a.id}" data-afield="itemId"><option value="">Not linked</option>${opts.map(l => `<option value="${l.id}"${l.id === a.itemId ? " selected" : ""}>${esc(l.area)}: ${esc(l.text.length > 90 ? l.text.slice(0, 88) + "…" : l.text)}</option>`).join("")}</select></div>
        </div>
        <div class="action-foot ai-only">
          ${busy.has(a.id) ? `<span class="thinking">Thinking about this action…</span>` : `<button class="ask" data-asuggest="${a.id}">${I("sparkles", 18)}Suggest improvements with AI</button>`}
        </div>
        ${p ? suggestionHTML(a.id, p) : ""}
      </article>`;
    }).join("");
  }
  function suggestionHTML(id, s) {
    if (s.error) return `<div class="advice"><p>${esc(s.error)}</p><div class="foot"><span></span><button class="linkbtn" data-adismiss="${id}">Dismiss</button></div></div>`;
    return `<div class="advice">
      ${s.offline ? `<p>The AI inspector isn't connected, so this is a general suggestion.</p>` : ""}
      <p><b>${esc(s.title)}</b></p>
      <ul class="acts">${(s.steps || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="meta2">${s.owner ? "Owner: " + esc(s.owner) + " · " : ""}${s.dueInWeeks ? "Due in " + esc(s.dueInWeeks) + " weeks" : ""}</p>
      ${s.success ? `<p><b>Success:</b> ${esc(s.success)}</p>` : ""}
      <div class="foot"><span>AI suggestion · advisory only</span><span class="row">
        <button class="btn" data-ause="${id}">${I("checks", 18)}Use this</button>
        <button class="linkbtn" data-adismiss="${id}">Dismiss</button></span></div>
    </div>`;
  }

  /* ---------- text for copying and reports ---------- */
  function text() {
    if (!actions().length) return "";
    const st = H.state();
    let t = "\nACTION PLAN\n";
    actions().forEach((a, n) => {
      const l = a.itemId && lineFor(a.itemId);
      t += `${n + 1}. [${STATUS[a.status]}] ${a.title || "(untitled)"}${a.owner ? " | Owner: " + a.owner : ""}${a.due ? " | Due: " + a.due : ""}${overdue(a) ? " (OVERDUE)" : ""}\n`;
      if (l) t += `   Line: ${l.text} [${({ met: "Met", part: "Partly", no: "Not yet", na: "N/A" })[st.answers[l.id]] || "not rated"}]\n`;
      if (a.detail) t += a.detail.split("\n").map(x => "   " + x).join("\n") + "\n";
      if (a.success) t += `   Success: ${a.success}\n`;
    });
    return t;
  }

  /* ---------- events ---------- */
  function onClick(e) {
    const t = e.target.closest("button"); if (!t) return false;
    const d = t.dataset, list = actions();
    const find = id => list.find(a => a.id === id);
    if (d.astatus) { const a = find(d.astatus); a.status = d.v; H.save(); render(); return true; }
    if (d.adel) { const i = list.findIndex(a => a.id === d.adel); if (i >= 0) { const [gone] = list.splice(i, 1); H.save(); render(); H.undo(`Action deleted`, () => { list.splice(i, 0, gone); H.save(); render(); }); } return true; }
    if (d.asuggest) { suggest(d.asuggest); return true; }
    if (d.ause) { const a = find(d.ause); applySuggestion(a, pending[d.ause]); delete pending[d.ause]; H.save(); render(); H.toast("Suggestion used. Edit it as you need."); return true; }
    if (d.adismiss) { delete pending[d.adismiss]; render(); return true; }
    if (d.pf) { filter = d.pf; render(); return true; }
    if (d.addact) { const [item, idx] = d.addact.split("|"); fromAdvice(item, Number(idx)); return true; }
    if (t.hasAttribute("data-addprio")) { fromReview(Number(d.addprio)); return true; }
    if (t.id === "planAdd") { const a = add({}, true); render(); const f = document.getElementById("at-" + a.id); if (f) f.focus(); return true; }
    if (t.id === "planGaps") { addFromGaps(); return true; }
    if (t.id === "planDraft") { draft(); return true; }
    return false;
  }
  function onInput(e) {
    const f = e.target.dataset.afield; if (!f) return;
    const card = e.target.closest("[data-aid]"); const a = actions().find(x => x.id === card.dataset.aid); if (!a) return;
    a[f] = e.target.value; H.save();
    if (f === "due") { card.classList.toggle("overdue", overdue(a)); }
  }

  function init(host) {
    H = host; I = host.icon; esc = host.esc; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", e => { if (e.target.dataset.afield === "itemId" || e.target.dataset.afield === "due") { onInput(e); render(); } });
    render();
  }

  root.HWWD = Object.assign(root.HWWD || {}, { plan: { init, render, text, add, STATUS, SOURCE, overdue } });
})(window);
