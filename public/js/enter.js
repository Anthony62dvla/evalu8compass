/* Moved out of enter.html so the Content-Security-Policy can forbid inline scripts. */
(function () {
  var params = new URLSearchParams(location.search);
  var next = params.get("next") || "/checklist.html";
  if (!/^\/[^/\\]/.test(next)) next = "/checklist.html"; // only same-site paths
  var form = document.getElementById("form"), code = document.getElementById("code"), err = document.getElementById("err"), go = document.getElementById("go");
  fetch("/api/access").then(function (r) { return r.json(); }).then(function (s) { if (!s.required || s.ok) location.replace(next); }).catch(function () {});
  code.addEventListener("input", function () { err.textContent = ""; });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (code.value.replace(/[^A-Za-z0-9]/g, "").length < 8) { err.textContent = "Enter the full code, for example ABCD-EFGH-JKLM."; return; }
    go.disabled = true;
    fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.value }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { if (x.ok) location.replace(next); else { err.textContent = x.d.error || "That didn't work. Try again."; go.disabled = false; code.focus(); } })
      .catch(function () { err.textContent = "Couldn't reach the server. Check your connection and try again."; go.disabled = false; });
  });
})();
