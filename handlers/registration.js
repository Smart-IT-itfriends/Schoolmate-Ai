const { getSession, saveSession, getDefaultStats, ensureStats } = require('../services/userService');
const referralService = require('../services/referralService');

function startRegistration(bot, chatId, user, isReregister = false, referralPayload = null) {
  const previousSession = getSession(user.id);
  const referralEligible = !previousSession?.completedAt && !isReregister;

  const session = {
    step: 'name',
    name: null,
    class: null,
    selectedSubject: null,
    telegramId: user.id,
    username: user.username || null,
    startedAt: new Date().toISOString(),
    completedAt: previousSession?.completedAt || null,
    xp: previousSession?.xp || 0,
    totalAiRequests: previousSession?.totalAiRequests || 0,
    dailyStreak: previousSession?.dailyStreak || 0,
    lastRewardClaimedDate: previousSession?.lastRewardClaimedDate || null,
    hasFreezeItem: previousSession?.hasFreezeItem || false,
    activeBuff: previousSession?.activeBuff || null,
    lastActivityDate: new Date().toISOString(),
    timezone: previousSession?.timezone || 'Europe/Kyiv',
    rewardBuff: previousSession?.rewardBuff || null,
    stats: previousSession ? ensureStats(previousSession) : getDefaultStats(),
    referralEligible,
    referredBy: previousSession?.referredBy || null,
    referralCode: previousSession?.referralCode || null,
    referralsCount: previousSession?.referralsCount || 0,
    referredUsers: previousSession?.referredUsers || [],
    referralRewardClaimed: previousSession?.referralRewardClaimed || false,
    referralRewardsDate: previousSession?.referralRewardsDate || null,
    referralRewardsToday: previousSession?.referralRewardsToday || 0,
    pendingReferralCode: null,
  };

  referralService.ensureReferralFields(session);

  if (referralEligible && referralPayload) {
    const applyResult = referralService.applyReferralCode(user.id, referralPayload, session);
    if (applyResult.valid) {
      session.pendingReferralCode = referralPayload.toUpperCase();
    }
  }

  saveSession(user.id, session);

  const message = isReregister
    ? '🔄 Давай оновимо твої дані.\n\nЯк тебе звати?'
    : referralPayload && session.referredBy
      ? '👋 Привіт! Я Schoolmate AI.\n\n🎁 Тебе запросив друг — після реєстрації ти отримаєш бонусні XP!\n\nЯк тебе звати?'
      : '👋 Привіт! Я Schoolmate AI.\n\nЯк тебе звати?';

  delete bot.userStates?.[chatId];

  bot.sendMessage(chatId, message, {
    reply_markup: { remove_keyboard: true },
  });
}

module.exports = {
  startRegistration,
};
