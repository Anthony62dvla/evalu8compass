/*
 * Evalu8 Compass — AI quality check (superadmin)
 * Runs the AI inspector on published Ofsted reports and records the admin's verdict.
 */
(function () {
  const $ = id => document.getElementById(id);
  const I = window.HWWD.icon, C = window.HWWD.criteria;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = d => d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const RATING = ["", "Poor", "Weak", "Good", "Excellent"];
  const QUESTIONS = [
    ["grades", "Grades and safeguarding read accurately"],
    ["nextSteps", "Next steps faithful to the report"],
    ["mapping", "Findings linked to the right checklist lines"],
    ["advice", "Line advice: sound, practical, right for the school type"],
  ];
  let info = null, busy = false;

  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2600); }
  async function api(method, path, body) {
    const r = await fetch("api/admin/evals" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { showSignedOut(); throw new Error("Signed out"); }
    if (!r.ok) throw Object.assign(new Error(d.error || "Something went wrong."), { detail: d.detail });
    return d;
  }
  function showSignedOut() { $("signedOut").classList.remove("hide"); $("page").classList.add("hide"); }

  async function load() {
    info = await api("GET", "");
    $("page").classList.remove("hide");
    $("sys").innerHTML = `<span><i class="dot" style="background:${info.ai ? "var(--met)" : "var(--no)"}"></i>${info.ai ? "AI connected (" + esc(info.model) + ")" : "AI not connected: checks can't run"}</span><span>AI instructions version <code>${esc(info.promptVersion)}</code></span>`;
    $("refs").innerHTML = info.reference.map(r => `<article class="ref">
      <b>${esc(r.school)}</b>
      <span class="sub">URN ${esc(r.urn)} · ${esc(({ maintained: "Maintained", academy: "Academy", independent: "Independent" })[r.profile.type])} · ${esc(r.profile.phases.map(p => (C.PHASES.find(x => x.id === p) || {}).label).join(", "))} · ${r.expected.framework === "renewed" ? "renewed framework" : "earlier framework"}</span>
      <ul>${r.expected.grades.map(([a, g]) => `<li>${esc(a)}: ${esc(g)}</li>`).join("")}<li>Safeguarding: ${esc(r.expected.safeguarding)}</li><li>${r.expected.nextSteps.length} next steps</li></ul>
      <div class="row"><button class="btn primary" data-run="${esc(r.id)}"${info.ai ? "" : " disabled"}>${I("player-play", 16)}Run check</button><a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">${I("arrow-up-right", 16)}Open report</a></div>
    </article>`).join("");
    $("oPhases").innerHTML = C.PHASES.map(p => `<label><input type="checkbox" value="${p.id}"${["ks3", "ks4"].includes(p.id) ? " checked" : ""}> ${esc(p.label)}</label>`).join("");
    $("oRun").disabled = !info.ai;
    renderRuns();
  }

  function renderRuns() {
    const runs = info.runs;
    $("runs").innerHTML = `<thead><tr><th>When</th><th>Report</th><th>Instructions</th><th>Automatic checks</th><th>Your verdict</th><th></th></tr></thead><tbody>${
      runs.length ? runs.map(r => `<tr>
        <td>${esc(when(r.at))}<span class="sub">${esc(r.model || "")} · ${r.seconds || "?"}s</span></td>
        <td>${esc(r.report.school)}</td>
        <td><code>${esc(r.promptVersion)}</code>${r.promptVersion === info.promptVersion ? `<span class="sub">current</span>` : ""}</td>
        <td>${r.pct == null ? `<span class="sub">no answer key</span>` : `<b style="color:${r.pct >= 90 ? "var(--met)" : r.pct >= 70 ? "var(--part)" : "var(--no)"}">${r.pct}%</b>`}</td>
        <td>${r.review ? QUESTIONS.map(([k]) => r.review[k] ? `<span class="pill2" title="${esc(k)}">${RATING[r.review[k]]}</span>` : "").join(" ") + (r.review.wouldShare ? `<span class="sub">Happy to share with a head</span>` : `<span class="sub">Not ready to share</span>`) : `<span class="sub">Not reviewed yet</span>`}</td>
        <td><div class="acts"><button class="btn" data-open="${r.id}">Open</button><button class="btn" data-del="${r.id}" aria-label="Delete this check">${I("trash", 16)}</button></div></td>
      </tr>`).join("") : `<tr class="empty-row"><td colspan="6">No checks yet. Run one on a reference report above.</td></tr>`}</tbody>`;
  }

  /* ---------- running ---------- */
  async function runCheck(body, label) {
    if (busy) return; busy = true;
    document.querySelectorAll("[data-run], #oRun").forEach(b => { b.disabled = true; });
    $("result").innerHTML = ""; $("running").classList.remove("hide");
    $("running").scrollIntoView && $("running").scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const rec = await api("POST", "/run", body);
      info.runs.unshift({ id: rec.id, at: rec.at, report: rec.report, promptVersion: rec.promptVersion, model: rec.model, seconds: rec.seconds, pct: rec.score ? rec.score.pct : null, review: null });
      renderRuns(); showResult(rec);
      toast(`Check finished: ${label}`);
    } catch (e) {
      if (e.message !== "Signed out") {
        const d = e.detail;
        $("result").innerHTML = `<section class="panel2"><p class="error">${esc(e.message)}</p>${d ? `<details><summary>Details for Claude (copy if asked)</summary><pre class="cmd" style="white-space:pre-wrap">${esc(JSON.stringify(d, null, 1))}</pre></details>` : ""}</section>`;
      }
    }
    finally {
      busy = false; $("running").classList.add("hide");
      document.querySelectorAll("[data-run], #oRun").forEach(b => { b.disabled = !info.ai; });
    }
  }

  function lineText(profile, id) {
    for (const a of C.resolve(profile)) { const i = a.items.find(x => x.id === id); if (i) return `${a.name}: ${i.text}`; }
    return id ? `(unknown line ${id})` : "Not linked to a line";
  }

  function showResult(rec) {
    const s = rec.score, r = rec.reading || {};
    const cls = !s ? "" : s.pct >= 90 ? "good" : s.pct >= 70 ? "mid" : "bad";
    const rv = rec.review || {};
    $("result").innerHTML = `<section class="panel2" aria-labelledby="resTitle">
      <h2 id="resTitle">${I("checks", 22)}Result: ${esc(rec.report.school)}</h2>
      <div class="res-head">
        ${s ? `<span class="res-pct ${cls}">${s.pct}%</span><span>${s.points} of ${s.max} automatic checks passed</span>` : `<span class="muted">No answer key, so there are no automatic checks. Judge the reading below.</span>`}
        <span class="muted small">${esc(when(rec.at))} · ${esc(rec.model)} · instructions <code>${esc(rec.promptVersion)}</code> · ${rec.seconds}s</span>
      </div>

      ${s ? `<div class="res-sec"><h3>Automatic checks</h3><ul class="checks">${s.checks.map(c => `<li class="${c.ok ? "y" : "n"}">${I(c.ok ? "circle-check" : "circle-x", 18)}<span>${esc(c.label)}${c.detail ? ` <span class="d">(${esc(c.detail)})</span>` : ""}</span></li>`).join("")}</ul></div>` : ""}

      <div class="res-sec"><h3>Grades</h3>
        <div class="cmp2"><div><h4>In the report</h4><ul>${rec.expected ? rec.expected.grades.map(([a, g]) => `<li>${esc(a)}: <b>${esc(g)}</b></li>`).join("") + `<li>Safeguarding: <b>${esc(rec.expected.safeguarding)}</b></li>` : "<li>No answer key</li>"}</ul></div>
        <div><h4>The AI read</h4><ul>${(r.grades || []).map(g => `<li>${esc(g.area)}: <b>${esc(g.grade)}</b></li>`).join("") || "<li>None</li>"}<li>Safeguarding: <b>${esc(r.safeguarding || "not given")}</b></li><li>Framework: ${esc(r.framework || "not given")} · Date: ${esc(r.inspectionDate || "not given")}</li></ul></div></div></div>

      <div class="res-sec"><h3>Next steps</h3>
        <div class="cmp2"><div><h4>In the report (our paraphrase)</h4><ol>${rec.expected ? rec.expected.nextSteps.map(x => `<li>${esc(x)}</li>`).join("") : "<li>No answer key</li>"}</ol></div>
        <div><h4>The AI read</h4><ol>${(r.nextSteps || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>None</li>"}</ol></div></div></div>

      <div class="res-sec"><h3>Summary the AI wrote</h3><p style="margin:0">${esc(r.summary || "")}</p></div>

      <div class="res-sec"><h3>Findings linked to the checklist</h3>
        <div class="tablewrap"><table class="atable" style="min-width:600px"><thead><tr><th>Type</th><th>Finding</th><th>Checklist line</th></tr></thead><tbody>
        ${(r.findings || []).map(f => `<tr><td>${f.type === "concern" ? "Concern" : "Strength"}</td><td>${esc(f.finding)}</td><td>${esc(lineText(rec.profile, f.itemId))}</td></tr>`).join("") || `<tr><td colspan="3">None</td></tr>`}
        </tbody></table></div></div>

      <div class="res-sec"><h3>Line advice a school would see</h3>
        ${(rec.advice || []).map(a => `<div class="adv"><b>${esc(a.line)}</b><span class="muted small">Prompted by: ${esc(a.finding)}</span>
          ${a.error ? `<p class="error">${esc(a.error)}</p>` : `${a.advice.summary ? `<p style="margin:0">${esc(a.advice.summary)}</p>` : ""}
          <ol>${(a.advice.activities || []).map(x => `<li><b>${esc(x.title)}</b>: ${esc(x.what)} <span class="muted small">(${esc(x.lead)} · ${esc(x.when)} · evidence: ${esc(x.evidence)})</span></li>`).join("")}</ol>
          ${a.advice.inspectorQuestion ? `<p style="margin:0"><i>An inspector might ask:</i> ${esc(a.advice.inspectorQuestion)}</p>` : ""}
          ${a.issues && a.issues.length ? `<p class="issues">Checks: ${esc(a.issues.join("; "))}</p>` : ""}`}</div>`).join("") || `<p class="muted" style="margin:0">No concerns were linked to checklist lines, so no advice was generated.</p>`}
      </div>

      <form class="rate" id="rateForm" data-id="${rec.id}">
        <h3 style="margin:0">Your verdict</h3>
        ${QUESTIONS.map(([k, label]) => `<fieldset><legend>${esc(label)}</legend>${[1, 2, 3, 4].map(n => `<label><input type="radio" name="${k}" value="${n}"${rv[k] === n ? " checked" : ""}> ${RATING[n]}</label>`).join("")}</fieldset>`).join("")}
        <fieldset><legend>Would you be happy for a headteacher to see this reading and advice?</legend>
          <label><input type="radio" name="wouldShare" value="yes"${rv.wouldShare === true ? " checked" : ""}> Yes</label><label><input type="radio" name="wouldShare" value="no"${rv.wouldShare === false ? " checked" : ""}> Not yet</label></fieldset>
        <label for="rvNotes" style="font-weight:700">What would you change? (be specific: this is what improves the AI's instructions)</label>
        <textarea id="rvNotes" rows="4">${esc(rv.notes || "")}</textarea>
        <div class="row"><button class="btn primary" type="submit">${I("device-floppy", 18)}Save my verdict</button></div>
      </form>
    </section>`;
    $("result").scrollIntoView && $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.run) { const r = info.reference.find(x => x.id === b.dataset.run); return runCheck({ refId: r.id }, r.school); }
    if (b.dataset.open) { try { showResult(await api("GET", "/" + b.dataset.open)); } catch (err) { toast(err.message); } return; }
    if (b.dataset.del) {
      if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.innerHTML = "Click again to delete"; setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.innerHTML = I("trash", 16); } }, 4000); return; }
      try { await api("DELETE", "/" + b.dataset.del); info.runs = info.runs.filter(x => x.id !== b.dataset.del); renderRuns(); toast("Check deleted"); } catch (err) { toast(err.message); }
      return;
    }
    if (b.id === "copyAll") {
      const out = [];
      for (const r of info.runs) {
        try {
          const full = await api("GET", "/" + r.id);
          out.push({ at: full.at, report: full.report.school, promptVersion: full.promptVersion, model: full.model, autoScore: full.score ? full.score.pct : null,
            failedChecks: full.score ? full.score.checks.filter(c => !c.ok).map(c => c.label + (c.detail ? ` (${c.detail})` : "")) : [],
            aiGrades: (full.reading.grades || []).map(g => `${g.area}: ${g.grade}`), aiNextSteps: full.reading.nextSteps,
            advice: (full.advice || []).map(a => ({ line: a.line, finding: a.finding, activities: a.advice ? (a.advice.activities || []).map(x => x.title) : [], issues: a.issues })),
            review: full.review });
        } catch (err) {}
      }
      const text = JSON.stringify(out, null, 1);
      try { await navigator.clipboard.writeText(text); toast(`Copied ${out.length} check${out.length === 1 ? "" : "s"}`); }
      catch (err) { const w = window.open("", "_blank"); if (w) { w.document.body.innerText = text; } else toast("Couldn't copy. Allow clipboard access and try again."); }
    }
  });

  document.addEventListener("submit", async e => {
    if (e.target.id === "rateForm") {
      e.preventDefault();
      const f = e.target, v = k => { const x = f.querySelector(`input[name="${k}"]:checked`); return x ? x.value : null; };
      const body = Object.fromEntries(QUESTIONS.map(([k]) => [k, v(k) ? Number(v(k)) : null]));
      body.wouldShare = v("wouldShare") === "yes"; body.notes = $("rvNotes").value;
      try {
        const rec = await api("POST", `/${f.dataset.id}/review`, body);
        const row = info.runs.find(x => x.id === rec.id); if (row) row.review = rec.review;
        renderRuns(); toast("Verdict saved");
      } catch (err) { toast(err.message); }
    }
    if (e.target.id === "ownForm") {
      e.preventDefault(); $("oErr").textContent = "";
      const url = $("oUrl").value.trim(), file = $("oPdf").files[0];
      if (!url && !file) { $("oErr").textContent = "Give a link to the report or upload the PDF."; return; }
      const phases = [...$("oPhases").querySelectorAll("input:checked")].map(x => x.value);
      if (!phases.length) { $("oErr").textContent = "Choose at least one phase."; return; }
      const body = { url: url || undefined, profile: { name: $("oName").value.trim(), type: $("oType").value, phases, special: $("oSpecial").checked }, expected: $("oExpected").value };
      if (file) {
        if (file.size > 25 * 1024 * 1024) { $("oErr").textContent = "That PDF is over 25 MB."; return; }
        body.pdf = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
        delete body.url;
      }
      runCheck(body, body.profile.name || "your report");
    }
  });

  load().catch(e => { if (e.message !== "Signed out") toast(e.message); });
})();
