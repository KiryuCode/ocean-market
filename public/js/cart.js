/**
 * Add-to-cart without full page reload (keeps scroll position).
 * Falls back to normal form submit if fetch fails.
 */
(function () {
  function updateCartBadge(count) {
    const badge = document.getElementById("cart-badge");
    if (!badge) return;
    const n = Number(count) || 0;
    badge.textContent = String(n);
    if (n > 0) {
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.classList.contains("js-add-to-cart")) return;

    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;

    const body = new URLSearchParams(new FormData(form));
    body.set("ajax", "1");

    fetch(form.action || "/cart/add", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      credentials: "same-origin",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Add to cart failed");
        return res.json();
      })
      .then(function (data) {
        if (data && data.ok) {
          updateCartBadge(data.cartCount);
        } else {
          throw new Error((data && data.error) || "Add to cart failed");
        }
      })
      .catch(function () {
        // Fallback: classic submit (will reload)
        form.classList.remove("js-add-to-cart");
        form.submit();
      })
      .finally(function () {
        if (button) button.disabled = false;
      });
  });
})();
