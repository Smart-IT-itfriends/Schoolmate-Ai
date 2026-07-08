require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('Помилка: встановіть BOT_TOKEN у файлі .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

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

function startRegistration(chatId, user) {
  const session = {
    step: 'name',
    name: null,
    class: null,
    telegramId: user.id,
    username: user.username || null,
    startedAt: new Date().toISOString(),
  };

  saveSession(user.id, session);

  bot.sendMessage(
    chatId,
    '👋 Привіт! Я Schoolmate AI.\n\nЯк тебе звати?'
  );
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  startRegistration(chatId, user);
});

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) {
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = getSession(userId);

  if (!session) {
    bot.sendMessage(chatId, 'Натисни /start, щоб почати.');
    return;
  }

  if (session.step === 'name') {
    const name = msg.text.trim();

    if (name.length < 2) {
      bot.sendMessage(chatId, 'Будь ласка, введи своє ім\'я (мінімум 2 символи).');
      return;
    }

    session.name = name;
    session.step = 'class';
    saveSession(userId, session);

    bot.sendMessage(
      chatId,
      `Приємно познайомитись, ${name}! 😊\n\nВ якому класі ти навчаєшся? (1–11)`
    );
    return;
  }

  if (session.step === 'class') {
    const classNum = parseInt(msg.text.trim(), 10);

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
      `Чудово, ${session.name}! 🎓\nТи у ${classNum}-му класі.\n\nРеєстрацію завершено. Можеш користуватись ботом!`
    );
  }
});

console.log('Бот запущено...');
