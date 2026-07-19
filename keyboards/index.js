const { getSubjectsForClass } = require('../subjects');

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['📚 Пояснити тему', '🧠 Створити тест'],
      ['📈 Мій прогрес', '👤 Мій профіль'],
      ['📝 Додати КР', '📅 Мої КР'],
      ['🎁 Забрати нагороду', '📖 Предмети'],
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
  backKeyboard,
  getActionKeyboard,
  buildSubjectActionKeyboard,
  buildSubjectsKeyboard,
};
