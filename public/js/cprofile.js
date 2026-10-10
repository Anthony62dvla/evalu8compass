/* The consultant profile fields, shared by the application form and the manage page. */
(function (root) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const boxes = (name, list, chosen, max) => list.map(([id, label]) =>
    `<label class="tick"><input type="checkbox" name="${name}" value="${esc(id)}"${(chosen || []).includes(id) ? " checked" : ""}><span>${esc(label)}</span></label>`).join("");

  /** Fills `el` with the profile fields. v = current values (or {}). */
  function render(el, o, v) {
    v = v || {};
    el.innerHTML = `
      <div class="f"><label for="cpName">Full name</label><input type="text" id="cpName" maxlength="100" autocomplete="name" value="${esc(v.name)}"></div>
      <div class="f"><label for="cpHeadline">One-line summary</label><p class="hint" id="cpHeadlineHint">What schools should know at a glance, for example "Former primary head and SIP: curriculum, early reading and leadership".</p><input type="text" id="cpHeadline" maxlength="120" aria-describedby="cpHeadlineHint" value="${esc(v.headline)}"></div>
      <div class="f"><label for="cpBio">Bio: your expertise and experience</label><p class="hint" id="cpBioHint">100 to 1,500 characters. Describe the schools you've worked with and the difference you've made. Don't name schools or pupils without permission, and don't use Ofsted's name or logo, or a serving inspector role, to promote your services.</p><textarea id="cpBio" maxlength="1500" rows="7" aria-describedby="cpBioHint">${esc(v.bio)}</textarea><p class="hint" id="cpBioCount" aria-live="polite"></p></div>
      <div class="row2">
        <div class="f"><label for="cpBackground">Background (optional)</label><p class="hint" id="cpBgHint">For example "Headteacher 2010–2020; school improvement partner since 2021".</p><input type="text" id="cpBackground" maxlength="300" aria-describedby="cpBgHint" value="${esc(v.background)}"></div>
        <div class="f"><label for="cpQuals">Qualifications (optional)</label><p class="hint" id="cpQHint">For example "QTS, NPQH, MA Education".</p><input type="text" id="cpQuals" maxlength="300" aria-describedby="cpQHint" value="${esc(v.qualifications)}"></div>
      </div>
      <fieldset><legend>Areas of expertise <span class="hint">(up to 8)</span></legend><div class="ticks2">${boxes("cpExp", o.expertise, v.expertise)}</div></fieldset>
      <fieldset><legend>Phases</legend><div class="ticks2">${boxes("cpPhase", o.phases, v.phases)}</div></fieldset>
      <fieldset><legend>Types of school</legend><div class="ticks2">${boxes("cpType", o.types, v.types)}</div></fieldset>
      <h2>Where you work</h2>
      <div class="row2">
        <div class="f"><label for="cpTown">Town or city you work from</label><input type="text" id="cpTown" maxlength="60" value="${esc(v.town)}"></div>
        <div class="f"><label for="cpPostcode">Postcode</label><p class="hint" id="cpPcHint">${v.district ? `Currently ${esc(v.district)}. ` : ""}We keep only the first part (for example LS6), to work out distances. Schools never see your address.</p><input type="text" id="cpPostcode" maxlength="10" autocomplete="postal-code" aria-describedby="cpPcHint"></div>
      </div>
      <div class="row2">
        <div class="f"><label for="cpRegion">Region</label><select id="cpRegion"><option value="">Choose…</option>${o.regions.map(r => `<option${v.region === r ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></div>
        <div class="f"><label for="cpTravel">How far will you travel? (miles)</label><input type="number" id="cpTravel" min="0" max="300" step="5" inputmode="numeric" value="${esc(v.travel != null ? v.travel : 30)}"></div>
      </div>
      <label class="agree"><input type="checkbox" id="cpRemote"${v.remote ? " checked" : ""}><span>I also work remotely (online), so schools further away can contact me</span></label>`;
    const bio = el.querySelector("#cpBio"), count = el.querySelector("#cpBioCount");
    const upd = () => { const n = bio.value.trim().length; count.textContent = n < 100 ? `${n} characters (at least 100)` : `${n} of 1,500 characters`; };
    bio.addEventListener("input", upd); upd();
  }
  const vals = (el, name) => [...el.querySelectorAll(`input[name="${name}"]:checked`)].map(x => x.value);
  function read(el) {
    const g = id => el.querySelector("#" + id);
    return { name: g("cpName").value, headline: g("cpHeadline").value, bio: g("cpBio").value, background: g("cpBackground").value, qualifications: g("cpQuals").value,
      expertise: vals(el, "cpExp"), phases: vals(el, "cpPhase"), types: vals(el, "cpType"), town: g("cpTown").value, postcode: g("cpPostcode").value,
      region: g("cpRegion").value, travel: Number(g("cpTravel").value), remote: g("cpRemote").checked };
  }
  /** Maps server field names to the input to focus. */
  const FIELD = { name: "cpName", headline: "cpHeadline", bio: "cpBio", town: "cpTown", region: "cpRegion", travel: "cpTravel", expertise: "cpExp", phases: "cpPhase", types: "cpType", postcode: "cpPostcode" };
  function focusField(el, f) {
    const id = FIELD[f]; if (!id) return false;
    const x = el.querySelector("#" + id) || el.querySelector(`input[name="${id}"]`);
    if (x) { x.focus(); return true; }
    return false;
  }
  root.CProfile = { render, read, focusField };
})(window);
