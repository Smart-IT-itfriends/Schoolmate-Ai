require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { getSubjectsForClass, getAllSubjects } = require('./subjects');
const userService = require('./services/userService');
const punishmentService = require('./services/punishmentService');
const keyboards = require('./keyboards');
const registration = require('./handlers/registration');
const explainHandler = require('./handlers/explain');
const examHandler = require('./handlers/exams');
const examScheduler = require('./services/examScheduler');
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

  return [
    '<b>👤 Мій профіль</b>',
    '',
    `Ім'я: <b>${session.name || 'Невідомо'}</b>`,
    `Клас: <b>${session.class || 'Невідомо'}</b>`,
    `Предмет: <b>${session.selectedSubject || 'Не обрано'}</b>`,
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
Дата реєстрації: <b>${registeredAt}</b>
Звернень до AI: <b>${aiRequests}</b>
XP: <b>${xp}</b>
Поточний стрік: <b>${streak}</b>`;

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...backKeyboard,
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
    `💬 Повідомлень боту: <b>${stats.messagesCount}</b>`,
  ].join('\n');

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...backKeyboard,
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

bot.on('callback_query', (query) => {
  const session = getSession(query.from.id);
  examHandler.handleExamCallback(bot, query, session, userStates, config);
});

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) {
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  const session = getSession(userId);

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

  if (text === '📋 Головне меню') {
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
    askForTopic(chatId, session, 'explaining_topic', config.messages.explainTopic);
    return;
  }

  if (text === '🧠 Створити тест') {
    session.totalAiRequests = (session.totalAiRequests || 0) + 1;
    userService.recordTestCompleted(session);
    saveSession(userId, session);
    userStates[chatId] = session.selectedSubject ? 'subject_selected' : 'main_menu';

    bot.sendMessage(chatId, config.messages.createTest, {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    });
    return;
  }

  if (text === '📈 Мій прогрес') {
    userStates[chatId] = 'viewing_progress';
    showUserProgress(chatId, session);
    return;
  }

  if (text === '📊 Статистика') {
    userStates[chatId] = 'viewing_stats';
    showLearningStats(chatId, session);
    return;
  }

  if (text === '🧊 Купити заморозку') {
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

  if (text === '👤 Мій профіль') {
    userStates[chatId] = 'viewing_profile';
    showUserProfile(chatId, session);
    return;
  }

  if (text === '🎁 Забрати нагороду') {
    handleDailyReward(chatId, userId, session);
    return;
  }

  if (text === '⚙️ Допомога') {
    userStates[chatId] = 'viewing_help';
    bot.sendMessage(chatId, config.messages.help, {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [['⬅️ Повернутися в меню']],
        resize_keyboard: true,
      },
    });
    return;
  }

  if (text === '⬅️ Повернутися в меню') {
    delete userStates[chatId];
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
  ]);

  console.log('🤖 Schoolmate AI Bot запущений і готовий до роботи...');
}

startBot().catch((error) => {
  console.error('Не вдалося запустити бота:', error.message || error);
  process.exit(1);
});
