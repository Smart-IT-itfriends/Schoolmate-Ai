const { askAI } = require('../services/aiService');

async function handleCheatsheetTopic(topic, session) {
  const prompt = [
    'Напиши коротку шпаргалку українською мовою для школяра.',
    session.selectedSubject ? `Предмет: ${session.selectedSubject}.` : '',
    `Тема: ${topic}`,
    'Опиши основні поняття, формули або правила у вигляді простого списку або пунктів.',
    'Додай короткий приклад або ілюстрацію, як застосувати матеріал.',
  ]
    .filter(Boolean)
    .join('\n');

  const cheatsheet = await askAI(prompt);
  return cheatsheet;
}

module.exports = { handleCheatsheetTopic };
