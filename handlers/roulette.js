const rouletteService = require('../services/rouletteService');
const rankService = require('../services/rankService');
const leaderboardService = require('../services/leaderboardService');
const { mainKeyboard } = require('../keyboards');

const rouletteDrafts = {};

const rouletteKeyboard = {
  reply_markup: {
    keyboard: [['⬅️ Вийти з рулетки']],
    resize_keyboard: true,
  },
};

function getSettings(config) {
  return config.roulette || {};
}

function isRouletteMenuText(text) {
  return text === '🎰 Рулетка XP';
}

function isLeaveRouletteText(text) {
  return text === '⬅️ Вийти з рулетки';
}

function buildBetKeyboard(config) {
  const presets = getSettings(config).presetBets || [10, 25, 50, 100, 250, 500];
  const rows = [];
  for (let i = 0; i < presets.length; i += 3) {
    rows.push(
      presets.slice(i, i + 3).map((amount) => ({
        text: `${amount} XP`,
        callback_data: `roulette:bet:${amount}`,
      }))
    );
  }
  rows.push([{ text: '✏️ Своя сума', callback_data: 'roulette:custom' }]);
  return { inline_keyboard: rows };
}

function buildColorKeyboard(bet) {
  return {
    inline_keyboard: [
      [
        { text: '🔴 Червоне', callback_data: `roulette:color:red:${bet}` },
        { text: '⚫ Чорне', callback_data: `roulette:color:black:${bet}` },
      ],
    ],
  };
}

function buildAfterSpinKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🎰 Грати ще', callback_data: 'roulette:menu' },
        { text: '⬅️ В меню', callback_data: 'roulette:exit' },
      ],
    ],
  };
}

function showRouletteMenu(bot, chatId, session, config) {
  const settings = getSettings(config);
  const multiplier = settings.winMultiplier ?? settings.winProfitPercent ?? 1.5;
  const balance = session.xp || 0;

  const text = [
    '🎰 <b>Рулетка XP</b>',
    '',
    `💰 Твій баланс: <b>${balance} XP</b>`,
    '',
    '<b>Правила:</b>',
    `• Обери ставку в XP`,
    `• Обери колір: 🔴 червоне або ⚫ чорне`,
    `• ✅ Виграш: ставка × <b>x${multiplier}</b>`,
    `• ❌ Програш: втрачаєш <b>всю ставку</b>`,
    `• 🟢 Випаде 0 — програш обох кольорів`,
    '',
    `Мін. ставка: ${settings.minBet || 5} XP · Макс.: ${settings.maxBet || 5000} XP`,
    '',
    'Обери суму ставки 👇',
  ].join('\n');

  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: buildBetKeyboard(config),
  });
}

function startRoulette(bot, chatId, userId, session, userStates, config) {
  userStates[chatId] = 'roulette_menu';
  delete rouletteDrafts[userId];
  bot.sendMessage(chatId, '🎰 Режим рулетки активний. Щоб вийти — «⬅️ Вийти з рулетки».', rouletteKeyboard);
  showRouletteMenu(bot, chatId, session, config);
}

function leaveRoulette(bot, chatId, userId, userStates) {
  delete userStates[chatId];
  delete rouletteDrafts[userId];
  bot.sendMessage(chatId, '👋 Ти вийшов(ла) з рулетки.', mainKeyboard);
}

function clearRouletteState(chatId, userId, userStates) {
  if (userStates[chatId] && String(userStates[chatId]).startsWith('roulette')) {
    delete userStates[chatId];
  }
  delete rouletteDrafts[userId];
}

function applySpinResult(session, result, config) {
  if (result.won) {
    return rankService.applyXpChange(session, result.profit, config);
  }
  return rankService.applyXpChange(session, result.netChange, config);
}

async function performSpin(bot, chatId, userId, session, bet, color, config, saveSession) {
  const validation = rouletteService.validateBet(bet, session, config);
  if (!validation.ok) {
    await bot.sendMessage(chatId, validation.message, {
      parse_mode: 'HTML',
      reply_markup: buildBetKeyboard(config),
    });
    return;
  }

  const spinning = await bot.sendMessage(chatId, '🎰 Крутимо рулетку...', rouletteKeyboard);
  await new Promise((resolve) => setTimeout(resolve, 1400));

  const result = rouletteService.resolveSpin(validation.bet, color, config);
  const xpResult = applySpinResult(session, result, config);
  if (result.won && result.profit > 0) {
    leaderboardService.recordXpChange(session, result.profit);
  }
  saveSession(userId, session, { levelBefore: xpResult.oldLevel });

  const wheelLabel = rouletteService.colorLabel(result.wheel.color);
  const chosenLabel = rouletteService.colorLabel(color);
  const settings = getSettings(config);
  const multiplier = settings.winMultiplier ?? settings.winProfitPercent ?? 1.5;

  let outcomeText;
  if (result.won) {
    outcomeText = [
      '🎉 <b>Виграш!</b>',
      '',
      `Колесо: <b>${result.wheel.pocket}</b> · ${wheelLabel}`,
      `Твій вибір: ${chosenLabel}`,
      `Ставка: <b>${validation.bet} XP</b>`,
      `Виграш (x${multiplier}): <b>+${result.profit} XP</b>`,
      `Новий баланс: <b>${session.xp} XP</b>`,
    ].join('\n');
  } else {
    outcomeText = [
      '😔 <b>Програш</b>',
      '',
      `Колесо: <b>${result.wheel.pocket}</b> · ${wheelLabel}`,
      `Твій вибір: ${chosenLabel}`,
      `Ставка втрачена: <b>-${validation.bet} XP</b>`,
      `Новий баланс: <b>${session.xp} XP</b>`,
    ].join('\n');
  }

  try {
    await bot.editMessageText(outcomeText, {
      chat_id: chatId,
      message_id: spinning.message_id,
      parse_mode: 'HTML',
      reply_markup: buildAfterSpinKeyboard(),
    });
  } catch {
    await bot.sendMessage(chatId, outcomeText, {
      parse_mode: 'HTML',
      reply_markup: buildAfterSpinKeyboard(),
    });
  }
}

async function handleRouletteMessage(bot, chatId, userId, text, session, userStates, config, saveSession) {
  const state = userStates[chatId];
  if (state !== 'roulette_custom_bet') {
    return false;
  }

  if (isLeaveRouletteText(text)) {
    leaveRoulette(bot, chatId, userId, userStates);
    return true;
  }

  const amount = parseInt(text.replace(/\s/g, ''), 10);
  const validation = rouletteService.validateBet(amount, session, config);
  if (!validation.ok) {
    await bot.sendMessage(chatId, validation.message, {
      parse_mode: 'HTML',
      ...rouletteKeyboard,
    });
    return true;
  }

  userStates[chatId] = 'roulette_pick_color';
  rouletteDrafts[userId] = { bet: validation.bet };

  await bot.sendMessage(
    chatId,
    `Ставка: <b>${validation.bet} XP</b>\n\nОбери колір 👇`,
    {
      parse_mode: 'HTML',
      reply_markup: buildColorKeyboard(validation.bet),
    }
  );
  return true;
}

async function handleRouletteCallback(bot, query, session, userStates, config, saveSession) {
  const data = String(query.data || '');
  if (!data.startsWith('roulette:')) {
    return false;
  }

  const chatId = query.message?.chat?.id || query.from.id;
  const userId = query.from.id;

  await bot.answerCallbackQuery(query.id);

  const parts = data.split(':');
  const action = parts[1];

  if (action === 'exit') {
    leaveRoulette(bot, chatId, userId, userStates);
    return true;
  }

  if (action === 'menu') {
    userStates[chatId] = 'roulette_menu';
    showRouletteMenu(bot, chatId, session, config);
    return true;
  }

  if (action === 'custom') {
    userStates[chatId] = 'roulette_custom_bet';
    await bot.sendMessage(chatId, config.messages.rouletteAskCustomBet, {
      parse_mode: 'HTML',
      ...rouletteKeyboard,
    });
    return true;
  }

  if (action === 'bet') {
    const bet = Number(parts[2]);
    userStates[chatId] = 'roulette_pick_color';
    rouletteDrafts[userId] = { bet };

    await bot.sendMessage(
      chatId,
      `Ставка: <b>${bet} XP</b>\n\nОбери колір 👇`,
      {
        parse_mode: 'HTML',
        reply_markup: buildColorKeyboard(bet),
      }
    );
    return true;
  }

  if (action === 'color') {
    const color = parts[2];
    const bet = Number(parts[3] || rouletteDrafts[userId]?.bet || 0);
    userStates[chatId] = 'roulette_menu';
    await performSpin(bot, chatId, userId, session, bet, color, config, saveSession);
    return true;
  }

  return false;
}

module.exports = {
  rouletteKeyboard,
  isRouletteMenuText,
  isLeaveRouletteText,
  startRoulette,
  leaveRoulette,
  clearRouletteState,
  handleRouletteMessage,
  handleRouletteCallback,
  showRouletteMenu,
};
