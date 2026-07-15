const { getActionKeyboard } = require('../keyboards');
const userService = require('../services/userService');

function handleExplainTopic(bot, chatId, topic, session) {
  const subject = session.selectedSubject ? ` (${session.selectedSubject})` : '';
  bot.userStates[chatId] = 'subject_selected';

  session.aiRequests = (session.aiRequests || 0) + 1;
  session.lastActivityDate = new Date().toISOString();
  userService.saveSession(session.telegramId || session.id, session);

  bot.sendMessage(
    chatId,
    `📚 <b>Пояснення теми${subject}: ${topic}</b>\n\nОсь основна інформація про цю тему:\n\n<i>Тут буде детальне пояснення від AI.</i>`,
    {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    }
  );
}

module.exports = { handleExplainTopic };
