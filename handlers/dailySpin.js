const dailySpinService = require('../services/dailySpinService');
const { backKeyboard } = require('../keyboards');

const MENU_TEXT = '🎡 Щоденна рулетка';

function isDailySpinMenuText(text) {
  return text === MENU_TEXT;
}

async function handleDailySpin(bot, chatId, userId, session, config, saveSession) {
  if (session.step !== 'completed') {
    await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
    return;
  }

  if (!dailySpinService.canSpinToday(session)) {
    await bot.sendMessage(chatId, config.messages.dailySpinAlreadyUsed, {
      parse_mode: 'HTML',
      ...backKeyboard,
    });
    return;
  }

  const spinning = await bot.sendMessage(chatId, '🎡 Крутимо щоденне колесо...', backKeyboard);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const result = dailySpinService.spinDaily(session, config);
  if (!result.ok) {
    try {
      await bot.editMessageText(config.messages.dailySpinAlreadyUsed, {
        chat_id: chatId,
        message_id: spinning.message_id,
        parse_mode: 'HTML',
      });
    } catch {
      await bot.sendMessage(chatId, config.messages.dailySpinAlreadyUsed, {
        parse_mode: 'HTML',
        ...backKeyboard,
      });
    }
    return;
  }

  saveSession(userId, session, { levelBefore: result.levelBefore });

  const text = [
    '🎡 <b>Щоденна рулетка</b>',
    '',
    result.applied.message,
    '',
    `💰 Твій XP: <b>${session.xp || 0}</b>`,
    session.hasFreezeItem ? '🧊 Заморозка стріку: <b>є</b>' : '🧊 Заморозка стріку: <b>немає</b>',
    '',
    'Повертайся завтра за новим обертом! 🍀',
  ].join('\n');

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: spinning.message_id,
      parse_mode: 'HTML',
    });
  } catch {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...backKeyboard });
  }
}

module.exports = {
  MENU_TEXT,
  isDailySpinMenuText,
  handleDailySpin,
};
