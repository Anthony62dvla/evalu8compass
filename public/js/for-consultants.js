/* For consultants: VAT wording, and "email my link again". */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  fetch("/api/pricing").then(function (r) { return r.json(); }).then(function (d) { if (d.vatRegistered) $("vatNote").textContent = d.vat; }).catch(function () {});
  $("linkForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("linkErr").textContent = ""; $("linkOk").textContent = "";
    var em = $("linkEmail").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(em)) { $("linkErr").textContent = "Enter a valid email address."; $("linkEmail").focus(); return; }
    $("linkGo").disabled = true;
    fetch("/api/consultants/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: em }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { $("linkGo").disabled = false; if (!x.ok) { $("linkErr").textContent = x.d.error || "That didn't work."; return; } $("linkOk").textContent = "If that address has applied, the link is on its way."; })
      .catch(function () { $("linkGo").disabled = false; $("linkErr").textContent = "Couldn't reach the server. Try again."; });
  });
})();
