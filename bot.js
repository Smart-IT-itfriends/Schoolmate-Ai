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
const token = process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN;

if (!token) {
  console.error('Помилка: встановіть TELEGRAM_TOKEN у файлі .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
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

function showUserProgress(chatId, session) {
  const xp = session.xp || 0;
  const streak = session.dailyStreak || 0;
  const status = punishmentService.getActivityStatus(session, config);
  const freezeCost = config.punishment.freezeItemCost;
  const freezeStatus = session.hasFreezeItem
    ? config.messages.progressHasFreeze
    : config.messages.progressNoFreeze.replace('{cost}', freezeCost);

  const message = [
    '📈 <b>Мій прогрес</b>',
    '',
    `🏅 Досвід (XP): <b>${xp}</b>`,
    `🔥 Поточний стрік: <b>${streak}</b> днів`,
    status,
    freezeStatus,
  ].join('\n');

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...progressKeyboard,
  });
}

function getSession(userId) {
  return userService.getSession(userId);
}

function saveSession(userId, session) {
  return userService.saveSession(userId, session);
}

function formatIsoDate(dateString) {
  if (!dateString) {
    return config.messages.profileNoData;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return config.messages.profileNoData;
  }

  return date.toLocaleDateString('uk-UA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getDateKey(dateInput) {
  const date = new Date(dateInput);
  return date.toISOString().split('T')[0];
}

function isSameDate(firstDate, secondDate) {
  return getDateKey(firstDate) === getDateKey(secondDate);
}

function buildReward() {
  const rewards = [
    { type: 'XP', amount: 15, chance: 0.5 },
    { type: 'XP', amount: 30, chance: 0.3 },
    { type: 'XP', amount: 50, chance: 0.15 },
    { type: 'BUFF', amount: 'DoubleXP', chance: 0.05 },
  ];

  const random = Math.random();
  let accumulator = 0;

  for (const reward of rewards) {
    accumulator += reward.chance;
    if (random <= accumulator) {
      return reward;
    }
  }

  return rewards[0];
}

function getRewardForStreak(streak) {
  if (streak === 7) {
    return { type: 'XP', amount: 100, message: '7-й день стріку! +100 XP' };
  }

  const reward = buildReward();
  if (reward.type === 'BUFF') {
    return { ...reward, message: 'Отримано ефект DoubleXP для наступного тесту!' };
  }

  return { ...reward, message: `Отримано ${reward.amount} XP` };
}

function showUserProfile(chatId, session) {
  const subjectText = session.selectedSubject || config.messages.profileNoSubject;
  const registeredAt = formatIsoDate(session.completedAt || session.startedAt);
  const aiRequests = session.aiRequests || 0;
  const xp = session.xp || 0;
  const streak = session.dailyStreak || 0;
  const lastReward = session.lastRewardClaimedDate
    ? formatIsoDate(session.lastRewardClaimedDate)
    : 'Ще не отримував';

  const message = `${config.messages.profileTitle}Ім'я: <b>${session.name || config.messages.profileNoData}</b>\nКлас: <b>${session.class || config.messages.profileNoData}</b>\nОбраний предмет: <b>${subjectText}</b>\nДата реєстрації: <b>${registeredAt}</b>\nЗвернень до AI: <b>${aiRequests}</b>\nXP: <b>${xp}</b>\nСтрік активності: <b>${streak}</b>\nОстання нагорода: <b>${lastReward}</b>`;

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

function canClaimReward(session) {
  if (!session.lastRewardClaimedDate) {
    return true;
  }

  return !isSameDate(session.lastRewardClaimedDate, new Date());
}

function formatRewardResult(rewardInfo, streak) {
  const rewardType = rewardInfo.type === 'BUFF' ? 'BUFF' : rewardInfo.type;
  const xpAmount = rewardInfo.type === 'BUFF' ? 0 : rewardInfo.amount;

  return config.messages.rewardResult
    .replace('%s', rewardType)
    .replace('%s', xpAmount)
    .replace('%s', streak);
}

function claimDailyReward(chatId, userId, session) {
  if (!canClaimReward(session)) {
    bot.sendMessage(chatId, config.messages.rewardAlreadyClaimed, backKeyboard);
    return;
  }

  const yesterdayKey = getDateKey(Date.now() - 24 * 60 * 60 * 1000);
  const lastClaimKey = session.lastRewardClaimedDate
    ? getDateKey(session.lastRewardClaimedDate)
    : null;

  let streak = 1;
  if (lastClaimKey === yesterdayKey) {
    streak = (session.dailyStreak || 0) + 1;
  }

  if (streak > 7) {
    streak = 1;
  }

  const rewardInfo = getRewardForStreak(streak);
  session.lastRewardClaimedDate = new Date().toISOString();
  session.dailyStreak = streak;
  session.lastActivityDate = new Date().toISOString();
  session.xp = (session.xp || 0) + (rewardInfo.type === 'XP' ? rewardInfo.amount : 0);
  session.activeBuff = rewardInfo.type === 'BUFF' ? rewardInfo.amount : session.activeBuff || null;

  saveSession(userId, session);

  const resultText = `🎁 ${rewardInfo.message}`;
  const rewardMessage = formatRewardResult(rewardInfo, streak);

  bot.sendMessage(chatId, '📦 Відкриваємо скриню...').then(() => {
    setTimeout(() => {
      bot.sendMessage(chatId, '✨ Зачекай, шукаємо бонус...');
      setTimeout(() => {
        bot.sendMessage(
          chatId,
          `${config.messages.rewardClaimed}\n\n${resultText}\n\n${rewardMessage}`,
          { parse_mode: 'HTML', ...backKeyboard }
        );
      }, 800);
    }, 800);
  });
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

function askForTopic(chatId, session, state, message) {
  userStates[chatId] = state;

  bot.sendMessage(chatId, message + getSubjectHint(session), {
    parse_mode: 'HTML',
    ...getActionKeyboard(session),
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
    showSubjectsMenu(chatId, session);
    return;
  }

  registration.startRegistration(bot, chatId, user);
});

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) {
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  let session = getSession(userId);

  if (!session) {
    bot.sendMessage(chatId, 'Натисни /start, щоб почати.');
    return;
  }

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
    saveSession(userId, session);

    bot.sendMessage(
      chatId,
      `Чудово, ${session.name}! 🎓\nТи у ${classNum}-му класі.\n\nОсь твої шкільні предмети:`
    );

    showSubjectsMenu(chatId, session);
    return;
  }

  if (session.step === 'completed') {
    applyInactivityCheck(chatId, userId, session);
    touchUserActivity(userId, session);
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

  if (text === '👤 Мій профіль') {
    showUserProfile(chatId, session);
    return;
  }

  if (text === '🎁 Забрати нагороду') {
    claimDailyReward(chatId, userId, session);
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
    showMainMenu(chatId, session);
    return;
  }

  if (userStates[chatId] === 'explaining_topic') {
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
  console.error('Polling error:', error);
});

const checkIntervalMs = (config.punishment.checkIntervalHours || 6) * 60 * 60 * 1000;

setInterval(() => {
  const atRisk = punishmentService.countAtRiskUsers(userService, config);
  if (atRisk > 0) {
    console.log(`[punishment] Фонова перевірка: ${atRisk} користувач(ів) у зоні ризику`);
  }
}, checkIntervalMs);

console.log('🤖 Schoolmate AI Bot запущений і готовий до роботи...');
