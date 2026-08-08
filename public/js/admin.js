/**
 * Admin section tabs: only the selected panel is visible.
 * Section is driven by the URL hash (#orders, #products, …).
 */
(function () {
  var VALID = ["orders", "products", "add-product", "ip-counts"];
  var DEFAULT = "orders";

  function currentSection() {
    var hash = (window.location.hash || "").replace(/^#/, "");
    return VALID.indexOf(hash) !== -1 ? hash : DEFAULT;
  }

  function showSection(sectionId) {
    if (VALID.indexOf(sectionId) === -1) sectionId = DEFAULT;

    document.querySelectorAll(".admin-panel").forEach(function (panel) {
      var match = panel.getAttribute("data-section") === sectionId;
      panel.hidden = !match;
      panel.classList.toggle("is-active", match);
    });

    document.querySelectorAll(".admin-nav-link").forEach(function (btn) {
      var match = btn.getAttribute("data-section") === sectionId;
      btn.classList.toggle("is-active", match);
      btn.setAttribute("aria-current", match ? "page" : "false");
    });
  }

  document.querySelectorAll(".admin-nav-link").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var section = btn.getAttribute("data-section") || DEFAULT;
      if (window.location.hash !== "#" + section) {
        window.location.hash = section;
      } else {
        showSection(section);
      }
    });
  });

  window.addEventListener("hashchange", function () {
    showSection(currentSection());
  });

  showSection(currentSection());

  // Clickable order rows → receipt page
  document.querySelectorAll(".order-row[data-href]").forEach(function (row) {
    function go() {
      window.location.href = row.getAttribute("data-href");
    }
    row.addEventListener("click", go);
    row.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        go();
      }
    });
  });
})();
