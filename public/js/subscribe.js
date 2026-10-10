/* Subscribe or renew with the school's access code; the invoice is emailed. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var post = function (url, body) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  };
  var code = "";
  var line = function (box, tag, text) { var el = document.createElement(tag); el.textContent = text; box.appendChild(el); };

  $("code").addEventListener("input", function () { $("codeErr").textContent = ""; });
  $("codeForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var c = $("code").value;
    if (c.replace(/[^A-Za-z0-9]/g, "").length < 8) { $("codeErr").textContent = "Enter the full code, for example ABCD-EFGH-JKLM."; $("code").focus(); return; }
    $("codeGo").disabled = true;
    post("/api/subscribe/quote", { code: c }).then(function (x) {
      $("codeGo").disabled = false;
      if (!x.ok) { $("codeErr").textContent = x.d.error || "That code isn't recognised."; $("code").focus(); return; }
      var q = x.d;
      if (q.manual) { $("codeErr").textContent = q.school + "'s subscription is arranged directly with us. Email support@evalu8compass.app."; return; }
      if (!q.already && q.unpaid) { $("codeErr").textContent = q.school + "'s last invoice hasn't been paid yet, so we can't renew online. Email support@evalu8compass.app and we'll sort it out."; return; }
      if (q.already) { $("codeErr").textContent = q.school + " is already subscribed (" + q.label + "). You can renew from " + q.already + "."; return; }
      code = c;
      var box = $("quote"); box.innerHTML = "";
      line(box, "b", q.school);
      line(box, "p", q.tierLabel + ": £" + q.price + " a year, " + q.vatNote + ".");
      line(box, "p", "Your paid year starts on " + q.startsLabel + ". " + (q.status === "trial" ? "You keep using it free until then." : q.status === "trial_ended" || q.status === "lapsed" || q.status === "cancelled" ? "Your access code works again as soon as you subscribe." : ""));
      line(box, "p", "The invoice is emailed straight away, payable within 30 days (or by the start of your paid year, if that's later).");
      $("subTitle").textContent = q.status === "trial" || q.status === "trial_ended" ? "Subscribe" : "Renew your subscription";
      $("codeForm").hidden = true; $("subForm").hidden = false; $("subForm").focus();
    }).catch(function () { $("codeGo").disabled = false; $("codeErr").textContent = "Couldn't reach the server. Try again."; });
  });
  $("back").addEventListener("click", function () { $("subForm").hidden = true; $("codeForm").hidden = false; $("code").focus(); });

  function fail(msg, id) { $("subErr").textContent = msg; $("subGo").disabled = false; if (id) $(id).focus(); }
  $("subForm").addEventListener("input", function () { $("subErr").textContent = ""; });
  $("subForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if ($("bName").value.trim().length < 2) return fail("Enter the name to put on the invoice.", "bName");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test($("bEmail").value.trim())) return fail("Enter a valid email address for the invoice.", "bEmail");
    if ($("address").value.trim().length < 8) return fail("Enter the school's postal address.", "address");
    if (!$("agree").checked) return fail("Tick the box to agree to the terms.", "agree");
    $("subGo").disabled = true;
    post("/api/subscribe", { code: code, billingName: $("bName").value, billingEmail: $("bEmail").value.trim(), address: $("address").value, po: $("po").value, agree: true })
      .then(function (x) {
        if (!x.ok) return fail(x.d.error || "That didn't work. Try again.");
        $("subForm").hidden = true;
        $("doneText").textContent = x.d.message;
        $("done").hidden = false; $("done").focus();
      })
      .catch(function () { fail("Couldn't reach the server. Try again."); });
  });
})();
