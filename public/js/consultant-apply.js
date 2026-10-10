/* Consultant application form. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var form = $("form"), err = $("err"), go = $("go"), prof = $("profile");
  fetch("/api/consultants/options").then(function (r) { return r.json(); }).then(function (o) { CProfile.render(prof, o, {}); }).catch(function () { err.textContent = "Couldn't load the form. Refresh the page."; });
  function fail(msg, focusId) { err.textContent = msg; go.disabled = false; if (focusId && $(focusId)) $(focusId).focus(); }
  form.addEventListener("input", function () { err.textContent = ""; });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var p = CProfile.read(prof);
    if (!p.postcode.trim()) return fail("Enter your postcode, or just the first part, so schools can find you by distance.", "cpPostcode");
    var body = Object.assign({}, p, {
      email: $("email").value.trim(), phone: $("phone").value, address: $("address").value, updateService: $("updateService").checked, trn: $("trn").value,
      insProvider: $("insProvider").value, insExpires: $("insExpires").value,
      referees: [{ name: $("r1n").value, role: $("r1r").value, email: $("r1e").value.trim() }, { name: $("r2n").value, role: $("r2r").value, email: $("r2e").value.trim() }],
      accurate: $("accurate").checked, consent: $("consent").checked, agree: $("agree").checked, website: $("website").value,
    });
    go.disabled = true;
    fetch("/api/consultants/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) {
          var f = x.d.fields && x.d.fields[0] && x.d.fields[0][0];
          var map = { email: "email", address: "address", trn: "trn", updateService: "updateService", insProvider: "insProvider", insExpires: "insExpires", ref1: "r1n", ref2: "r2n", agree: "accurate" };
          fail(x.d.error || "That didn't work. Try again.");
          if (f && !CProfile.focusField(prof, f) && map[f]) $(map[f]).focus();
          else if (!f && /postcode/i.test(x.d.error || "")) $("cpPostcode").focus();
          return;
        }
        form.hidden = true; $("done").hidden = false; $("done").focus();
      })
      .catch(function () { fail("Couldn't reach the server. Check your connection and try again."); });
  });
})();
