const { getSession, saveSession } = require('../services/userService');

function startRegistration(bot, chatId, user, isReregister = false) {
  const previousSession = getSession(user.id);
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
    rewardBuff: previousSession?.rewardBuff || null,
  };

  saveSession(user.id, session);

  const message = isReregister
    ? '🔄 Давай оновимо твої дані.\n\nЯк тебе звати?'
    : '👋 Привіт! Я Schoolmate AI.\n\nЯк тебе звати?';

  delete bot.userStates?.[chatId];

  bot.sendMessage(chatId, message, {
    reply_markup: { remove_keyboard: true },
  });
}

module.exports = {
  startRegistration,
};
