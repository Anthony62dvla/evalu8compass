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

  const Y = window.HWWD.sync, G = window.HWWD.progress;
  let state = S.DEFAULT();
  let view = [];
  let filter = "all";
  const busy = new Set();
  const save = () => Y.changed(state);
  const aiOn = () => state.profile.ai !== false;
  const P = window.HWWD.plan;
  function applyAI() { document.body.classList.toggle("no-ai", !aiOn()); $("pAI").checked = aiOn(); }
  const ctx = () => ({ name: state.profile.name, type: state.profile.type, phases: state.profile.phases, special: state.profile.special });

  /* ---------- Setup ---------- */
  function renderSetup() {
    const p = state.profile;
    $("pName").value = p.name || "";
    $("pBy").value = p.by || "";
    $("pDate").value = p.date || "";
    $("pSpecial").checked = !!p.special;
    applyAI();
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
    if (P && P.render) P.render();
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
      <ul class="acts">${acts.map((a, n) => `<li>${a.when ? `<span class="when">${esc(a.when)}</span>` : ""}<b>${esc(a.title)}</b><span>${esc(a.what)}</span>
        <span class="meta2">${a.lead ? `Lead: ${esc(a.lead)}` : ""}${a.lead && a.evidence ? " · " : ""}${a.evidence ? `Evidence: ${esc(a.evidence)}` : ""}</span>
        <button class="advice-add" data-addact="${id}|${n}">${I("target", 14)}Add to action plan</button></li>`).join("")}</ul>
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
        ${pr.length ? `<div><h3>Improvement priorities</h3><ol class="prio">${pr.map((p, n) => `<li><b>${esc(p.title)}</b><span class="meta2">${esc(p.area)}${p.lead ? " · Lead: " + esc(p.lead) : ""}${p.timescale ? " · " + esc(p.timescale) : ""}</span>
          <ul>${(p.actions || []).map(a => `<li>${esc(a)}</li>`).join("")}</ul>${p.successLooksLike ? `<span class="meta2">Success looks like: ${esc(p.successLooksLike)}</span>` : ""}
          <button class="advice-add" data-addprio="${n}">${I("target", 14)}Add to action plan</button></li>`).join("")}</ol></div>` : ""}
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
    out += P.text();
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

  function undo(msg, fn) {
    const bar = $("undoBar"); $("undoMsg").textContent = msg; bar.classList.remove("hide");
    clearTimeout(undo.t);
    $("undoBtn").onclick = () => { bar.classList.add("hide"); fn(); };
    undo.t = setTimeout(() => bar.classList.add("hide"), 6000);
  }
  function showView(id) {
    ["evalView", "planView", "progressView"].forEach(v => $(v).classList.toggle("hide", v !== id));
    document.querySelectorAll("[data-view]").forEach(b => { b.setAttribute("aria-selected", b.dataset.view === id); b.tabIndex = b.dataset.view === id ? 0 : -1; });
    if (id === "planView") P.render();
    if (id === "progressView") renderProgress();
    history.replaceState(null, "", id === "planView" ? "#plan" : id === "progressView" ? "#progress" : location.pathname);
  }

  /* ---------- Progress: termly snapshots ---------- */
  let snaps = null, cmpFrom = "", cmpTo = "now";
  const snapCache = {};
  const fmtDate = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  async function renderProgress() {
    if (!$("snapName").value) $("snapName").value = G.termName();
    if (Y.mode() !== "server") {
      $("snapForm").classList.add("hide");
      $("snapList").innerHTML = `<div class="plan-empty"><p>Snapshots are saved to your school's account, so they need a connection to evalu8compass.app. They aren't available in an offline copy.</p></div>`;
      return;
    }
    try { snaps = await Y.snapshots.list(); }
    catch (e) { $("snapList").innerHTML = `<div class="plan-empty"><p>${esc(e.message)}</p></div>`; return; }
    renderSnapList();
    if (snaps.length && (!cmpFrom || !snaps.some(x => x.id === cmpFrom))) cmpFrom = snaps[0].id;
    renderCompare();
  }
  function renderSnapList() {
    if (!snaps.length) {
      $("snapList").innerHTML = `<div class="plan-empty" style="margin-top:14px"><span class="tile">${I("history", 26)}</span><h3>No snapshots yet</h3>
        <p>Save your first snapshot when this round of self-evaluation is complete. Next term, save another and compare the two.</p></div>`;
      $("compare").innerHTML = ""; return;
    }
    $("snapList").innerHTML = `<ul class="snaps">${snaps.map(x => {
      const c = x.counts;
      return `<li class="snap" data-sid="${x.id}"${x.id === cmpFrom ? ' aria-current="true"' : ""}>
        <div class="snap-name"><b>${esc(x.name)}</b><span>Saved ${fmtDate(x.at)} · ${c.met} met, ${c.part} partly, ${c.no} not yet${c.actions ? ` · ${c.done} of ${c.actions} actions done` : ""}</span></div>
        <div class="row"><button class="btn" data-cmp="${x.id}">${I("arrows-diff", 18)}Compare with now</button>
        <button class="btn" data-snapdel="${x.id}" aria-label="Delete snapshot ${esc(x.name)}">${I("trash", 18)}Delete</button></div></li>`;
    }).join("")}</ul>`;
  }
  async function snapState(id) {
    if (id === "now") return state;
    if (!snapCache[id]) snapCache[id] = (await Y.snapshots.get(id)).state;
    return snapCache[id];
  }
  async function renderCompare() {
    if (!snaps || !snaps.length || !cmpFrom) { $("compare").innerHTML = ""; return; }
    let from, to;
    try { [from, to] = await Promise.all([snapState(cmpFrom), snapState(cmpTo)]); }
    catch (e) { $("compare").innerHTML = `<div class="cmp"><p>${esc(e.message)}</p></div>`; return; }
    const r = G.compare(view, from, to);
    const nameOf = id => id === "now" ? "now" : esc((snaps.find(x => x.id === id) || {}).name || "");
    const d = r.to.pct - r.from.pct;
    const deltaHTML = n => `<span class="delta ${n > 0 ? "up" : n < 0 ? "down" : "same"}">${n > 0 ? "+" : ""}${n} pts</span>`;
    const moves = (list, cls) => `<ul class="moves ${cls}">${list.map(m => `<li><span class="chg">${esc(m.fromLabel)} → ${esc(m.toLabel)}</span><span>${esc(m.text)}</span><small>${esc(m.area)}</small></li>`).join("")}</ul>`;
    const opt = (id, label, sel) => `<option value="${id}"${id === sel ? " selected" : ""}>${esc(label)}</option>`;
    $("compare").innerHTML = `<section class="cmp" aria-labelledby="cmpTitle">
      <h3 id="cmpTitle">What's changed</h3>
      <div class="cmp-pick">
        <label for="cmpFrom">From</label><select id="cmpFrom">${snaps.map(x => opt(x.id, `${x.name} (${fmtDate(x.at)})`, cmpFrom)).join("")}</select>
        <label for="cmpTo">to</label><select id="cmpTo">${opt("now", "Now", cmpTo)}${snaps.filter(x => x.id !== cmpFrom).map(x => opt(x.id, `${x.name} (${fmtDate(x.at)})`, cmpTo)).join("")}</select>
        <a class="btn" href="report.html?since=${encodeURIComponent(cmpFrom)}">${I("file-export", 18)}Report with this comparison</a>
      </div>
      <p class="small muted" style="margin:0">Compared across the ${r.to.total} lines that apply to your school's current settings.</p>
      <div class="cmp-stats">
        <div class="cmp-stat ${d > 0 ? "up" : d < 0 ? "down" : ""}"><b>${r.from.pct}% → ${r.to.pct}%</b><span>Lines met</span></div>
        <div class="cmp-stat up"><b>${r.improved.length}</b><span>Lines improved</span></div>
        <div class="cmp-stat ${r.slipped.length ? "down" : ""}"><b>${r.slipped.length}</b><span>Lines slipped</span></div>
        <div class="cmp-stat"><b>${r.newly.length}</b><span>Newly assessed</span></div>
        <div class="cmp-stat up"><b>${r.actionsDone.length}</b><span>Actions completed</span></div>
      </div>
      <div class="cmp-wrap"><table class="cmp-table"><thead><tr><th>Evaluation area</th><th class="num">${nameOf(cmpFrom)}</th><th class="num">${cmpTo === "now" ? "Now" : nameOf(cmpTo)}</th><th class="num">Change</th></tr></thead>
        <tbody>${r.areas.map(a => `<tr><td>${esc(a.name)}</td><td class="num">${a.from.assessed ? a.from.pct + "%" : "–"}</td><td class="num">${a.to.assessed ? a.to.pct + "%" : "–"}</td><td class="num">${a.from.assessed && a.to.assessed ? deltaHTML(a.change) : ""}</td></tr>`).join("")}</tbody></table></div>
      ${r.improved.length ? `<div><h3 style="margin-bottom:8px">${I("trending-up", 20)} Improved</h3>${moves(r.improved, "up")}</div>` : ""}
      ${r.slipped.length ? `<div><h3 style="margin-bottom:8px">${I("trending-down", 20)} Slipped</h3>${moves(r.slipped, "down")}</div>` : ""}
      ${r.actionsDone.length ? `<div><h3 style="margin-bottom:8px">${I("circle-check", 20)} Actions completed</h3><ul class="moves up">${r.actionsDone.map(a => `<li><span>${esc(a.title || "Untitled action")}</span>${a.owner ? `<small>${esc(a.owner)}</small>` : ""}</li>`).join("")}</ul></div>` : ""}
      ${!r.improved.length && !r.slipped.length && !r.newly.length && !r.actionsDone.length ? `<p class="muted" style="margin:0">No ratings or actions have changed between these two points.</p>` : ""}
    </section>`;
  }
  $("snapForm").addEventListener("submit", async e => {
    e.preventDefault(); $("snapErr").textContent = "";
    const name = $("snapName").value.trim() || G.termName();
    if (!Object.keys(state.answers).length) { $("snapErr").textContent = "Rate some lines first, then save a snapshot."; return; }
    if (snaps && snaps.some(x => x.name.toLowerCase() === name.toLowerCase())) { $("snapErr").textContent = `You already have a snapshot called "${name}". Choose another name.`; return; }
    $("snapSave").disabled = true;
    try { const x = await Y.snapshots.create(name); cmpFrom = x.id; cmpTo = "now"; toast(`Snapshot "${x.name}" saved`); $("snapName").value = ""; await renderProgress(); }
    catch (err) { $("snapErr").textContent = err.message; }
    $("snapSave").disabled = false;
  });
  $("progressView").addEventListener("change", e => {
    if (e.target.id === "cmpFrom") { cmpFrom = e.target.value; if (cmpTo === cmpFrom) cmpTo = "now"; renderSnapList(); renderCompare(); }
    if (e.target.id === "cmpTo") { cmpTo = e.target.value; renderCompare(); }
  });
  $("progressView").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.cmp) { cmpFrom = b.dataset.cmp; cmpTo = "now"; renderSnapList(); await renderCompare(); $("compare").scrollIntoView && $("compare").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (b.dataset.snapdel) {
      if (!b.dataset.confirm) {
        b.dataset.confirm = "1"; b.innerHTML = `${I("alert-triangle", 18)}Click again to delete`;
        setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.innerHTML = `${I("trash", 18)}Delete`; } }, 4000); return;
      }
      b.disabled = true;
      try { await Y.snapshots.remove(b.dataset.snapdel); delete snapCache[b.dataset.snapdel]; if (cmpFrom === b.dataset.snapdel) cmpFrom = ""; if (cmpTo === b.dataset.snapdel) cmpTo = "now"; toast("Snapshot deleted"); renderProgress(); }
      catch (err) { toast(err.message); b.disabled = false; }
    }
  });

  /* ---------- Saving status ---------- */
  const SYNC = {
    idle: ["cloud-check", "Loading…"], saved: ["cloud-check", "Saved to your school's account"], pending: ["cloud-upload", "Saving…"], saving: ["cloud-upload", "Saving…"],
    offline: ["cloud-off", "Offline: saved on this device, will sync"], localonly: ["cloud-off", "Not connected: saved on this device only"],
    signedout: ["cloud-off", "Signed out: changes kept on this device."], error: ["alert-triangle", "Not saved"],
  };
  function showSync(st, detail) {
    const b = $("syncBadge"); if (!b) return;
    const [ic, text] = SYNC[st] || SYNC.idle;
    b.hidden = Y.mode() !== "server" && st !== "localonly";
    b.dataset.s = st;
    $("syncIcon").innerHTML = I(ic, 18);
    $("syncText").innerHTML = esc(text) + (st === "signedout" ? ` <a href="enter.html?next=${encodeURIComponent("/checklist.html" + location.hash)}">Sign in again</a>` : "");
    b.title = detail || text;
    if (st === "error" && detail) toast(detail);
  }
  /** Colleagues' changes arrived: redraw without losing the cursor */
  function applyRemote(next) {
    const a = document.activeElement, id = a && a.id;
    const sel = a && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
    const y = window.scrollY;
    state = next;
    renderSetup(); renderAreas(); renderReview(); P.render();
    if (!$("progressView").classList.contains("hide") && cmpTo === "now") renderCompare();
    if (id && $(id)) { const el = $(id); el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    window.scrollTo(0, y);
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
    if (d.view) return showView(d.view);
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
  $("pAI").addEventListener("change", e => { state.profile.ai = e.target.checked; save(); applyAI(); P.render(); toast(e.target.checked ? "AI suggestions switched on" : "AI suggestions switched off. Nothing will be sent to the AI."); });
  $("planCopy").onclick = () => copyText(planText(), $("copyBox"), $("copyPanel"), $("copyMsg"));

  $("reviewBtn").onclick = runReview;
  $("copyBtn").onclick = () => copyText(planText(), $("copyBox"), $("copyPanel"), $("copyMsg"));
  $("dataBtn").onclick = () => { $("dataBox").value = JSON.stringify(state, null, 1); $("dataPanel").classList.toggle("hide"); };
  $("dataCopy").onclick = () => copyText($("dataBox").value, $("dataBox"), null, null);
  $("dataClose").onclick = () => $("dataPanel").classList.add("hide");
  $("dataLoad").onclick = () => {
    try {
      const obj = JSON.parse($("dataBox").value);
      if (!obj || !obj.profile || !obj.answers) throw new Error();
      state = S.merge(obj); save(); renderSetup(); renderAreas(); renderReview(); P.render();
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
    save(); $("confirm").classList.add("hide"); renderAreas(); renderReview(); P.render(); toast("All answers cleared");
  };

  // Tabs: left/right arrow keys move between them (WAI-ARIA tabs pattern)
  document.querySelector(".tablist-in").addEventListener("keydown", e => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const tabs = [...document.querySelectorAll(".tablist-in [role=tab]")].filter(t => !t.hidden);
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault(); tabs[n].focus(); showView(tabs[n].dataset.view);
  });

  /* ---------- Start ---------- */
  Y.onStatus(showSync);
  Y.onRemote(applyRemote);
  P.init({
    state: () => state, save, view: () => view, ctx, toast, undo, aiOn, icon: I, esc,
    ai: (task, data) => AI.ask(task, data), errorText: e => AI.errorText(e),
  });
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  async function boot() {
    const r = await Y.start({ canApply: () => !document.querySelector(".thinking") });
    state = r.state;
    renderSetup(); renderAreas(); renderReview(); P.render();
    if (location.hash === "#plan") showView("planView");
    if (location.hash === "#progress") showView("progressView");
    if (r.mode !== "server") { $("saveNote").textContent = "This copy isn't connected to your school's account, so your answers are saved in this browser only. Use Save / load to keep a copy."; $("progressTab").hidden = true; }
    if (r.legacy) {
      const n = Object.keys(r.legacy.answers || {}).length, m = Object.keys(state.answers || {}).length;
      $("legacyInfo").textContent = `This device: ${plural(n, "line")} rated, ${plural((r.legacy.actions || []).length, "action")}. Shared copy: ${plural(m, "line")} rated, ${plural((state.actions || []).length, "action")}.`;
      $("legacyPanel").classList.remove("hide");
      $("legacyKeep").onclick = () => { Y.keepShared(); $("legacyPanel").classList.add("hide"); toast("Keeping the shared copy"); };
      $("legacyUse").onclick = async () => {
        try { applyRemote(await Y.useLegacy(r.legacy)); $("legacyPanel").classList.add("hide"); toast("The shared copy now matches this device"); }
        catch (e) { toast(e.message); }
      };
    }
  }
  boot();
  // The workshop needs the server; hide its link in single-file or artifact copies
  if (location.protocol === "file:" || !document.querySelector('link[href="css/styles.css"]')) { ["workshopLink", "homeLink", "reportLink"].forEach(id => { const w = $(id); if (w) w.hidden = true; }); }
  // School access: show sign-out, and use the school's name if none is set yet
  if (location.protocol !== "file:" && document.querySelector('link[href="css/styles.css"]')) {
    fetch("api/access").then(r => r.json()).then(a => {
      if (a.required && a.ok) {
        const so = $("signOut"); so.hidden = false;
        so.onclick = e => { e.preventDefault(); fetch("api/access/logout", { method: "POST" }).finally(() => { location.href = "index.html"; }); };
      }
    }).catch(() => {});
  }
  AI.provider().then(p => {
    const b = $("aiBadge");
    b.classList.toggle("off", p.kind === "offline");
    b.querySelector("span").textContent = p.kind === "offline" ? "Built-in suggestions (AI not connected)" : "AI inspector ready";
  });
})();
