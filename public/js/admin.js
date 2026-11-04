/**
 * Admin section tabs: only the selected panel is visible.
 * Section is driven by the URL hash (#orders, #products, …).
 */
(function () {
  var VALID = ["orders", "ship", "products", "add-product", "ip-counts"];
  var DEFAULT = "orders";

  function currentSection() {
    var hash = (window.location.hash || "").replace(/^#/, "");
    if (VALID.indexOf(hash) !== -1) return hash;
    var nav = document.querySelector(".admin-nav");
    var initial = nav && nav.getAttribute("data-section");
    if (initial && VALID.indexOf(initial) !== -1) return initial;
    return DEFAULT;
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
      var onShipPage = window.location.pathname.replace(/\/$/, "") === "/admin/ship";
      if (section === "ship" && !onShipPage) {
        window.location.href = "/admin/ship";
        return;
      }
      if (section !== "ship" && onShipPage) {
        window.location.href = "/admin#" + section;
        return;
      }
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

  var shipForm = document.getElementById("ship-form");
  var shipDialog = document.getElementById("ship-dialog");
  var shipStart = document.getElementById("ship-start");
  var shipHint = document.getElementById("ship-hint");
  var shipCancel = document.getElementById("ship-cancel");
  var trackingInput = document.getElementById("tracking_number");

  function selectedShipOrder() {
    return document.querySelector('#ship-form input[name="order_id"]:checked');
  }

  document.querySelectorAll(".ship-row").forEach(function (row) {
    row.addEventListener("click", function (event) {
      if (event.target.closest("a, button, input, label, textarea, select")) return;
      var radio = row.querySelector('input[type="radio"]');
      if (!radio || radio.disabled) return;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  document.querySelectorAll('#ship-form input[name="order_id"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      if (!shipHint || !radio.checked) return;
      var label = radio.getAttribute("data-order-label") || radio.value;
      shipHint.textContent = "Order " + label + " selected.";
    });
  });

  if (shipStart && shipDialog) {
    shipStart.addEventListener("click", function () {
      var selected = selectedShipOrder();
      if (!selected) {
        if (shipHint) {
          shipHint.textContent = "Select an unshipped order, then click Ship.";
        }
        return;
      }
      if (shipHint) shipHint.textContent = "";
      var label = document.getElementById("ship-dialog-order");
      if (label) {
        label.textContent = selected.getAttribute("data-order-label") || selected.value;
      }
      var carrierInput = document.getElementById("carrier");
      if (trackingInput) {
        trackingInput.required = true;
        trackingInput.value = "";
        trackingInput.setCustomValidity("");
      }
      if (carrierInput) carrierInput.value = "";
      if (typeof shipDialog.showModal === "function") {
        shipDialog.showModal();
        if (trackingInput) trackingInput.focus();
      }
    });
  }

  if (shipDialog) {
    shipDialog.addEventListener("close", function () {
      if (trackingInput) trackingInput.required = false;
    });
  }

  if (shipCancel && shipDialog) {
    shipCancel.addEventListener("click", function () {
      shipDialog.close();
    });
  }

  if (shipForm) {
    shipForm.addEventListener("submit", function (event) {
      var selected = selectedShipOrder();
      if (!selected) {
        event.preventDefault();
        if (shipHint) shipHint.textContent = "Select an unshipped order, then click Ship.";
        return;
      }
      if (trackingInput && !String(trackingInput.value || "").trim()) {
        event.preventDefault();
        trackingInput.value = "";
        trackingInput.setCustomValidity("Enter a tracking number.");
        trackingInput.reportValidity();
      }
    });
  }

  if (trackingInput) {
    trackingInput.addEventListener("input", function () {
      trackingInput.setCustomValidity("");
    });
  }

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
