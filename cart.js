/**
 * Session shopping cart helpers.
 *
 * Cart shape in session: { [productId]: quantity }
 * Easy to inspect and tweak without touching routes.
 */

const db = require("./db");

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== "object") {
    req.session.cart = {};
  }
  return req.session.cart;
}

function cartCount(cart) {
  return Object.values(cart).reduce((sum, qty) => sum + Number(qty || 0), 0);
}

/**
 * Resolve cart into line items with product details.
 * Drops unknown product ids automatically.
 */
async function getCartItems(cart) {
  const items = [];
  for (const [productId, quantity] of Object.entries(cart || {})) {
    const product = await db.getProduct(productId);
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    if (!product || qty < 1) continue;
    items.push({
      product,
      quantity: qty,
      lineTotal: product.price * qty,
    });
  }
  return items;
}

function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.lineTotal, 0);
}

async function addToCart(req, productId, quantity = 1) {
  const product = await db.getProduct(productId);
  if (!product) return false;
  const cart = getCart(req);
  const add = Math.max(1, Math.floor(Number(quantity) || 1));
  cart[productId] = (Number(cart[productId]) || 0) + add;
  req.session.cart = cart;
  return true;
}

async function setCartQuantity(req, productId, quantity) {
  const product = await db.getProduct(productId);
  if (!product) return false;
  const cart = getCart(req);
  const qty = Math.floor(Number(quantity) || 0);
  if (qty < 1) {
    delete cart[productId];
  } else {
    cart[productId] = qty;
  }
  req.session.cart = cart;
  return true;
}

function removeFromCart(req, productId) {
  const cart = getCart(req);
  delete cart[productId];
  req.session.cart = cart;
}

function clearCart(req) {
  req.session.cart = {};
}

/** Build product_id / product_name strings for the orders table. */
function orderFieldsFromItems(items) {
  const productId = items.map((i) => `${i.product.id}×${i.quantity}`).join(", ");
  const productName = items
    .map((i) =>
      i.quantity > 1 ? `${i.product.name} ×${i.quantity}` : i.product.name
    )
    .join(", ");
  return { productId, productName };
}

module.exports = {
  getCart,
  cartCount,
  getCartItems,
  cartTotal,
  addToCart,
  setCartQuantity,
  removeFromCart,
  clearCart,
  orderFieldsFromItems,
};
