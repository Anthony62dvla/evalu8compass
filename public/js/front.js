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
