const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

// Create bot instance
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });

// Store user states
const userStates = {};

// Define keyboard buttons
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['📚 Пояснити тему', '📝 Підготовка до контрольної'],
      ['🧠 Створити тест', '📈 Мій прогрес'],
      ['⚙️ Допомога']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

const backKeyboard = {
  reply_markup: {
    keyboard: [
      ['⬅️ Повернутися в меню']
    ],
    resize_keyboard: true
  }
};

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    config.messages.start,
    mainKeyboard
  );
});

// Handle button presses
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '📚 Пояснити тему') {
    userStates[chatId] = 'explaining_topic';
    bot.sendMessage(
      chatId,
      config.messages.explainTopic,
      backKeyboard
    );
  }

  else if (text === '📝 Підготовка до контрольної') {
    userStates[chatId] = 'preparing_test';
    bot.sendMessage(
      chatId,
      config.messages.prepareTest,
      backKeyboard
    );
  }

  else if (text === '🧠 Створити тест') {
    userStates[chatId] = 'creating_test';
    bot.sendMessage(
      chatId,
      config.messages.createTest,
      backKeyboard
    );
  }

  else if (text === '📈 Мій прогрес') {
    userStates[chatId] = 'viewing_progress';
    bot.sendMessage(
      chatId,
      config.messages.myProgress,
      backKeyboard
    );
  }

  else if (text === '⚙️ Допомога') {
    userStates[chatId] = 'viewing_help';
    bot.sendMessage(
      chatId,
      config.messages.help,
      {
        reply_markup: {
          keyboard: [
            ['⬅️ Повернутися в меню']
          ],
          resize_keyboard: true
        }
      },
      { parse_mode: 'HTML' }
    );
  }

  else if (text === '⬅️ Повернутися в меню') {
    userStates[chatId] = 'main_menu';
    bot.sendMessage(
      chatId,
      'Ти повернувся до головного меню. Виберіть опцію:',
      mainKeyboard
    );
  }

  // Handle user input based on current state
  else if (userStates[chatId] === 'explaining_topic') {
    handleExplainTopic(chatId, text);
  }

  else if (userStates[chatId] === 'preparing_test') {
    handlePrepareTest(chatId, text);
  }

  else if (userStates[chatId] === 'creating_test') {
    handleCreateTest(chatId, text);
  }

  else if (text === '/start') {
    // Already handled above
    return;
  }

  else {
    // Default response
    bot.sendMessage(chatId, 'Коли ласка, виберіть опцію з меню.');
  }
});

// Handle "Explain Topic" flow
function handleExplainTopic(chatId, topic) {
  const response = `
📚 <b>Пояснення теми: ${topic}</b>

Ось основна інформація про цю тему:

<i>Це приклад пояснення. В реальному боті тут буде:
- Детальне описання теми
- Приклади
- Формули
- Посилання на ресурси</i>

Чи є у тебе ще якісь питання щодо цієї теми?
  `;
  
  bot.sendMessage(chatId, response, {
    parse_mode: 'HTML',
    ...backKeyboard
  });
}

// Handle "Prepare for Test" flow
function handlePrepareTest(chatId, subject) {
  const response = `
📝 <b>Матеріали для підготовки: ${subject}</b>

Матеріали для підготовки до контрольної:

• Основні поняття
• Теоретичні основи
• Типові завдання
• Тестові питання

Чи хочеш отримати детальніший матеріал?
  `;
  
  bot.sendMessage(chatId, response, {
    parse_mode: 'HTML',
    ...backKeyboard
  });
}

// Handle "Create Test" flow
function handleCreateTest(chatId, difficulty) {
  const response = `
🧠 <b>Створення тесту (${difficulty})</b>

Тест створюється...

Вибір предмету:
1️⃣ Математика
2️⃣ Українська мова
3️⃣ Історія
4️⃣ Англійська мова
5️⃣ Інший предмет

Вкажи номер предмету.
  `;
  
  bot.sendMessage(chatId, response, {
    parse_mode: 'HTML',
    ...backKeyboard
  });
}

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('🤖 Schoolmate AI Bot запущений і готовий до роботи...');
console.log('⏳ Чекаю повідомлень...');
