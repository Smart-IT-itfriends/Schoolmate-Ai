/**
 * Premium access helpers.
 * Premium is enabled for all users.
 * Legacy helpers (PREMIUM_USER_IDS / session.isPremium) are kept for compatibility.
 */

function parsePremiumIds() {
  const raw = process.env.PREMIUM_USER_IDS || '';
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function isPremium(_session, _userId) {
  return true;
}

function setPremium(session, value) {
  if (!session) {
    return session;
  }

  session.isPremium = Boolean(value);
  return session;
}

module.exports = {
  isPremium,
  setPremium,
  parsePremiumIds,
};
