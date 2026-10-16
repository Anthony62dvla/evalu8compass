/*
 * Evalu8 Compass — the Catholic schools inspection tab (Catholic schools only).
 * The three key areas, each through pupil outcomes, provision and leadership; compliance;
 * the response to the last inspection's areas for improvement; and the CSED.
 */
(function (root) {
  const CS = root.HWWD.csi, C = root.HWWD.checks;
  let H, I, esc, el, P;
  const st = () => H.state();
  const cs = () => st().csi || (st().csi = {});
  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const aiOn = () => (st().profile || {}).ai !== false;
  const CTX = [["mission", "Our mission statement", 3], ["context", "Our context: pupils, families and community", 3], ["diocese", "Our diocese", 1], ["parish", "Our parish, priest and chaplaincy", 2], ["trust", "Our trust (if an academy) and governance", 2]];
  let showDoc = false, crFile = null, crBusy = false, crOpen = false, openCtx = null;
  const gradeOpts = (v, none) => `<option value="">${none || "Not graded"}</option>` + [1, 2, 3, 4].map(g => `<option value="${g}"${Number(v) === g ? " selected" : ""}>${g}: ${CS.GRADES[g]}</option>`).join("");

  function readerHTML(last) {
    const rd = last.reading;
    if (crBusy) return `<div class="si-read busy" role="status">${I("sparkles", 18)}Reading your inspection report… this can take a minute.</div>`;
    const form = `<div class="si-read-form">
        <div class="of-row"><label class="btn filebtn">${I("file-upload", 18)}Choose PDF<input type="file" id="crFile" accept="application/pdf"></label><span class="muted" id="crName">${crFile ? esc(crFile.name) : "No file chosen"}</span></div>
        <details><summary>Or paste the report text</summary><label class="sr-only" for="crText">Inspection report text</label><textarea id="crText" rows="4" placeholder="Paste the full report text here"></textarea></details>
        <div class="of-row"><button class="btn ai" type="button" data-crread="1"${aiOn() ? "" : " disabled"}>${I("sparkles", 18)}Read the report</button><span class="muted">${aiOn() ? "Uses one AI request." : "Needs AI suggestions switched on in Step 1."}</span></div>
        <p class="error" id="crErr" role="alert"></p></div>`;
    if (!rd) return `<div class="si-read"><p class="small"><b>Upload your last Catholic schools inspection report</b> (CSI, or your diocese's section 48 report) and the AI will read it: the grades, strengths and areas for improvement, mapped to each area. Or fill in the details below yourself.</p>${form}</div>`;
    const mission = ((cs().ctx || {}).mission || "").trim();
    return `<div class="si-read done">
      <p class="small"><b>Your last inspection report${last.filename ? " (" + esc(last.filename) + ")" : ""}</b>, read ${esc(nice(last.at))}.</p>
      ${rd.summary ? `<p class="si-sum">${esc(rd.summary)}</p>` : ""}
      ${(rd.strengths || []).length ? `<div class="si-list"><span class="lbl">Strengths</span><ul>${rd.strengths.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      ${rd.mission && !mission ? `<p class="small">The report quotes your mission as: <b>${esc(rd.mission)}</b> <button class="btn" type="button" data-crmission="1">${I("copy", 16)}Use it as our mission statement</button></p>` : ""}
      <p class="small">The AI reads the report for you: check the grades and areas for improvement against your copy.</p>
      <button class="linkbtn" type="button" data-cragain="1" aria-expanded="${crOpen}">${crOpen ? "Cancel" : "Read a newer report"}</button>
      ${crOpen ? form : ""}</div>`;
  }

  function render() {
    const box = el("csiList"); if (!box) return;
    const p = st().profile || {};
    if (!CS.isCatholic(p)) { box.innerHTML = `<p class="small">Choose <b>Catholic</b> under Church school in Step 1.</p>`; return; }
    const c = cs(), stt = CS.status(st()), last = c.last || {}, due = CS.nextDue(st()), ctx = c.ctx || {}, comp = c.comp || {};
    const nCtx = CTX.filter(([k]) => (ctx[k] || "").trim()).length; if (openCtx === null) openCtx = nCtx < 2;
    box.innerHTML = `
    <section class="si-stand" aria-labelledby="csStandH">
      <div class="sg-head"><h3 id="csStandH">${I("compass", 20)}Where we stand</h3><span class="sg-count${stt.overall && stt.overall <= 2 ? " all" : ""}">${stt.overall ? "Points to: " + CS.GRADES[stt.overall] : `${stt.rated} of 9 graded`}</span></div>
      <p class="small">Your own best-fit grades on the inspection scale. Each key area's grade is suggested from its three parts; change it if your best fit differs. The overall grade follows the handbook: it can't be higher than any key area, needs every area for improvement fully addressed to be good, and full compliance to be outstanding.</p>
      <div class="doc-tbl"><table class="cs-grid"><thead><tr><th scope="col">Key area</th>${CS.SUBS.map(([, l]) => `<th scope="col">${l}</th>`).join("")}<th scope="col">Key area grade</th></tr></thead><tbody>
        ${stt.areas.map(a => `<tr><th scope="row"><a href="#cs-${a.id}">${esc(a.name)}</a></th>${a.subs.map(s => `<td class="g${s.grade}">${s.grade ? CS.GRADES[s.grade] : "–"}</td>`).join("")}
          <td><label class="sr-only" for="csKey-${a.id}">${esc(a.name)} grade</label><select id="csKey-${a.id}" data-cs="key_${a.id}.grade">${gradeOpts((c["key_" + a.id] || {}).grade, a.suggested ? `Suggested: ${CS.GRADES[a.suggested]}` : "Not graded")}</select></td></tr>`).join("")}
      </tbody></table></div>
      ${readerHTML(last)}
      <div class="si-last">
        <div class="field"><label for="csLastDate">Last inspection</label><input type="date" id="csLastDate" data-cs="last.date" value="${esc(last.date || "")}"></div>
        <div class="field"><label for="csLastOverall">Overall grade then</label><select id="csLastOverall" data-cs="last.overall">${gradeOpts(last.overall, "Choose…")}</select></div>
        <div class="field wide"><label for="csLastAreas">Areas for improvement from that report <span class="muted-inline">(one per line)</span></label><textarea id="csLastAreas" data-cs="last.areas" rows="3">${esc(last.areas || "")}</textarea></div>
      </div>
      ${due ? `<p class="small">Your next Catholic schools inspection is likely around <b>${esc(nice(due))}</b> (normally five years after a good or better outcome, three otherwise). Inspections come with two working days' notice.</p>` : ""}
    </section>

    <details class="si-sec" data-cssec="1"${openCtx ? " open" : ""}><summary><span class="si-h">Our school and mission</span><span class="small">${nCtx} of ${CTX.length} written</span></summary>
      <div class="si-body">
        <div class="cs-nums"><div class="field si-roll"><label for="csRoll">Pupils on roll</label><input id="csRoll" data-cs="roll" inputmode="numeric" value="${esc(c.roll || "")}"></div>
        <div class="field si-roll"><label for="csPct">Baptised Catholic (%)</label><input id="csPct" data-cs="catholicPct" inputmode="numeric" value="${esc(c.catholicPct || "")}"></div></div>
        ${CTX.map(([k, label, rows]) => `<div class="field"><label for="csc-${k}">${esc(label)}</label><textarea id="csc-${k}" data-cs="ctx.${k}" rows="${rows}">${esc(ctx[k] || "")}</textarea></div>`).join("")}
      </div></details>

    <section class="si-stand" aria-labelledby="csCompH">
      <h3 id="csCompH" class="cs-h3">${I("clipboard-check", 20)}Compliance and areas for improvement</h3>
      <div class="cs-comp">${CS.COMPLIANCE.map(([k, label]) => `<div class="field"><label for="csComp-${k}">${esc(label)}</label><select id="csComp-${k}" data-cs="comp.${k}"><option value="">Not yet confirmed</option>${Object.entries(CS.COMP).map(([v, l]) => `<option value="${v}"${comp[k] === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>`).join("")}</div>
      ${stt.afiList.length ? `<h4 class="cs-h4">How well have we addressed our last areas for improvement?</h4>${stt.afiList.map((t, i) => `<div class="field"><label for="csAfi-${i}">${esc(t)}</label><select id="csAfi-${i}" data-cs="afi.${i}"><option value="">Not yet evaluated</option>${Object.entries(CS.AFI).map(([v, l]) => `<option value="${v}"${(c.afi || {})[i] === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>`).join("")}`
        : `<p class="small">Add your last report's areas for improvement above, then say how far each has been addressed.</p>`}
    </section>

    ${CS.AREAS.map(a => `<h3 class="si-iqh" id="cs-${a.id}">${esc(a.name)}</h3>${CS.SUBS.map(([s, label]) => subCard(a, s, label)).join("")}`).join("")}

    <section class="si-doc" aria-labelledby="csDocH">
      <h3 id="csDocH">${I("file-text", 20)}Catholic self-evaluation (CSED)</h3>
      <p class="small">Written from everything above, organised by key area and by pupil outcomes, provision and leadership. Share it with your diocese and governors, and have it ready for the inspection team.</p>
      <div class="row"><button class="btn" type="button" data-csdoc="1" aria-expanded="${showDoc}">${I("eye", 16)}${showDoc ? "Hide" : "Read"} the CSED</button>
        <button class="btn" type="button" data-csprint="1">${I("file-export", 16)}Print or save as PDF</button>
        <button class="btn primary" type="button" data-cssend="1">${I("mail", 16)}Email to the head and our adviser</button></div>
      <div class="lead-preview${showDoc ? "" : " hide"}" id="csDoc">${showDoc ? H.renderDoc(CS.csed(st())) : ""}</div>
    </section>`;
  }

  function subCard(a, s, label) {
    const id = `${a.id}_${s}`, v = cs()[id] || {}, mon = CS.evidenceFor(st(), id);
    const fromReport = ((((cs().last || {}).reading) || {}).findings || []).filter(f => f.sub === id);
    const acts = (st().actions || []).filter(x => x.csi === id);
    const g = Number(v.grade) || 0;
    return `<article class="si-iq cs-g${g}" id="cs-${id}" aria-labelledby="csq-${id}">
      <div class="si-iq-top"><span class="si-n">${esc(a.short)}</span><h4 id="csq-${id}">${esc(a.name)}: ${esc(label)}</h4></div>
      <ul class="si-prompts">${CS.PROMPTS[id].map(t => `<li>${esc(t)}</li>`).join("")}</ul>
      ${fromReport.length ? `<div class="si-rep"><span class="lbl">From your last inspection report</span><ul>${fromReport.map(f => `<li><b>${f.type === "strength" ? "Strength" : "To improve"}:</b> ${esc(f.finding)}</li>`).join("")}</ul></div>` : ""}
      <div class="two">
        <div class="field"><label for="cse-${id}">Strengths and evidence</label><textarea id="cse-${id}" data-cs="${id}.evidence" rows="5" placeholder="What is strong, for whom, and how do you know? What would pupils, staff, parents and the parish say?">${esc(v.evidence || "")}</textarea></div>
        <div class="field"><label for="csn-${id}">Areas to develop</label><textarea id="csn-${id}" data-cs="${id}.next" rows="5">${esc(v.next || "")}</textarea></div>
      </div>
      <fieldset class="judge-pick"><legend>Our best-fit grade</legend>${[1, 2, 3, 4].map(n => `<label class="switch"><input type="radio" name="csg-${id}" value="${n}" data-csg="${id}"${g === n ? " checked" : ""}> ${CS.GRADES[n]}</label>`).join("")}</fieldset>
      <div class="si-ev"><span class="lbl">Monitoring linked here</span>${mon.length ? `<ul>${mon.slice(0, 6).map(r => `<li>${esc(C.line(r))}</li>`).join("")}</ul>` : `<span class="small">None yet. In the Monitoring tab, choose this under <b>Catholic schools inspection</b>.</span>`}</div>
      ${acts.length ? `<ul class="ag-acts">${acts.map(x => `<li>${I(x.status === "done" ? "circle-check" : "target", 16)}<span><b>${esc(x.title || "Action")}</b>${x.owner ? " · " + esc(x.owner) : ""}${x.due ? " · due " + esc(x.due) : ""}</span></li>`).join("")}</ul>` : ""}
      <div class="row"><button class="btn" type="button" data-csact="${id}">${I("target", 16)}Add an action</button></div>
    </article>`;
  }

  function set(path, val) {
    const [a, b] = path.split("."), c = cs();
    if (!b) c[a] = val;
    else { c[a] = { ...(c[a] || {}) }; if (val === "" && (a === "comp" || a === "afi")) delete c[a][b]; else c[a][b] = val; if (/_(po|pr|le)$/.test(a)) c[a].updatedAt = new Date().toISOString(); }
    H.save();
    if (showDoc) { const d = el("csDoc"); if (d) d.innerHTML = H.renderDoc(CS.csed(st())); }
  }
  async function readReport() {
    const text = (el("crText") && el("crText").value.trim()) || "";
    if (!crFile && text.length < 200) { el("crErr").textContent = "Choose the report PDF, or paste its full text."; return; }
    crBusy = true; render();
    try {
      await H.flush();
      const r = await fetch("api/school/csi/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(crFile ? { pdf: crFile.data, filename: crFile.name } : { text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "The report couldn't be read. Try again.");
      cs().last = d.last; crFile = null; crOpen = false; crBusy = false; H.save(); render();
      H.toast("Inspection report read and saved");
    } catch (e) { crBusy = false; render(); const er = el("crErr"); if (er) er.textContent = e.message; else H.toast(e.message); }
  }
  function print() {
    const d = el("csDoc"); d.innerHTML = H.renderDoc(CS.csed(st())); d.classList.remove("hide");
    document.body.classList.add("print-doc"); d.classList.add("printing"); window.print();
    setTimeout(() => { document.body.classList.remove("print-doc"); d.classList.remove("printing"); if (!showDoc) d.classList.add("hide"); }, 500);
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b || !el("csiView") || !el("csiView").contains(b)) return false;
    const d = b.dataset;
    if (d.crread) { readReport(); return true; }
    if (d.cragain) { crOpen = !crOpen; render(); return true; }
    if (d.crmission) { const rd = (cs().last || {}).reading; if (rd && rd.mission) { cs().ctx = { ...(cs().ctx || {}), mission: rd.mission }; H.save(); openCtx = true; render(); H.toast("Mission statement added"); } return true; }
    if (d.csdoc) { showDoc = !showDoc; render(); const t = document.querySelector("[data-csdoc]"); if (t) t.focus(); return true; }
    if (d.csprint) { print(); return true; }
    if (d.cssend) {
      b.disabled = true;
      H.flush().then(() => fetch("api/school/csi/send", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))
        .then(r => r.json().then(j => ({ ok: r.ok, j })))
        .then(({ ok, j }) => H.toast(ok ? `CSED emailed to ${j.sent} ${j.sent === 1 ? "person" : "people"}` : j.error || "That didn't send."))
        .catch(() => H.toast("Couldn't reach the server. Try again.")).finally(() => { b.disabled = false; });
      return true;
    }
    if (d.csact) {
      const id = d.csact, v = cs()[id] || {}, [aid, sid] = id.split("_");
      const a = CS.AREAS.find(x => x.id === aid), s = CS.SUBS.find(x => x[0] === sid);
      const first = String(v.next || "").split(/\n|\. /)[0].trim().slice(0, 140);
      P.add({ title: first || `Strengthen ${a.name.toLowerCase()}: ${s[1].toLowerCase()}`, owner: "", source: "csi", csi: id, detail: `Catholic schools inspection: ${a.name}, ${s[1].toLowerCase()}`, status: "todo" }, true);
      H.save(); render(); P.render(); H.toast(first ? "Added to the improvement plan. Give it an owner and date there." : "Action added: describe it in the Action plan tab.");
      return true;
    }
    return false;
  }
  function onInput(e) {
    const t = e.target; if (!t.dataset || !t.dataset.cs || t.tagName === "SELECT" || t.type === "date") return;
    const k = t.dataset.cs;
    set(k, k === "roll" ? t.value.replace(/[^\d]/g, "").slice(0, 5) : k === "catholicPct" ? t.value.replace(/[^\d]/g, "").slice(0, 3) : t.value);
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === "crFile") {
      const f = t.files[0]; crFile = null; el("crErr").textContent = "";
      if (!f) { el("crName").textContent = "No file chosen"; return; }
      if (f.size > 25 * 1024 * 1024) { el("crErr").textContent = "That PDF is over 25 MB. Paste the text instead."; return; }
      const fr = new FileReader(); fr.onload = () => { crFile = { name: f.name, data: fr.result }; el("crName").textContent = f.name; }; fr.readAsDataURL(f);
      return;
    }
    if (t.dataset && t.dataset.cs && (t.tagName === "SELECT" || t.type === "date")) {
      const k = t.dataset.cs, numeric = /\.(grade|overall)$/.test(k);
      set(k, numeric ? (Number(t.value) || 0) : t.value);
      if (k === "last.areas") return;
      render(); const again = el(t.id); if (again) again.focus(); return;
    }
    if (t.dataset && t.dataset.csg) { set(t.dataset.csg + ".grade", Number(t.value)); render(); const again = document.querySelector(`[data-csg="${t.dataset.csg}"][value="${t.value}"]`); if (again) again.focus(); }
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; P = host.plan; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("toggle", e => { if (e.target.dataset && e.target.dataset.cssec) openCtx = e.target.open; }, true);
    document.addEventListener("focusout", e => { if (e.target && e.target.id === "csLastAreas") render(); });
  }
  function isEditing() { const a = document.activeElement; return !!(a && el("csiView") && el("csiView").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  root.HWWD.csitab = { init, render, isEditing };
})(window);
