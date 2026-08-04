const pokerService = require('../services/pokerService');
const rankService = require('../services/rankService');
const leaderboardService = require('../services/leaderboardService');
const { mainKeyboard } = require('../keyboards');

const pokerDrafts = {};

const pokerKeyboard = {
  reply_markup: {
    keyboard: [['⬅️ Вийти з покеру']],
    resize_keyboard: true,
  },
};

function getSettings(config) {
  return config.poker || {};
}

function isPokerMenuText(text) {
  return text === '🃏 Покер';
}

function isLeavePokerText(text) {
  return text === '⬅️ Вийти з покеру';
}

function getDraft(userId) {
  return pokerDrafts[userId] || null;
}

function setDraft(userId, draft) {
  pokerDrafts[userId] = draft;
}

function clearDraft(userId) {
  delete pokerDrafts[userId];
}

function buildVariantKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🂡 5-карточний Дро-покер', callback_data: 'poker:variant:draw' }],
      [{ text: '🂠 Техаський Холдем', callback_data: 'poker:variant:holdem' }],
      [{ text: '⬅️ В меню', callback_data: 'poker:exit' }],
    ],
  };
}

function buildBetKeyboard(config) {
  const presets = getSettings(config).presetBets || [10, 25, 50, 100, 250, 500];
  const rows = [];
  for (let i = 0; i < presets.length; i += 3) {
    rows.push(
      presets.slice(i, i + 3).map((amount) => ({
        text: `${amount} XP`,
        callback_data: `poker:bet:${amount}`,
      }))
    );
  }
  rows.push([
    { text: '✏️ Своя сума', callback_data: 'poker:custom' },
    { text: '⬅️ До видів гри', callback_data: 'poker:menu' },
  ]);
  return { inline_keyboard: rows };
}

function buildAfterHandKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🃏 Грати ще', callback_data: 'poker:menu' },
        { text: '⬅️ В меню', callback_data: 'poker:exit' },
      ],
    ],
  };
}

function buildDiscardKeyboard(draft) {
  const mask = draft.discardMask || [false, false, false, false, false];
  const cardRow = draft.playerCards.map((card, idx) => ({
    text: `${mask[idx] ? '❌' : '✅'} ${pokerService.formatCard(card)}`,
    callback_data: `poker:toggle:${idx}`,
  }));
  return {
    inline_keyboard: [
      cardRow.slice(0, 3),
      cardRow.slice(3),
      [
        { text: '🔄 Обміняти вибрані', callback_data: 'poker:draw' },
        { text: '✋ Залишити як є', callback_data: 'poker:keep' },
      ],
    ],
  };
}

function buildHoldemContinueKeyboard(stage) {
  const labels = {
    preflop: 'Показати флоп (3 карти)',
    flop: 'Показати терн',
    turn: 'Показати рівер',
    river: 'Розкрити карти суперника',
  };
  return {
    inline_keyboard: [[{ text: `▶️ ${labels[stage] || 'Далі'}`, callback_data: 'poker:next' }]],
  };
}

function showPokerMenu(bot, chatId, session, config) {
  const settings = getSettings(config);
  const multiplier = settings.winMultiplier ?? 1.5;
  const balance = session.xp || 0;

  const text = [
    '🃏 <b>Покер XP</b>',
    '',
    `💰 Твій баланс: <b>${balance} XP</b>`,
    '',
    '<b>Два види гри проти бота:</b>',
    '• <b>5-карточний Дро-покер</b> — 5 карт, можна обміняти частину',
    '• <b>Техаський Холдем</b> — 2 свої карти + 5 спільних на столі',
    '',
    '<b>Правила виплат:</b>',
    `• ✅ Виграш: ставка × <b>x${multiplier}</b>`,
    '• ❌ Програш: втрачаєш <b>всю ставку</b>',
    '• 🤝 Нічия: ставка повертається',
    '',
    `Мін. ставка: ${settings.minBet || 5} XP · Макс.: ${settings.maxBet || 5000} XP`,
    '',
    'Обери вид покеру 👇',
  ].join('\n');

  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: buildVariantKeyboard(),
  });
}

function showBetMenu(bot, chatId, session, config, variant) {
  const label = pokerService.variantLabel(variant);
  const balance = session.xp || 0;
  const text = [
    `🃏 <b>${label}</b>`,
    '',
    `💰 Баланс: <b>${balance} XP</b>`,
    '',
    'Обери суму ставки 👇',
  ].join('\n');

  bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: buildBetKeyboard(config),
  });
}

function startPoker(bot, chatId, userId, session, userStates, config) {
  userStates[chatId] = 'poker_menu';
  clearDraft(userId);
  bot.sendMessage(chatId, '🃏 Режим покеру активний. Щоб вийти — «⬅️ Вийти з покеру».', pokerKeyboard);
  showPokerMenu(bot, chatId, session, config);
}

function leavePoker(bot, chatId, userId, userStates) {
  delete userStates[chatId];
  clearDraft(userId);
  bot.sendMessage(chatId, '👋 Ти вийшов(ла) з покеру.', mainKeyboard);
}

function clearPokerState(chatId, userId, userStates) {
  if (userStates[chatId] && String(userStates[chatId]).startsWith('poker')) {
    delete userStates[chatId];
  }
  clearDraft(userId);
}

function applyHandResult(session, result, config) {
  if (result.outcome === 'win') {
    return rankService.applyXpChange(session, result.profit, config);
  }
  if (result.outcome === 'loss') {
    return rankService.applyXpChange(session, result.netChange, config);
  }
  return rankService.applyXpChange(session, 0, config);
}

async function settleHand(bot, chatId, userId, session, draft, config, saveSession, userStates, messageId) {
  const result = pokerService.resolveShowdown(draft, draft.bet, config);
  const xpResult = applyHandResult(session, result, config);
  if (result.outcome === 'win' && result.profit > 0) {
    leaderboardService.recordXpChange(session, result.profit);
  }
  saveSession(userId, session, { levelBefore: xpResult.oldLevel });

  const settings = getSettings(config);
  const multiplier = settings.winMultiplier ?? 1.5;
  const variant = pokerService.variantLabel(draft.variant);

  let outcomeLine;
  if (result.outcome === 'win') {
    outcomeLine = `🎉 <b>Виграш!</b> +${result.profit} XP (x${multiplier})`;
  } else if (result.outcome === 'loss') {
    outcomeLine = `😔 <b>Програш</b> −${draft.bet} XP`;
  } else {
    outcomeLine = '🤝 <b>Нічия</b> — ставка повернута';
  }

  const lines = [
    `🃏 <b>${variant} — розклад</b>`,
    '',
    `Твої карти: <b>${pokerService.formatCards(draft.playerCards)}</b>`,
    `Комбінація: <b>${result.playerHand.name}</b>`,
  ];
  if (draft.variant === 'holdem') {
    lines.push(`Стіл: <b>${pokerService.formatCards(draft.community)}</b>`);
  }
  lines.push(
    '',
    `Бот: <b>${pokerService.formatCards(draft.aiCards)}</b>`,
    `Комбінація бота: <b>${result.aiHand.name}</b>`,
    '',
    `Ставка: <b>${draft.bet} XP</b>`,
    outcomeLine,
    `Новий баланс: <b>${session.xp} XP</b>`
  );
  const text = lines.join('\n');

  if (userStates) {
    userStates[chatId] = 'poker_menu';
  }
  clearDraft(userId);

  const options = {
    parse_mode: 'HTML',
    reply_markup: buildAfterHandKeyboard(),
  };

  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...options,
      });
      return;
    } catch {
      // fall through
    }
  }
  await bot.sendMessage(chatId, text, options);
}

async function beginDrawRound(bot, chatId, userId, session, bet, config, userStates) {
  const hand = pokerService.startDrawHand();
  const draft = {
    ...hand,
    bet,
    discardMask: [false, false, false, false, false],
  };
  setDraft(userId, draft);
  userStates[chatId] = 'poker_draw_discard';

  const text = [
    '🂡 <b>Дро-покер</b>',
    '',
    `Ставка: <b>${bet} XP</b>`,
    `Твої карти: <b>${pokerService.formatCards(draft.playerCards)}</b>`,
    '',
    'Натисни на карти, які хочеш <b>скинути</b> (❌), потім «Обміняти».',
    'Або залиш руку як є.',
  ].join('\n');

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: buildDiscardKeyboard(draft),
  });
}

async function beginHoldemRound(bot, chatId, userId, session, bet, config, userStates) {
  const hand = pokerService.startHoldemHand();
  const draft = { ...hand, bet };
  setDraft(userId, draft);
  userStates[chatId] = 'poker_holdem';

  const text = [
    '🂠 <b>Техаський Холдем</b>',
    '',
    `Ставка: <b>${bet} XP</b>`,
    `Твої карти (hole): <b>${pokerService.formatCards(draft.playerCards)}</b>`,
    'Карти бота: <b>🂠 🂠</b>',
    'Стіл: —',
    '',
    'Натисни, щоб відкрити наступну вулицю 👇',
  ].join('\n');

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: buildHoldemContinueKeyboard(draft.stage),
  });
}

function holdemBoardText(draft) {
  return [
    '🂠 <b>Техаський Холдем</b>',
    '',
    `Ставка: <b>${draft.bet} XP</b>`,
    `Твої карти: <b>${pokerService.formatCards(draft.playerCards)}</b>`,
    'Карти бота: <b>🂠 🂠</b>',
    `Стіл (${draft.stage}): <b>${pokerService.formatCards(draft.community) || '—'}</b>`,
    '',
    draft.stage === 'river'
      ? 'Час розкрити карти суперника 👇'
      : 'Натисни, щоб відкрити наступну вулицю 👇',
  ].join('\n');
}

async function handlePokerMessage(bot, chatId, userId, text, session, userStates, config, saveSession) {
  const state = userStates[chatId];
  if (state !== 'poker_custom_bet') {
    return false;
  }

  if (isLeavePokerText(text)) {
    leavePoker(bot, chatId, userId, userStates);
    return true;
  }

  const amount = parseInt(String(text).replace(/\s/g, ''), 10);
  const validation = pokerService.validateBet(amount, session, config);
  if (!validation.ok) {
    await bot.sendMessage(chatId, validation.message, {
      parse_mode: 'HTML',
      ...pokerKeyboard,
    });
    return true;
  }

  const draft = getDraft(userId);
  const variant = draft?.variant || 'draw';
  setDraft(userId, { ...(draft || {}), variant, bet: validation.bet });

  if (variant === 'holdem') {
    await beginHoldemRound(bot, chatId, userId, session, validation.bet, config, userStates);
  } else {
    await beginDrawRound(bot, chatId, userId, session, validation.bet, config, userStates);
  }
  return true;
}

async function handlePokerCallback(bot, query, session, userStates, config, saveSession) {
  const data = String(query.data || '');
  if (!data.startsWith('poker:')) {
    return false;
  }

  const chatId = query.message?.chat?.id || query.from.id;
  const userId = query.from.id;
  const messageId = query.message?.message_id;
  const parts = data.split(':');
  const action = parts[1];

  await bot.answerCallbackQuery(query.id);

  if (action === 'exit') {
    leavePoker(bot, chatId, userId, userStates);
    return true;
  }

  if (action === 'menu') {
    userStates[chatId] = 'poker_menu';
    clearDraft(userId);
    showPokerMenu(bot, chatId, session, config);
    return true;
  }

  if (action === 'variant') {
    const variant = parts[2] === 'holdem' ? 'holdem' : 'draw';
    setDraft(userId, { variant });
    userStates[chatId] = 'poker_pick_bet';
    showBetMenu(bot, chatId, session, config, variant);
    return true;
  }

  if (action === 'custom') {
    const draft = getDraft(userId);
    if (!draft?.variant) {
      showPokerMenu(bot, chatId, session, config);
      return true;
    }
    userStates[chatId] = 'poker_custom_bet';
    await bot.sendMessage(chatId, config.messages.pokerAskCustomBet, {
      parse_mode: 'HTML',
      ...pokerKeyboard,
    });
    return true;
  }

  if (action === 'bet') {
    const bet = Number(parts[2]);
    const validation = pokerService.validateBet(bet, session, config);
    if (!validation.ok) {
      await bot.sendMessage(chatId, validation.message, {
        parse_mode: 'HTML',
        reply_markup: buildBetKeyboard(config),
      });
      return true;
    }

    const draft = getDraft(userId);
    const variant = draft?.variant || 'draw';
    setDraft(userId, { ...(draft || {}), variant, bet: validation.bet });

    if (variant === 'holdem') {
      await beginHoldemRound(bot, chatId, userId, session, validation.bet, config, userStates);
    } else {
      await beginDrawRound(bot, chatId, userId, session, validation.bet, config, userStates);
    }
    return true;
  }

  if (action === 'toggle') {
    const draft = getDraft(userId);
    if (!draft || draft.variant !== 'draw' || draft.stage !== 'discard') {
      return true;
    }
    const idx = Number(parts[2]);
    if (!Number.isInteger(idx) || idx < 0 || idx > 4) {
      return true;
    }
    draft.discardMask[idx] = !draft.discardMask[idx];
    setDraft(userId, draft);

    const text = [
      '🂡 <b>Дро-покер</b>',
      '',
      `Ставка: <b>${draft.bet} XP</b>`,
      `Твої карти: <b>${pokerService.formatCards(draft.playerCards)}</b>`,
      '',
      '❌ = скинути · ✅ = залишити',
    ].join('\n');

    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: buildDiscardKeyboard(draft),
      });
    } catch {
      // ignore identical markup edits
    }
    return true;
  }

  if (action === 'draw' || action === 'keep') {
    const draft = getDraft(userId);
    if (!draft || draft.variant !== 'draw' || draft.stage !== 'discard') {
      return true;
    }

    const discardIndexes =
      action === 'keep'
        ? []
        : draft.discardMask.map((flag, idx) => (flag ? idx : -1)).filter((idx) => idx >= 0);

    const updated = pokerService.applyDraw(draft, discardIndexes);
    updated.bet = draft.bet;
    setDraft(userId, updated);

    await settleHand(bot, chatId, userId, session, updated, config, saveSession, userStates, messageId);
    return true;
  }

  if (action === 'next') {
    const draft = getDraft(userId);
    if (!draft || draft.variant !== 'holdem') {
      return true;
    }

    if (draft.stage === 'river') {
      await settleHand(
        bot,
        chatId,
        userId,
        session,
        { ...draft, stage: 'showdown' },
        config,
        saveSession,
        userStates,
        messageId
      );
      return true;
    }

    const updated = pokerService.advanceHoldem(draft);
    updated.bet = draft.bet;
    setDraft(userId, updated);

    try {
      await bot.editMessageText(holdemBoardText(updated), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: buildHoldemContinueKeyboard(updated.stage),
      });
    } catch {
      await bot.sendMessage(chatId, holdemBoardText(updated), {
        parse_mode: 'HTML',
        reply_markup: buildHoldemContinueKeyboard(updated.stage),
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  pokerKeyboard,
  isPokerMenuText,
  isLeavePokerText,
  startPoker,
  leavePoker,
  clearPokerState,
  handlePokerMessage,
  handlePokerCallback,
  showPokerMenu,
};
