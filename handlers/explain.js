const { getActionKeyboard } = require('../keyboards');
const { askAI } = require('../services/aiService');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function handleExplainTopic(bot, chatId, topic, session) {
  const subject = session.selectedSubject
    ? ` (${escapeHtml(session.selectedSubject)})`
    : '';

  try {
    await bot.sendMessage(chatId, '⏳ Готую пояснення теми...');

    const prompt = [
      'Поясни тему зрозумілою українською мовою для школяра.',
      subject ? `Предмет: ${session.selectedSubject}.` : '',
      `Тема: ${topic}`,
      'Додай коротке пояснення основних понять і простий приклад.',
    ]
      .filter(Boolean)
      .join('\n');

    const explanation = await askAI(prompt);
    bot.userStates[chatId] = 'subject_selected';

    await bot.sendMessage(
      chatId,
      `📚 <b>Пояснення теми${subject}: ${escapeHtml(topic)}</b>\n\n${escapeHtml(explanation)}`,
      {
        parse_mode: 'HTML',
        ...getActionKeyboard(session),
      }
    );
  } catch (error) {
    console.error('Explain topic error:', error);
    bot.userStates[chatId] = 'subject_selected';
    await bot.sendMessage(
      chatId,
      'Не вдалося отримати пояснення. Спробуй ще раз пізніше.',
      getActionKeyboard(session)
    );
  }
}

module.exports = { handleExplainTopic };
