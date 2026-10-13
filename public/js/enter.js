/* Moved out of enter.html so the Content-Security-Policy can forbid inline scripts. */
(function () {
  var params = new URLSearchParams(location.search);
  var next = params.get("next") || "/checklist.html";
  if (!/^\/[^/\\]/.test(next)) next = "/checklist.html"; // only same-site paths
  var form = document.getElementById("form"), code = document.getElementById("code"), err = document.getElementById("err"), go = document.getElementById("go");
  fetch("/api/access").then(function (r) { return r.json(); }).then(function (s) { if (!s.required || s.ok) location.replace(next); else if (s.governor) location.replace("/governors.html"); }).catch(function () {});
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
