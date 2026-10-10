/* Find a consultant: search the register (signed-in schools only) and send an enquiry. */
(function () {
  const $ = id => document.getElementById(id);
  const I = window.HWWD.icon;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json().then(d => ({ ok: r.ok, status: r.status, d })));
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2600); }
  let wanted = [];

  Promise.all([fetch("/api/consultants/options").then(r => r.json()), fetch("/api/consultants/suggest").then(r => r.ok ? r.json() : { suggested: [] })]).then(([o, s]) => {
    $("region").insertAdjacentHTML("beforeend", o.regions.map(r => `<option>${esc(r)}</option>`).join(""));
    $("phase").insertAdjacentHTML("beforeend", o.phases.map(([id, l]) => `<option value="${esc(id)}">${esc(l)}</option>`).join(""));
    $("type").insertAdjacentHTML("beforeend", o.types.map(([id, l]) => `<option value="${esc(id)}">${esc(l)}</option>`).join(""));
    if (s.type) $("type").value = s.type;
    const sug = new Set((s.suggested || []).map(x => x.id));
    $("exp").innerHTML = o.expertise.map(([id, l]) => `<label class="opt"><input type="checkbox" name="exp" value="${esc(id)}"${sug.has(id) ? " checked" : ""}><span>${esc(l)}${sug.has(id) ? ' <span class="star">· suggested</span>' : ""}</span></label>`).join("");
    if (sug.size) { $("sugHint").hidden = false; $("sugHint").textContent = "We've ticked the areas your self-evaluation shows most need attention. Change them as you like."; }
    search();
  }).catch(() => { $("err").textContent = "Couldn't load the register. Refresh the page."; });

  $("postcode").addEventListener("input", () => { $("err").textContent = ""; if ($("postcode").value.trim()) $("region").value = ""; });
  $("region").addEventListener("change", () => { if ($("region").value) $("postcode").value = ""; });
  $("form").addEventListener("submit", e => { e.preventDefault(); search(true); });

  async function search(userAsked) {
    $("err").textContent = "";
    wanted = [...document.querySelectorAll('input[name="exp"]:checked')].map(x => x.value);
    const q = { postcode: $("postcode").value.trim(), region: $("region").value, phase: $("phase").value, type: $("type").value, expertise: wanted };
    $("go").disabled = true;
    try {
      const x = await post("/api/consultants/search", q);
      if (x.status === 401) { location.href = "enter.html?next=" + encodeURIComponent("/consultants.html"); return; }
      if (!x.ok) { $("err").textContent = x.d.error || "That search didn't work."; if (/postcode/i.test(x.d.error || "")) $("postcode").focus(); return; }
      render(x.d, q);
    } catch (e) { $("err").textContent = "Couldn't reach the server. Try again."; }
    finally { $("go").disabled = false; }
  }

  function render(d, q) {
    const n = d.results.length;
    const where = d.from ? ` who ${n === 1 ? "works" : "work"} near ${d.from}` : q.region ? ` in ${q.region}` : "";
    $("count").textContent = n ? `${n} consultant${n === 1 ? "" : "s"}${where}${wanted.length ? ", matching at least one area you chose" : ""}. Closest and best matched first.` : "";
    if (!n) {
      $("results").innerHTML = `<div class="empty"><p><b>No consultants match that search yet.</b></p><p>Try fewer areas of expertise, a wider region, or no location. The register is new and growing.</p></div>`;
      return;
    }
    $("results").innerHTML = d.results.map(c => `
      <article class="ccard" data-id="${esc(c.id)}" aria-labelledby="cn-${esc(c.id)}">
        <h2 id="cn-${esc(c.id)}">${esc(c.name)}</h2>
        <p class="head">${esc(c.headline)}</p>
        <p class="where"><span>${I("home", 16)}${esc(c.town)} (${esc(c.district)}), ${esc(c.region)}</span>
          ${c.miles != null ? `<span>${I("arrow-up-right", 16)}about ${c.miles} mile${c.miles === 1 ? "" : "s"} away</span>` : ""}
          <span>${c.travel ? `travels up to ${c.travel} miles` : "doesn't travel"}${c.remote ? " · works remotely" : ""}</span>
          ${c.remoteOnly ? `<span><b>Remote support only for you</b></span>` : ""}</p>
        <div class="tags">${c.expertiseIds.map((id, i) => `<span class="tag${wanted.includes(id) ? " hit" : ""}">${esc(c.expertise[i])}</span>`).join("")}</div>
        <p class="meta"><b>Phases:</b> ${esc(c.phases.join(", "))} · <b>Schools:</b> ${esc(c.types.join(", "))}</p>
        ${c.background ? `<p class="meta"><b>Background:</b> ${esc(c.background)}</p>` : ""}
        ${c.qualifications ? `<p class="meta"><b>Qualifications:</b> ${esc(c.qualifications)}</p>` : ""}
        <details><summary>Read ${esc(c.name.split(" ")[0])}'s bio</summary><p class="bio">${esc(c.bio)}</p></details>
        <ul class="checks" aria-label="Checks made by Evalu8 Compass">${c.checks.map(k => `<li>${I("circle-check", 16)}<span>${esc(k.label)}: checked ${esc(k.at)}${k.until ? `, insured until ${esc(k.until)}` : ""}</span></li>`).join("")}</ul>
        <p class="meta" style="color:var(--muted);font-size:13px">On the register since ${esc(c.listedSince)}</p>
        <div><button class="btn primary" type="button" data-contact="${esc(c.id)}" aria-expanded="false">${I("mail", 18)}Contact ${esc(c.name.split(" ")[0])}</button></div>
      </article>`).join("");
  }

  $("results").addEventListener("click", e => {
    const b = e.target.closest("[data-contact]"); if (!b) return;
    const card = b.closest(".ccard"), id = b.dataset.contact;
    let f = card.querySelector(".cform");
    if (f) { f.remove(); b.setAttribute("aria-expanded", "false"); return; }
    b.setAttribute("aria-expanded", "true");
    card.insertAdjacentHTML("beforeend", `
      <form class="cform" novalidate aria-label="Enquiry to ${esc(card.querySelector("h2").textContent)}">
        <div class="two">
          <div class="field"><label for="n-${id}">Your name</label><input id="n-${id}" maxlength="100" autocomplete="name"></div>
          <div class="field"><label for="r-${id}">Your role</label><input id="r-${id}" maxlength="100" placeholder="For example Headteacher"></div>
          <div class="field"><label for="e-${id}">Your email</label><input id="e-${id}" type="email" maxlength="200" autocomplete="email"></div>
          <div class="field"><label for="p-${id}">Phone (optional)</label><input id="p-${id}" type="tel" maxlength="30" autocomplete="tel"></div>
        </div>
        <div class="field"><label for="m-${id}">What would you like help with?</label><textarea id="m-${id}" maxlength="2000" placeholder="For example: we'd like support with our early reading curriculum this term, about four half-day visits."></textarea></div>
        <p class="hint" style="margin:0;font-size:13px;color:var(--muted)">Don't include pupils' names or other personal details. Your message, name and email are sent to the consultant, who replies to you directly.</p>
        <div class="row"><button class="btn primary" type="submit">${I("arrow-right", 18)}Send enquiry</button><span class="err" role="alert"></span></div>
      </form>`);
    f = card.querySelector(".cform");
    f.querySelector("input").focus();
    f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const err = f.querySelector(".err"), go = f.querySelector("button");
      err.textContent = ""; go.disabled = true;
      const x = await post(`/api/consultants/${id}/contact`, { name: $("n-" + id).value, role: $("r-" + id).value, email: $("e-" + id).value.trim(), phone: $("p-" + id).value, message: $("m-" + id).value }).catch(() => ({ ok: false, d: { error: "Couldn't reach the server. Try again." } }));
      go.disabled = false;
      if (!x.ok) { err.textContent = x.d.error || "That didn't send."; return; }
      f.innerHTML = `<p class="sent" role="status" tabindex="-1">Enquiry sent. A copy is on its way to your inbox, and the consultant will reply to you directly.</p>`;
      f.querySelector(".sent").focus();
      toast("Enquiry sent");
    });
  });
})();
