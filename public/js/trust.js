/* Evalu8 Compass — the trust view: the schools that share their summary, side by side. */
(function () {
  const I = window.HWWD.icon, $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nice = d => d ? new Date(String(d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";
  const PH = { eyfs: "EYFS", ks1: "KS1", ks2: "KS2", ks3: "KS3", ks4: "KS4", p16: "16+" };
  let data = null, open = null;
  const band = v => v == null ? "none" : v >= 80 ? "hi" : v >= 60 ? "mid" : "lo";

  function renderDoc(doc) {
    return `<div class="doc"><h3 class="doc-title">${esc(doc.title)}</h3>${doc.sections.map(s => `<section class="doc-sec"><h4>${esc(s.head)}</h4>
      ${s.para ? `<p class="doc-para">${esc(s.para)}</p>` : ""}${(s.lines || []).length ? `<ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${s.table ? `<div class="doc-tbl"><table><thead><tr>${s.table.cols.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</section>`).join("")}</div>`;
  }
  function areaCols() { const used = new Set(data.schools.flatMap(s => Object.keys(s.scores))); return data.areas.filter(a => used.has(a.id)); }
  function faith(f) { return !f ? "–" : f.kind === "SIAMS" ? `SIAMS: ${f.yes}/${f.total} yes` : `CSI: ${f.overall ? ["", "Outstanding", "Good", "Requires improvement", "Inadequate"][f.overall] : "not graded"}`; }

  function render() {
    $("trustName").textContent = data.trust.name; document.title = `Trust view · ${data.trust.name}`;
    $("whoAmI").innerHTML = `${I("user", 16)}<span>${esc(data.me.name)}</span>`;
    const S = data.schools, sum = (f) => S.reduce((t, s) => t + f(s), 0);
    $("tiles").innerHTML = [
      ["school", S.length, S.length === 1 ? "school sharing" : "schools sharing"],
      ["shield-check", sum(s => s.safeguarding.gaps), "safeguarding lines not yet met"],
      ["alert-triangle", sum(s => s.plan.risk + s.plan.off), "actions at risk or off track"],
      ["history", sum(s => s.plan.overdue), "actions overdue"],
      ["eye", sum(s => s.monitoring.term), "monitoring activities this term"],
    ].map(([ic, n, l]) => `<div class="stat"><span class="tile">${I(ic, 22)}</span><div><b>${n}</b><span>${esc(l)}</span></div></div>`).join("");
    const cols = areaCols();
    $("tbl").innerHTML = S.length ? `<table class="trust-grid"><caption class="sr-only">Schools compared</caption><thead><tr><th scope="col">School</th><th scope="col">Overall</th>${cols.map(a => `<th scope="col" title="${esc(a.name)}">${esc(a.name)}</th>`).join("")}<th scope="col">Safeguarding lines and checks</th><th scope="col">Plan</th><th scope="col">Monitoring this term</th><th scope="col">Governors</th><th scope="col">Church inspection</th><th scope="col">Updated</th></tr></thead><tbody>${
      S.map(s => `<tr${open === s.id ? ' class="sel"' : ""}><th scope="row"><button class="linkbtn" type="button" data-open="${s.id}" aria-expanded="${open === s.id}">${esc(s.name)}</button><span class="sub">${esc(s.type)}${s.phases.length ? " · " + esc(s.phases.map(p => PH[p] || p).join(", ")) : ""}</span></th>
        <td class="pct b-${band(s.overall)}">${s.overall == null ? "–" : s.overall + "%"}</td>
        ${cols.map(a => `<td class="pct b-${band(s.scores[a.id])}">${s.scores[a.id] == null ? "–" : s.scores[a.id] + "%"}</td>`).join("")}
        <td>${s.safeguarding.gaps ? `<b class="warn">${s.safeguarding.gaps} not met</b>` : "All met"}<span class="sub">Checks ${s.safeguarding.checks}/${s.safeguarding.of}${s.safeguarding.concerns ? ` · ${s.safeguarding.concerns} concern` : ""}</span></td>
        <td>${s.plan.open} open${s.plan.risk + s.plan.off ? ` · <b class="warn">${s.plan.risk + s.plan.off} at risk</b>` : ""}<span class="sub">${s.plan.overdue} overdue · ${s.plan.done} done</span></td>
        <td>${s.monitoring.term}${s.monitoring.concerns ? ` · <b class="warn">${s.monitoring.concerns} concern</b>` : ""}</td>
        <td>${s.governors.lastReport ? "Report " + nice(s.governors.lastReport) : "No report yet"}<span class="sub">${s.governors.openQuestions} open question${s.governors.openQuestions === 1 ? "" : "s"}</span></td>
        <td>${esc(faith(s.faith))}</td><td>${nice(s.updatedAt)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="small">No schools are sharing yet. Once a school's headteacher agrees, it appears here.</p>`;
    $("pending").textContent = data.pending.length ? `Waiting for the headteacher to agree: ${data.pending.map(p => p.name).join(", ")}.` : "";
    $("csv").disabled = !S.length;
  }
  async function openSchool(id) {
    const box = $("detail");
    if (open === id) { open = null; box.hidden = true; render(); return; }
    open = id; render(); box.hidden = false; box.innerHTML = `<p class="small">Loading…</p>`;
    try {
      const r = await fetch(`api/trust/school/${id}`); const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      box.innerHTML = `<div class="sg-head"><h2>${esc(d.row.name)}</h2><div class="row"><button class="btn" type="button" id="dPrint">${I("file-export", 16)}Print or save as PDF</button><button class="btn" type="button" data-open="${id}">Close</button></div></div><div class="lead-preview" id="dDoc">${renderDoc(d.doc)}</div>`;
      box.scrollIntoView({ block: "start", behavior: "smooth" }); $("dDoc").setAttribute("tabindex", "-1"); $("dDoc").focus({ preventScroll: true });
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message || "Couldn't load that school.")}</p>`; }
  }
  function csv() {
    const cols = areaCols(), q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const rows = [["School", "Type", "Phases", "Overall %", ...cols.map(a => a.name + " %"), "Safeguarding lines not met", "Safeguarding checks done", "Open actions", "At risk or off track", "Overdue", "Done", "Monitoring this term", "Monitoring concerns", "Last governors' report", "Open governors' questions", "Church inspection", "Updated"],
      ...data.schools.map(s => [s.name, s.type, s.phases.join(" "), s.overall, ...cols.map(a => s.scores[a.id]), s.safeguarding.gaps, `${s.safeguarding.checks}/${s.safeguarding.of}`, s.plan.open, s.plan.risk + s.plan.off, s.plan.overdue, s.plan.done, s.monitoring.term, s.monitoring.concerns, s.governors.lastReport ? s.governors.lastReport.slice(0, 10) : "", s.governors.openQuestions, faith(s.faith), s.updatedAt ? s.updatedAt.slice(0, 10) : ""])];
    const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${data.trust.name.replace(/[^\w ]+/g, "")} schools ${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.open) return openSchool(b.dataset.open);
    if (b.id === "csv") return csv();
    if (b.id === "dPrint") { const p = $("dDoc"); document.body.classList.add("print-doc"); p.classList.add("printing"); window.print(); setTimeout(() => { document.body.classList.remove("print-doc"); p.classList.remove("printing"); }, 500); }
  });
  $("signOut").addEventListener("click", e => { e.preventDefault(); fetch("api/access/logout", { method: "POST" }).finally(() => { location.href = "enter.html"; }); });
  (async () => {
    try { const r = await fetch("api/trust/view"); if (r.status === 401) { location.href = "enter.html?next=%2Ftrust.html"; return; } data = await r.json(); if (!r.ok) throw new Error(data.error); render(); }
    catch (e) { $("loadErr").textContent = "Couldn't load the trust view. Refresh to try again."; }
  })();
})();
