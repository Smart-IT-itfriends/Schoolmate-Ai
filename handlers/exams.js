const examService = require('../services/examService');
const { processExamReminders } = require('../services/examScheduler');
const { backKeyboard } = require('../keyboards');
const questHandler = require('./quests');

function getUserTimezone(session) {
  return session?.timezone || 'Europe/Kyiv';
}

function buildExamListKeyboard(exams) {
  const rows = exams.map((exam) => [
    { text: `✏️ ${exam.title.slice(0, 18)}`, callback_data: `exam_edit:${exam.id}` },
    { text: '📅 Дата', callback_data: `exam_editdate:${exam.id}` },
    { text: '🗑', callback_data: `exam_delete:${exam.id}` },
  ]);

  rows.push([{ text: '⬅️ Закрити', callback_data: 'exam_close' }]);

  return { inline_keyboard: rows };
}

function formatExamList(exams, timezone) {
  if (exams.length === 0) {
    return null;
  }

  return exams
    .map((exam, index) => {
      const date = examService.formatExamDate(exam.scheduledAt, exam.timezone || timezone);
      return `${index + 1}. <b>${exam.title}</b>\n   📅 ${date}`;
    })
    .join('\n\n');
}

function startAddExam(bot, chatId, userStates) {
  userStates[chatId] = 'exam_add_title';
  bot.sendMessage(chatId, '📝 <b>Додати контрольну роботу</b>\n\nВведи назву КР (наприклад: <i>КР з Математики</i>):\n\n<i>Скасувати: натисни «⬅️ Повернутися в меню»</i>', {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

function showMyExams(bot, chatId, userId, session, config) {
  const timezone = getUserTimezone(session);
  const exams = examService.getUpcomingExamsByUser(userId);

  if (exams.length === 0) {
    bot.sendMessage(chatId, config.messages.examListEmpty, backKeyboard);
    return;
  }

  const list = formatExamList(exams, timezone);
  bot.sendMessage(chatId, `${config.messages.examListTitle}\n\n${list}\n\n${config.messages.examListHint}`, {
    parse_mode: 'HTML',
    reply_markup: buildExamListKeyboard(exams),
  });
}

function handleExamMessage(bot, chatId, userId, text, session, userStates, config, saveSession) {
  const state = userStates[chatId];
  if (!state || !state.startsWith('exam_')) {
    return false;
  }

  const timezone = getUserTimezone(session);

  if (state === 'exam_add_title') {
    if (text.length < 2) {
      bot.sendMessage(chatId, config.messages.examTitleTooShort);
      return true;
    }

    session.examDraft = { title: text.trim() };
    userStates[chatId] = 'exam_add_date';
    saveSession(userId, session);

    bot.sendMessage(
      chatId,
      config.messages.examAskDate.replace('{timezone}', timezone),
      { parse_mode: 'HTML' }
    );
    return true;
  }

  if (state === 'exam_add_date') {
    const parsed = examService.parseExamDate(text, timezone);

    if (!parsed.valid) {
      const errorMessage =
        parsed.error === 'past' ? config.messages.examDatePast : config.messages.examDateInvalid;
      bot.sendMessage(chatId, errorMessage);
      return true;
    }

    const exam = examService.createExam({
      userId,
      chatId,
      title: session.examDraft.title,
      scheduledAt: parsed.scheduledAt,
      timezone,
    });

    delete session.examDraft;
    delete userStates[chatId];
    saveSession(userId, session);

    const formattedDate = examService.formatExamDate(exam.scheduledAt, timezone);
    bot.sendMessage(
      chatId,
      config.messages.examCreated
        .replace('{title}', exam.title)
        .replace('{date}', formattedDate),
      { parse_mode: 'HTML', ...backKeyboard }
    );

    questHandler.applyQuestTrigger(bot, chatId, userId, 'create_exam', session, saveSession);

    processExamReminders(bot, config, (telegramBot, targetChatId, message) => {
      telegramBot.sendMessage(targetChatId, message, { parse_mode: 'HTML' });
    });

    return true;
  }

  if (state.startsWith('exam_edit_title:')) {
    const examId = state.split(':')[1];
    const exam = examService.getExamById(examId);

    if (!exam || String(exam.userId) !== String(userId)) {
      delete userStates[chatId];
      bot.sendMessage(chatId, config.messages.examNotFound, backKeyboard);
      return true;
    }

    if (text.length < 2) {
      bot.sendMessage(chatId, config.messages.examTitleTooShort);
      return true;
    }

    examService.updateExam(examId, userId, { title: text.trim() });
    delete userStates[chatId];

    bot.sendMessage(chatId, config.messages.examUpdated.replace('{title}', text.trim()), {
      parse_mode: 'HTML',
      ...backKeyboard,
    });
    return true;
  }

  if (state.startsWith('exam_edit_date:')) {
    const examId = state.split(':')[1];
    const exam = examService.getExamById(examId);

    if (!exam || String(exam.userId) !== String(userId)) {
      delete userStates[chatId];
      bot.sendMessage(chatId, config.messages.examNotFound, backKeyboard);
      return true;
    }

    const parsed = examService.parseExamDate(text, exam.timezone || timezone);

    if (!parsed.valid) {
      const errorMessage =
        parsed.error === 'past' ? config.messages.examDatePast : config.messages.examDateInvalid;
      bot.sendMessage(chatId, errorMessage);
      return true;
    }

    examService.updateExam(examId, userId, {
      scheduledAt: parsed.scheduledAt.toISOString(),
      notified2d: false,
      notified1d: false,
      notified2h: false,
    });
    delete userStates[chatId];

    const formattedDate = examService.formatExamDate(parsed.scheduledAt.toISOString(), exam.timezone);
    bot.sendMessage(
      chatId,
      config.messages.examDateUpdated.replace('{date}', formattedDate),
      { parse_mode: 'HTML', ...backKeyboard }
    );
    return true;
  }

  return false;
}

function handleExamCallback(bot, query, session, userStates, config) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  if (data === 'exam_close') {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
    return true;
  }

  if (data.startsWith('exam_edit:')) {
    const examId = data.split(':')[1];
    const exam = examService.getExamById(examId);

    if (!exam || String(exam.userId) !== String(userId)) {
      bot.answerCallbackQuery(query.id, { text: config.messages.examNotFound });
      return true;
    }

    userStates[chatId] = `exam_edit_title:${examId}`;
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
      config.messages.examEditTitle.replace('{title}', exam.title),
      { parse_mode: 'HTML' }
    );
    return true;
  }

  if (data.startsWith('exam_editdate:')) {
    const examId = data.split(':')[1];
    const exam = examService.getExamById(examId);

    if (!exam || String(exam.userId) !== String(userId)) {
      bot.answerCallbackQuery(query.id, { text: config.messages.examNotFound });
      return true;
    }

    userStates[chatId] = `exam_edit_date:${examId}`;
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
      config.messages.examAskDate.replace('{timezone}', exam.timezone || getUserTimezone(session)),
      { parse_mode: 'HTML' }
    );
    return true;
  }

  if (data.startsWith('exam_delete:')) {
    const examId = data.split(':')[1];
    const exam = examService.getExamById(examId);

    if (!exam || String(exam.userId) !== String(userId)) {
      bot.answerCallbackQuery(query.id, { text: config.messages.examNotFound });
      return true;
    }

    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, config.messages.examDeleteConfirm.replace('{title}', exam.title), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Так, видалити', callback_data: `exam_delete_confirm:${examId}` },
            { text: '❌ Скасувати', callback_data: 'exam_close' },
          ],
        ],
      },
    });
    return true;
  }

  if (data.startsWith('exam_delete_confirm:')) {
    const examId = data.split(':')[1];
    const deleted = examService.deleteExam(examId, userId);

    bot.answerCallbackQuery(query.id, {
      text: deleted ? config.messages.examDeletedShort : config.messages.examNotFound,
    });

    if (deleted) {
      bot.sendMessage(chatId, config.messages.examDeleted, backKeyboard);
    }
    return true;
  }

  return false;
}

module.exports = {
  startAddExam,
  showMyExams,
  handleExamMessage,
  handleExamCallback,
};
