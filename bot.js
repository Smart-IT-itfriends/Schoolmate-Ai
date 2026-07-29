require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { getSubjectsForClass, getAllSubjects } = require('./subjects');
const userService = require('./services/userService');
const punishmentService = require('./services/punishmentService');
const adminService = require('./services/adminService');
const keyboards = require('./keyboards');
const registration = require('./handlers/registration');
const explainHandler = require('./handlers/explain');
const examHandler = require('./handlers/exams');
const createTestHandler = require('./handlers/createTest');
const mediaHandler = require('./handlers/media');
const duelHandler = require('./handlers/duel');
const questHandler = require('./handlers/quests');
const supportHandler = require('./handlers/support');
const examScheduler = require('./services/examScheduler');
const premiumService = require('./services/premiumService');
const leaderboardService = require('./services/leaderboardService');
const { matchesMenuText } = require('./services/menuText');
const token = process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN;

if (!token) {
  console.error('Помилка: встановіть TELEGRAM_TOKEN у файлі .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });
const userStates = {};
bot.userStates = userStates;
const allSubjects = getAllSubjects();

const { mainKeyboard, backKeyboard } = keyboards;

const progressKeyboard = {
  reply_markup: {
    keyboard: [['🧊 Купити заморозку'], ['⬅️ Повернутися в меню']],
    resize_keyboard: true,
  },
};

function applyInactivityCheck(chatId, userId, session) {
  const result = punishmentService.checkInactivityPunishment(session, config);

  if (result.changed) {
    saveSession(userId, result.session);
  }

  for (const message of result.messages) {
    bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  }

  return result.session;
}

function touchUserActivity(userId, session) {
  punishmentService.touchActivity(session);
  saveSession(userId, session);
}

function getSession(userId) {
  return userService.getSession(userId);
}

function saveSession(userId, session) {
  return userService.saveSession(userId, session);
}

function buildSubjectsKeyboard(classNum) {
  return keyboards.buildSubjectsKeyboard(classNum);
}

function buildSubjectActionKeyboard() {
  return keyboards.buildSubjectActionKeyboard();
}

function getActionKeyboard(session) {
  return keyboards.getActionKeyboard(session);
}

function showSubjectsMenu(chatId, session) {
  const subjects = getSubjectsForClass(session.class);

  bot.sendMessage(
    chatId,
    `📚 Предмети для ${session.class}-го класу:\n\n${subjects.map((s) => `• ${s}`).join('\n')}\n\nОбери предмет:`,
    buildSubjectsKeyboard(session.class)
  );
}

function showMainMenu(chatId, session) {
  userStates[chatId] = 'main_menu';

  bot.sendMessage(
    chatId,
    `Привіт, ${session.name}! 👋\n\n${config.messages.start}`,
    mainKeyboard
  );
}

function getSubjectHint(session) {
  return session.selectedSubject
    ? `\n\nПредмет: <b>${session.selectedSubject}</b>`
    : '';
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(isoString) {
  if (!isoString) {
    return 'Не вказано';
  }
  return new Date(isoString).toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getDailyReward(streak) {
  const rewardByDay = {
    1: { type: 'XP', amount: 15, text: '+15 XP' },
    2: { type: 'XP', amount: 20, text: '+20 XP' },
    3: { type: 'XP', amount: 25, text: '+25 XP' },
    4: { type: 'XP', amount: 30, text: '+30 XP' },
    5: { type: 'XP', amount: 35, text: '+35 XP' },
    6: { type: 'XP', amount: 40, text: '+40 XP' },
    7: { type: 'XP', amount: 100, text: '+100 XP' },
  };

  return rewardByDay[streak] || rewardByDay[1];
}

function buildProfileMessage(session) {
  const registeredAt = session.completedAt || session.startedAt || new Date().toISOString();
  const premiumLabel = premiumService.isPremium(session, session.telegramId) ? '⭐ Так' : 'Ні';

  return [
    '<b>👤 Мій профіль</b>',
    '',
    `Ім'я: <b>${session.name || 'Невідомо'}</b>`,
    `Клас: <b>${session.class || 'Невідомо'}</b>`,
    `Предмет: <b>${session.selectedSubject || 'Не обрано'}</b>`,
    `Premium: <b>${premiumLabel}</b>`,
    `Дата реєстрації: <b>${formatDate(registeredAt)}</b>`,
    `Звернень до AI: <b>${session.totalAiRequests || 0}</b>`,
  ].join('\n');
}

function buildProgressMessage(session) {
  return [
    '<b>📈 Мій прогрес</b>',
    '',
    `XP: <b>${session.xp || 0}</b>`,
    `Звернень до AI: <b>${session.totalAiRequests || 0}</b>`,
    `Стрік активності: <b>${session.dailyStreak || 0} днів</b>`,
    `Остання нагорода: <b>${formatDate(session.lastRewardClaimedDate)}</b>`,
    '',
    'Продовжуй щодня заходити в бот, щоб отримувати бонуси та зберігати стрік!',
  ].join('\n');
}

function askForTopic(chatId, session, state, message) {
  userStates[chatId] = state;

  bot.sendMessage(chatId, message + getSubjectHint(session), {
    parse_mode: 'HTML',
    ...getActionKeyboard(session),
  });
}

function formatIsoDate(dateString) {
  if (!dateString) return 'Не вказано';
  const date = new Date(dateString);
  return date.toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function showUserProfile(chatId, session) {
  const subjectText = session.selectedSubject || 'Не обрано';
  const registeredAt = formatIsoDate(session.completedAt || session.startedAt);
  const aiRequests = session.totalAiRequests || 0;
  const xp = session.xp || 0;
  const streak = session.dailyStreak || 0;

  const message = `👤 <b>Мій профіль</b>

Ім'я: <b>${session.name || 'Невідомо'}</b>
Клас: <b>${session.class || 'Не вказано'}</b>
Обраний предмет: <b>${subjectText}</b>
Premium: <b>${premiumService.isPremium(session, session.telegramId) ? '⭐ Так' : 'Ні'}</b>
Рейтинг дуелей: <b>${session.duelRating || 1000}</b>
Дата реєстрації: <b>${registeredAt}</b>
Звернень до AI: <b>${aiRequests}</b>
XP: <b>${xp}</b>
Поточний стрік: <b>${streak}</b>`;

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

function showPremiumInfo(chatId, userId, session) {
  const isActive = premiumService.isPremium(session, userId);
  const status = isActive ? 'активний ⭐' : 'неактивний';
  const message = config.messages.premiumInfo
    .replace('{status}', status)
    .replace('{userId}', String(userId));

  // Build products keyboard
  const products = premiumService.getProducts();
  const inlineKeyboard = products.map((p) => [
    {
      text: `${p.label} — ${p.cost} XP`,
      callback_data: `premium:show_buy:${p.id}`,
    },
  ]);

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
}

function isSameDay(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isYesterday(dateString) {
  const date = new Date(dateString);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(date, yesterday);
}

const dailyRewards = [
  { type: 'XP', amount: 15, chance: 0.5 },
  { type: 'XP', amount: 30, chance: 0.3 },
  { type: 'XP', amount: 50, chance: 0.15 },
  { type: 'BUFF', amount: 'DoubleXP', chance: 0.05 },
];

function pickDailyReward() {
  const random = Math.random();
  let cumulative = 0;

  for (const reward of dailyRewards) {
    cumulative += reward.chance;
    if (random <= cumulative) {
      return reward;
    }
  }

  return dailyRewards[dailyRewards.length - 1];
}

function getRewardText(reward) {
  if (reward.type === 'XP') {
    return `+${reward.amount} XP`;
  }

  if (reward.type === 'BUFF') {
    return `+${reward.amount} (Подвійний XP для наступного тесту)`;
  }

  return 'подарунок';
}

function handleDailyReward(chatId, userId, session) {
  if (!session || session.step !== 'completed') {
    bot.sendMessage(chatId, 'Натисни /start, щоб почати.');
    return;
  }

  if (session.lastRewardClaimedDate && isSameDay(session.lastRewardClaimedDate, new Date())) {
    bot.sendMessage(chatId, 'Ти вже забрав свою нагороду сьогодні! Повертайся завтра ⏳', backKeyboard);
    return;
  }

  const nextStreak = session.lastRewardClaimedDate && isYesterday(session.lastRewardClaimedDate)
    ? (session.dailyStreak || 0) + 1
    : 1;

  session.dailyStreak = nextStreak;
  session.lastRewardClaimedDate = new Date().toISOString();
  session.lastActivityDate = new Date().toISOString();

  let reward;
  let bonusText = '';

  if (nextStreak > 0 && nextStreak % 7 === 0) {
    reward = { type: 'XP', amount: 100 };
    bonusText = '🎉 Це 7-й день твого стріку!';
  } else {
    reward = pickDailyReward();
  }

  if (reward.type === 'XP') {
    session.xp = (session.xp || 0) + reward.amount;
  } else if (reward.type === 'BUFF') {
    session.activeBuff = reward.amount;
    session.buffExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  saveSession(userId, session);

  bot.sendMessage(chatId, '📦 Відкриваємо скриню...');

  setTimeout(() => {
    bot.sendMessage(chatId, '✨ Заглядаємо всередину...');
  }, 800);

  setTimeout(() => {
    const rewardText = getRewardText(reward);
    const currentXp = session.xp || 0;
    const message = `🎁 Ти отримав ${rewardText}!\n${bonusText}\n\nТвій поточний XP: <b>${currentXp}</b>\nПоточний стрік: <b>${session.dailyStreak}</b>`;

    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...backKeyboard,
    });

    questHandler.applyQuestTrigger(bot, chatId, userId, 'claim_daily_reward', session, saveSession);
  }, 1600);
}

function showUserProgress(chatId, session) {
  const xp = session.xp || 0;
  const streak = session.dailyStreak || 0;
  const lastClaim = session.lastRewardClaimedDate ? formatIsoDate(session.lastRewardClaimedDate) : 'Не отримано';
  const buff = session.activeBuff ? `\nАктивний бонус: <b>${session.activeBuff}</b>` : '';
  const status = punishmentService.getActivityStatus(session, config);
  const freezeCost = config.punishment.freezeItemCost;
  const freezeStatus = session.hasFreezeItem
    ? config.messages.progressHasFreeze
    : config.messages.progressNoFreeze.replace('{cost}', freezeCost);

  const message = `📈 <b>Мій прогрес</b>\n\n🏅 Досвід (XP): <b>${xp}</b>\n🔥 Поточний стрік: <b>${streak}</b>\n🕒 Остання нагорода: <b>${lastClaim}</b>${buff}\n${status}\n${freezeStatus}`;

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...progressKeyboard,
  });
}

function showLearningStats(chatId, session) {
  const stats = userService.ensureStats(session);

  const message = [
    '📊 <b>Статистика навчання</b>',
    '',
    `📚 Тем пояснено: <b>${stats.topicsExplained}</b>`,
    `🧠 Тестів пройдено: <b>${stats.testsCompleted}</b>`,
    `⚔️ Дуелей зіграно: <b>${stats.duelsPlayed || 0}</b>`,
    `🏆 Дуелей виграно: <b>${stats.duelsWon || 0}</b>`,
    `📈 Рейтинг дуелей: <b>${session.duelRating || 1000}</b>`,
    `💬 Повідомлень боту: <b>${stats.messagesCount}</b>`,
  ].join('\n');

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

function buildLeaderboardKeyboard(period, page, pageCount) {
  const rows = [
    [
      { text: 'За весь час', callback_data: `leaderboard:period:all_time:1` },
      { text: 'За тиждень', callback_data: `leaderboard:period:weekly:1` },
      { text: 'За місяць', callback_data: `leaderboard:period:monthly:1` },
    ],
  ];

  if (pageCount > 1) {
    const navRow = [];
    if (page > 1) {
      navRow.push({ text: '⬅️', callback_data: `leaderboard:page:${period}:${page - 1}` });
    }
    navRow.push({ text: `Сторінка ${page}/${pageCount}`, callback_data: `leaderboard:page:${period}:${page}` });
    if (page < pageCount) {
      navRow.push({ text: '➡️', callback_data: `leaderboard:page:${period}:${page + 1}` });
    }
    rows.push(navRow);
  }

  return { reply_markup: { inline_keyboard: rows } };
}

function formatLeaderboardName(entry) {
  if (entry.username) {
    return `@${entry.username}`;
  }
  if (entry.name) {
    return escapeHtml(entry.name);
  }
  return `Користувач ${String(entry.userId).slice(-4).padStart(4, '0')}`;
}

function buildLeaderboardMessage(leaderboard, currentRank, period) {
  const periodLabel = period === 'weekly' ? 'За тиждень' : period === 'monthly' ? 'За місяць' : 'За весь час';
  const lines = [`🏆 <b>Лідерборд · ${periodLabel}</b>`, ''];

  if (leaderboard.entries.length === 0) {
    lines.push('Поки що немає даних для рейтингу.');
  } else {
    leaderboard.entries.forEach((entry, index) => {
      const rank = (leaderboard.page - 1) * leaderboard.pageSize + index + 1;
      const medal = rank === 1 ? '🥇 ' : rank === 2 ? '🥈 ' : rank === 3 ? '🥉 ' : '';
      const userName = formatLeaderboardName(entry);
      const selfMark = entry.userId === String(currentRank?.userId) ? ' <b>(Ти)</b>' : '';
      lines.push(`${medal}<b>${rank}</b>. ${userName}${selfMark} — <b>${entry.score}</b> XP`);
    });
  }

  lines.push('');

  if (currentRank) {
    lines.push(`Твоя позиція: <b>${currentRank.rank}</b> / ${currentRank.totalCount}`);
    lines.push(`Твій результат: <b>${currentRank.score}</b> XP`);
  } else {
    lines.push('Твоя позиція: ще не в рейтингу. Продовжуй збирати XP!');
  }

  lines.push('');
  lines.push('Перемикай періоди та переглядай Топ-100.');
  return lines.join('\n');
}

async function showLeaderboard(chatId, userId, period = 'all_time', page = 1) {
  const leaderboard = leaderboardService.getLeaderboard(period, page, 20);
  const currentRank = leaderboardService.getUserRank(userId, period);
  const message = buildLeaderboardMessage(leaderboard, currentRank, period);

  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...buildLeaderboardKeyboard(period, leaderboard.page, leaderboard.pageCount),
  });
}

function isSubjectForUser(session, text) {
  if (!session || session.step !== 'completed') {
    return false;
  }

  return getSubjectsForClass(session.class).includes(text);
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  const session = getSession(user.id);

  if (session && session.step === 'completed') {
    applyInactivityCheck(chatId, user.id, session);
    touchUserActivity(user.id, session);
    showMainMenu(chatId, session);
    return;
  }

  registration.startRegistration(bot, chatId, user);
});

bot.onText(/\/add_exam/, (msg) => {
  const chatId = msg.chat.id;
  const session = getSession(msg.from.id);

  if (!session || session.step !== 'completed') {
    bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
    return;
  }

  examHandler.startAddExam(bot, chatId, userStates);
});

bot.onText(/\/my_exams/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId);

  if (!session || session.step !== 'completed') {
    bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
    return;
  }

  examHandler.showMyExams(bot, chatId, userId, session, config);
});

bot.onText(/\/premium/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId) || { telegramId: userId };
  showPremiumInfo(chatId, userId, session);
});

bot.onText(/\/admin(?:@\w+)?/, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  bot.sendMessage(chatId, config.messages.adminHelp, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🧑‍💼 Картка користувача', callback_data: 'admin:menu:user' },
          { text: '📊 Статистика', callback_data: 'admin:menu:stats' },
        ],
        [
          { text: '➕ Додати XP', callback_data: 'admin:menu:give_xp' },
          { text: '➖ Списати XP', callback_data: 'admin:menu:take_xp' },
        ],
        [
          { text: '⭐ Дати Premium', callback_data: 'admin:menu:set_premium' },
          { text: '⛔ Забанити / Розбанити', callback_data: 'admin:menu:ban' },
        ],
      ],
    },
  });
});

bot.onText(/\/user(?:@\w+)?\s+(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  const identifier = match && match[1] ? match[1].trim() : null;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  if (!identifier) {
    bot.sendMessage(chatId, config.messages.adminInvalidArgs);
    return;
  }

  const target = adminService.getUserByIdentifier(identifier);
  if (!target || !target.session) {
    bot.sendMessage(chatId, config.messages.adminUserNotFound);
    return;
  }

  const card = adminService.getUserCard(target.session, target.id);
  bot.sendMessage(chatId, card, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '+100 XP', callback_data: `admin:action:give_xp:${target.id}:100` },
          { text: '-100 XP', callback_data: `admin:action:take_xp:${target.id}:100` },
        ],
        [
          { text: 'Premium 7d', callback_data: `admin:action:set_premium:${target.id}:7` },
          { text: target.session.banned ? 'Розбанити' : 'Забанити', callback_data: `admin:action:${target.session.banned ? 'unban' : 'ban'}:${target.id}` },
        ],
      ],
    },
  });
});

bot.onText(/\/give_xp(?:@\w+)?\s+([^\s]+)(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  const targetId = match[1];
  const amount = Number(match[2] || 100);

  if (!targetId || !Number.isFinite(amount) || amount <= 0) {
    bot.sendMessage(chatId, config.messages.adminInvalidArgs);
    return;
  }

  const target = adminService.getUserByIdentifier(targetId);
  if (!target || !target.session) {
    bot.sendMessage(chatId, config.messages.adminUserNotFound);
    return;
  }

  const updated = adminService.adjustXp(target.id, amount);
  if (!updated) {
    bot.sendMessage(chatId, config.messages.adminActionFailed);
    return;
  }

  adminService.logAction(user, 'give_xp', target.id, `amount=${amount}`);
  bot.sendMessage(chatId, `✅ Додано ${amount} XP користувачу ${target.id}. Новий баланс: ${updated.xp}.`, { parse_mode: 'HTML' });
});

bot.onText(/\/take_xp(?:@\w+)?\s+([^\s]+)(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  const targetId = match[1];
  const amount = Number(match[2] || 100);

  if (!targetId || !Number.isFinite(amount) || amount <= 0) {
    bot.sendMessage(chatId, config.messages.adminInvalidArgs);
    return;
  }

  const target = adminService.getUserByIdentifier(targetId);
  if (!target || !target.session) {
    bot.sendMessage(chatId, config.messages.adminUserNotFound);
    return;
  }

  const updated = adminService.adjustXp(target.id, -amount);
  if (!updated) {
    bot.sendMessage(chatId, config.messages.adminActionFailed);
    return;
  }

  adminService.logAction(user, 'take_xp', target.id, `amount=${amount}`);
  bot.sendMessage(chatId, `✅ Списано ${amount} XP у користувача ${target.id}. Новий баланс: ${updated.xp}.`, { parse_mode: 'HTML' });
});

bot.onText(/\/set_premium(?:@\w+)?\s+([^\s]+)\s+(\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  const targetId = match[1];
  const days = Number(match[2]);

  if (!targetId || !Number.isFinite(days) || days <= 0) {
    bot.sendMessage(chatId, config.messages.adminInvalidArgs);
    return;
  }

  const target = adminService.getUserByIdentifier(targetId);
  if (!target || !target.session) {
    bot.sendMessage(chatId, config.messages.adminUserNotFound);
    return;
  }

  const updated = adminService.setPremiumDays(target.id, days);
  if (!updated) {
    bot.sendMessage(chatId, config.messages.adminActionFailed);
    return;
  }

  adminService.logAction(user, 'set_premium', target.id, `days=${days}`);
  bot.sendMessage(chatId, `✅ Premium активовано для користувача ${target.id} на ${days} днів.`, { parse_mode: 'HTML' });
});

bot.onText(/\/ban(?:@\w+)?\s+([^\s]+)(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  const targetId = match[1];
  const reason = match[2] ? match[2].trim() : 'Не вказано';

  if (!targetId) {
    bot.sendMessage(chatId, config.messages.adminInvalidArgs);
    return;
  }

  const target = adminService.getUserByIdentifier(targetId);
  if (!target || !target.session) {
    bot.sendMessage(chatId, config.messages.adminUserNotFound);
    return;
  }

  const updated = adminService.banUser(target.id, reason);
  if (!updated) {
    bot.sendMessage(chatId, config.messages.adminActionFailed);
    return;
  }

  adminService.logAction(user, 'ban', target.id, `reason=${reason}`);
  bot.sendMessage(chatId, `⛔ Користувач ${target.id} заблокований. Причина: ${reason}`, { parse_mode: 'HTML' });
});

bot.onText(/\/unban(?:@\w+)?\s+([^\s]+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  const targetId = match[1];

  if (!targetId) {
    bot.sendMessage(chatId, config.messages.adminInvalidArgs);
    return;
  }

  const target = adminService.getUserByIdentifier(targetId);
  if (!target || !target.session) {
    bot.sendMessage(chatId, config.messages.adminUserNotFound);
    return;
  }

  const updated = adminService.unbanUser(target.id);
  if (!updated) {
    bot.sendMessage(chatId, config.messages.adminActionFailed);
    return;
  }

  adminService.logAction(user, 'unban', target.id);
  bot.sendMessage(chatId, `✅ Користувач ${target.id} розблокований.`, { parse_mode: 'HTML' });
});

bot.onText(/\/stats(?:@\w+)?/, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!adminService.isAdminUser(user)) {
    bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return;
  }

  const stats = adminService.getSystemStats();
  const uptime = process.uptime();
  const uptimeText = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;

  bot.sendMessage(chatId, `📊 <b>Системна статистика</b>\n\n` +
    `Користувачів: <b>${stats.userCount}</b>\n` +
    `Онлайн за останні 15 хв: <b>${stats.onlineCount}</b>\n` +
    `Преміум активних: <b>${stats.premiumCount}</b>\n` +
    `Заблоковано: <b>${stats.bannedCount}</b>\n` +
    `Загальний XP: <b>${stats.totalXp}</b>\n` +
    `Середній XP: <b>${stats.averageXp}</b>\n` +
    `Uptime: <b>${uptimeText}</b>`, {
    parse_mode: 'HTML',
  });
});

bot.onText(/\/leaderboard(?:@\w+)?/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId);

  if (!session || session.step !== 'completed') {
    await bot.sendMessage(chatId, 'Натисни /start, щоб почати.');
    return;
  }

  await showLeaderboard(chatId, userId, 'all_time', 1);
});

bot.onText(/\/quests/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId);

  if (!session || session.step !== 'completed') {
    bot.sendMessage(chatId, 'РЎРїРѕС‡Р°С‚РєСѓ Р·Р°РІРµСЂС€Рё СЂРµС”СЃС‚СЂР°С†С–СЋ С‡РµСЂРµР· /start');
    return;
  }

  questHandler.showQuests(bot, chatId, userId);
});

bot.on('callback_query', async (query) => {
  const session = getSession(query.from.id);
  const chatId = query.message?.chat?.id || query.from.id;
  const user = query.from;
  const data = String(query.data || '');

  if (data.startsWith('admin:')) {
    if (!adminService.isAdminUser(user)) {
      await bot.answerCallbackQuery(query.id, { text: config.messages.adminAccessDenied, show_alert: true });
      return;
    }

    await bot.answerCallbackQuery(query.id);
    const parts = data.split(':');
    const mode = parts[1];

    if (mode === 'menu') {
      const menuKey = parts[2];
      if (menuKey === 'user') {
        await bot.sendMessage(chatId, 'Введіть /user <user_id|username> для перегляду картки користувача.', { parse_mode: 'HTML' });
        return;
      }
      if (menuKey === 'stats') {
        const stats = adminService.getSystemStats();
        const uptime = process.uptime();
        const uptimeText = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
        await bot.sendMessage(chatId, `📊 <b>Системна статистика</b>\n\n` +
          `Користувачів: <b>${stats.userCount}</b>\n` +
          `Онлайн за останні 15 хв: <b>${stats.onlineCount}</b>\n` +
          `Преміум активних: <b>${stats.premiumCount}</b>\n` +
          `Заблоковано: <b>${stats.bannedCount}</b>\n` +
          `Загальний XP: <b>${stats.totalXp}</b>\n` +
          `Середній XP: <b>${stats.averageXp}</b>\n` +
          `Uptime: <b>${uptimeText}</b>`, { parse_mode: 'HTML' });
        return;
      }
      if (menuKey === 'give_xp') {
        await bot.sendMessage(chatId, 'Введіть команду: /give_xp <user_id> [amount]', { parse_mode: 'HTML' });
        return;
      }
      if (menuKey === 'take_xp') {
        await bot.sendMessage(chatId, 'Введіть команду: /take_xp <user_id> [amount]', { parse_mode: 'HTML' });
        return;
      }
      if (menuKey === 'set_premium') {
        await bot.sendMessage(chatId, 'Введіть команду: /set_premium <user_id> <days>', { parse_mode: 'HTML' });
        return;
      }
      if (menuKey === 'ban') {
        await bot.sendMessage(chatId, 'Введіть команду: /ban <user_id> [reason] або /unban <user_id>', { parse_mode: 'HTML' });
        return;
      }
    }

    if (mode === 'action') {
      const action = parts[2];
      const targetId = parts[3];
      const amount = Number(parts[4] || 0);
      const target = adminService.getUserByIdentifier(targetId);

      if (!target || !target.session) {
        await bot.sendMessage(chatId, config.messages.adminUserNotFound);
        return;
      }

      let updated;
      if (action === 'give_xp') {
        updated = adminService.adjustXp(target.id, amount || 100);
        if (updated) {
          adminService.logAction(user, 'give_xp', target.id, `amount=${amount || 100}`);
          await bot.sendMessage(chatId, `✅ Додано ${amount || 100} XP користувачу ${target.id}. Новий баланс: ${updated.xp}.`, { parse_mode: 'HTML' });
        }
      } else if (action === 'take_xp') {
        updated = adminService.adjustXp(target.id, -(amount || 100));
        if (updated) {
          adminService.logAction(user, 'take_xp', target.id, `amount=${amount || 100}`);
          await bot.sendMessage(chatId, `✅ Списано ${amount || 100} XP у користувача ${target.id}. Новий баланс: ${updated.xp}.`, { parse_mode: 'HTML' });
        }
      } else if (action === 'set_premium') {
        updated = adminService.setPremiumDays(target.id, amount || 7);
        if (updated) {
          adminService.logAction(user, 'set_premium', target.id, `days=${amount || 7}`);
          await bot.sendMessage(chatId, `✅ Premium активовано для користувача ${target.id} на ${amount || 7} днів.`, { parse_mode: 'HTML' });
        }
      } else if (action === 'ban') {
        updated = adminService.banUser(target.id, 'Бан із адмін-кнопки');
        if (updated) {
          adminService.logAction(user, 'ban', target.id, 'reason=Адмінська дія');
          await bot.sendMessage(chatId, `⛔ Користувач ${target.id} заблокований.`, { parse_mode: 'HTML' });
        }
      } else if (action === 'unban') {
        updated = adminService.unbanUser(target.id);
        if (updated) {
          adminService.logAction(user, 'unban', target.id);
          await bot.sendMessage(chatId, `✅ Користувач ${target.id} розблокований.`, { parse_mode: 'HTML' });
        }
      }

      if (!updated) {
        await bot.sendMessage(chatId, config.messages.adminActionFailed);
      }
      return;
    }
  }

  if (data.startsWith('leaderboard:')) {
    await bot.answerCallbackQuery(query.id);
    const parts = data.split(':');
    const action = parts[1];
    const period = parts[2] || 'all_time';
    const page = Number(parts[3] || 1);

    if (action === 'period' || action === 'page') {
      await showLeaderboard(chatId, query.from.id, period, page);
      return;
    }
  }

  if (await duelHandler.handleDuelCallback(bot, query, session, userStates, config)) {
    return;
  }

  if (await createTestHandler.handleQuizCallback(bot, query, session, userStates, config, saveSession)) {
    return;
  }

  // Handle premium store callbacks: premium:show_buy:<id> | premium:confirm:<id> | premium:cancel
  try {
    const data = String(query.data || '');
    if (data.startsWith('premium:')) {
      const parts = data.split(':');
      const action = parts[1];
      const productId = parts[2];

      await bot.answerCallbackQuery(query.id);

      if (action === 'show_buy' && productId) {
        const products = premiumService.getProducts();
        const product = products.find((p) => p.id === productId);
        if (!product) {
          await bot.sendMessage(query.message.chat.id, '❌ Товар не знайдено.');
          return;
        }

        const confirmKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: `Підтвердити — витратити ${product.cost} XP`, callback_data: `premium:confirm:${product.id}` },
                { text: 'Скасувати', callback_data: 'premium:cancel' },
              ],
            ],
          },
        };

        await bot.sendMessage(query.message.chat.id, `Ви впевнені, що хочете витратити ${product.cost} XP на ${product.label}?`, confirmKeyboard);
        return;
      }

      if (action === 'confirm' && productId) {
        const result = await premiumService.purchaseProduct(query.from.id, productId);

        if (!result || !result.success) {
          if (result && result.error === 'insufficient') {
            await bot.sendMessage(query.message.chat.id, `❌ Недостатньо XP. Потрібно ${result.needed} XP, у вас ${result.balance} XP.`);
            return;
          }

          await bot.sendMessage(query.message.chat.id, '❌ Не вдалося виконати покупку. Спробуйте пізніше.');
          return;
        }

        // Persist session to file and inform user
        const newSession = result.session;
        saveSession(query.from.id, newSession);

        const untilText = formatIsoDate(newSession.premiumUntil);
        await bot.sendMessage(query.message.chat.id, `✅ Успіх! Ви отримали ${result.product.label}.
Термін дії: <b>${untilText}</b>
Ваш поточний XP: <b>${result.newXp}</b>`, { parse_mode: 'HTML' });
        return;
      }

      if (action === 'cancel') {
        await bot.sendMessage(query.message.chat.id, '❌ Операцію скасовано.');
        await bot.answerCallbackQuery(query.id);
        return;
      }
    }
  } catch (err) {
    console.error('Premium callback error:', err.message || err);
  }

  examHandler.handleExamCallback(bot, query, session, userStates, config);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId);

  if (msg.photo || msg.voice || msg.audio) {
    if (!session) {
      bot.sendMessage(chatId, 'Натисни /start, щоб почати.');
      return;
    }

    if (msg.photo && await supportHandler.handleSupportPhoto(bot, msg, session, userStates, config)) {
      userService.recordMessage(session);
      saveSession(userId, session);
      applyInactivityCheck(chatId, userId, session);
      touchUserActivity(userId, session);
      return;
    }

    userService.recordMessage(session);
    saveSession(userId, session);
    applyInactivityCheck(chatId, userId, session);
    touchUserActivity(userId, session);

    await mediaHandler.handlePremiumMedia(bot, msg, session, config, saveSession);
    return;
  }

  if (msg.document) {
    if (!session) {
      bot.sendMessage(chatId, 'Натисни /start, щоб почати.');
      return;
    }

    if (await supportHandler.handleSupportDocument(bot, msg, session, userStates, config)) {
      userService.recordMessage(session);
      saveSession(userId, session);
      applyInactivityCheck(chatId, userId, session);
      touchUserActivity(userId, session);
      return;
    }

    if (await createTestHandler.handleQuizDocument(bot, msg, session, userStates, config)) {
      return;
    }

    const isImageDoc =
      msg.document.mime_type && String(msg.document.mime_type).startsWith('image/');

    if (isImageDoc) {
      userService.recordMessage(session);
      saveSession(userId, session);
      applyInactivityCheck(chatId, userId, session);
      touchUserActivity(userId, session);
      await mediaHandler.handlePremiumMedia(bot, msg, session, config, saveSession);
      return;
    }
  }

  if (!msg.text || msg.text.startsWith('/')) {
    return;
  }

  const text = msg.text.trim();

  if (!session) {
    bot.sendMessage(chatId, 'Натисни /start, щоб почати.');
    return;
  }

  userService.recordMessage(session);
  saveSession(userId, session);

  if (session.step === 'name') {
    if (text.length < 2) {
      bot.sendMessage(chatId, 'Будь ласка, введи своє ім\'я (мінімум 2 символи).');
      return;
    }

    session.name = text;
    session.step = 'class';
    saveSession(userId, session);

    bot.sendMessage(
      chatId,
      `Приємно познайомитись, ${text}! 😊\n\nВ якому класі ти навчаєшся? (1–11)`
    );
    return;
  }

  if (session.step === 'class') {
    const classNum = parseInt(text, 10);

    if (Number.isNaN(classNum) || classNum < 1 || classNum > 11) {
      bot.sendMessage(chatId, 'Введи число від 1 до 11.');
      return;
    }

    session.class = classNum;
    session.step = 'completed';
    session.completedAt = new Date().toISOString();
    session.hasFreezeItem = session.hasFreezeItem || false;
    session.lastActivityDate = new Date().toISOString();
    session.timezone = session.timezone || config.exams.defaultTimezone;
    saveSession(userId, session);

    bot.sendMessage(
      chatId,
      `Чудово, ${session.name}! 🎓\nТи у ${classNum}-му класі.\n\nОсь твої шкільні предмети:`
    );

    showSubjectsMenu(chatId, session);
    showMainMenu(chatId, session);
    return;
  }

  if (session.step === 'completed') {
    applyInactivityCheck(chatId, userId, session);
    touchUserActivity(userId, session);
  }

  if (examHandler.handleExamMessage(bot, chatId, userId, text, session, userStates, config, saveSession)) {
    return;
  }

  if (supportHandler.isSupportMenuText(text)) {
    if (session.step !== 'completed') {
      bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return;
    }
    supportHandler.startSupport(bot, chatId, userStates, config);
    return;
  }

  if (supportHandler.isSupportCancelText(text)) {
    supportHandler.cancelSupport(bot, chatId, userId, userStates, config);
    return;
  }

  if (await supportHandler.handleSupportText(bot, chatId, userId, text, session, userStates, config)) {
    return;
  }

  if (duelHandler.handleDuelMessage(bot, chatId, userId, text, session, userStates, config)) {
    return;
  }

  if (createTestHandler.handleQuizMessage(bot, chatId, userId, text, session, userStates, config, saveSession)) {
    return;
  }

  if (text === '📋 Головне меню') {
    createTestHandler.clearQuizSession(chatId);
    duelHandler.clearUserDuelSearch(userId, chatId, userStates);
    supportHandler.clearSupportState(chatId, userId, userStates);
    showMainMenu(chatId, session);
    return;
  }

  if (text === '📖 Предмети') {
    showSubjectsMenu(chatId, session);
    return;
  }

  if (text === '🔄 Перереєструватися') {
    registration.startRegistration(bot, chatId, msg.from, true);
    return;
  }

  if (isSubjectForUser(session, text)) {
    session.selectedSubject = text;
    saveSession(userId, session);
    userStates[chatId] = 'subject_selected';

    bot.sendMessage(
      chatId,
      `✅ Обрано предмет: <b>${text}</b>\n\nЩо хочеш зробити?`,
      {
        parse_mode: 'HTML',
        ...buildSubjectActionKeyboard(),
      }
    );
    return;
  }

  if (text === '📚 Пояснити тему') {
    createTestHandler.clearQuizSession(chatId);
    askForTopic(chatId, session, 'explaining_topic', config.messages.explainTopic);
    return;
  }

  if (text === '🧠 Створити тест') {
    createTestHandler.startCreateTest(bot, chatId, session, userStates, config);
    return;
  }

  if (text === '⚔️ Дуель знань') {
    duelHandler.showDuelMenu(bot, chatId, userId, session, config);
    return;
  }

  if (matchesMenuText(text, '📈 Мій прогрес')) {
    userStates[chatId] = 'viewing_progress';
    showUserProgress(chatId, session);
    return;
  }

  if (matchesMenuText(text, '📊 Статистика')) {
    userStates[chatId] = 'viewing_stats';
    showLearningStats(chatId, session);
    return;
  }

  if (matchesMenuText(text, '🏆 Квести')) {
    userStates[chatId] = 'viewing_quests';
    questHandler.showQuests(bot, chatId, userId);
    return;
  }

  if (matchesMenuText(text, '🧊 Купити заморозку')) {
    const purchaseResult = punishmentService.buyFreezeItem(session, config);

    if (purchaseResult.success) {
      saveSession(userId, session);
    }

    bot.sendMessage(chatId, purchaseResult.message, {
      parse_mode: 'HTML',
      ...progressKeyboard,
    });
    return;
  }

  if (text === '📝 Додати КР') {
    if (session.step !== 'completed') {
      bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return;
    }
    examHandler.startAddExam(bot, chatId, userStates);
    return;
  }

  if (text === '📅 Мої КР') {
    if (session.step !== 'completed') {
      bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
      return;
    }
    examHandler.showMyExams(bot, chatId, userId, session, config);
    return;
  }

  if (matchesMenuText(text, '👤 Мій профіль')) {
    userStates[chatId] = 'viewing_profile';
    showUserProfile(chatId, session);
    return;
  }

  if (matchesMenuText(text, '🏆 Лідерборд')) {
    userStates[chatId] = 'viewing_leaderboard';
    await showLeaderboard(chatId, userId, 'all_time', 1);
    return;
  }

  if (matchesMenuText(text, '🎁 Забрати нагороду')) {
    handleDailyReward(chatId, userId, session);
    return;
  }

  if (matchesMenuText(text, '⚙️ Допомога')) {
    userStates[chatId] = 'viewing_help';
    bot.sendMessage(chatId, config.messages.help + (config.messages.helpQuest || ''), {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [['⬅️ Повернутися в меню']],
        resize_keyboard: true,
      },
    });
    return;
  }

  if (matchesMenuText(text, '⭐ Premium')) {
    userStates[chatId] = 'viewing_premium';
    showPremiumInfo(chatId, userId, session);
    return;
  }

  if (matchesMenuText(text, '⬅️ Повернутися в меню')) {
    delete userStates[chatId];
    createTestHandler.clearQuizSession(chatId);
    duelHandler.clearUserDuelSearch(userId, chatId, userStates);
    supportHandler.clearSupportState(chatId, userId, userStates);
    if (session.examDraft) {
      delete session.examDraft;
      saveSession(userId, session);
    }
    showMainMenu(chatId, session);
    return;
  }

  if (userStates[chatId] === 'explaining_topic') {
    session.totalAiRequests = (session.totalAiRequests || 0) + 1;
    userService.recordTopicExplained(session);
    saveSession(userId, session);
    explainHandler.handleExplainTopic(bot, chatId, text, session);
    questHandler.applyQuestTrigger(bot, chatId, userId, 'explain_topic', session, saveSession);
    return;
  }

  if (allSubjects.includes(text)) {
    bot.sendMessage(
      chatId,
      'Цей предмет не входить до твоєї програми. Обери предмет з меню або натисни «📖 Предмети».',
      buildSubjectsKeyboard(session.class)
    );
    return;
  }

  bot.sendMessage(
    chatId,
    'Обери предмет з меню або натисни «📋 Головне меню».',
    buildSubjectsKeyboard(session.class)
  );
});



bot.on('polling_error', (error) => {
  const errorCode = error.response?.body?.error_code;
  console.error('Polling error:', error.message || error);

  if (errorCode === 409) {
    console.error('\n❌ Помилка 409: бот уже запущений в іншому місці.');
    console.error('   Зупини всі інші npm start / сервери з цим же TELEGRAM_TOKEN.\n');
    process.exit(1);
  }
});

const checkIntervalMs = (config.punishment.checkIntervalHours || 6) * 60 * 60 * 1000;

setInterval(() => {
  const atRisk = punishmentService.countAtRiskUsers(userService, config);
  if (atRisk > 0) {
    console.log(`[punishment] Фонова перевірка: ${atRisk} користувач(ів) у зоні ризику`);
  }
}, checkIntervalMs);

examScheduler.startExamScheduler(bot, config);

async function startBot() {
  await bot.deleteWebHook({ drop_pending_updates: true });
  await bot.startPolling({ restart: true });

  await bot.setMyCommands([
    { command: 'start', description: 'Почати роботу з ботом' },
    { command: 'add_exam', description: 'Додати контрольну роботу' },
    { command: 'my_exams', description: 'Мої майбутні контрольні' },
    { command: 'duel', description: 'Дуель знань — пошук, друг по ID або код' },
    { command: 'premium', description: 'Статус Premium (фото та голос)' },
    { command: 'quests', description: 'Твої квести та прогрес' },
    { command: 'leaderboard', description: 'Топ-100 користувачів за XP' },
    { command: 'admin', description: 'Адмін-панель для модераторів' },
    { command: 'user', description: 'Переглянути картку користувача' },
    { command: 'give_xp', description: 'Нарахувати XP користувачу' },
    { command: 'take_xp', description: 'Списати XP у користувача' },
    { command: 'set_premium', description: 'Надати або продовжити Premium' },
    { command: 'ban', description: 'Заблокувати користувача' },
    { command: 'unban', description: 'Розблокувати користувача' },
    { command: 'stats', description: 'Системна статистика для адмінів' },
    { command: 'leaderboard', description: 'Топ-100 користувачів за XP' },
  ]);

  leaderboardService.createApiServer(Number(process.env.LEADERBOARD_PORT || 3001));
  console.log('🤖 Schoolmate AI Bot запущений і готовий до роботи...');
}

startBot().catch((error) => {
  console.error('Не вдалося запустити бота:', error.message || error);
  process.exit(1);
});
