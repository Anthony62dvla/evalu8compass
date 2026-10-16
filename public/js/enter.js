/* Moved out of enter.html so the Content-Security-Policy can forbid inline scripts. */
(function () {
  var params = new URLSearchParams(location.search);
  var next = params.get("next") || "/checklist.html";
  if (!/^\/[^/\\]/.test(next)) next = "/checklist.html"; // only same-site paths
  var form = document.getElementById("form"), code = document.getElementById("code"), err = document.getElementById("err"), go = document.getElementById("go");
  fetch("/api/access").then(function (r) { return r.json(); }).then(function (s) { if (!s.required || s.ok) location.replace(next); else if (s.governor) location.replace("/governors.html"); else if (s.trust) location.replace("/trust.html"); }).catch(function () {});
  // Sign in with your email: email → code → (choose where) → signed in
  var ef = document.getElementById("emailForm"), em = document.getElementById("email"), ec = document.getElementById("ecode"), eerr = document.getElementById("emailErr"), ego = document.getElementById("emailGo"), egt = document.getElementById("emailGoText");
  var s1 = document.getElementById("emailStep1"), s2 = document.getElementById("emailStep2"), s3 = document.getElementById("emailStep3"), back = document.getElementById("emailBack"), step = 1, choices = null;
  function post(url, body) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }); }
  function show(n) {
    step = n; s1.hidden = n !== 1; s2.hidden = n !== 2; s3.hidden = n !== 3; back.hidden = n === 1;
    egt.textContent = n === 1 ? "Email me a code" : n === 2 ? "Sign in" : "Continue";
    (n === 1 ? em : n === 2 ? ec : s3.querySelector("input")).focus();
  }
  function done(d) { location.replace(d.kind === "trust" ? "/trust.html" : next); }
  back.addEventListener("click", function () { eerr.textContent = ""; ec.value = ""; show(1); });
  [em, ec].forEach(function (x) { x.addEventListener("input", function () { eerr.textContent = ""; }); });
  ef.addEventListener("submit", function (e) {
    e.preventDefault(); eerr.textContent = "";
    var email = em.value.trim();
    if (step === 1) {
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { eerr.textContent = "Enter your work email address."; em.focus(); return; }
      ego.disabled = true;
      post("/api/login/email", { email: email }).then(function (x) {
        ego.disabled = false;
        if (!x.ok) { eerr.textContent = x.d.error || "That didn't work. Try again."; return; }
        document.getElementById("codeHint").textContent = "If " + email + " is on a team in Evalu8 Compass, a code is on its way. It works for 10 minutes. Check your junk folder if it doesn't arrive.";
        show(2);
      }).catch(function () { ego.disabled = false; eerr.textContent = "Couldn't reach the server. Try again."; });
      return;
    }
    var codeV = ec.value.replace(/\D/g, "");
    if (codeV.length !== 6) { eerr.textContent = "Enter the 6-digit code from the email."; ec.focus(); return; }
    var pick = step === 3 ? (s3.querySelector("input:checked") || {}).value : undefined;
    if (step === 3 && !pick) { eerr.textContent = "Choose where to sign in."; return; }
    ego.disabled = true;
    post("/api/login/code", { email: email, code: codeV, choice: pick }).then(function (x) {
      ego.disabled = false;
      if (!x.ok) { eerr.textContent = x.d.error || "That didn't work."; return; }
      if (x.d.choose) {
        choices = x.d.choose;
        document.getElementById("chooseList").innerHTML = choices.map(function (c, i) { return '<label><input type="radio" name="where" value="' + c.key + '"' + (i ? "" : " checked") + "> " + c.name.replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }) + (c.kind === "trust" ? " (trust view)" : "") + "</label>"; }).join("");
        show(3); return;
      }
      done(x.d);
    }).catch(function () { ego.disabled = false; eerr.textContent = "Couldn't reach the server. Try again."; });
  });

  code.addEventListener("input", function () { err.textContent = ""; document.getElementById("subLink").hidden = true; });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (code.value.replace(/[^A-Za-z0-9]/g, "").length < 8) { err.textContent = "Enter the full code, for example ABCD-EFGH-JKLM."; return; }
    go.disabled = true;
    fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.value }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.ok) return location.replace(x.d.governor ? "/governors.html" : next);
        err.textContent = x.d.error || "That didn't work. Try again."; go.disabled = false;
        if (x.d.code === "use_email") { em.focus(); return; }
        document.getElementById("subLink").hidden = !x.d.subscribe;
        code.focus();
      })
      .catch(function () { err.textContent = "Couldn't reach the server. Check your connection and try again."; go.disabled = false; });
  });

  // Lost code: a new code is emailed to the address the school signed up with
  var lost = document.getElementById("lost"), le = document.getElementById("lostEmail"), lerr = document.getElementById("lostErr"), lok = document.getElementById("lostOk"), lgo = document.getElementById("lostGo");
  le.addEventListener("input", function () { lerr.textContent = ""; });
  lost.addEventListener("submit", function (e) {
    e.preventDefault();
    lok.textContent = "";
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(le.value.trim())) { lerr.textContent = "Enter a valid email address."; le.focus(); return; }
    lgo.disabled = true;
    fetch("/api/signup/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: le.value.trim() }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { lgo.disabled = false; if (!x.ok) { lerr.textContent = x.d.error || "That didn't work."; return; } lok.textContent = "If that address is registered, a new code is on its way. Check your junk folder if it doesn't arrive in a few minutes."; })
      .catch(function () { lgo.disabled = false; lerr.textContent = "Couldn't reach the server. Try again."; });
  });
})();
