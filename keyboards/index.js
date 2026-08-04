const { getSubjectsForClass } = require('../subjects');

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['📚 Навчання', '🏆 Нагороди'],
      ['🎮 Розваги', '⚙️ Сервіс'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

const educationKeyboard = {
  reply_markup: {
    keyboard: [
      ['📚 Пояснити тему', '📄 Шпаргалка'],
      ['🧠 Створити тест', '⚔️ Дуель знань'],
      ['📊 Статистика', '📈 Мій прогрес', '👤 Мій профіль'],
      ['🏆 Квести', '📖 Предмети', '📝 Додати КР'],
      ['📅 Мої КР', '📂 Мої шпаргалки'],
      ['⬅️ Назад'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

const rewardsKeyboard = {
  reply_markup: {
    keyboard: [
      ['🎁 Забрати нагороду', '🎡 Щоденна рулетка', '⭐ Premium'],
      ['🏆 Лідерборд', '⬅️ Назад'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

const entertainmentKeyboard = {
  reply_markup: {
    keyboard: [
      ['👥 Запросити друга', '🌐 Глобальний чат', '🎰 Рулетка XP'],
      ['🃏 Покер', '⚙️ Допомога', '⬅️ Назад'],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

const serviceKeyboard = {
  reply_markup: {
    keyboard: [
      ['⚙️ Допомога', '💬 Підтримка / Запитання', '🔄 Перереєструватися'],
      ['⬅️ Назад'],
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
        ['📚 Пояснити тему', '📄 Шпаргалка'],
        ['🧠 Створити тест', '⚔️ Дуель знань'],
        ['📋 Головне меню'],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

function getActionKeyboard(session) {
  if (session && session.selectedSubject) {
    return buildSubjectActionKeyboard();
  }

  return backKeyboard;
}

function buildSubjectsKeyboard(classNum) {
  const subjects = getSubjectsForClass(classNum);
  const rows = [];

  for (let i = 0; i < subjects.length; i += 2) {
    rows.push(subjects.slice(i, i + 2));
  }

  rows.push(['📝 Додати КР', '📅 Мої КР']);
  rows.push(['📋 Головне меню', '🔄 Перереєструватися']);

  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

module.exports = {
  mainKeyboard,
  educationKeyboard,
  rewardsKeyboard,
  entertainmentKeyboard,
  serviceKeyboard,
  backKeyboard,
  getActionKeyboard,
  buildSubjectActionKeyboard,
  buildSubjectsKeyboard,
};
