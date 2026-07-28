/**
 * Premium access helpers.
 * Premium is enabled for all users.
 * Legacy helpers (PREMIUM_USER_IDS / session.isPremium) are kept for compatibility.
 */
const config = require('../config');
const userService = require('./userService');

const locks = new Map();

function parsePremiumIds() {
  const raw = process.env.PREMIUM_USER_IDS || '';
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function isPremium(session, userId) {
  // Prefer explicit session field if present
  try {
    const now = Date.now();
    const until = session && (session.premiumUntil || session.premium_until);
    if (until && Date.parse(until) > now) {
      return true;
    }

    // Fallback to env-specified premium user IDs
    const ids = parsePremiumIds();
    if (ids.has(String(userId))) return true;
  } catch (e) {
    // ignore parse errors
  }

  return false;
}

function getProducts() {
  return (config.premium && config.premium.products) || [];
}

async function purchaseProduct(userId, productId) {
  if (locks.get(userId)) {
    return { success: false, error: 'in_progress' };
  }

  locks.set(userId, true);
  try {
    const users = userService.loadUsers();
    const userKey = String(userId);
    const session = users[userKey] || {};

    const products = getProducts();
    const product = products.find((p) => p.id === productId);
    if (!product) {
      return { success: false, error: 'not_found' };
    }

    session.xp = Number.isFinite(session.xp) ? session.xp : 0;
    if (session.xp < product.cost) {
      return { success: false, error: 'insufficient', needed: product.cost, balance: session.xp };
    }

    // Deduct XP
    session.xp -= product.cost;

    // Compute premiumUntil (extend if active)
    const now = Date.now();
    const existingUntil = session.premiumUntil ? Date.parse(session.premiumUntil) : 0;
    const base = existingUntil > now ? existingUntil : now;
    const newUntil = new Date(base + product.days * 24 * 60 * 60 * 1000).toISOString();
    session.premiumUntil = newUntil;

    // Persist
    users[userKey] = session;
    userService.saveUsers(users);

    return { success: true, session, product, newXp: session.xp, premiumUntil: newUntil };
  } catch (err) {
    return { success: false, error: 'server_error', details: err.message };
  } finally {
    locks.delete(userId);
  }
}

module.exports = {
  isPremium,
  setPremium: (session, value) => {
    if (!session) return session;
    session.isPremium = Boolean(value);
    return session;
  },
  parsePremiumIds,
  getProducts,
  purchaseProduct,
};
