/*
 * How Well Are We Doing? — app
 * Renders the checklist for the chosen school type and phases, handles
 * ratings and notes, and shows AI inspector suggestions and reviews.
 */
(function () {
  const { criteria: C, inspector: AI, store: S } = window.HWWD;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LABEL = { met: "Met", part: "Partly", no: "Not yet", na: "N/A" };
  const I = window.HWWD.icon;
  const STATE_ICON = { met: "circle-check", part: "circle-half-2", no: "circle-x", na: "circle-minus" };
  const TYPE_ICON = { maintained: "building-community", academy: "school", independent: "building" };
  const tickIcon = s => I(STATE_ICON[s] || "circle-check", 20);
  const CHEV = I("chevron-down", 20, "chev");
  const GRADE_COLOR = {
    "exceptional": "var(--g-exc)", "strong standard": "var(--g-strong)", "expected standard": "var(--g-exp)",
    "needs attention": "var(--g-att)", "urgent improvement": "var(--g-urg)", "met": "var(--met)", "not met": "var(--no)",
  };

  let state = S.load();
  let view = [];
  let filter = "all";
  const busy = new Set();
  const save = () => S.save(state);
  const ctx = () => ({ name: state.profile.name, type: state.profile.type, phases: state.profile.phases, special: state.profile.special });

  /* ---------- Setup ---------- */
  function renderSetup() {
    const p = state.profile;
    $("pName").value = p.name || "";
    $("pBy").value = p.by || "";
    $("pDate").value = p.date || "";
    $("pSpecial").checked = !!p.special;
    $("types").innerHTML = C.SCHOOL_TYPES.map(t => `<button class="opt" data-type="${t.id}" aria-pressed="${p.type === t.id}">${I(TYPE_ICON[t.id], 24)}<span>${esc(t.label)}<small>${esc(t.hint)}</small></span></button>`).join("");
    renderBrand();
    $("phases").innerHTML = C.PHASES.map(ph => `<button class="opt" data-phase="${ph.id}" aria-pressed="${p.phases.includes(ph.id)}" title="${esc(ph.hint)}">${esc(ph.label)}</button>`).join("");
  }
  function renderBrand() {
    const p = state.profile;
    $("brandName").textContent = p.name || "Your school";
    $("brandLogo").innerHTML = p.logo ? `<img src="${esc(p.logo)}" alt="${esc(p.name || "School")} logo">` : I("school", 26);
    $("pLogoRemove").classList.toggle("hide", !p.logo);
  }
  function scopeNote() {
    const n = view.reduce((s, a) => s + a.items.length, 0);
    const type = C.SCHOOL_TYPES.find(t => t.id === state.profile.type);
    $("scopeNote").textContent = state.profile.phases.length
      ? `Showing ${n} expectations in ${view.length} areas for ${type ? type.label.toLowerCase() : ""} settings. Answers to hidden lines are kept if you change these settings.`
      : "Choose at least one phase to see the checklist.";
  }

  /* ---------- Areas ---------- */
  function renderAreas() {
    view = state.profile.phases.length ? C.resolve(ctx()) : [];
    scopeNote();
    $("areas").innerHTML = view.map(a => `
      <section class="area${state.collapsed[a.id] ? " collapsed" : ""}" id="a-${a.id}">
        <button class="ahead" data-toggle="${a.id}" aria-expanded="${!state.collapsed[a.id]}">
          <span class="tile">${I(a.icon || "list-check", 24)}</span>
          <h2>${esc(a.name)}<span class="sub">${esc(a.sub)}</span></h2>
          <span class="status-pill" id="g-${a.id}"></span>
          <span class="acount" id="c-${a.id}"></span>${CHEV}
        </button>
        <div class="abar" id="b-${a.id}"></div>
        <ul class="items">${a.items.map(it => itemHTML(a, it)).join("")}</ul>
      </section>`).join("");
    update();
  }
  function itemHTML(area, it) {
    const s = state.answers[it.id] || "";
    return `<li class="item" data-k="${it.id}" data-area="${area.id}" data-s="${s}">
      <div class="qrow">
        <button class="tick" data-tick="${it.id}" aria-label="Mark as met">${tickIcon(s)}</button>
        <div class="q"><strong>${esc(it.text)}${it.special ? '<span class="tag">Specialist</span>' : ""}</strong>
          <div class="look">Evidence: ${esc(it.evidence)}</div>
          ${it.ref ? `<div class="ref">${esc(it.ref)}</div>` : ""}</div>
      </div>
      <div class="states indent">${["met", "part", "no", "na"].map(v => `<button class="st" data-set="${it.id}" data-v="${v}" aria-pressed="${s === v}">${I(STATE_ICON[v], 18)}${LABEL[v]}</button>`).join("")}
        <button class="ask${s === "part" || s === "no" ? "" : " hide"}" data-ask="${it.id}">${I("sparkles", 18)}Ask the AI inspector</button></div>
      <div class="note indent"><textarea id="n-${it.id}" data-note="${it.id}" rows="1" placeholder="Our evidence / next step">${esc(state.notes[it.id] || "")}</textarea></div>
      <div class="indent" id="adv-${it.id}">${state.ai[it.id] ? adviceHTML(it.id, state.ai[it.id]) : ""}</div>
    </li>`;
  }

  /* ---------- Scores ---------- */
  function counts(items) {
    const c = { met: 0, part: 0, no: 0, na: 0, todo: 0 };
    items.forEach(i => c[state.answers[i.id] || "todo"]++);
    return c;
  }
  function barHTML(c, total) {
    const seg = (n, col) => n ? `<span style="width:${n / total * 100}%;background:${col}"></span>` : "";
    return seg(c.met, "var(--met)") + seg(c.part, "var(--part)") + seg(c.no, "var(--no)") + seg(c.na, "var(--na)");
  }
  function areaStatus(a, c) {
    const assessed = c.met + c.part + c.no;
    if (!assessed) return null;
    if (a.judged) return c.no ? ["Gaps to fix", "var(--no)", "var(--no-soft)"] : c.part ? ["Partly met", "var(--part)", "var(--part-soft)"] : ["On track", "var(--met)", "var(--met-soft)"];
    const sc = (c.met + c.part * 0.5) / assessed;
    if (sc >= 0.9) return ["On track", "var(--met)", "var(--met-soft)"];
    if (sc >= 0.7) return ["Mostly there", "var(--accent)", "var(--accent-soft)"];
    if (sc >= 0.4) return ["Needs attention", "var(--part)", "var(--part-soft)"];
    return ["Urgent focus", "var(--no)", "var(--no-soft)"];
  }
  function update() {
    const all = [];
    view.forEach(a => {
      all.push(...a.items);
      const c = counts(a.items);
      $("c-" + a.id).textContent = `${a.items.length - c.todo}/${a.items.length}`;
      $("b-" + a.id).innerHTML = barHTML(c, a.items.length);
      const st = areaStatus(a, c), g = $("g-" + a.id);
      g.hidden = !st;
      if (st) { g.textContent = st[0]; g.style.color = st[1]; g.style.background = st[2]; }
    });
    const c = counts(all), applicable = all.length - c.na;
    $("pct").innerHTML = `${applicable ? Math.round(c.met / applicable * 100) : 0}%<small>met · ${all.length - c.todo} of ${all.length} assessed</small>`;
    $("bar").innerHTML = all.length ? barHTML(c, all.length) : "";
    $("legend").innerHTML = [["met", "Met", c.met], ["part", "Partly", c.part], ["no", "Not yet", c.no], ["na", "N/A", c.na]]
      .map(([k, l, n]) => `<span><i style="background:var(--${k})"></i>${l} ${n}</span>`).join("") +
      `<span><i style="background:var(--na-soft);outline:1px solid var(--line)"></i>To assess ${c.todo}</span>`;
    applyFilter();
  }
  function applyFilter() {
    document.querySelectorAll(".item").forEach(li => {
      const s = li.dataset.s;
      li.classList.toggle("hide", filter === "todo" ? !!s : filter === "gaps" ? !(s === "part" || s === "no") : false);
    });
    document.querySelectorAll("section.area").forEach(sec => sec.classList.toggle("hide", filter !== "all" && !sec.querySelector(".item:not(.hide)")));
  }

  function setAnswer(id, v) {
    if (state.answers[id] === v) delete state.answers[id]; else state.answers[id] = v;
    const li = document.querySelector(`.item[data-k="${id}"]`), s = state.answers[id] || "";
    li.dataset.s = s;
    li.querySelector(".tick").innerHTML = tickIcon(s);
    li.querySelectorAll(".st").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === s));
    li.querySelector(".ask").classList.toggle("hide", !(s === "part" || s === "no"));
    save(); update();
  }

  /* ---------- AI inspector: single line ---------- */
  function findItem(id) {
    for (const a of view) { const it = a.items.find(i => i.id === id); if (it) return { area: a, item: it }; }
    return null;
  }
  async function askItem(id) {
    if (busy.has(id)) return;
    const found = findItem(id); if (!found) return;
    const box = $("adv-" + id);
    busy.add(id);
    box.innerHTML = '<div class="thinking">The inspector is reviewing this line…</div>';
    try {
      const result = await AI.ask("item", { ctx: ctx(), area: found.area.name, item: found.item, status: state.answers[id], note: state.notes[id] || "" });
      state.ai[id] = { ...result, at: new Date().toISOString() };
      save();
      box.innerHTML = adviceHTML(id, state.ai[id]);
    } catch (e) {
      box.innerHTML = `<div class="advice"><p>${esc(AI.errorText(e))}</p><div class="foot"><span></span><button class="linkbtn" data-ask="${id}">Try again</button></div></div>`;
    } finally { busy.delete(id); }
  }
  function adviceHTML(id, r) {
    const acts = Array.isArray(r.activities) ? r.activities : [];
    return `<div class="advice">
      ${r.notice ? `<p>${esc(r.notice)}</p>` : ""}
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
      ${r.quickWin ? `<p class="qw">${I("bulb", 18)}<span>Start with: ${esc(r.quickWin)}</span></p>` : ""}
      <ul class="acts">${acts.map(a => `<li>${a.when ? `<span class="when">${esc(a.when)}</span>` : ""}<b>${esc(a.title)}</b><span>${esc(a.what)}</span>
        <span class="meta2">${a.lead ? `Lead: ${esc(a.lead)}` : ""}${a.lead && a.evidence ? " · " : ""}${a.evidence ? `Evidence: ${esc(a.evidence)}` : ""}</span></li>`).join("")}</ul>
      ${r.inspectorQuestion ? `<p class="iq">An inspector might ask: “${esc(r.inspectorQuestion)}”</p>` : ""}
      <div class="foot"><span>${r.offline ? "Built-in suggestions" : "AI inspector"}${r.at ? " · " + new Date(r.at).toLocaleDateString("en-GB") : ""} · advisory only</span>
        <span class="row"><button class="linkbtn" data-ask="${id}">Ask again</button><button class="linkbtn" data-clearai="${id}">Hide</button></span></div>
    </div>`;
  }

  /* ---------- AI inspector: whole review ---------- */
  function reviewData() {
    return {
      ctx: ctx(),
      areas: view.map(a => ({
        id: a.id, name: a.name, judged: !!a.judged, counts: counts(a.items),
        items: a.items.map(i => ({ text: i.text, status: state.answers[i.id] || "", note: state.notes[i.id] || "" })),
      })),
    };
  }
  async function runReview() {
    const btn = $("reviewBtn");
    const assessed = Object.keys(state.answers).length;
    if (!assessed) { toast("Rate some lines first, then ask for a review"); return; }
    btn.disabled = true;
    $("review").innerHTML = '<section class="review"><div class="review-body"><div class="thinking">The inspector is reading your self-assessment. This can take up to a minute…</div></div></section>';
    if ($("review").scrollIntoView) $("review").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const r = await AI.ask("review", reviewData());
      state.review = { ...r, at: new Date().toISOString() };
      save(); renderReview();
    } catch (e) {
      $("review").innerHTML = `<section class="review"><div class="review-body"><p>${esc(AI.errorText(e))}</p></div></section>`;
    } finally { btn.disabled = false; }
  }
  function renderReview() {
    const r = state.review;
    if (!r) { $("review").innerHTML = ""; return; }
    const areas = Array.isArray(r.areas) ? r.areas : [], pr = Array.isArray(r.priorities) ? r.priorities : [], str = Array.isArray(r.strengths) ? r.strengths : [];
    $("review").innerHTML = `<section class="review" aria-labelledby="revTitle">
      <div class="review-head"><span class="tile ai">${I("sparkles", 24)}</span><div><h2 id="revTitle">Inspector readiness review</h2>${r.notice ? `<p>${esc(r.notice)}</p>` : ""}<p>${esc(r.overall)}</p></div>
        <button class="btn" id="closeReview">${I("x", 18)}Hide review</button></div>
      <div class="review-body">
        <div><h3>Indicative grades</h3><div class="grades">${areas.map(g => `<div class="gcard" style="--gc:${GRADE_COLOR[String(g.grade).toLowerCase()] || "var(--na)"}"><b>${esc(g.area)}</b><span class="gl">${esc(g.grade)}</span><p>${esc(g.why)}</p></div>`).join("")}</div></div>
        ${pr.length ? `<div><h3>Improvement priorities</h3><ol class="prio">${pr.map(p => `<li><b>${esc(p.title)}</b><span class="meta2">${esc(p.area)}${p.lead ? " · Lead: " + esc(p.lead) : ""}${p.timescale ? " · " + esc(p.timescale) : ""}</span>
          <ul>${(p.actions || []).map(a => `<li>${esc(a)}</li>`).join("")}</ul>${p.successLooksLike ? `<span class="meta2">Success looks like: ${esc(p.successLooksLike)}</span>` : ""}</li>`).join("")}</ol></div>` : ""}
        ${str.length ? `<div><h3>Strengths to showcase</h3><p>${str.map(esc).join(" · ")}</p></div>` : ""}
        <p class="disclaimer">${r.offline ? "Worked out from your ratings because the AI inspector isn't connected." : "Generated by the AI inspector"}${r.at ? " on " + new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}. Indicative only, not an Ofsted judgement.</p>
      </div></section>`;
  }

  /* ---------- Action plan text ---------- */
  function planText() {
    const p = state.profile;
    let out = `HOW WELL ARE WE DOING? – ${p.name || "Our school"}\n${(C.SCHOOL_TYPES.find(t => t.id === p.type) || {}).label || ""} · ${p.phases.map(x => (C.PHASES.find(z => z.id === x) || {}).label).join(", ")}${p.special ? " · Specialist" : ""}\nReviewed ${p.date || "(no date)"} by ${p.by || "(not named)"}\n`;
    view.forEach(a => {
      const gaps = a.items.filter(i => ["part", "no"].includes(state.answers[i.id]) || !state.answers[i.id]);
      if (!gaps.length) return;
      out += `\n${a.name.toUpperCase()}\n`;
      gaps.forEach(i => {
        const s = state.answers[i.id];
        out += `- [${s ? LABEL[s] : "Not assessed"}] ${i.text}${state.notes[i.id] ? ` | ${state.notes[i.id]}` : ""}\n`;
        const ai = state.ai[i.id];
        if (ai && s && s !== "met" && s !== "na") (ai.activities || []).forEach(x => { out += `    > ${x.title}${x.lead ? ` (${x.lead}` : ""}${x.when ? `, ${x.when})` : x.lead ? ")" : ""}\n`; });
      });
    });
    if (state.review && Array.isArray(state.review.priorities)) {
      out += `\nINSPECTOR REVIEW PRIORITIES\n`;
      state.review.priorities.forEach((x, n) => { out += `${n + 1}. ${x.title} – ${(x.actions || []).join("; ")}\n`; });
    }
    return out;
  }
  async function copyText(text, box, panel, msg) {
    box.value = text;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
      if (panel) panel.classList.add("hide");
    } catch (e) {
      if (panel) panel.classList.remove("hide");
      if (msg) msg.textContent = "Select and copy the text below.";
      box.focus(); box.select();
    }
  }

  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2000); }

  /* ---------- Events ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    if (d.tick) return setAnswer(d.tick, state.answers[d.tick] || "met");
    if (d.set) return setAnswer(d.set, d.v);
    if (d.ask) return askItem(d.ask);
    if (d.clearai) { delete state.ai[d.clearai]; save(); $("adv-" + d.clearai).innerHTML = ""; return; }
    if (d.toggle) {
      state.collapsed[d.toggle] = !state.collapsed[d.toggle];
      $("a-" + d.toggle).classList.toggle("collapsed", !!state.collapsed[d.toggle]);
      t.setAttribute("aria-expanded", !state.collapsed[d.toggle]); save(); return;
    }
    if (d.f) { filter = d.f; document.querySelectorAll("[data-f]").forEach(b => b.setAttribute("aria-pressed", b === t)); applyFilter(); return; }
    if (d.type) { state.profile.type = d.type; save(); renderSetup(); renderAreas(); return; }
    if (d.phase) {
      const ph = state.profile.phases, i = ph.indexOf(d.phase);
      i >= 0 ? ph.splice(i, 1) : ph.push(d.phase);
      ph.sort((a, b) => C.PHASES.findIndex(x => x.id === a) - C.PHASES.findIndex(x => x.id === b));
      save(); renderSetup(); renderAreas(); return;
    }
    if (t.id === "closeReview") { state.review = null; save(); renderReview(); }
  });
  $("areas").addEventListener("input", e => { const k = e.target.dataset.note; if (k) { state.notes[k] = e.target.value; save(); } });
  [["pName", "name"], ["pBy", "by"], ["pDate", "date"]].forEach(([id, key]) => $(id).addEventListener("input", e => { state.profile[key] = e.target.value; save(); if (key === "name") renderBrand(); }));
  $("pLogo").addEventListener("change", e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return toast("Choose a PNG, JPG, WebP or SVG image.");
    if (f.size > 200 * 1024) return toast("That logo is over 200 KB. Try a smaller version.");
    const r = new FileReader();
    r.onload = () => { state.profile.logo = r.result; save(); renderBrand(); toast("Logo added"); };
    r.readAsDataURL(f);
  });
  $("pLogoRemove").onclick = () => { delete state.profile.logo; save(); renderBrand(); };
  $("pSpecial").addEventListener("change", e => { state.profile.special = e.target.checked; save(); renderAreas(); });

  $("reviewBtn").onclick = runReview;
  $("copyBtn").onclick = () => copyText(planText(), $("copyBox"), $("copyPanel"), $("copyMsg"));
  $("dataBtn").onclick = () => { $("dataBox").value = JSON.stringify(state, null, 1); $("dataPanel").classList.toggle("hide"); };
  $("dataCopy").onclick = () => copyText($("dataBox").value, $("dataBox"), null, null);
  $("dataClose").onclick = () => $("dataPanel").classList.add("hide");
  $("dataLoad").onclick = () => {
    try {
      const obj = JSON.parse($("dataBox").value);
      if (!obj || !obj.profile || !obj.answers) throw new Error();
      state = S.merge(obj); save(); renderSetup(); renderAreas(); renderReview();
      $("dataPanel").classList.add("hide"); toast("Self-assessment loaded");
    } catch (e) { toast("That text isn't a saved self-assessment. Copy it again from Save / load."); }
  };
  $("expandBtn").onclick = e => {
    const anyOpen = view.some(a => !state.collapsed[a.id]);
    view.forEach(a => { state.collapsed[a.id] = anyOpen; });
    $("expandBtn").querySelector("span").textContent = anyOpen ? "Expand all" : "Collapse all";
    save(); renderAreas();
  };
  $("resetBtn").onclick = () => $("confirm").classList.remove("hide");
  $("noBtn").onclick = () => $("confirm").classList.add("hide");
  $("yesBtn").onclick = () => {
    state = { ...S.DEFAULT(), profile: state.profile };
    save(); $("confirm").classList.add("hide"); renderAreas(); renderReview(); toast("All answers cleared");
  };

  /* ---------- Start ---------- */
  renderSetup(); renderAreas(); renderReview();
  // The workshop needs the server; hide its link in single-file or artifact copies
  if (location.protocol === "file:" || !document.querySelector('link[href="css/styles.css"]')) { const w = $("workshopLink"); if (w) w.hidden = true; }
  AI.provider().then(p => {
    const b = $("aiBadge");
    b.classList.toggle("off", p.kind === "offline");
    b.querySelector("span").textContent = p.kind === "offline" ? "Built-in suggestions (AI not connected)" : "AI inspector ready";
  });
})();
