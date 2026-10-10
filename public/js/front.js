/* Moved out of index.html so the Content-Security-Policy can forbid inline scripts. */
(function () {
    var f = document.getElementById("joinBox"), i = document.getElementById("frontCode"), e = document.getElementById("frontCodeErr");
    i.addEventListener("input", function () { i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); e.textContent = ""; });
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (i.value.length !== 6) { e.textContent = "The code has six letters and numbers."; i.focus(); return; }
      location.href = "workshop.html?code=" + encodeURIComponent(i.value);
    });
  })();

/* Pricing: today's free period and the VAT wording come from the server */
(function () {
  fetch("/api/pricing").then(function (r) { return r.json(); }).then(function (d) {
    var f = document.getElementById("freeNow"), v = document.getElementById("vatNote");
    if (f && d.freeNow) f.textContent = "Sign up today and it's free until " + d.freeNow.untilLabel + ".";
    if (v && d.vat) v.textContent = d.vat;
  }).catch(function () {});
})();
