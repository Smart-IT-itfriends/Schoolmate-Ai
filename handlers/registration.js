const { saveSession } = require('../services/userService');

function startRegistration(bot, chatId, user, isReregister = false) {
  const session = {
    step: 'name',
    name: null,
    class: null,
    selectedSubject: null,
    aiRequests: 0,
    xp: 0,
    dailyStreak: 0,
    lastRewardClaimedDate: null,
    hasFreezeItem: false,
    activeBuff: null,
    lastActivityDate: new Date().toISOString(),
    telegramId: user.id,
    username: user.username || null,
    startedAt: new Date().toISOString(),
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
