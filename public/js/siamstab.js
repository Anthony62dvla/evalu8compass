/*
 * Evalu8 Compass — the SIAMS tab (Church of England and Methodist schools only).
 * Context, vision, and for each Inspection Question: evidence of impact, what isn't yet true,
 * and leaders' honest view of whether they can answer it "yes". Builds the SIAMS self-evaluation.
 */
(function (root) {
  const SI = root.HWWD.siams, C = root.HWWD.checks;
  let H, I, esc, el, P;
  const st = () => H.state();
  const sm = () => st().siams || (st().siams = {});
  const today = () => new Date().toISOString().slice(0, 10);
  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const openSec = { ctx1: null, ctx2: null };
  let showDoc = false, srFile = null, srBusy = false, srOpen = false;
  const aiOn = () => (st().profile || {}).ai !== false;

  /** Reading the last SIAMS report with the AI, and what it found. */
  function readerHTML(last) {
    const rd = last.reading;
    if (srBusy) return `<div class="si-read busy" role="status">${I("sparkles", 18)}Reading your SIAMS report… this can take a minute.</div>`;
    const form = `<div class="si-read-form">
        <div class="of-row"><label class="btn filebtn">${I("file-upload", 18)}Choose PDF<input type="file" id="srFile" accept="application/pdf"></label><span class="muted" id="srName">${srFile ? esc(srFile.name) : "No file chosen"}</span></div>
        <details><summary>Or paste the report text</summary><label class="sr-only" for="srText">SIAMS report text</label><textarea id="srText" rows="4" placeholder="Paste the full report text here"></textarea></details>
        <div class="of-row"><button class="btn ai" type="button" data-srread="1"${aiOn() ? "" : " disabled"}>${I("sparkles", 18)}Read the report</button><span class="muted">${aiOn() ? "Uses one AI request." : "Needs AI suggestions switched on in Step 1."}</span></div>
        <p class="error" id="srErr" role="alert"></p></div>`;
    if (!rd) return `<div class="si-read"><p class="small"><b>Upload your last SIAMS report</b> and the AI will read it: the outcome, strengths and areas for development, and which Inspection Question each relates to. Or fill in the details below yourself.</p>${form}</div>`;
    const vis = ((sm().ctx2 || {}).vision || "").trim();
    return `<div class="si-read done">
      <p class="small"><b>Your last SIAMS report${last.filename ? " (" + esc(last.filename) + ")" : ""}</b>, read ${esc(nice(last.at))}. ${rd.outcome === "earlier" ? "Inspected under the previous framework" + ((rd.earlierGrades || []).length ? ": " + esc(rd.earlierGrades.map(g => `${g.area} ${g.grade}`).join("; ")) : "") + "." : ""}</p>
      ${rd.summary ? `<p class="si-sum">${esc(rd.summary)}</p>` : ""}
      ${(rd.strengths || []).length ? `<div class="si-list"><span class="lbl">Strengths</span><ul>${rd.strengths.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${rd.vision && !vis ? `<p class="small">The report records your vision as: <b>${esc(rd.vision)}</b> <button class="btn" type="button" data-srvision="1">${I("copy", 16)}Use it in "What are we doing here?"</button></p>` : ""}
      <p class="small">The AI reads the report for you: check the outcome and areas for development against your copy.</p>
      <button class="linkbtn" type="button" data-sragain="1" aria-expanded="${srOpen}">${srOpen ? "Cancel" : "Read a newer report"}</button>
      ${srOpen ? form : ""}
    </div>`;
  }
  async function readReport() {
    const text = (el("srText") && el("srText").value.trim()) || "";
    if (!srFile && text.length < 200) { el("srErr").textContent = "Choose the report PDF, or paste its full text."; return; }
    srBusy = true; render();
    try {
      await H.flush();
      const r = await fetch("api/school/siams/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(srFile ? { pdf: srFile.data, filename: srFile.name } : { text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "The report couldn't be read. Try again.");
      sm().last = d.last; srFile = null; srOpen = false; srBusy = false; H.save(); render();
      H.toast("SIAMS report read and saved");
    } catch (e) { srBusy = false; render(); const er = el("srErr"); if (er) er.textContent = e.message; else H.toast(e.message); }
  }

  function filled(obj, defs) { return defs.filter(d => ((obj || {})[d[0]] || "").trim()).length; }

  function render() {
    const box = el("siamsList"); if (!box) return;
    const p = st().profile || {};
    if (!SI.isChurch(p)) { box.innerHTML = `<p class="small">Choose <b>Church school</b> in Step 1 to use SIAMS.</p>`; return; }
    const s = sm(), stt = SI.status(st()), last = s.last || {}, due = SI.nextDue(st());
    const c1 = s.ctx1 || {}, c2 = s.ctx2 || {};
    const n1 = filled(c1, SI.CTX1), n2 = filled(c2, SI.CTX2);
    if (openSec.ctx1 === null) openSec.ctx1 = n1 < 2; if (openSec.ctx2 === null) openSec.ctx2 = n2 < 3;
    box.innerHTML = `
    <section class="si-stand" aria-labelledby="siStandH">
      <div class="sg-head"><h3 id="siStandH">${I("compass", 20)}Where we stand</h3><span class="sg-count${stt.ready ? " all" : ""}">${stt.yes} of ${stt.total} answered "yes"</span></div>
      <p class="small">SIAMS has no criteria to meet. For each Inspection Question, the inspector asks whether leaders can show, with evidence, that the answer is yes. If every answer is yes, the school is living up to its foundation as a Church school. This is your own honest view, not a prediction.</p>
      <ul class="si-chips">${stt.list.map(x => `<li><a href="#si-${x.q.id}" class="si-chip j-${x.judge || "none"}"><b>IQ${x.q.n}</b> ${esc(x.q.short)}<span>${x.judge ? SI.JUDGE[x.judge] : "Not yet considered"}</span></a></li>`).join("")}</ul>
      ${readerHTML(last)}
      <div class="si-last">
        <div class="field"><label for="siLastDate">Last SIAMS inspection</label><input type="date" id="siLastDate" data-si="last.date" value="${esc(last.date || "")}"></div>
        <div class="field"><label for="siLastOut">Outcome</label><select id="siLastOut" data-si="last.outcome"><option value="">Choose…</option><option value="J1"${last.outcome === "J1" ? " selected" : ""}>J1: living up to its foundation</option><option value="J2"${last.outcome === "J2" ? " selected" : ""}>J2: strengths, with issues to address</option><option value="other"${last.outcome === "other" ? " selected" : ""}>Under the previous framework</option></select></div>
        <div class="field wide"><label for="siLastAreas">Areas for development from that report <span class="muted-inline">(one per line)</span></label><textarea id="siLastAreas" data-si="last.areas" rows="3">${esc(last.areas || "")}</textarea></div>
      </div>
      ${due ? `<p class="small">SIAMS usually inspects every five years: your next inspection is likely around <b>${esc(nice(due))}</b>. Check the National Society's list of likely inspections each summer.</p>` : ""}
    </section>

    <details class="si-sec" data-sisec="ctx1"${openSec.ctx1 ? " open" : ""}><summary><span class="si-h">Who are we?</span><span class="small">Factual context: no judgement is made on it · ${n1} of ${SI.CTX1.length} written</span></summary>
      <div class="si-body">
        <p class="small">From Step 1: ${esc(SI.CHURCH[p.church])} school${p.designation ? ", " + esc(SI.DESIGNATION[p.designation].toLowerCase()) : ""}, ${p.type === "academy" ? "academy" : "maintained"}.${p.designation ? "" : " <b>Choose your designation in Step 1.</b>"}</p>
        <div class="field si-roll"><label for="siRoll">Pupils on roll</label><input id="siRoll" data-si="roll" inputmode="numeric" value="${esc(s.roll || "")}"></div>
        ${SI.CTX1.map(([k, label]) => `<div class="field"><label for="si1-${k}">${esc(label)}</label><textarea id="si1-${k}" data-si="ctx1.${k}" rows="2">${esc(c1[k] || "")}</textarea></div>`).join("")}
      </div></details>

    <details class="si-sec" data-sisec="ctx2"${openSec.ctx2 ? " open" : ""}><summary><span class="si-h">What are we doing here?</span><span class="small">Your vision, its theology and your arrangements: this informs the judgements · ${n2} of ${SI.CTX2.length} written</span></summary>
      <div class="si-body">
        <p class="small">Write these in your own words. Inspectors look for a vision leaders genuinely own and understand, so Evalu8 Compass won't write it for you.</p>
        ${SI.CTX2.map(([k, label, hint]) => `<div class="field"><label for="si2-${k}">${esc(label)}</label>${hint ? `<p class="small" id="si2h-${k}">${esc(hint)}</p>` : ""}<textarea id="si2-${k}" data-si="ctx2.${k}" rows="${k === "vision" || k === "theology" ? 4 : 3}"${hint ? ` aria-describedby="si2h-${k}"` : ""}>${esc(c2[k] || "")}</textarea></div>`).join("")}
      </div></details>

    <h3 class="si-iqh">How, then, shall we live and learn together?</h3>
    ${stt.list.map(x => iqCard(x, p)).join("")}

    <section class="si-doc" aria-labelledby="siDocH">
      <h3 id="siDocH">${I("file-text", 20)}SIAMS self-evaluation</h3>
      <p class="small">Written from everything above, organised as the framework is. Brief and focused, as SIAMS asks. Share it with your diocesan adviser and governors, and have it ready for the inspector.</p>
      <div class="row"><button class="btn" type="button" data-sidoc="1" aria-expanded="${showDoc}">${I("eye", 16)}${showDoc ? "Hide" : "Read"} the self-evaluation</button>
        <button class="btn" type="button" data-siprint="1">${I("file-export", 16)}Print or save as PDF</button>
        <button class="btn primary" type="button" data-sisend="1">${I("mail", 16)}Email to the head and our adviser</button></div>
      <div class="lead-preview${showDoc ? "" : " hide"}" id="siDoc">${showDoc ? H.renderDoc(SI.sef(st())) : ""}</div>
    </section>`;
  }

  function iqCard(x, p) {
    const q = x.q, v = sm()[q.id] || {}, mon = SI.evidenceFor(st(), q.id);
    const fromReport = ((((sm().last || {}).reading) || {}).findings || []).filter(f => f.iq === q.id);
    const acts = (st().actions || []).filter(a => a.siams === q.id);
    return `<article class="si-iq j-${x.judge || "none"}" id="si-${q.id}" aria-labelledby="siq-${q.id}">
      <div class="si-iq-top"><span class="si-n">IQ${q.n}</span><h4 id="siq-${q.id}">${esc(q.q)}</h4></div>
      <ul class="si-prompts">${q.prompts.map(t => `<li>${esc(t)}</li>`).join("")}${q.trust && SI.isAcademy(p) ? `<li>${esc(q.trust)}</li>` : ""}</ul>
      ${fromReport.length ? `<div class="si-rep"><span class="lbl">From your last SIAMS report</span><ul>${fromReport.map(f => `<li class="${f.type}"><b>${f.type === "strength" ? "Strength" : "To develop"}:</b> ${esc(f.finding)}</li>`).join("")}</ul></div>` : ""}
      <div class="two">
        <div class="field"><label for="sie-${q.id}">Evidence of impact</label><textarea id="sie-${q.id}" data-si="${q.id}.evidence" rows="5" placeholder="What difference does this make, for whom, and how do you know? What would pupils, staff, parents and the church say?">${esc(v.evidence || "")}</textarea></div>
        <div class="field"><label for="sin-${q.id}">What isn't yet true, and what we're doing about it</label><textarea id="sin-${q.id}" data-si="${q.id}.next" rows="5">${esc(v.next || "")}</textarea></div>
      </div>
      <fieldset class="judge-pick"><legend>Can we answer this "yes", with evidence?</legend>${Object.entries(SI.JUDGE).map(([k, l]) => `<label class="switch"><input type="radio" name="sij-${q.id}" value="${k}" data-sij="${q.id}"${v.judge === k ? " checked" : ""}> ${l}</label>`).join("")}</fieldset>
      ${x.judge === "partly" || x.judge === "notyet" ? `<p class="si-gap">${I("alert-triangle", 16)}<span>If an inspector couldn't answer this "yes", the report would say leaders have not ensured ${esc(q.gap)}.</span></p>` : ""}
      <div class="si-ev"><span class="lbl">Monitoring linked to IQ${q.n}</span>${mon.length ? `<ul>${mon.slice(0, 6).map(r => `<li>${esc(C.line(r))}</li>`).join("")}</ul>` : `<span class="small">None yet. In the Monitoring tab, choose this question under <b>SIAMS Inspection Question</b>${q.id === "iq3" ? ", for example when you record collective worship" : q.id === "iq6" || q.id === "iq7" ? ", for example when you record an RE visit" : ""}.</span>`}</div>
      ${acts.length ? `<ul class="ag-acts">${acts.map(a => `<li>${I(a.status === "done" ? "circle-check" : "target", 16)}<span><b>${esc(a.title || "Action")}</b>${a.owner ? " · " + esc(a.owner) : ""}${a.due ? " · due " + esc(a.due) : ""}</span></li>`).join("")}</ul>` : ""}
      <div class="row"><button class="btn" type="button" data-siact="${q.id}">${I("target", 16)}Add an action for IQ${q.n}</button></div>
    </article>`;
  }

  function set(path, val) {
    const [a, b] = path.split("."), s = sm();
    if (!b) s[a] = val;
    else { s[a] = { ...(s[a] || {}) }; s[a][b] = val; if (/^iq\d$/.test(a)) s[a].updatedAt = new Date().toISOString(); }
    H.save();
    if (showDoc) { const d = el("siDoc"); if (d) d.innerHTML = H.renderDoc(SI.sef(st())); }
  }
  function print() {
    const d = el("siDoc"); d.innerHTML = H.renderDoc(SI.sef(st())); d.classList.remove("hide");
    document.body.classList.add("print-doc"); d.classList.add("printing"); window.print();
    setTimeout(() => { document.body.classList.remove("print-doc"); d.classList.remove("printing"); if (!showDoc) d.classList.add("hide"); }, 500);
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b || !el("siamsView") || !el("siamsView").contains(b)) return false;
    const d = b.dataset;
    if (d.srread) { readReport(); return true; }
    if (d.sragain) { srOpen = !srOpen; render(); return true; }
    if (d.srvision) { const rd = (sm().last || {}).reading; if (rd && rd.vision) { const c2 = { ...(sm().ctx2 || {}) }; c2.vision = rd.vision; sm().ctx2 = c2; H.save(); openSec.ctx2 = true; render(); H.toast("Vision added. Check it and write how it is theologically rooted."); } return true; }
    if (d.sidoc) { showDoc = !showDoc; render(); const t = document.querySelector("[data-sidoc]"); if (t) t.focus(); return true; }
    if (d.siprint) { print(); return true; }
    if (d.sisend) {
      b.disabled = true;
      H.flush().then(() => fetch("api/school/siams/send", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))
        .then(r => r.json().then(j => ({ ok: r.ok, j })))
        .then(({ ok, j }) => H.toast(ok ? `Self-evaluation emailed to ${j.sent} ${j.sent === 1 ? "person" : "people"}` : j.error || "That didn't send."))
        .catch(() => H.toast("Couldn't reach the server. Try again.")).finally(() => { b.disabled = false; });
      return true;
    }
    if (d.siact) {
      const q = SI.IQS.find(x => x.id === d.siact), v = sm()[q.id] || {};
      const first = String(v.next || "").split(/\n|\. /)[0].trim().slice(0, 140);
      const a = P.add({ title: first || `Strengthen IQ${q.n}: ${q.short.toLowerCase()}`, owner: "", source: "siams", siams: q.id, detail: `SIAMS Inspection Question ${q.n}: ${q.q}`, status: "todo" }, true);
      H.save(); render(); P.render(); H.toast(first ? "Added to the improvement plan. Give it an owner and date there." : "Action added: describe it in the Action plan tab.");
      return true;
    }
    return false;
  }
  function onInput(e) {
    const t = e.target; if (!t.dataset || !t.dataset.si || t.tagName === "SELECT" || t.type === "date") return;
    set(t.dataset.si, t.dataset.si === "roll" ? t.value.replace(/[^\d]/g, "").slice(0, 5) : t.value);
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === "srFile") {
      const f = t.files[0]; srFile = null; el("srErr").textContent = "";
      if (!f) { el("srName").textContent = "No file chosen"; return; }
      if (f.size > 25 * 1024 * 1024) { el("srErr").textContent = "That PDF is over 25 MB. Paste the text instead."; return; }
      const fr = new FileReader(); fr.onload = () => { srFile = { name: f.name, data: fr.result }; el("srName").textContent = f.name; }; fr.readAsDataURL(f);
      return;
    }
    if (t.dataset && t.dataset.si && (t.tagName === "SELECT" || t.type === "date")) { set(t.dataset.si, t.value); render(); const again = el(t.id); if (again) again.focus(); return; }
    if (t.dataset && t.dataset.sij) { set(t.dataset.sij + ".judge", t.value); render(); const again = document.querySelector(`[data-sij="${t.dataset.sij}"][value="${t.value}"]`); if (again) again.focus(); }
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; P = host.plan; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("toggle", e => { const k = e.target.dataset && e.target.dataset.sisec; if (k) openSec[k] = e.target.open; }, true);
  }
  function isEditing() { const a = document.activeElement; return !!(a && el("siamsView") && el("siamsView").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  root.HWWD.siamstab = { init, render, isEditing };
})(window);
