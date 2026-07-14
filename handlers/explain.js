const { getActionKeyboard } = require('../keyboards');

function handleExplainTopic(bot, chatId, topic, session) {
  const subject = session.selectedSubject ? ` (${session.selectedSubject})` : '';
  bot.userStates[chatId] = 'subject_selected';

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
