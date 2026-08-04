const referralService = require('../services/referralService');
const { backKeyboard } = require('../keyboards');

function showReferralProgram(bot, chatId, userId, session, config) {
  const code = referralService.getOrCreateReferralCode(userId, session);
  const botUsername = bot.botUsername || process.env.BOT_USERNAME;

  if (!botUsername) {
    bot.sendMessage(
      chatId,
      '⚠️ Реферальна програма тимчасово недоступна. Спробуй пізніше.',
      backKeyboard
    );
    return;
  }

  const link = referralService.buildReferralLink(botUsername, code);
  const referralsCount = session.referralsCount || 0;
  const referrerReward = config.referral?.referrerReward || 0;
  const refereeReward = config.referral?.refereeReward || 0;
  const maxPerDay = config.referral?.maxReferralsPerDay || 0;

  const message = [
    '👥 <b>Реферальна програма</b>',
    '',
    'Запрошуй друзів і отримуй XP, коли вони завершать реєстрацію!',
    '',
    `🔗 <b>Твоє посилання:</b>`,
    `<code>${link}</code>`,
    '',
    `🔑 <b>Твій код:</b> <code>${code}</code>`,
    '',
    `👫 Запрошено друзів: <b>${referralsCount}</b>`,
    `🎁 Ти отримаєш: <b>+${referrerReward} XP</b> за кожного друга`,
    `🎉 Друг отримає: <b>+${refereeReward} XP</b> стартовий бонус`,
    maxPerDay > 0 ? `📅 Ліміт нагород на день: <b>${maxPerDay}</b>` : '',
    '',
    'Надішли посилання другу або нехай введе код під час реєстрації.',
  ]
    .filter(Boolean)
    .join('\n');

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Скопіювати посилання', callback_data: `referral:copy:${code}` }],
        [{ text: '⬅️ Повернутися в меню', callback_data: 'referral:back' }],
      ],
    },
  });
}

function handleReferralCallback(bot, query, config) {
  const data = query.data || '';

  if (!data.startsWith('referral:')) {
    return false;
  }

  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const action = data.split(':')[1];

  bot.answerCallbackQuery(query.id).catch(() => {});

  if (action === 'back') {
    bot.sendMessage(chatId, 'Повертаємось у головне меню 👇', require('../keyboards').mainKeyboard);
    return true;
  }

  if (action === 'copy') {
    const code = data.split(':')[2];
    const botUsername = bot.botUsername || process.env.BOT_USERNAME;

    if (!botUsername || !code) {
      return true;
    }

    const link = referralService.buildReferralLink(botUsername, code);
    bot.sendMessage(
      chatId,
      `📋 <b>Твоє реферальне посилання:</b>\n\n<code>${link}</code>\n\nНатисни на посилання, щоб скопіювати, і надішли другу.`,
      { parse_mode: 'HTML' }
    );
    return true;
  }

  return false;
}

function handleReferralRegistrationStep(bot, chatId, userId, text, session, config, saveSession) {
  if (session.step !== 'referral') {
    return false;
  }

  const skipLabels = ['⏭ Пропустити', 'пропустити', 'skip', '/skip'];

  if (skipLabels.includes(text.trim()) || skipLabels.includes(text)) {
    session.step = 'class';
    saveSession(userId, session);
    bot.sendMessage(chatId, 'Добре! В якому класі ти навчаєшся? (1–11)');
    return true;
  }

  const result = referralService.applyReferralCode(userId, text, session);

  if (!result.valid) {
    const messages = {
      invalid_code: '❌ Реферальний код не знайдено. Спробуй ще раз або натисни «⏭ Пропустити».',
      self_referral: '❌ Не можна використати власний код 😄 Спробуй інший або пропусти.',
      already_referred: 'ℹ️ Реферальний код уже застосовано.',
      referrer_not_registered: '❌ Цей код належить користувачу, який ще не завершив реєстрацію.',
    };

    bot.sendMessage(chatId, messages[result.reason] || config.messages.referralInvalid);
    return true;
  }

  saveSession(userId, session);
  session.step = 'class';
  saveSession(userId, session);

  bot.sendMessage(
    chatId,
    `✅ Реферальний код застосовано! Після завершення реєстрації ти отримаєш бонусні XP.\n\nВ якому класі ти навчаєшся? (1–11)`
  );
  return true;
}

function askForReferralCode(bot, chatId) {
  bot.sendMessage(
    chatId,
    '🎁 <b>Маєш реферальний код від друга?</b>\n\nВведи його зараз або натисни «⏭ Пропустити».',
    {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [['⏭ Пропустити']],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
}

function notifyReferralRewards(bot, chatId, userId, result, config) {
  if (!result.success) {
    return;
  }

  bot.sendMessage(
    chatId,
    `🎉 <b>Реферальний бонус!</b>\n\nТи отримав(ла) <b>+${result.refereeReward} XP</b> за реєстрацію за запрошенням друга!`,
    { parse_mode: 'HTML' }
  );

  if (result.referrerReward > 0) {
    bot
      .sendMessage(
        result.referrerId,
        `👥 <b>Новий реферал!</b>\n\nТвій друг завершив реєстрацію. Ти отримав(ла) <b>+${result.referrerReward} XP</b>!`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {});
  }
}

module.exports = {
  showReferralProgram,
  handleReferralCallback,
  handleReferralRegistrationStep,
  askForReferralCode,
  notifyReferralRewards,
};
