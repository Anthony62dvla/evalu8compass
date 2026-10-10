/*
 * How Well Are We Doing? — staff workshop page
 * Three views: landing (join or start), staff (answer + see shared findings),
 * facilitator (live findings, agree ratings, AI plan, export).
 */
(function () {
  const C = window.HWWD.criteria;
  const I = window.HWWD.icon;
  const STATE_ICON = { met: "circle-check", part: "circle-half-2", no: "circle-x", na: "help-circle" };
  const ROLE_ICON = { teacher: "chalkboard", ta: "user-heart", support: "tool", slt: "briefcase", governor: "building-community", other: "user" };
  const TYPE_ICON = { maintained: "building-community", academy: "school", independent: "building" };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const BASE_PATH = location.pathname.replace(/[^/]*$/, "");
  const API = BASE_PATH + "api/w";
  const ROLES = [["teacher", "Teacher"], ["ta", "Teaching assistant"], ["support", "Support staff"], ["slt", "Senior leader"], ["governor", "Governor / trustee"], ["other", "Other"]];
  const ROLE_NAME = { teacher: "Teachers", ta: "Teaching assistants", support: "Support staff", slt: "Senior leaders", governor: "Governors / trustees", other: "Other" };
  const LABEL = { met: "Met", part: "Partly", no: "Not yet", na: "N/A" };
  const COLOR = { met: "var(--met)", part: "var(--part)", no: "var(--no)", na: "var(--na)" };
  const ls = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const STAFF_KEY = c => "hwwd-ws-staff-" + c;
  const FAC_KEY = "hwwd-ws-fac";

  let code = null, info = null, cred = null, key = null, es = null;
  let results = null, aiState = {}, myAnswers = {}, ffilter = "all", reportFile = null;
  const saveTimers = {};

  async function api(method, path, body, k) {
    const r = await fetch(API + path, {
      method, headers: { "content-type": "application/json", ...(k ? { "x-facilitator-key": k } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { status: r.status });
    return data;
  }
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2400); }
  function show(view) { ["landing", "staff", "fac"].forEach(v => $(v).classList.toggle("hide", v !== view)); window.scrollTo(0, 0); }
  function bar(c, labels = true) {
    const total = c.met + c.part + c.no + c.na;
    if (!total) return "";
    return ["met", "part", "no", "na"].map(k => c[k] ? `<span style="width:${c[k] / total * 100}%;background:${COLOR[k]}" title="${LABEL[k]}: ${c[k]}">${labels && c[k] / total > 0.08 ? c[k] : ""}</span>` : "").join("");
  }
  async function copy(text, fallbackBox) {
    try { await navigator.clipboard.writeText(text); toast("Copied"); if (fallbackBox) fallbackBox.classList.add("hide"); }
    catch (e) { if (fallbackBox) { fallbackBox.value = text; fallbackBox.classList.remove("hide"); fallbackBox.focus(); fallbackBox.select(); toast("Select the text and copy it"); } }
  }

  /* Tabs: each nav switches the panels its buttons name */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab]"); if (!t) return;
    const nav = t.closest(".tabs");
    nav.querySelectorAll("[data-tab]").forEach(b => { b.setAttribute("aria-selected", b === t); $(b.dataset.tab).classList.toggle("hide", b !== t); });
  });

  function setBrand(profile, sub) {
    const p = profile || {};
    $("brandName").textContent = p.name || "How well are we doing?";
    $("brandSub").textContent = sub || "Staff workshop";
    $("brandLogo").innerHTML = p.logo ? `<img src="${esc(p.logo)}" alt="${esc(p.name || "School")} logo">` : I("school", 26);
  }

  /* ================= Landing ================= */
  let joinRole = null;
  const cProfile = { name: "", type: "maintained", phases: [], special: false };
  let cAreas = null;

  function renderLanding() {
    $("roles").innerHTML = ROLES.map(([id, l]) => `<button type="button" class="opt role" data-role="${id}" aria-pressed="${joinRole === id}">${I(ROLE_ICON[id], 22)}${l}</button>`).join("");
    $("cTypes").innerHTML = C.SCHOOL_TYPES.map(t => `<button type="button" class="opt" data-ctype="${t.id}" aria-pressed="${cProfile.type === t.id}">${I(TYPE_ICON[t.id], 22)}${esc(t.label)}</button>`).join("");
    $("cPhases").innerHTML = C.PHASES.map(p => `<button type="button" class="opt" data-cphase="${p.id}" aria-pressed="${cProfile.phases.includes(p.id)}" title="${esc(p.hint)}">${esc(p.label)}</button>`).join("");
    const areas = cProfile.phases.length ? C.resolve(cProfile) : [];
    if (!cAreas) cAreas = new Set(areas.map(a => a.id));
    $("cAreas").innerHTML = areas.length
      ? areas.map(a => `<label><input type="checkbox" data-carea="${a.id}" ${cAreas.has(a.id) ? "checked" : ""}> <span class="tile sm">${I(a.icon, 18)}</span> ${esc(a.name)} <small>${a.items.length} lines</small></label>`).join("")
      : `<span class="muted small">Choose your phases to see the areas.</span>`;
    const n = areas.filter(a => cAreas.has(a.id)).reduce((s, a) => s + a.items.length, 0);
    $("cAreaNote").textContent = n ? `${n} lines in total. Staff take roughly ${Math.max(5, Math.round(n * 0.25))} minutes. For a short session, pick two or three areas.` : "";
    const fac = ls.get(FAC_KEY, {});
    const codes = Object.keys(fac).sort((a, b) => (fac[b].at || "").localeCompare(fac[a].at || "")).slice(0, 5);
    $("resumeList").innerHTML = codes.length ? `<span class="muted small">Your recent workshops</span>` + codes.map(c => `<button type="button" class="btn" data-resume="${c}">${I("arrow-right", 18)}Open ${c}${fac[c].name ? " · " + esc(fac[c].name) : ""}</button>`).join("") : "";
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    if (d.role) { joinRole = d.role; renderLanding(); }
    if (d.ctype) { cProfile.type = d.ctype; cAreas = null; renderLanding(); }
    if (d.cphase) { const i = cProfile.phases.indexOf(d.cphase); i >= 0 ? cProfile.phases.splice(i, 1) : cProfile.phases.push(d.cphase); cAreas = null; renderLanding(); }
    if (d.resume) { const fac = ls.get(FAC_KEY, {}); startFac(d.resume, fac[d.resume].key); }
  });
  document.addEventListener("change", e => {
    if (e.target.dataset.carea) { e.target.checked ? cAreas.add(e.target.dataset.carea) : cAreas.delete(e.target.dataset.carea); renderLanding(); }
    if (e.target.id === "cSpecial") { cProfile.special = e.target.checked; cAreas = null; renderLanding(); }
  });
  $("cLogo").addEventListener("change", e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return toast("Choose a PNG, JPG, WebP or SVG image.");
    if (f.size > 200 * 1024) return toast("That logo is over 200 KB. Try a smaller version.");
    const r = new FileReader();
    r.onload = () => { cProfile.logo = r.result; $("cLogoName").textContent = f.name; setBrand(cProfile, "Staff workshop"); };
    r.readAsDataURL(f);
  });
  $("joinCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });

  $("joinForm").addEventListener("submit", async e => {
    e.preventDefault();
    const c = $("joinCode").value.trim().toUpperCase();
    $("joinError").textContent = "";
    if (c.length !== 6) return void ($("joinError").textContent = "The code has six letters and numbers.");
    if (!joinRole) return void ($("joinError").textContent = "Choose your role.");
    const btn = $("joinBtn"); btn.disabled = true;
    try {
      const existing = ls.get(STAFF_KEY(c));
      const me = existing || await api("POST", `/${c}/join`, { role: joinRole });
      ls.set(STAFF_KEY(c), me);
      await startStaff(c, me);
    } catch (err) { $("joinError").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  /* Latest Ofsted report on the start form: the school's saved one, or a PDF just for this workshop */
  let savedOfsted = null, cReportFile = null;
  function renderCOfsted() {
    const box = $("cOfsted"); if (!box) return;
    const r = savedOfsted && savedOfsted.reading;
    box.innerHTML = `<div class="ofbox">
      ${r ? `<label class="switch"><input type="checkbox" id="cUseSaved" ${cReportFile ? "" : "checked"}> Use your saved report${r.inspectionDate ? `: inspected ${esc(r.inspectionDate)}` : ""}${savedOfsted.filename ? ` (${esc(savedOfsted.filename)})` : ""}</label>`
          : `<p class="muted">Optional. The AI reads it to shape the improvement plan. Saving it on the checklist (Step 2) means every workshop uses it.</p>`}
      <div class="row"><label class="btn filebtn">${I("file-upload", 18)}${r ? "Use a different PDF" : "Choose PDF"}<input type="file" id="cReport" accept="application/pdf"></label><span class="muted" id="cReportName">${cReportFile ? esc(cReportFile.name) : ""}</span></div>
    </div>`;
  }
  $("cOfsted").addEventListener("change", e => {
    if (e.target.id === "cUseSaved" && e.target.checked) { cReportFile = null; renderCOfsted(); return; }
    if (e.target.id !== "cReport") return;
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 18 * 1024 * 1024) { toast("That PDF is over 18 MB. You can paste the text in the Improvement plan tab instead."); return; }
    const fr = new FileReader();
    fr.onload = () => { cReportFile = { name: f.name, data: fr.result }; renderCOfsted(); };
    fr.readAsDataURL(f);
  });

  $("createForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("createError").textContent = "";
    cProfile.name = $("cName").value.trim();
    if (!cProfile.phases.length) return void ($("createError").textContent = "Choose at least one phase.");
    if (!cAreas || !cAreas.size) return void ($("createError").textContent = "Choose at least one area.");
    const btn = $("createBtn"); btn.disabled = true;
    try {
      const useSaved = !!(savedOfsted && !cReportFile && $("cUseSaved") && $("cUseSaved").checked);
      const r = await api("POST", "", { profile: cProfile, areaIds: [...cAreas], useSchoolReport: useSaved });
      const fac = ls.get(FAC_KEY, {}); fac[r.code] = { key: r.key, name: cProfile.name, at: new Date().toISOString() }; ls.set(FAC_KEY, fac);
      const upload = cReportFile; cReportFile = null;
      await startFac(r.code, r.key);
      // A report chosen just for this workshop is read in the background while staff join
      if (upload) aiAction($("fReadReport"), $("fReport"), "report", { filename: upload.name, pdf: upload.data }, "Reading the Ofsted report while staff join…");
    } catch (err) {
      $("createError").textContent = err.message;
      if (err.status === 401) { $("createFields").classList.add("hide"); $("createLocked").classList.remove("hide"); }
    }
    finally { btn.disabled = false; }
  });

  /* ================= Live connection ================= */
  function connect(query, handlers) {
    if (es) es.close();
    es = new EventSource(`${API}/${code}/events?${query}`);
    Object.entries(handlers).forEach(([ev, fn]) => es.addEventListener(ev, m => { try { fn(JSON.parse(m.data)); } catch (err) { console.error(err); } }));
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) toast("Connection lost. Refresh the page to reconnect."); };
  }

  /* ================= Staff ================= */
  async function startStaff(c, me) {
    code = c; cred = me;
    try {
      info = await api("GET", `/${c}`);
      const mine = await api("GET", `/${c}/mine?pid=${me.pid}&token=${me.token}`);
      myAnswers = mine.responses || {};
      cred.role = mine.role;
    } catch (err) {
      if (err.status === 403 || err.status === 404) { localStorage.removeItem(STAFF_KEY(c)); show("landing"); $("joinCode").value = c; $("joinError").textContent = err.message; return; }
      throw err;
    }
    history.replaceState(null, "", `${BASE_PATH}workshop.html?code=${c}`);
    $("sEyebrow").textContent = `Workshop ${c} · ${(ROLES.find(r => r[0] === cred.role) || [, ""])[1]}`;
    $("sTitle").textContent = info.profile.name ? `How well is ${info.profile.name} doing?` : "How well are we doing?";
    setBrand(info.profile, `Staff workshop ${c}`);
    $("brandNav").classList.add("hide");
    renderStaffAnswers();
    show("staff");
    connect(`pid=${me.pid}&token=${me.token}`, {
      state: s => staffState(s),
      results: r => { results = r; $("s-results").innerHTML = findingsHTML(r, false); },
      plan: p => { $("sPlanTab").classList.toggle("hide", !p); if (p) $("s-plan").innerHTML = planHTML(p, false); },
    });
  }
  function staffState(s) {
    info.status = s.status; info.share = s.share;
    const b = $("sBanner");
    const msgs = [];
    if (s.status === "closed") msgs.push("Responses are closed. Thank you for taking part.");
    if (s.share.results) msgs.push("The facilitator has shared the findings. Open the Findings tab.");
    if (s.share.plan) msgs.push("The improvement plan has been shared. Open Our plan.");
    b.textContent = msgs.join(" ");
    b.classList.toggle("hide", !msgs.length);
    b.classList.toggle("closed", s.status === "closed");
    $("sResultsTab").classList.toggle("hide", !s.share.results);
    if (!s.share.results && $("sResultsTab").getAttribute("aria-selected") === "true") document.querySelector('[data-tab="s-answer"]').click();
    if (!s.share.plan && $("sPlanTab").getAttribute("aria-selected") === "true") document.querySelector('[data-tab="s-answer"]').click();
    document.querySelectorAll("#s-answer button.st, #s-answer textarea").forEach(el => { el.disabled = s.status === "closed"; });
  }
  function renderStaffAnswers() {
    $("s-answer").innerHTML = `<p class="privacy-note">${I("lock", 18)}<span>Your answers are anonymous. In comments, don't name pupils or colleagues: describe what happens, not who.</span></p>` + info.areas.map(a => `
      <section class="area"><div class="ahead"><span class="tile">${I(a.icon || "list-check", 24)}</span><h2>${esc(a.name)}<span class="sub">${esc(a.sub)}</span></h2></div>
      <ul class="items">${a.items.map(it => {
        const m = myAnswers[it.id] || {}, s = m.s || "";
        return `<li class="item" data-k="${it.id}" data-s="${s}">
          <div class="q"><strong>${esc(it.text)}</strong><div class="look">Inspectors look for: ${esc(it.evidence)}</div></div>
          <div class="states">${["met", "part", "no", "na"].map(v => `<button class="st" data-ans="${it.id}" data-v="${v}" aria-pressed="${s === v}">${I(STATE_ICON[v], 18)}${v === "na" ? "Don't know" : LABEL[v]}</button>`).join("")}</div>
          <div class="note"><textarea data-com="${it.id}" rows="1" maxlength="600" placeholder="Comment (optional): what's working, what isn't, an example. No names, please.">${esc(m.c || "")}</textarea></div>
        </li>`;
      }).join("")}</ul></section>`).join("");
    staffCount();
  }
  function staffCount() {
    const total = info.areas.reduce((s, a) => s + a.items.length, 0);
    const done = info.areas.reduce((s, a) => s + a.items.filter(i => myAnswers[i.id] && myAnswers[i.id].s).length, 0);
    $("sMine").textContent = `${done}/${total}`;
  }
  function saveAnswer(id) {
    const st = $("saveState");
    st.textContent = "Saving…"; st.className = "savestate saving";
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(async () => {
      const m = myAnswers[id] || {};
      try {
        await api("PUT", `/${code}/answer`, { pid: cred.pid, token: cred.token, itemId: id, s: m.s || null, c: m.c || "" });
        st.textContent = "Saved"; st.className = "savestate";
      } catch (err) { st.textContent = err.message; st.className = "savestate err"; }
    }, 500);
  }
  $("s-answer").addEventListener("click", e => {
    const b = e.target.closest("[data-ans]"); if (!b) return;
    const id = b.dataset.ans, m = myAnswers[id] = myAnswers[id] || {};
    m.s = m.s === b.dataset.v ? "" : b.dataset.v;
    const li = b.closest(".item"); li.dataset.s = m.s;
    li.querySelectorAll(".st").forEach(x => x.setAttribute("aria-pressed", x.dataset.v === m.s));
    staffCount(); saveAnswer(id);
  });
  $("s-answer").addEventListener("input", e => {
    const id = e.target.dataset.com; if (!id) return;
    (myAnswers[id] = myAnswers[id] || {}).c = e.target.value;
    saveAnswer(id);
  });

  /* ================= Findings (shared by staff and facilitator) ================= */
  function reportFlags() {
    const m = {};
    ((aiState.report && aiState.report.findings) || []).forEach(f => { if (f.itemId) (m[f.itemId] = m[f.itemId] || []).push(f); });
    return m;
  }
  function findingsHTML(r, fac) {
    if (!r || !r.participants) return `<div class="empty">No responses yet. Findings appear here as staff answer.</div>`;
    const rep = fac ? reportFlags() : {};
    const html = r.areas.map(a => {
      const items = a.items.filter(i => !fac || ffilter === "all" || (ffilter === "flag" && (i.split || i.gap)) || (ffilter === "todo" && !(i.agreed && i.agreed.s)));
      if (!items.length) return "";
      return `<section class="warea"><div class="warea-head"><span class="tile">${I(a.icon || "list-check", 22)}</span><h3>${esc(a.name)}</h3>${a.score != null ? `<span class="score">Staff score ${a.score}%</span>` : ""}</div>
      <ul class="witems">${items.map(i => itemFinding(i, fac, rep[i.id])).join("")}</ul></section>`;
    }).join("");
    return html || `<div class="empty">No lines match this filter.</div>`;
  }
  function itemFinding(i, fac, rep) {
    const c = i.counts, rated = c.met + c.part + c.no;
    const roles = Object.entries(i.roles || {});
    const concerns = (rep || []).filter(f => f.type === "concern");
    const ag = i.agreed && i.agreed.s;
    return `<li class="witem" data-id="${i.id}">
      <div class="wq"><strong>${esc(i.text)}</strong>
        ${i.split ? `<span class="flag split" title="Staff answers are divided">${I("arrows-diff", 14)}Staff split</span>` : ""}
        ${i.gap ? `<span class="flag gap" title="Senior leaders rate this ${i.gap.leaders}%, other staff ${i.gap.others}%">${I("scale", 14)}Leaders ${i.gap.leaders}% · staff ${i.gap.others}%</span>` : ""}
        ${concerns.length ? `<span class="flag ofsted">${I("file-text", 14)}Ofsted concern</span>` : ""}
        ${!fac && ag ? `<span class="agreed-badge flag" style="color:${COLOR[ag]}">${I(STATE_ICON[ag], 16)}Agreed: ${LABEL[ag]}</span>` : ""}
      </div>
      <div class="wbarrow"><div class="wbar" role="img" aria-label="${c.met} met, ${c.part} partly, ${c.no} not yet, ${c.na} don't know">${bar(c)}</div>
        <span class="wmeta">${c.n} answers${rated ? ` · score ${i.score}%` : ""}</span></div>
      ${concerns.map(f => `<div class="ofsted-note">Ofsted: ${esc(f.finding)}</div>`).join("")}
      ${roles.length ? `<details data-dk="${i.id}:r"><summary>${I("users", 16)} By role</summary><div class="rolegrid">${roles.map(([role, rc]) => `<div class="rolerow"><span>${esc(ROLE_NAME[role] || role)}</span><div class="wbar">${bar(rc, false)}</div><span class="wmeta">${rc.n}</span></div>`).join("")}</div></details>` : ""}
      ${i.comments.length ? `<details data-dk="${i.id}:c"><summary>${I("message-circle", 16)} Comments (${i.comments.length})</summary><ul class="comments">${i.comments.map(cm => `<li>${cm.role ? `<span class="who">${esc(cm.role)}</span>` : ""}${esc(cm.text)}</li>`).join("")}</ul></details>` : ""}
      ${fac ? `<div class="agree"><span class="lbl">Agreed</span>${["met", "part", "no", "na"].map(v => `<button class="st" data-agree="${i.id}" data-v="${v}" aria-pressed="${ag === v}">${I(STATE_ICON[v], 18)}${LABEL[v]}</button>`).join("")}
        <input type="text" id="an-${i.id}" data-agreenote="${i.id}" maxlength="600" placeholder="Note from discussion" value="${esc(i.agreed ? i.agreed.note : "")}"></div>` : ""}
    </li>`;
  }
  /** Re-render without losing open sections, focus or half-typed notes. */
  function renderPreserving(el, html) {
    const open = new Set([...el.querySelectorAll("details[open]")].map(d => d.dataset.dk));
    const a = document.activeElement, focusId = a && el.contains(a) && a.id, val = focusId && a.value, sel = focusId && a.selectionStart;
    el.innerHTML = html;
    el.querySelectorAll("details").forEach(d => { if (open.has(d.dataset.dk)) d.open = true; });
    if (focusId && $(focusId)) { const f = $(focusId); f.value = val; f.focus(); try { f.setSelectionRange(sel, sel); } catch (e) {} }
  }

  /* ================= Facilitator ================= */
  async function startFac(c, k) {
    code = c; key = k;
    try { info = await api("GET", `/${c}`); }
    catch (err) { toast(err.message); show("landing"); return; }
    history.replaceState(null, "", `${BASE_PATH}workshop.html?code=${c}`);
    const joinUrl = BASE_PATH === "/" ? `${location.host}/join/${c}` : `${location.host}${BASE_PATH}workshop.html?code=${c}`;
    $("fCode").textContent = c;
    $("fReport").href = `${BASE_PATH}report.html?workshop=${c}`;
    setBrand(info.profile, info.demo ? `Workshop ${c} · DEMO DATA` : `Facilitating workshop ${c}`);
    fetch(BASE_PATH + "api/admin/me").then(r => r.json()).then(m => { $("fDemo").classList.toggle("hide", !m.signedIn); }).catch(() => {});
    $("brandNav").classList.remove("hide");
    $("fJoinUrl").textContent = joinUrl.replace(/^www\./, "");
    if (window.qrcode) {
      try { const q = window.qrcode(0, "M"); q.addData(`${location.protocol}//${joinUrl}`); q.make(); $("fQr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
    }
    show("fac");
    connect(`key=${encodeURIComponent(k)}`, {
      state: s => {
        $("fPeople").textContent = s.participants; $("fDone").textContent = s.completion + "%";
        $("fShare").checked = s.share.results; $("fClosed").checked = s.status === "closed";
        $("fSharePlan").checked = s.share.plan;
      },
      results: r => {
        results = r;
        renderPreserving($("fResults"), findingsHTML(r, true));
        const rc = Object.entries(r.roleCounts || {});
        $("fRoles").textContent = rc.length ? "Joined: " + rc.map(([role, n]) => `${ROLE_NAME[role] || role} ${n}`).join(" · ") : "";
      },
      ai: a => {
        aiState = a;
        if (document.activeElement !== $("fContext") && !$("fContext").dataset.dirty) $("fContext").value = (a.context && a.context.text) || "";
        $("fReport").innerHTML = a.report ? reportHTML(a.report) : "";
        $("fThemesOut").innerHTML = a.themes ? themesHTML(a.themes) : "";
        $("fPlan").innerHTML = a.plan ? planHTML(a.plan, true) : "";
        $("fSharePlan").disabled = !a.plan; $("fCopyPlan").disabled = !a.plan;
        if (results) renderPreserving($("fResults"), findingsHTML(results, true));
      },
    });
  }
  const control = (action, extra) => api("POST", `/${code}/control`, { action, ...extra }, key).catch(err => toast(err.message));

  $("fShare").addEventListener("change", e => control("shareResults", { value: e.target.checked }));
  $("fClosed").addEventListener("change", e => control("status", { value: e.target.checked ? "closed" : "open" }));
  $("fSharePlan").addEventListener("change", e => control("sharePlan", { value: e.target.checked }));
  $("fAgreeAll").addEventListener("click", () => control("agreeAll"));
  $("fDemo").addEventListener("click", async () => {
    if (!confirm("Add 10 made-up staff with realistic answers? Use this only for trying the workshop, never in a real school's workshop.")) return;
    try { const r = await api("POST", `/${code}/demo`, {}, key); setBrand(info.profile, `Workshop ${code} · DEMO DATA`); toast(`Added ${r.added} demo staff`); }
    catch (err) { toast(err.message); }
  });
  $("fPresent").addEventListener("click", () => {
    document.body.classList.add("present");
    if (!document.querySelector(".exitpresent")) {
      const b = document.createElement("button"); b.className = "btn exitpresent"; b.textContent = "Exit present mode";
      b.onclick = () => document.body.classList.remove("present"); document.body.append(b);
    }
  });
  $("fCopyLink").addEventListener("click", () => {
    copy(`${location.origin}${BASE_PATH}workshop.html?code=${code}#key=${key}`);
    toast("Facilitator link copied. Anyone with it can control this workshop, so share it carefully.");
  });
  $("fLeave").addEventListener("click", () => { if (es) es.close(); setBrand(null); document.body.classList.remove("present"); history.replaceState(null, "", BASE_PATH + "workshop.html"); renderLanding(); show("landing"); });

  document.querySelectorAll("[data-ff]").forEach(b => b.addEventListener("click", () => {
    ffilter = b.dataset.ff;
    document.querySelectorAll("[data-ff]").forEach(x => x.setAttribute("aria-pressed", x === b));
    if (results) renderPreserving($("fResults"), findingsHTML(results, true));
  }));
  $("fResults").addEventListener("click", e => {
    const b = e.target.closest("[data-agree]"); if (!b) return;
    const id = b.dataset.agree, item = findResult(id);
    const cur = item && item.agreed && item.agreed.s;
    control("agree", { itemId: id, s: cur === b.dataset.v ? null : b.dataset.v, note: ($("an-" + id) || {}).value || "" });
  });
  $("fResults").addEventListener("change", e => {
    const id = e.target.dataset.agreenote; if (!id) return;
    const item = findResult(id);
    control("agree", { itemId: id, s: item && item.agreed ? item.agreed.s : null, note: e.target.value });
  });
  function findResult(id) { for (const a of (results || { areas: [] }).areas) { const i = a.items.find(x => x.id === id); if (i) return i; } return null; }

  /* ----- Plan stage ----- */
  $("fContext").addEventListener("input", e => { e.target.dataset.dirty = "1"; $("fContextSaved").textContent = "Not saved"; });
  $("fSaveContext").addEventListener("click", async () => {
    await control("context", { text: $("fContext").value });
    delete $("fContext").dataset.dirty; $("fContextSaved").textContent = "Saved";
  });
  $("fReportFile").addEventListener("change", e => {
    const f = e.target.files[0]; reportFile = null;
    if (!f) { $("fReportName").textContent = "No file chosen"; return; }
    if (f.size > 18 * 1024 * 1024) { $("fReportName").textContent = "That PDF is over 18 MB. Paste the text instead."; return; }
    const r = new FileReader();
    r.onload = () => { reportFile = { name: f.name, data: r.result }; $("fReportName").textContent = f.name; };
    r.readAsDataURL(f);
  });
  async function aiAction(btn, out, path, body, waiting) {
    btn.disabled = true;
    const prev = out.innerHTML;
    out.innerHTML = `<div class="thinking">${esc(waiting)}</div>`;
    try { await api("POST", `/${code}/${path}`, body || {}, key); }
    catch (err) { out.innerHTML = prev + `<p class="error">${esc(err.message)}</p>`; }
    finally { btn.disabled = false; }
  }
  $("fReadReport").addEventListener("click", () => {
    const text = $("fReportText").value.trim();
    if (!reportFile && text.length < 200) return toast("Choose the report PDF or paste its text first.");
    aiAction($("fReadReport"), $("fReport"), "report", reportFile ? { filename: reportFile.name, pdf: reportFile.data } : { text }, "Reading the report. This can take a minute…");
  });
  $("fThemes").addEventListener("click", () => aiAction($("fThemes"), $("fThemesOut"), "themes", null, "Grouping staff comments into themes…"));
  $("fPlanBtn").addEventListener("click", () => {
    if ($("fContext").dataset.dirty) control("context", { text: $("fContext").value }).then(() => delete $("fContext").dataset.dirty);
    aiAction($("fPlanBtn"), $("fPlan"), "plan", null, "Writing your improvement plan. This can take up to two minutes…");
  });
  $("fCopyPlan").addEventListener("click", () => aiState.plan && copy(planText(aiState.plan)));

  function lineText(id) { for (const a of info.areas) { const i = a.items.find(x => x.id === id); if (i) return i.text; } return ""; }
  function reportHTML(r) {
    const con = (r.findings || []).filter(f => f.type === "concern"), str = (r.findings || []).filter(f => f.type === "strength");
    return `<div class="out">
      <p><b>${esc(r.filename || "Ofsted report")}</b>${r.inspectionDate ? ` · inspected ${esc(r.inspectionDate)}` : ""}${r.framework ? ` · ${esc(({ renewed: "renewed framework", earlier: "earlier framework", "pre-registration": "pre-registration inspection" }[r.framework] || r.framework))}` : ""}${r.safeguarding ? ` · safeguarding ${esc(r.safeguarding)}` : ""}</p>
      ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
      ${(r.grades || []).length ? `<div><h4>Grades</h4><ul>${r.grades.map(g => `<li>${esc(g.area)}: <b>${esc(g.grade)}</b></li>`).join("")}</ul></div>` : ""}
      ${(r.nextSteps || []).length ? `<div><h4>Next steps in the report</h4><ul>${r.nextSteps.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
      ${con.length ? `<div><h4>Concerns mapped to the checklist (${con.length})</h4><ul>${con.map(f => `<li>${esc(f.finding)}${f.itemId && lineText(f.itemId) ? ` <span class="muted small">→ ${esc(lineText(f.itemId))}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      ${str.length ? `<div><h4>Strengths</h4><ul>${str.map(f => `<li>${esc(f.finding)}</li>`).join("")}</ul></div>` : ""}
      <p class="muted small">Concerns also show on the matching lines in Live findings. AI reading, check against the report.</p></div>`;
  }
  function themesHTML(t) {
    return `<div class="out">${t.overall ? `<p>${esc(t.overall)}</p>` : ""}
      ${(t.areas || []).map(a => `<div><h4>${esc(a.area)}</h4><ul>${(a.themes || []).map(x => `<li><b>${esc(x.theme)}</b>${x.mentions ? ` <span class="muted small">(${esc(x.mentions)})</span>` : ""}: ${esc(x.detail)}</li>`).join("")}</ul></div>`).join("")}</div>`;
  }
  function planHTML(p, fac) {
    const pr = p.priorities || [];
    return `<div class="out">
      ${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
      ${!fac && p.staffMessage ? `<div class="staffmsg">${esc(p.staffMessage)}</div>` : ""}
      <ol class="plan-pr">${pr.map(x => `<li><b>${esc(x.title)}</b>
        <span class="muted small">${esc(x.area || "")}${fac && (x.sources || []).length ? `<span class="srcs">${x.sources.map(s => `<span class="src ${esc(s)}">${esc(s)}</span>`).join("")}</span>` : ""}</span>
        ${x.why ? `<span>${esc(x.why)}</span>` : ""}
        ${(x.actions || []).length ? `<div class="tablewrap"><table class="acttable"><thead><tr><th>Action</th>${fac ? "<th>Lead</th>" : ""}<th>By</th>${fac ? "<th>Evidence</th>" : ""}</tr></thead><tbody>
          ${x.actions.map(a => `<tr><td>${esc(a.action)}</td>${fac ? `<td>${esc(a.lead)}</td>` : ""}<td>${esc(a.by)}</td>${fac ? `<td>${esc(a.evidence)}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : ""}
        ${fac && x.successCriteria ? `<span class="small"><b>Success looks like:</b> ${esc(x.successCriteria)}</span>` : ""}
        ${fac && x.monitoring ? `<span class="small"><b>Monitoring:</b> ${esc(x.monitoring)}</span>` : ""}
      </li>`).join("")}</ol>
      ${fac && (p.complianceChecks || []).length ? `<div><h4>Compliance checks (fix now, alongside the plan)</h4><ul>${p.complianceChecks.map(c => `<li>${esc(c.item)}${c.lead ? ` <span class="muted small">(${esc(c.lead)}${c.by ? ", " + esc(c.by) : ""})</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      ${(p.quickWins || []).length ? `<div><h4>Quick wins (next two weeks)</h4><ul>${p.quickWins.map(q => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
      ${fac && p.staffMessage ? `<div><h4>Message for staff (shown when you share the plan)</h4><div class="staffmsg">${esc(p.staffMessage)}</div></div>` : ""}
      <p class="muted small">${fac ? "AI draft for the headteacher to edit and adopt. Not an Ofsted judgement." : "Shared by your leadership team."}</p></div>`;
  }
  function planText(p) {
    let t = `SCHOOL IMPROVEMENT PLAN: THIS TERM – ${info.profile.name || "Our school"}\nFrom staff workshop ${code}, ${new Date().toLocaleDateString("en-GB")}\n\n${p.summary || ""}\n`;
    (p.priorities || []).forEach((x, n) => {
      t += `\n${n + 1}. ${x.title} (${x.area || ""})${(x.sources || []).length ? ` [${x.sources.join(", ")}]` : ""}\n${x.why || ""}\n`;
      (x.actions || []).forEach(a => { t += `   - ${a.action} | Lead: ${a.lead || "-"} | By: ${a.by || "-"} | Evidence: ${a.evidence || "-"}\n`; });
      if (x.successCriteria) t += `   Success: ${x.successCriteria}\n`;
      if (x.monitoring) t += `   Monitoring: ${x.monitoring}\n`;
    });
    if ((p.complianceChecks || []).length) t += `\nCOMPLIANCE CHECKS (fix now)\n` + p.complianceChecks.map(c => `- ${c.item}${c.lead ? ` | Lead: ${c.lead}` : ""}${c.by ? ` | By: ${c.by}` : ""}`).join("\n") + "\n";
    if ((p.quickWins || []).length) t += `\nQUICK WINS\n` + p.quickWins.map(q => `- ${q}`).join("\n") + "\n";
    if (p.staffMessage) t += `\nMESSAGE FOR STAFF\n${p.staffMessage}\n`;
    return t;
  }

  /* ----- Export ----- */
  function checklistData() {
    const answers = {}, notes = {};
    results.areas.forEach(a => a.items.forEach(i => {
      if (!i.agreed || !i.agreed.s) return;
      answers[i.id] = i.agreed.s;
      const c = i.counts;
      notes[i.id] = [i.agreed.note, `Workshop ${code}: ${c.met} met, ${c.part} partly, ${c.no} not yet (${c.n} staff)`].filter(Boolean).join(" · ");
    }));
    // The workshop's improvement plan comes across as actions in the checklist's action plan
    const actions = [];
    ((aiState.plan && aiState.plan.priorities) || []).forEach(pr => (pr.actions || []).forEach(x => actions.push({
      id: Math.random().toString(36).slice(2, 10), title: x.action || pr.title,
      detail: [pr.title ? "Priority: " + pr.title : "", x.by ? "By: " + x.by : "", x.evidence ? "Evidence: " + x.evidence : ""].filter(Boolean).join("\n"),
      itemId: (pr.lines || [])[0] || "", owner: x.lead || "", due: "", success: pr.successCriteria || "", status: "todo", source: "workshop", createdAt: new Date().toISOString(),
    })));
    ((aiState.plan && aiState.plan.complianceChecks) || []).forEach(c => actions.push({
      id: Math.random().toString(36).slice(2, 10), title: c.item, detail: "Compliance check from the workshop plan" + (c.by ? "\nBy: " + c.by : ""),
      itemId: "", owner: c.lead || "", due: "", success: "", status: "todo", source: "workshop", createdAt: new Date().toISOString(),
    }));
    return { answers, notes, actions };
  }
  $("fExportChecklist").addEventListener("click", () => {
    if (!results) return toast("No findings yet.");
    const { answers, notes, actions } = checklistData();
    if (!Object.keys(answers).length) return toast("Agree some ratings first on the Live findings tab.");
    const data = { version: 2, profile: { ...info.profile, by: `Staff workshop ${code}`, date: new Date().toISOString().slice(0, 10) }, answers, notes, ai: {}, review: null, collapsed: {}, actions };
    copy(JSON.stringify(data), $("fExportBox"));
  });
  // Straight into the school's saved self-evaluation (needs the school's access code on this device)
  $("fSendChecklist").addEventListener("click", async () => {
    if (!results) return toast("No findings yet.");
    const { answers, notes, actions } = checklistData();
    if (!Object.keys(answers).length) return toast("Agree some ratings first on the Live findings tab.");
    const b = $("fSendChecklist"); b.disabled = true;
    try {
      const r = await fetch(BASE_PATH + "api/school", { credentials: "same-origin" });
      if (r.status === 401) throw new Error("Sign in with your school access code on this device first (open the checklist), or use Copy as data instead.");
      const cur = await r.json();
      if (!r.ok) throw new Error(cur.error || "Couldn't reach your school's checklist.");
      const st = cur.state || { notes: {}, actions: [] };
      const set = {};
      for (const [id, v] of Object.entries(answers)) {
        set["answers." + id] = v;
        const old = (st.notes || {})[id] || "";
        set["notes." + id] = old && !old.includes(`Workshop ${code}`) ? old + "\n" + notes[id] : old.includes(`Workshop ${code}`) ? old : notes[id];
      }
      const have = new Set((st.actions || []).filter(a => a.source === "workshop").map(a => a.title));
      const fresh = actions.filter(a => !have.has(a.title));
      const res = await fetch(BASE_PATH + "api/school", { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRev: cur.rev, patch: { set, ...(fresh.length ? { actions: { upsert: fresh, del: [] } } : {}) } }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save to your checklist.");
      toast(`Sent ${Object.keys(answers).length} agreed rating${Object.keys(answers).length === 1 ? "" : "s"}${fresh.length ? ` and ${fresh.length} action${fresh.length === 1 ? "" : "s"}` : ""} to your checklist`);
    } catch (err) { toast(err.message); }
    b.disabled = false;
  });
  $("fExportAll").addEventListener("click", async () => {
    try { const d = await api("GET", `/${code}/export`, null, key); copy(JSON.stringify(d, null, 1), $("fExportBox")); }
    catch (err) { toast(err.message); }
  });

  /* ================= Start ================= */
  (async function init() {
    renderLanding();
    try {
      const a = await fetch(BASE_PATH + "api/access").then(r => r.json());
      if (a.required && !a.ok) { $("createFields").classList.add("hide"); $("createLocked").classList.remove("hide"); }
      else if (a.school && !$("cName").value) $("cName").value = a.school;
      if (a.ok) {
        const sc = await fetch(BASE_PATH + "api/school").then(r => r.ok ? r.json() : null).catch(() => null);
        savedOfsted = sc && sc.state && sc.state.ofsted;
        // Start from the school's own settings when it has them
        const p = sc && sc.state && sc.state.profile;
        if (p && p.phases && p.phases.length && !cProfile.phases.length) { cProfile.type = p.type; cProfile.phases = p.phases.slice(); cProfile.special = !!p.special; if (!$("cName").value && p.name) $("cName").value = p.name; $("cSpecial").checked = cProfile.special; cAreas = null; renderLanding(); }
      }
      renderCOfsted();
    } catch (e) {}
    const params = new URLSearchParams(location.search);
    const c = (params.get("code") || "").toUpperCase();
    const hk = (location.hash.match(/key=([a-f0-9]+)/) || [])[1];
    if (c && hk) {
      const fac = ls.get(FAC_KEY, {}); fac[c] = { ...(fac[c] || {}), key: hk, at: new Date().toISOString() }; ls.set(FAC_KEY, fac);
      return startFac(c, hk);
    }
    if (c) {
      const fac = ls.get(FAC_KEY, {});
      if (fac[c]) return startFac(c, fac[c].key);
      const me = ls.get(STAFF_KEY(c));
      if (me) return startStaff(c, me);
      $("joinCode").value = c;
    }
    show("landing");
  })();
})();
