# Schoolmate AI - Telegram Bot 🤖

Освітній Telegram бот для допомоги студентам з навчанням.

## Функції 📚

- **📚 Пояснити тему** - Отримуй пояснення будь-якої теми
- **📝 Підготовка до контрольної** - Матеріали для підготовки до контрольної роботи
- **🧠 Створити тест** - Генеруй тести для тренування
- **📈 Мій прогрес** - Перегляд своєї статистики
- **⚙️ Допомога** - Довідка по боту

## Установка 💻

### Вимоги
- Node.js (версія 20+)
- npm або yarn
- Токен Telegram бота (від @BotFather)

### Кроки установки

1. **Клонуй репозиторій**
   ```bash
   git clone <your-repo-url>
   cd Schoolmate-Ai
   ```

2. **Встанови залежності**
   ```bash
   npm install
   ```

3. **Отримай токен бота**
   - Йди до [@BotFather](https://t.me/botfather) на Telegram
   - Введи `/newbot`
   - Слідуй інструкціям
   - Скопіюй токен

4. **Налаштуй середовище**
   - Відкрий файл `.env`
   - Замість `YOUR_BOT_TOKEN_HERE` вставь твій токен:
    ```
    TELEGRAM_TOKEN=123456789:ABCdefGHIjklmNOpqrsTUvwxYZ
    GEMINI_API_KEY=your_gemini_api_key_here
    ```

5. **Перевір AI Service**
   ```bash
   node scripts/test-ai.js
   ```

   Якщо `GEMINI_API_KEY` не задано, скрипт пропустить реальний API-виклик.

6. **Запусти бота**
   ```bash
   npm start
   ```

   Для розробки з auto-reload:
   ```bash
   npm run dev
   ```

## Використання 🚀

Після запуску бота:
1. Йди до Telegram
2. Знайди свого бота за допомогою @username
3. Натисни `/start`
4. Вибирай опції з меню

## Структура проекту 📂

```
Schoolmate-Ai/
├── bot.js           # Головна логіка бота
├── config.js        # Конфігурація та повідомлення
├── package.json     # Залежності проекту
├── .env             # Переменні середовища
├── .env.example     # Приклад .env файлу
└── README.md        # Цей файл
```

## Залежності 📦

- `node-telegram-bot-api` - Бібліотека для роботи з Telegram API
- `dotenv` - Завантаження змінних з .env файлу

## Розробка 🛠️

### Додавання нових команд

Відкрий `bot.js` і додай новий обробник:
```javascript
bot.onText(/\/mynewcommand/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Відповідь на команду');
});
```

### Додавання нових кнопок

В `bot.js` оновлюй `mainKeyboard`:
```javascript
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['Кнопка 1', 'Кнопка 2'],
      ['Кнопка 3']
    ],
    resize_keyboard: true
  }
};
```

## Налаштування 🔧

Все настройки повідомлень та конфігурації знаходяться в `config.js`. Ти можеш змінити:
- Текст повідомлень
- Відповіді бота
- Мови та форматування

## Помилки та вирішення 🐛

**Помилка: "Could not connect to Telegram"**
- Перевір токен в `.env`
- Переконайся, що у тебе є інтернет

**Помилка: "Cannot find module 'node-telegram-bot-api'"**
- Запусти `npm install`

## Ліцензія 📄

MIT License - див. файл LICENSE

## Автор 👨‍💻

Schoolmate AI Team

---

**Потрібна допомога?** 
- Документація [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- [Telegram Bot API](https://core.telegram.org/bots)
