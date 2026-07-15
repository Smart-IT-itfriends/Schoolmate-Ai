require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { getSubjectsForClass, getAllSubjects } = require('./subjects');
const userService = require('./services/userService');
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
  const session = getSession(userId);

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
    saveSession(userId, session);

    bot.sendMessage(
      chatId,
      `Чудово, ${session.name}! 🎓\nТи у ${classNum}-му класі.\n\nОсь твої шкільні предмети:`
    );

    showSubjectsMenu(chatId, session);
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
    userStates[chatId] = session.selectedSubject ? 'subject_selected' : 'main_menu';

    bot.sendMessage(chatId, config.messages.createTest, {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    });
    return;
  }

  if (text === '📈 Мій прогрес') {
    userStates[chatId] = 'viewing_progress';
    bot.sendMessage(chatId, buildProgressMessage(session), {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [['⬅️ Повернутися в меню']],
        resize_keyboard: true,
      },
    });
    return;
  }

  if (text === '👤 Мій профіль') {
    userStates[chatId] = 'viewing_profile';
    bot.sendMessage(chatId, buildProfileMessage(session), {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [['⬅️ Повернутися в меню']],
        resize_keyboard: true,
      },
    });
    return;
  }

  if (text === '🎁 Забрати нагороду') {
    const today = getTodayDateString();
    if (session.lastRewardClaimedDate === today) {
      bot.sendMessage(chatId, config.messages.rewardAlreadyClaimed, backKeyboard);
      return;
    }

    const newStreak = session.lastRewardClaimedDate === new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      ? (session.dailyStreak || 0) + 1
      : 1;

    const reward = getDailyReward(newStreak);
    session.xp = (session.xp || 0) + reward.amount;
    session.lastRewardClaimedDate = today;
    session.dailyStreak = newStreak;
    saveSession(userId, session);

    bot.sendMessage(chatId, '📦 Відкриваємо скриню...');
    setTimeout(() => {
      bot.sendMessage(chatId, '✨ ...', { parse_mode: 'HTML' });
    }, 800);
    setTimeout(() => {
      bot.sendMessage(
        chatId,
        `🎁 <b>Знайдено ${reward.text}!</b>\n\nТвій прогрес оновлено. Тепер у тебе <b>${session.xp}</b> XP.`,
        { parse_mode: 'HTML', ...backKeyboard }
      );
    }, 1600);

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
    session.totalAiRequests = (session.totalAiRequests || 0) + 1;
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
  console.error('Polling error:', error);
});

console.log('🤖 Schoolmate AI Bot запущений і готовий до роботи...');
