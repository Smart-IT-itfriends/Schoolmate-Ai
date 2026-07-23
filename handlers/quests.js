const questService = require('../services/questService');
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
  const result = questService.triggerQuestProgress(userId, targetType, session);

  if (result.completions.length > 0 && session && typeof saveSession === 'function') {
    saveSession(userId, session);
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
