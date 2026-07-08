require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { getSubjectsForClass, getAllSubjects } = require('./subjects');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const token = process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN;

if (!token) {
  console.error('Помилка: встановіть TELEGRAM_TOKEN у файлі .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const userStates = {};
const allSubjects = getAllSubjects();

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['📚 Пояснити тему', '🧠 Створити тест'],
      ['📈 Мій прогрес', '📖 Предмети'],
      ['⚙️ Допомога', '🔄 Перереєструватися'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

const backKeyboard = {
  reply_markup: {
    keyboard: [['⬅️ Повернутися в меню']],
    resize_keyboard: true,
  },
};

function buildSubjectActionKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['📚 Пояснити тему', '🧠 Створити тест'],
        ['📋 Головне меню'],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

function getActionKeyboard(session) {
  if (session.selectedSubject) {
    return buildSubjectActionKeyboard();
  }

  return backKeyboard;
}

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function getSession(userId) {
  const users = loadUsers();
  return users[String(userId)] || null;
}

function saveSession(userId, session) {
  const users = loadUsers();
  users[String(userId)] = session;
  saveUsers(users);
}

function buildSubjectsKeyboard(classNum) {
  const subjects = getSubjectsForClass(classNum);
  const rows = [];

  for (let i = 0; i < subjects.length; i += 2) {
    rows.push(subjects.slice(i, i + 2));
  }

  rows.push(['📋 Головне меню', '🔄 Перереєструватися']);

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
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

function startRegistration(chatId, user, isReregister = false) {
  delete userStates[chatId];

  const session = {
    step: 'name',
    name: null,
    class: null,
    selectedSubject: null,
    telegramId: user.id,
    username: user.username || null,
    startedAt: new Date().toISOString(),
  };

  saveSession(user.id, session);

  const message = isReregister
    ? '🔄 Давай оновимо твої дані.\n\nЯк тебе звати?'
    : '👋 Привіт! Я Schoolmate AI.\n\nЯк тебе звати?';

  bot.sendMessage(chatId, message, {
    reply_markup: { remove_keyboard: true },
  });
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
    showSubjectsMenu(chatId, session);
    return;
  }

  startRegistration(chatId, user);
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
    startRegistration(chatId, msg.from, true);
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
    bot.sendMessage(chatId, config.messages.myProgress, backKeyboard);
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
    handleExplainTopic(chatId, text, session);
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

function handleExplainTopic(chatId, topic, session) {
  const subject = session.selectedSubject ? ` (${session.selectedSubject})` : '';
  userStates[chatId] = 'subject_selected';

  bot.sendMessage(
    chatId,
    `📚 <b>Пояснення теми${subject}: ${topic}</b>\n\nОсь основна інформація про цю тему:\n\n<i>Тут буде детальне пояснення від AI.</i>`,
    {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    }
  );
}

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('🤖 Schoolmate AI Bot запущений і готовий до роботи...');
