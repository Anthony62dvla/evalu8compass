/* A consultant's private page: status, checks, fees, and editing the listing. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var I = window.HWWD.icon;
  var q = new URLSearchParams(location.search), id = q.get("id"), t = q.get("t");
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function post(url, extra) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.assign({ id: id, t: t }, extra || {})) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }
  var opts = null;
  function show(d) {
    $("bad").hidden = true; ["status", "edit", "leave"].forEach(function (x) { $(x).hidden = false; });
    $("stPill").textContent = d.label; $("stPill").className = "status-pill" + (d.visible ? " live" : "");
    $("pendingNote").hidden = !d.pending;
    $("checks").innerHTML = d.checks.map(function (c) { return '<li class="' + (c.at ? "" : "todo") + '">' + I(c.at ? "circle-check" : "circle-minus", 18) + "<span>" + esc(c.label) + (c.at ? " · checked " + esc(c.at) : " · to do") + "</span></li>"; }).join("");
    $("dates").textContent = [d.insuranceUntil ? "Insurance on record until " + d.insuranceUntil + "." : "", d.checksDue ? "Next annual check: " + d.checksDue + "." : ""].join(" ");
    var L = d.fees.listing, A = d.fees.annual;
    $("fees").innerHTML = [
      "<li" + (L && L.paidAt ? "" : ' class="todo"') + ">" + I(L && L.paidAt ? "circle-check" : "circle-minus", 18) + "<span>£" + d.listingFee + " listing fee: " + (L && L.paidAt ? "paid, thank you" : L && L.number ? "invoice " + esc(L.number) + " sent" : "invoiced when your listing is approved") + "</span></li>",
      "<li" + (A && !A.paidAt ? ' class="todo"' : "") + ">" + I(A && !A.paidAt ? "circle-minus" : "circle-check", 18) + "<span>£" + d.annualFee + " annual check: " + (A && A.number && !A.paidAt ? "invoice " + esc(A.number) + " sent" : "invoiced a month before it's due") + "</span></li>",
    ].join("");
    $("edNote").textContent = d.status === "applied" ? "Changes are saved straight away." : "Changes to what schools see are checked by us before they go live, usually within two working days.";
    CProfile.render($("profile"), opts, d.pending || d.profile);
    $("phone").value = d.phone || "";
  }
  if (!id || !t) { $("bad").hidden = false; return; }
  Promise.all([fetch("/api/consultants/options").then(function (r) { return r.json(); }), post("/api/consultants/me")]).then(function (a) {
    opts = a[0];
    if (!a[1].ok) { $("bad").hidden = false; return; }
    show(a[1].d);
  }).catch(function () { $("bad").hidden = false; });

  $("edit").addEventListener("input", function () { $("err").textContent = ""; $("ok").textContent = ""; });
  $("edit").addEventListener("submit", function (e) {
    e.preventDefault();
    $("save").disabled = true;
    var p = CProfile.read($("profile")); p.phone = $("phone").value;
    post("/api/consultants/me/update", { profile: p }).then(function (x) {
      $("save").disabled = false;
      if (!x.ok) { $("err").textContent = x.d.error || "That didn't work."; var f = x.d.fields && x.d.fields[0] && x.d.fields[0][0]; if (f) CProfile.focusField($("profile"), f); return; }
      show(x.d);
      $("ok").textContent = x.d.pending ? "Saved. We'll check your changes before they go live." : "Saved.";
    }).catch(function () { $("save").disabled = false; $("err").textContent = "Couldn't reach the server. Try again."; });
  });
  $("withdraw").addEventListener("click", function () {
    if (!confirm("Remove your listing and delete your details? This can't be undone.")) return;
    post("/api/consultants/me/withdraw").then(function (x) {
      if (!x.ok) { alert(x.d.error || "That didn't work."); return; }
      document.querySelector("main").innerHTML = '<section class="acct"><h1>Your listing has been removed</h1><p class="lead">Your details have been deleted. Thank you for being part of the register.</p></section>';
    });
  });
})();
