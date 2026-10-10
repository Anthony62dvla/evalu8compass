/* Sign-up: a school gets its access code by email; trusts send an enquiry. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var form = $("form"), err = $("err"), go = $("go"), pricing = null;
  var PRICES = { independent: 99, primary: 149, secondary: 199 };
  var LABEL = { independent: "Independent school", primary: "Primary school", secondary: "Secondary school" };
  var val = function (name) { var x = form.querySelector('input[name="' + name + '"]:checked'); return x ? x.value : ""; };

  fetch("/api/pricing").then(function (r) { return r.json(); }).then(function (d) { pricing = d; update(); }).catch(function () {});
  var want = new URLSearchParams(location.search).get("type");
  if (want) { var r = form.querySelector('input[name="type"][value="' + want + '"]'); if (r) r.checked = true; }

  function update() {
    var type = val("type"), phase = val("phase"), trust = type === "trust";
    $("phaseSet").hidden = !(type === "maintained" || type === "academy");
    $("trustRows").hidden = !trust;
    $("urnRow").hidden = trust;
    $("schoolLbl").textContent = trust ? "Trust name" : "School name";
    $("title").textContent = trust ? "Tell us about your trust" : "Start your free term";
    $("goText").textContent = trust ? "Send my enquiry" : "Email my access code";
    var tier = type === "independent" ? "independent" : (type === "maintained" || type === "academy") && phase ? phase : "";
    var box = $("summary");
    if (!tier) { box.hidden = true; return; }
    var until = pricing && pricing.freeNow ? pricing.freeNow.untilLabel : "the end of this term";
    box.innerHTML = "";
    var b = document.createElement("b"); b.textContent = "Free until " + until; box.appendChild(b);
    var p = document.createElement("p");
    p.textContent = "Then " + LABEL[tier].toLowerCase() + " subscription: £" + PRICES[tier] + " a year, " + (pricing && pricing.vatRegistered ? "plus VAT" : "excluding VAT") + ", invoiced and payable within 30 days. We'll remind you before your free term ends.";
    box.appendChild(p);
    box.hidden = false;
  }
  form.addEventListener("change", update);
  update();

  function fail(msg, focusId) { err.textContent = msg; go.disabled = false; if (focusId) $(focusId).focus(); }
  form.addEventListener("input", function () { err.textContent = ""; });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var type = val("type");
    if (!type) return fail("Choose your type of school.", null) || form.querySelector('input[name="type"]').focus();
    if ((type === "maintained" || type === "academy") && !val("phase")) return fail("Choose primary or secondary.") || form.querySelector('input[name="phase"]').focus();
    if ($("school").value.trim().length < 3) return fail(type === "trust" ? "Enter your trust's name." : "Enter your school's name.", "school");
    if ($("name").value.trim().length < 2) return fail("Enter your name.", "name");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test($("email").value.trim())) return fail("Enter a valid email address.", "email");
    if (!$("agree").checked) return fail("Tick the box to agree to the terms and privacy notice.", "agree");
    go.disabled = true;
    var body = { type: type, phase: val("phase"), school: $("school").value, urn: $("urn").value, name: $("name").value, role: $("role").value, email: $("email").value.trim(),
      schools: $("schools").value, message: $("message").value, agree: true, website: $("website").value };
    fetch("/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) return fail(x.d.error || "That didn't work. Try again.");
        form.hidden = true;
        var done = $("done");
        if (x.d.kind === "enquiry") {
          $("doneTitle").textContent = "Thank you";
          $("doneText").textContent = "We've emailed a confirmation to " + body.email + " and will be in touch within two working days about pricing for your trust.";
          $("doneBtn").hidden = true;
        } else {
          $("doneText").textContent = "We've sent your school's access code to " + body.email + ". Enter it to start your self-evaluation.";
        }
        done.hidden = false; done.focus();
      })
      .catch(function () { fail("Couldn't reach the server. Check your connection and try again."); });
  });
})();
