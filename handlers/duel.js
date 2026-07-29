const { askAI } = require('../services/aiService');
const duelStore = require('../services/duelStore');
const {
  calculateAnswerPoints,
  determineWinner,
  applyRatingDelta,
} = require('../services/duelScoring');
const userService = require('../services/userService');
const leaderboardService = require('../services/leaderboardService');
const rankService = require('../services/rankService');
const { getActionKeyboard, backKeyboard } = require('../keyboards');

const OPTION_LABELS = ['А', 'Б', 'В', 'Г'];
const AI_USER_ID = 'ai';

const matchmakingTimers = new Map();
const questionTimers = new Map();
const aiAnswerTimers = new Map();

const FALLBACK_QUESTIONS = [
  {
    question: 'Скільки буде 7 × 8?',
    options: ['54', '56', '64', '48'],
    correctIndex: 1,
  },
  {
    question: 'Яка столиця України?',
    options: ['Львів', 'Одеса', 'Київ', 'Харків'],
    correctIndex: 2,
  },
  {
    question: 'Яка планета найближча до Сонця?',
    options: ['Венера', 'Меркурій', 'Марс', 'Земля'],
    correctIndex: 1,
  },
  {
    question: 'Скільки континентів на Землі?',
    options: ['5', '6', '7', '8'],
    correctIndex: 2,
  },
  {
    question: 'Хто написав «Кобзар»?',
    options: ['Іван Франко', 'Леся Українка', 'Тарас Шевченко', 'Микола Гоголь'],
    correctIndex: 2,
  },
  {
    question: 'Яка хімічна формула води?',
    options: ['CO₂', 'H₂O', 'O₂', 'NaCl'],
    correctIndex: 1,
  },
  {
    question: 'Скільки градусів у прямому куті?',
    options: ['45°', '60°', '90°', '180°'],
    correctIndex: 2,
  },
  {
    question: 'Яка мова є державною в Україні?',
    options: ['Російська', 'Англійська', 'Польська', 'Українська'],
    correctIndex: 3,
  },
  {
    question: '2² дорівнює…',
    options: ['2', '4', '8', '16'],
    correctIndex: 1,
  },
  {
    question: 'Який орган відповідає за перекачування крові?',
    options: ['Легені', 'Печінка', 'Серце', 'Нирки'],
    correctIndex: 2,
  },
];

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clearTimer(map, key) {
  const timer = map.get(key);
  if (timer) {
    clearTimeout(timer);
    map.delete(key);
  }
}

function clearMatchmakingTimer(userId) {
  clearTimer(matchmakingTimers, String(userId));
}

function clearQuestionTimer(duelId) {
  clearTimer(questionTimers, String(duelId));
}

function clearAiTimer(duelId) {
  clearTimer(aiAnswerTimers, String(duelId));
}

function extractJson(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON in AI response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeQuestions(raw, expectedCount) {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid questions');
  }

  const questions = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const question = String(item.question || '').trim();
      const options = Array.isArray(item.options)
        ? item.options.map((o) => String(o || '').trim()).filter(Boolean)
        : [];
      let correctIndex = Number(item.correctIndex);
      if (
        !question ||
        options.length < 4 ||
        !Number.isInteger(correctIndex) ||
        correctIndex < 0 ||
        correctIndex > 3
      ) {
        return null;
      }
      return {
        question,
        options: options.slice(0, 4),
        correctIndex,
      };
    })
    .filter(Boolean)
    .slice(0, expectedCount);

  if (questions.length < expectedCount) {
    throw new Error('Not enough valid questions');
  }

  return questions;
}

function pickFallbackQuestions(count) {
  const shuffled = FALLBACK_QUESTIONS.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((q) => ({
    question: q.question,
    options: q.options.slice(),
    correctIndex: q.correctIndex,
  }));
}

async function generateDuelQuestions({ subject, grade, count }) {
  const prompt = [
    'Згенеруй короткі шкільні тестові запитання українською для дуелі знань.',
    subject ? `Предмет: ${subject}.` : 'Предмети загальної шкільної програми.',
    grade ? `Клас: ${grade}.` : '',
    `Кількість: рівно ${count}.`,
    'Кожне запитання: 4 варіанти, один правильний (correctIndex 0-3).',
    'Відповідь ЛИШЕ JSON:',
    '{"questions":[{"question":"...","options":["A","B","C","D"],"correctIndex":0}]}',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const text = await askAI(prompt);
    return normalizeQuestions(extractJson(text).questions, count);
  } catch (error) {
    console.error('Duel AI questions failed, using fallback:', error.message || error);
    return pickFallbackQuestions(count);
  }
}

function buildSearchKeyboard() {
  return {
    inline_keyboard: [[{ text: '❌ Скасувати пошук', callback_data: 'duel_cancel_search' }]],
  };
}

function buildDuelMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔍 Шукати суперника', callback_data: 'duel_mode_search' }],
      [{ text: '👥 Запросити друга (ID)', callback_data: 'duel_mode_invite' }],
      [{ text: '🔑 Приєднатися за кодом', callback_data: 'duel_mode_join' }],
      [{ text: '🤖 Зіграти з ШІ', callback_data: 'duel_vs_ai' }],
    ],
  };
}

function buildInviteCancelKeyboard(inviteId) {
  return {
    inline_keyboard: [[{ text: '❌ Скасувати запрошення', callback_data: `duel_invite_cancel:${inviteId}` }]],
  };
}

function buildInviteAcceptKeyboard(inviteId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Прийняти', callback_data: `duel_invite_accept:${inviteId}` },
        { text: '❌ Відхилити', callback_data: `duel_invite_decline:${inviteId}` },
      ],
    ],
  };
}

function buildAiOfferKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🤖 Зіграти з ШІ', callback_data: 'duel_vs_ai' },
        { text: '❌ Скасувати', callback_data: 'duel_cancel_search' },
      ],
    ],
  };
}

function buildAnswerKeyboard(duelId, questionIndex) {
  return {
    inline_keyboard: [
      OPTION_LABELS.map((label, i) => ({
        text: label,
        callback_data: `duel_ans:${duelId}:${questionIndex}:${i}`,
      })),
    ],
  };
}

function formatQuestionMessage(duel, questionIndex, config) {
  const q = duel.questions[questionIndex];
  const total = config.duel.questionCount;
  const timeoutSec = Math.round(config.duel.answerTimeoutMs / 1000);
  const options = q.options
    .map((opt, i) => `<b>${OPTION_LABELS[i]}.</b> ${escapeHtml(opt)}`)
    .join('\n');

  return [
    `⚔️ <b>Дуель знань</b> — питання ${questionIndex + 1}/${total}`,
    `⏱️ Час: <b>${timeoutSec} с</b>`,
    '',
    escapeHtml(q.question),
    '',
    options,
  ].join('\n');
}

function getOpponentName(duel, userId) {
  if (String(duel.player1Id) === String(userId)) {
    return duel.player2Name;
  }
  return duel.player1Name;
}

function ensureDuelStats(session) {
  if (!session.stats || typeof session.stats !== 'object') {
    session.stats = userService.getDefaultStats();
  }
  session.stats.duelsPlayed = session.stats.duelsPlayed || 0;
  session.stats.duelsWon = session.stats.duelsWon || 0;
  session.duelRating = Number.isFinite(session.duelRating) ? session.duelRating : 1000;
  return session;
}

function applyDuelResultToUser(userId, outcome, config) {
  if (String(userId) === AI_USER_ID) {
    return;
  }

  const session = userService.getSession(userId);
  if (!session) {
    return;
  }

  ensureDuelStats(session);
  session.stats.duelsPlayed += 1;
  if (outcome === 'win') {
    session.stats.duelsWon += 1;
  }
  session.duelRating = applyRatingDelta(session.duelRating, outcome, config.duel.rating);
  const xpGain = outcome === 'win' ? config.duel.xpWin : outcome === 'draw' ? config.duel.xpDraw : config.duel.xpLoss;
  const xpResult = rankService.applyXpChange(session, xpGain, config);
  if (xpGain > 0) {
    leaderboardService.recordXpChange(session, xpGain);
  }
  userService.saveSession(userId, session, { levelBefore: xpResult.oldLevel });
}

async function showDuelMenu(bot, chatId, userId, session, config) {
  if (!session || session.step !== 'completed') {
    await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
    return;
  }

  const active = duelStore.findActiveDuelForUser(userId);
  if (active) {
    await bot.sendMessage(
      chatId,
      '⚔️ У тебе вже є активна дуель. Дочекайся її завершення.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const message = (config.messages.duelMenu || '')
    .replace('{userId}', String(userId));

  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: buildDuelMenuKeyboard(),
  });
}

async function startMatchmaking(bot, chatId, userId, session, userStates, config) {
  if (!session || session.step !== 'completed') {
    await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
    return;
  }

  const active = duelStore.findActiveDuelForUser(userId);
  if (active) {
    await bot.sendMessage(
      chatId,
      '⚔️ У тебе вже є активна дуель. Дочекайся її завершення.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  clearMatchmakingTimer(userId);

  const opponent = duelStore.findOpponentInPool(userId);
  if (opponent) {
    duelStore.removeFromPool(opponent.userId);
    duelStore.removeFromPool(userId);
    clearMatchmakingTimer(opponent.userId);

    const duel = duelStore.createDuel({
      player1Id: opponent.userId,
      player2Id: userId,
      player1ChatId: opponent.chatId,
      player2ChatId: chatId,
      player1Name: opponent.name,
      player2Name: session.name || 'Гравець',
      class: session.class || opponent.class,
      subject: session.selectedSubject || opponent.subject,
      vsAi: false,
    });

    await notifyMatchFound(bot, duel, config);
    await prepareAndStartDuel(bot, duel.id, config);
    return;
  }

  duelStore.upsertPoolEntry({
    userId,
    chatId,
    name: session.name || 'Гравець',
    class: session.class,
    subject: session.selectedSubject,
  });
  userStates[chatId] = 'duel_searching';

  await bot.sendMessage(chatId, config.messages.duelSearching, {
    parse_mode: 'HTML',
    reply_markup: buildSearchKeyboard(),
  });

  const waitMs = config.duel.matchmakingTimeoutMs;
  const timer = setTimeout(async () => {
    matchmakingTimers.delete(String(userId));
    const stillWaiting = duelStore.getPoolEntry(userId);
    if (!stillWaiting) {
      return;
    }

    try {
      await bot.sendMessage(chatId, config.messages.duelNoOpponent, {
        parse_mode: 'HTML',
        reply_markup: buildAiOfferKeyboard(),
      });
    } catch (error) {
      console.error('Duel matchmaking timeout notify failed:', error.message || error);
    }
  }, waitMs);

  matchmakingTimers.set(String(userId), timer);
}

async function askFriendId(bot, chatId, userStates, config) {
  userStates[chatId] = 'duel_await_friend_id';
  await bot.sendMessage(chatId, config.messages.duelAskFriendId, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

async function askJoinCode(bot, chatId, userStates, config) {
  userStates[chatId] = 'duel_await_join_code';
  await bot.sendMessage(chatId, config.messages.duelAskJoinCode, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

async function createFriendInvite(bot, chatId, userId, session, userStates, config, friendIdRaw) {
  const friendId = String(friendIdRaw || '').trim();

  if (!/^\d{5,15}$/.test(friendId)) {
    await bot.sendMessage(chatId, config.messages.duelFriendIdInvalid, { parse_mode: 'HTML' });
    return;
  }

  if (friendId === String(userId)) {
    await bot.sendMessage(chatId, config.messages.duelFriendIdSelf, { parse_mode: 'HTML' });
    return;
  }

  if (duelStore.findActiveDuelForUser(userId)) {
    await bot.sendMessage(chatId, '⚔️ У тебе вже є активна дуель.', { parse_mode: 'HTML' });
    return;
  }

  if (duelStore.findActiveDuelForUser(friendId)) {
    await bot.sendMessage(chatId, config.messages.duelFriendBusy, { parse_mode: 'HTML' });
    return;
  }

  clearMatchmakingTimer(userId);
  duelStore.removeFromPool(userId);

  const invite = duelStore.createInvite({
    fromUserId: userId,
    fromChatId: chatId,
    fromName: session.name || 'Гравець',
    fromClass: session.class,
    fromSubject: session.selectedSubject,
    toUserId: friendId,
    ttlMs: config.duel.inviteTtlMs || 15 * 60 * 1000,
  });

  delete userStates[chatId];
  userStates[chatId] = 'duel_invite_pending';

  await bot.sendMessage(
    chatId,
    config.messages.duelInviteCreated
      .replace('{code}', invite.code)
      .replace('{friendId}', friendId),
    {
      parse_mode: 'HTML',
      reply_markup: buildInviteCancelKeyboard(invite.id),
    }
  );

  const friendSession = userService.getSession(friendId);
  if (friendSession && friendSession.step === 'completed') {
    try {
      await bot.sendMessage(
        Number(friendId),
        config.messages.duelInviteReceived
          .replace('{name}', escapeHtml(session.name || 'Гравець'))
          .replace('{userId}', String(userId))
          .replace('{code}', invite.code),
        {
          parse_mode: 'HTML',
          reply_markup: buildInviteAcceptKeyboard(invite.id),
        }
      );
    } catch (error) {
      console.error('Failed to notify friend about duel invite:', error.message || error);
      await bot.sendMessage(chatId, config.messages.duelInviteNotifyFailed, {
        parse_mode: 'HTML',
      });
    }
  } else {
    await bot.sendMessage(chatId, config.messages.duelFriendNotRegistered, {
      parse_mode: 'HTML',
    });
  }
}

async function joinInviteByCode(bot, chatId, userId, session, userStates, config, codeRaw) {
  const invite = duelStore.getInviteByCode(codeRaw);
  if (!invite) {
    await bot.sendMessage(chatId, config.messages.duelInviteNotFound, { parse_mode: 'HTML' });
    return;
  }

  await acceptInvite(bot, chatId, userId, session, userStates, config, invite.id);
}

async function acceptInvite(bot, chatId, userId, session, userStates, config, inviteId) {
  const invite = duelStore.getInviteById(inviteId);
  if (!invite || invite.status !== 'pending') {
    await bot.sendMessage(chatId, config.messages.duelInviteNotFound, { parse_mode: 'HTML' });
    return;
  }

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    duelStore.updateInvite(inviteId, { status: 'expired' });
    await bot.sendMessage(chatId, config.messages.duelInviteExpired, { parse_mode: 'HTML' });
    return;
  }

  if (String(invite.fromUserId) === String(userId)) {
    await bot.sendMessage(chatId, config.messages.duelFriendIdSelf, { parse_mode: 'HTML' });
    return;
  }

  if (invite.toUserId && String(invite.toUserId) !== String(userId)) {
    await bot.sendMessage(chatId, config.messages.duelInviteWrongUser, { parse_mode: 'HTML' });
    return;
  }

  if (duelStore.findActiveDuelForUser(userId) || duelStore.findActiveDuelForUser(invite.fromUserId)) {
    await bot.sendMessage(chatId, '⚔️ Хтось із вас уже в активній дуелі.', { parse_mode: 'HTML' });
    return;
  }

  duelStore.updateInvite(inviteId, { status: 'accepted', acceptedBy: String(userId) });
  clearMatchmakingTimer(userId);
  clearMatchmakingTimer(invite.fromUserId);
  duelStore.removeFromPool(userId);
  duelStore.removeFromPool(invite.fromUserId);

  if (userStates[chatId]) {
    delete userStates[chatId];
  }
  if (userStates[invite.fromChatId] === 'duel_invite_pending') {
    delete userStates[invite.fromChatId];
  }

  const duel = duelStore.createDuel({
    player1Id: invite.fromUserId,
    player2Id: userId,
    player1ChatId: invite.fromChatId,
    player2ChatId: chatId,
    player1Name: invite.fromName,
    player2Name: session.name || 'Гравець',
    class: session.class || invite.fromClass,
    subject: session.selectedSubject || invite.fromSubject,
    vsAi: false,
  });

  await notifyMatchFound(bot, duel, config);
  await prepareAndStartDuel(bot, duel.id, config);
}

async function declineInvite(bot, chatId, userId, config, inviteId) {
  const invite = duelStore.getInviteById(inviteId);
  if (!invite || invite.status !== 'pending') {
    await bot.sendMessage(chatId, config.messages.duelInviteNotFound, { parse_mode: 'HTML' });
    return;
  }

  duelStore.updateInvite(inviteId, { status: 'declined' });
  await bot.sendMessage(chatId, config.messages.duelInviteDeclinedSelf, { parse_mode: 'HTML' });

  try {
    await bot.sendMessage(
      invite.fromChatId,
      config.messages.duelInviteDeclinedHost.replace(
        '{name}',
        escapeHtml((userService.getSession(userId) || {}).name || 'Суперник')
      ),
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Failed to notify host about declined invite:', error.message || error);
  }
}

async function cancelInvite(bot, chatId, userId, userStates, config, inviteId) {
  const invite = duelStore.getInviteById(inviteId);
  if (!invite || String(invite.fromUserId) !== String(userId)) {
    await bot.sendMessage(chatId, config.messages.duelInviteNotFound, { parse_mode: 'HTML' });
    return;
  }

  if (invite.status === 'pending') {
    duelStore.updateInvite(inviteId, { status: 'cancelled' });
  }

  if (userStates[chatId] === 'duel_invite_pending') {
    delete userStates[chatId];
  }

  await bot.sendMessage(chatId, config.messages.duelInviteCancelled, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

function handleDuelMessage(bot, chatId, userId, text, session, userStates, config) {
  const state = userStates[chatId];
  if (!state || !String(state).startsWith('duel_')) {
    return false;
  }

  if (text === '⬅️ Повернутися в меню' || text === '📋 Головне меню') {
    return false;
  }

  if (state === 'duel_await_friend_id') {
    createFriendInvite(bot, chatId, userId, session, userStates, config, text).catch((err) =>
      console.error('createFriendInvite error:', err)
    );
    return true;
  }

  if (state === 'duel_await_join_code') {
    joinInviteByCode(bot, chatId, userId, session, userStates, config, text).catch((err) =>
      console.error('joinInviteByCode error:', err)
    );
    return true;
  }

  if (state === 'duel_searching' || state === 'duel_invite_pending') {
    bot.sendMessage(
      chatId,
      state === 'duel_searching'
        ? config.messages.duelSearchingHint
        : config.messages.duelInvitePendingHint,
      { parse_mode: 'HTML' }
    );
    return true;
  }

  return false;
}

async function cancelSearch(bot, chatId, userId, userStates, config) {
  clearMatchmakingTimer(userId);
  const removed = duelStore.removeFromPool(userId);
  if (userStates[chatId] === 'duel_searching') {
    delete userStates[chatId];
  }

  await bot.sendMessage(
    chatId,
    removed ? config.messages.duelSearchCancelled : config.messages.duelNotSearching,
    { parse_mode: 'HTML', ...backKeyboard }
  );
}

async function notifyMatchFound(bot, duel, config) {
  const text1 = config.messages.duelMatched.replace('{opponent}', escapeHtml(duel.player2Name));
  const text2 = config.messages.duelMatched.replace('{opponent}', escapeHtml(duel.player1Name));

  await bot.sendMessage(duel.player1ChatId, text1, { parse_mode: 'HTML' });
  if (!duel.vsAi) {
    await bot.sendMessage(duel.player2ChatId, text2, { parse_mode: 'HTML' });
  }
}

async function startVsAi(bot, chatId, userId, session, userStates, config) {
  if (!duelStore.getPoolEntry(userId) && userStates[chatId] !== 'duel_searching') {
    // Allow starting AI duel even if just offered after timeout
  }

  clearMatchmakingTimer(userId);
  duelStore.removeFromPool(userId);
  if (userStates[chatId] === 'duel_searching') {
    delete userStates[chatId];
  }

  const active = duelStore.findActiveDuelForUser(userId);
  if (active) {
    await bot.sendMessage(chatId, '⚔️ У тебе вже є активна дуель.', { parse_mode: 'HTML' });
    return;
  }

  const duel = duelStore.createDuel({
    player1Id: userId,
    player2Id: AI_USER_ID,
    player1ChatId: chatId,
    player2ChatId: chatId,
    player1Name: session.name || 'Гравець',
    player2Name: 'ШІ-суперник',
    class: session.class,
    subject: session.selectedSubject,
    vsAi: true,
  });

  await bot.sendMessage(
    chatId,
    config.messages.duelMatched.replace('{opponent}', 'ШІ-суперник 🤖'),
    { parse_mode: 'HTML' }
  );

  await prepareAndStartDuel(bot, duel.id, config);
}

async function prepareAndStartDuel(bot, duelId, config) {
  const duel = duelStore.getDuelById(duelId);
  if (!duel) {
    return;
  }

  const count = config.duel.questionCount;
  await bot.sendMessage(duel.player1ChatId, config.messages.duelGenerating, {
    parse_mode: 'HTML',
  });
  if (!duel.vsAi && duel.player2ChatId !== duel.player1ChatId) {
    await bot.sendMessage(duel.player2ChatId, config.messages.duelGenerating, {
      parse_mode: 'HTML',
    });
  }

  const questions = await generateDuelQuestions({
    subject: duel.subject,
    grade: duel.class,
    count,
  });

  duelStore.updateDuel(duelId, {
    questions,
    status: 'active',
    currentQuestion: 0,
    questionStartedAt: new Date().toISOString(),
  });

  await sendCurrentQuestion(bot, duelId, config);
}

async function sendCurrentQuestion(bot, duelId, config) {
  const duel = duelStore.getDuelById(duelId);
  if (!duel || duel.status !== 'active') {
    return;
  }

  const index = duel.currentQuestion;
  const message = formatQuestionMessage(duel, index, config);
  const keyboard = buildAnswerKeyboard(duelId, index);

  const msg1 = await bot.sendMessage(duel.player1ChatId, message, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });

  let msg2 = null;
  if (!duel.vsAi) {
    msg2 = await bot.sendMessage(duel.player2ChatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  const answers = { ...(duel.answers || {}) };
  answers[String(index)] = {
    ...(answers[String(index)] || {}),
    messageIds: {
      [String(duel.player1Id)]: msg1.message_id,
      ...(duel.vsAi
        ? {}
        : { [String(duel.player2Id)]: msg2.message_id }),
    },
  };

  duelStore.updateDuel(duelId, {
    answers,
    questionStartedAt: new Date().toISOString(),
  });

  clearQuestionTimer(duelId);
  const timer = setTimeout(() => {
    handleQuestionTimeout(bot, duelId, index, config).catch((err) =>
      console.error('Duel timeout error:', err)
    );
  }, config.duel.answerTimeoutMs);
  questionTimers.set(String(duelId), timer);

  if (duel.vsAi) {
    scheduleAiAnswer(bot, duelId, index, config);
  }
}

function scheduleAiAnswer(bot, duelId, questionIndex, config) {
  clearAiTimer(duelId);
  const delay = 2500 + Math.floor(Math.random() * 8000);
  const timer = setTimeout(async () => {
    aiAnswerTimers.delete(String(duelId));
    const duel = duelStore.getDuelById(duelId);
    if (!duel || duel.status !== 'active' || duel.currentQuestion !== questionIndex) {
      return;
    }

    const q = duel.questions[questionIndex];
    const correctChance = config.duel.aiCorrectChance ?? 0.7;
    const optionIndex =
      Math.random() < correctChance
        ? q.correctIndex
        : [0, 1, 2, 3].filter((i) => i !== q.correctIndex)[Math.floor(Math.random() * 3)];

    await registerAnswer(bot, {
      duelId,
      userId: AI_USER_ID,
      questionIndex,
      optionIndex,
      config,
      fromCallback: false,
    });
  }, delay);
  aiAnswerTimers.set(String(duelId), timer);
}

function bothPlayersAnswered(duel, questionIndex) {
  const bucket = duel.answers?.[String(questionIndex)] || {};
  const p1 = bucket[String(duel.player1Id)];
  const p2 = bucket[String(duel.player2Id)];
  return Boolean(p1 && p2);
}

async function registerAnswer(bot, { duelId, userId, questionIndex, optionIndex, config, query }) {
  let duel = duelStore.getDuelById(duelId);
  if (!duel || duel.status !== 'active') {
    if (query) {
      await bot.answerCallbackQuery(query.id, { text: 'Дуель уже завершена' });
    }
    return;
  }

  if (duel.currentQuestion !== questionIndex) {
    if (query) {
      await bot.answerCallbackQuery(query.id, { text: 'Це питання вже минуло' });
    }
    return;
  }

  const uid = String(userId);
  const key = String(questionIndex);
  const answers = { ...(duel.answers || {}) };
  const bucket = { ...(answers[key] || {}) };

  if (bucket[uid]) {
    if (query) {
      await bot.answerCallbackQuery(query.id, { text: 'Ти вже відповів(ла)' });
    }
    return;
  }

  const startedAt = new Date(duel.questionStartedAt || Date.now()).getTime();
  const elapsedMs = Date.now() - startedAt;
  const q = duel.questions[questionIndex];
  const isCorrect = Number(optionIndex) === q.correctIndex;
  const points = calculateAnswerPoints({
    isCorrect,
    elapsedMs,
    timeoutMs: config.duel.answerTimeoutMs,
    basePoints: config.duel.basePoints,
    maxSpeedBonus: config.duel.maxSpeedBonus,
  });

  bucket[uid] = {
    optionIndex: Number(optionIndex),
    answeredAt: new Date().toISOString(),
    elapsedMs,
    isCorrect,
    points,
  };
  answers[key] = bucket;

  const scores = { ...duel.scores };
  scores[uid] = (scores[uid] || 0) + points;

  duel = duelStore.updateDuel(duelId, { answers, scores });

  if (query) {
    await bot.answerCallbackQuery(query.id, {
      text: isCorrect ? `✅ +${points}` : '❌ Неправильно',
    });
  }

  if (uid !== AI_USER_ID) {
    const feedback = isCorrect
      ? config.messages.duelAnswerCorrect.replace('{points}', String(points))
      : config.messages.duelAnswerWrong;
    try {
      const chatId = uid === String(duel.player1Id) ? duel.player1ChatId : duel.player2ChatId;
      await bot.sendMessage(chatId, feedback, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Duel feedback error:', error.message || error);
    }
  }

  if (bothPlayersAnswered(duel, questionIndex)) {
    clearQuestionTimer(duelId);
    clearAiTimer(duelId);
    await advanceOrFinish(bot, duelId, config);
  }
}

async function handleQuestionTimeout(bot, duelId, questionIndex, config) {
  const duel = duelStore.getDuelById(duelId);
  if (!duel || duel.status !== 'active' || duel.currentQuestion !== questionIndex) {
    return;
  }

  clearAiTimer(duelId);

  const key = String(questionIndex);
  const answers = { ...(duel.answers || {}) };
  const bucket = { ...(answers[key] || {}) };
  const players = [duel.player1Id, duel.player2Id];

  for (const pid of players) {
    const id = String(pid);
    if (!bucket[id]) {
      bucket[id] = {
        optionIndex: null,
        answeredAt: new Date().toISOString(),
        elapsedMs: config.duel.answerTimeoutMs,
        isCorrect: false,
        points: 0,
        timeout: true,
      };

      if (id !== AI_USER_ID) {
        const chatId = id === String(duel.player1Id) ? duel.player1ChatId : duel.player2ChatId;
        bot.sendMessage(chatId, config.messages.duelTimeout, { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  }

  answers[key] = bucket;
  duelStore.updateDuel(duelId, { answers });
  await advanceOrFinish(bot, duelId, config);
}

async function advanceOrFinish(bot, duelId, config) {
  const duel = duelStore.getDuelById(duelId);
  if (!duel || duel.status !== 'active') {
    return;
  }

  const next = duel.currentQuestion + 1;
  if (next >= config.duel.questionCount || next >= duel.questions.length) {
    await finishDuel(bot, duelId, config);
    return;
  }

  duelStore.updateDuel(duelId, {
    currentQuestion: next,
    questionStartedAt: new Date().toISOString(),
  });

  await bot.sendMessage(duel.player1ChatId, `⚔️ Наступне питання…`, { parse_mode: 'HTML' });
  if (!duel.vsAi) {
    await bot.sendMessage(duel.player2ChatId, `⚔️ Наступне питання…`, { parse_mode: 'HTML' });
  }

  await sendCurrentQuestion(bot, duelId, config);
}

async function finishDuel(bot, duelId, config) {
  clearQuestionTimer(duelId);
  clearAiTimer(duelId);

  const duel = duelStore.getDuelById(duelId);
  if (!duel || duel.status === 'finished') {
    return;
  }

  const score1 = duel.scores[String(duel.player1Id)] || 0;
  const score2 = duel.scores[String(duel.player2Id)] || 0;
  const { winnerId, result } = determineWinner(
    score1,
    score2,
    duel.player1Id,
    duel.player2Id
  );

  duelStore.updateDuel(duelId, {
    status: 'finished',
    finishedAt: new Date().toISOString(),
    winnerId,
    result,
  });

  if (result === 'draw') {
    applyDuelResultToUser(duel.player1Id, 'draw', config);
    applyDuelResultToUser(duel.player2Id, 'draw', config);
  } else if (result === 'win_a') {
    applyDuelResultToUser(duel.player1Id, 'win', config);
    applyDuelResultToUser(duel.player2Id, 'loss', config);
  } else {
    applyDuelResultToUser(duel.player1Id, 'loss', config);
    applyDuelResultToUser(duel.player2Id, 'win', config);
  }

  await sendResultToPlayer(bot, duel, duel.player1Id, duel.player1ChatId, score1, score2, config);
  if (!duel.vsAi) {
    await sendResultToPlayer(bot, duel, duel.player2Id, duel.player2ChatId, score2, score1, config);
  }
}

async function sendResultToPlayer(bot, duel, userId, chatId, myScore, foeScore, config) {
  const session = userService.getSession(userId);
  const rating = session ? ensureDuelStats(session).duelRating : 1000;
  let headline;

  if (myScore === foeScore) {
    headline = config.messages.duelDraw;
  } else if (myScore > foeScore) {
    headline = config.messages.duelWin;
  } else {
    headline = config.messages.duelLose;
  }

  const message = [
    headline,
    '',
    `🏆 Рахунок: <b>${myScore}:${foeScore}</b>`,
    `👤 Суперник: <b>${escapeHtml(getOpponentName(duel, userId))}</b>`,
    `📊 Твій рейтинг дуелей: <b>${rating}</b>`,
  ].join('\n');

  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...(session ? getActionKeyboard(session) : backKeyboard),
  });
}

async function handleDuelCallback(bot, query, session, userStates, config) {
  const data = query.data || '';
  if (!data.startsWith('duel_')) {
    return false;
  }

  const chatId = query.message.chat.id;
  const userId = query.from.id;

  if (data === 'duel_mode_search') {
    await bot.answerCallbackQuery(query.id);
    if (!session || session.step !== 'completed') {
      await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return true;
    }
    await startMatchmaking(bot, chatId, userId, session, userStates, config);
    return true;
  }

  if (data === 'duel_mode_invite') {
    await bot.answerCallbackQuery(query.id);
    if (!session || session.step !== 'completed') {
      await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return true;
    }
    await askFriendId(bot, chatId, userStates, config);
    return true;
  }

  if (data === 'duel_mode_join') {
    await bot.answerCallbackQuery(query.id);
    if (!session || session.step !== 'completed') {
      await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return true;
    }
    await askJoinCode(bot, chatId, userStates, config);
    return true;
  }

  if (data === 'duel_cancel_search') {
    await bot.answerCallbackQuery(query.id);
    await cancelSearch(bot, chatId, userId, userStates, config);
    return true;
  }

  if (data === 'duel_vs_ai') {
    await bot.answerCallbackQuery(query.id, { text: 'Старт проти ШІ' });
    if (!session || session.step !== 'completed') {
      await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return true;
    }
    await startVsAi(bot, chatId, userId, session, userStates, config);
    return true;
  }

  if (data.startsWith('duel_invite_accept:')) {
    await bot.answerCallbackQuery(query.id, { text: 'Прийнято' });
    if (!session || session.step !== 'completed') {
      await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return true;
    }
    const inviteId = data.split(':')[1];
    await acceptInvite(bot, chatId, userId, session, userStates, config, inviteId);
    return true;
  }

  if (data.startsWith('duel_invite_decline:')) {
    await bot.answerCallbackQuery(query.id);
    const inviteId = data.split(':')[1];
    await declineInvite(bot, chatId, userId, config, inviteId);
    return true;
  }

  if (data.startsWith('duel_invite_cancel:')) {
    await bot.answerCallbackQuery(query.id);
    const inviteId = data.split(':')[1];
    await cancelInvite(bot, chatId, userId, userStates, config, inviteId);
    return true;
  }

  if (data.startsWith('duel_ans:')) {
    const parts = data.split(':');
    const duelId = parts[1];
    const questionIndex = parseInt(parts[2], 10);
    const optionIndex = parseInt(parts[3], 10);

    await registerAnswer(bot, {
      duelId,
      userId,
      questionIndex,
      optionIndex,
      config,
      query,
    });
    return true;
  }

  return false;
}

function clearUserDuelSearch(userId, chatId, userStates) {
  clearMatchmakingTimer(userId);
  duelStore.removeFromPool(userId);
  duelStore.cancelInvitesForUser(userId);
  if (
    chatId &&
    (userStates[chatId] === 'duel_searching' ||
      userStates[chatId] === 'duel_await_friend_id' ||
      userStates[chatId] === 'duel_await_join_code' ||
      userStates[chatId] === 'duel_invite_pending')
  ) {
    delete userStates[chatId];
  }
}

module.exports = {
  showDuelMenu,
  startMatchmaking,
  cancelSearch,
  handleDuelCallback,
  handleDuelMessage,
  clearUserDuelSearch,
  startVsAi,
  AI_USER_ID,
  calculateAnswerPoints,
  determineWinner,
};
