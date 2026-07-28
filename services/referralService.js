const crypto = require('crypto');
const userService = require('./userService');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function ensureReferralFields(session) {
  return userService.ensureReferralFields(session);
}

function generateUniqueCode(length, users) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < length; i += 1) {
      const index = crypto.randomInt(0, CODE_CHARS.length);
      code += CODE_CHARS[index];
    }

    const exists = Object.values(users).some(
      (user) => user?.referralCode && user.referralCode.toUpperCase() === code
    );

    if (!exists) {
      return code;
    }
  }

  throw new Error('Не вдалося згенерувати унікальний реферальний код');
}

function getOrCreateReferralCode(userId, session) {
  ensureReferralFields(session);

  if (session.referralCode) {
    return session.referralCode;
  }

  const users = userService.loadUsers();
  const code = generateUniqueCode(6, users);
  session.referralCode = code;
  userService.saveSession(userId, session);
  return code;
}

function findUserByReferralCode(code) {
  if (!code || typeof code !== 'string') {
    return null;
  }

  const normalized = code.trim().toUpperCase();
  const users = userService.loadUsers();

  for (const [userId, session] of Object.entries(users)) {
    if (session?.referralCode && session.referralCode.toUpperCase() === normalized) {
      return { userId, session };
    }
  }

  return null;
}

function parseStartPayload(text) {
  const match = text.match(/\/start(?:\s+(.+))?/);
  const payload = match?.[1]?.trim();

  if (!payload) {
    return null;
  }

  if (payload.toLowerCase().startsWith('ref_')) {
    return payload.slice(4).trim();
  }

  return payload;
}

function buildReferralLink(botUsername, code) {
  return `https://t.me/${botUsername}?start=ref_${code}`;
}

function canReferrerReceiveReward(referrerSession, config) {
  ensureReferralFields(referrerSession);

  const referralConfig = config.referral || {};
  const maxTotal = referralConfig.maxReferralsTotal || 0;
  const maxPerDay = referralConfig.maxReferralsPerDay || 0;
  const today = getTodayDateString();

  if (maxTotal > 0 && (referrerSession.referralsCount || 0) >= maxTotal) {
    return { allowed: false, reason: 'total_limit' };
  }

  if (referrerSession.referralRewardsDate !== today) {
    referrerSession.referralRewardsDate = today;
    referrerSession.referralRewardsToday = 0;
  }

  if (maxPerDay > 0 && (referrerSession.referralRewardsToday || 0) >= maxPerDay) {
    return { allowed: false, reason: 'daily_limit' };
  }

  return { allowed: true };
}

function validateReferralApplication(refereeId, referralCode, refereeSession) {
  ensureReferralFields(refereeSession);

  if (refereeSession.referredBy) {
    return { valid: false, reason: 'already_referred' };
  }

  const referrer = findUserByReferralCode(referralCode);
  if (!referrer) {
    return { valid: false, reason: 'invalid_code' };
  }

  if (String(referrer.userId) === String(refereeId)) {
    return { valid: false, reason: 'self_referral' };
  }

  if (!referrer.session || referrer.session.step !== 'completed') {
    return { valid: false, reason: 'referrer_not_registered' };
  }

  return {
    valid: true,
    referrerId: referrer.userId,
    referrerSession: referrer.session,
  };
}

function applyReferralCode(refereeId, referralCode, refereeSession) {
  const validation = validateReferralApplication(refereeId, referralCode, refereeSession);

  if (!validation.valid) {
    return validation;
  }

  refereeSession.referredBy = Number(validation.referrerId) || validation.referrerId;
  ensureReferralFields(refereeSession);

  return {
    valid: true,
    referrerId: validation.referrerId,
  };
}

function processReferralReward(refereeId, config) {
  const users = userService.loadUsers();
  const refereeKey = String(refereeId);
  const referee = users[refereeKey];

  if (!referee) {
    return { success: false, reason: 'referee_not_found' };
  }

  ensureReferralFields(referee);

  if (!referee.referredBy || referee.referralRewardClaimed) {
    return { success: false, reason: 'no_pending_referral' };
  }

  const referrerKey = String(referee.referredBy);
  const referrer = users[referrerKey];

  if (!referrer) {
    return { success: false, reason: 'referrer_not_found' };
  }

  if (referrerKey === refereeKey) {
    return { success: false, reason: 'self_referral' };
  }

  if (referrer.step !== 'completed') {
    return { success: false, reason: 'referrer_not_registered' };
  }

  if ((referrer.referredUsers || []).includes(Number(refereeId)) || (referrer.referredUsers || []).includes(refereeKey)) {
    return { success: false, reason: 'duplicate' };
  }

  ensureReferralFields(referrer);

  const rewardCheck = canReferrerReceiveReward(referrer, config);
  const referrerGetsReward = rewardCheck.allowed;

  const referralConfig = config.referral || {};
  const referrerReward = referralConfig.referrerReward || 0;
  const refereeReward = referralConfig.refereeReward || 0;

  if (referrerGetsReward) {
    referrer.xp = (referrer.xp || 0) + referrerReward;
    referrer.referralsCount = (referrer.referralsCount || 0) + 1;
    referrer.referralRewardsToday = (referrer.referralRewardsToday || 0) + 1;
    referrer.referralRewardsDate = getTodayDateString();
  }

  referrer.referredUsers = [...(referrer.referredUsers || []), Number(refereeId) || refereeKey];

  referee.xp = (referee.xp || 0) + refereeReward;
  referee.referralRewardClaimed = true;

  users[referrerKey] = referrer;
  users[refereeKey] = referee;
  userService.saveUsers(users);

  return {
    success: true,
    referrerId: referrerKey,
    referrerReward: referrerGetsReward ? referrerReward : 0,
    refereeReward,
    referrerName: referrer.name || 'друг',
    referrerLimited: !referrerGetsReward,
    limitReason: referrerGetsReward ? null : rewardCheck.reason,
  };
}

module.exports = {
  ensureReferralFields,
  getOrCreateReferralCode,
  findUserByReferralCode,
  parseStartPayload,
  buildReferralLink,
  validateReferralApplication,
  applyReferralCode,
  processReferralReward,
  canReferrerReceiveReward,
  getTodayDateString,
};
