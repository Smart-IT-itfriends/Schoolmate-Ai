const questService = require('../services/questService');
const rankService = require('../services/rankService');
const config = require('../config');
const { backKeyboard } = require('../keyboards');

function showQuests(bot, chatId, userId) {
  questService.ensureUserQuests(userId);
  const message = questService.formatQuestsList(userId);

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

function applyQuestTrigger(bot, chatId, userId, targetType, session, saveSession) {
  const levelBefore = session
    ? rankService.calculateLevel(session.xp || 0, config).currentLevel
    : 1;
  const result = questService.triggerQuestProgress(userId, targetType, session);

  if (result.completions.length > 0 && session && typeof saveSession === 'function') {
    saveSession(userId, session, { levelBefore });
  }

  for (const completion of result.completions) {
    bot.sendMessage(chatId, completion.message, { parse_mode: 'HTML' });
  }

  return result;
}

module.exports = {
  showQuests,
  applyQuestTrigger,
};
