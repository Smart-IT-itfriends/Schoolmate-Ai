const https = require('https');
const http = require('http');
const { getActionKeyboard, backKeyboard } = require('../keyboards');
const { askAI, AIServiceError } = require('../services/aiService');
const userService = require('../services/userService');
const leaderboardService = require('../services/leaderboardService');
const questHandler = require('./quests');

const OPTION_LABELS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
const ALLOWED_COUNTS = [3, 5, 7, 10];
const DIFFICULTIES = {
  easy: 'легкий',
  medium: 'середній',
  hard: 'складний',
};

/** In-memory quiz sessions keyed by chatId. Extensible for future question types. */
const quizSessions = {};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clearQuizSession(chatId) {
  delete quizSessions[chatId];
}

function getQuizSession(chatId) {
  return quizSessions[chatId] || null;
}

function startCreateTest(bot, chatId, session, userStates, config) {
  clearQuizSession(chatId);
  quizSessions[chatId] = {
    subject: session.selectedSubject || null,
    grade: session.class || null,
    material: null,
    questionCount: null,
    difficulty: null,
    questions: [],
    currentIndex: 0,
    score: 0,
    answered: false,
  };

  userStates[chatId] = 'quiz_ask_topic';

  bot.sendMessage(chatId, config.messages.quizAskTopic, {
    parse_mode: 'HTML',
    ...backKeyboard,
  });
}

function buildCountKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '3', callback_data: 'quiz_count:3' },
        { text: '5', callback_data: 'quiz_count:5' },
        { text: '7', callback_data: 'quiz_count:7' },
        { text: '10', callback_data: 'quiz_count:10' },
      ],
      [{ text: '❌ Скасувати', callback_data: 'quiz_cancel' }],
    ],
  };
}

function buildDifficultyKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🟢 Легкий', callback_data: 'quiz_diff:easy' },
        { text: '🟡 Середній', callback_data: 'quiz_diff:medium' },
        { text: '🔴 Складний', callback_data: 'quiz_diff:hard' },
      ],
      [{ text: '❌ Скасувати', callback_data: 'quiz_cancel' }],
    ],
  };
}

function buildAnswerKeyboard(questionIndex, optionsLength) {
  const rows = [];
  const row = [];

  for (let i = 0; i < optionsLength; i += 1) {
    row.push({
      text: OPTION_LABELS[i] || String(i + 1),
      callback_data: `quiz_ans:${questionIndex}:${i}`,
    });
  }

  rows.push(row);
  rows.push([{ text: '⏹ Зупинити тест', callback_data: 'quiz_stop' }]);

  return { inline_keyboard: rows };
}

function extractJson(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response does not contain JSON object');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeQuestions(rawQuestions, expectedCount) {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('Empty questions array');
  }

  const questions = rawQuestions
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const question = String(item.question || '').trim();
      const options = Array.isArray(item.options)
        ? item.options.map((opt) => String(opt || '').trim()).filter(Boolean)
        : [];

      let correctIndex = Number(item.correctIndex);
      if (Number.isNaN(correctIndex) && typeof item.correctAnswer === 'string') {
        correctIndex = options.findIndex(
          (opt) => opt.toLowerCase() === item.correctAnswer.trim().toLowerCase()
        );
      }

      if (
        !question ||
        options.length < 2 ||
        !Number.isInteger(correctIndex) ||
        correctIndex < 0 ||
        correctIndex >= options.length
      ) {
        return null;
      }

      return {
        type: item.type === 'open' ? 'open' : 'multiple_choice',
        question,
        options: options.slice(0, 6),
        correctIndex: Math.min(correctIndex, Math.min(options.length, 6) - 1),
        explanation: item.explanation ? String(item.explanation).trim() : '',
      };
    })
    .filter(Boolean)
    .filter((q) => q.type === 'multiple_choice')
    .slice(0, expectedCount);

  if (questions.length === 0) {
    throw new Error('No valid multiple-choice questions parsed');
  }

  return questions;
}

async function generateQuizFromAi({ subject, grade, material, questionCount, difficulty }) {
  const difficultyLabel = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;

  const prompt = [
    'Ти — шкільний помічник. Згенеруй навчальний тест українською мовою.',
    subject ? `Предмет: ${subject}.` : '',
    grade ? `Клас: ${grade}.` : '',
    `Рівень складності: ${difficultyLabel}.`,
    `Кількість запитань: рівно ${questionCount}.`,
    'Матеріал / тема:',
    material,
    '',
    'Вимоги:',
    '- Кожне запитання має тип multiple_choice.',
    '- У кожного запитання 4 варіанти відповідей.',
    '- Рівно одна правильна відповідь (correctIndex — індекс від 0).',
    '- Додай коротке explanation до правильної відповіді (для майбутнього показу).',
    '- Не дублюй запитання.',
    '- Відповідь ОБОВ\'ЯЗКОВО лише валідний JSON без зайвого тексту:',
    '{',
    '  "questions": [',
    '    {',
    '      "type": "multiple_choice",',
    '      "question": "...",',
    '      "options": ["...", "...", "...", "..."],',
    '      "correctIndex": 0,',
    '      "explanation": "..."',
    '    }',
    '  ]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');

  const aiText = await askAI(prompt);
  const parsed = extractJson(aiText);
  return normalizeQuestions(parsed.questions, questionCount);
}

function formatQuestionMessage(quiz, index) {
  const question = quiz.questions[index];
  const total = quiz.questions.length;
  const optionsText = question.options
    .map((opt, i) => `<b>${OPTION_LABELS[i] || i + 1}.</b> ${escapeHtml(opt)}`)
    .join('\n');

  return [
    `🧠 <b>Тест</b> — запитання ${index + 1}/${total}`,
    quiz.subject ? `Предмет: <b>${escapeHtml(quiz.subject)}</b>` : null,
    '',
    escapeHtml(question.question),
    '',
    optionsText,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

async function sendCurrentQuestion(bot, chatId, quiz) {
  const index = quiz.currentIndex;
  quiz.answered = false;

  await bot.sendMessage(chatId, formatQuestionMessage(quiz, index), {
    parse_mode: 'HTML',
    reply_markup: buildAnswerKeyboard(index, quiz.questions[index].options.length),
  });
}

function isDoubleXpActive(session) {
  if (!session || session.activeBuff !== 'DoubleXP') {
    return false;
  }

  if (!session.buffExpiresAt) {
    return true;
  }

  return new Date(session.buffExpiresAt).getTime() > Date.now();
}

async function finishQuiz(bot, chatId, userId, session, userStates, config, saveSession, stoppedEarly) {
  const quiz = quizSessions[chatId];
  if (!quiz) {
    userStates[chatId] = session.selectedSubject ? 'subject_selected' : 'main_menu';
    return;
  }

  const total = quiz.questions.length;
  const score = quiz.score;
  const answeredCount = quiz.currentIndex + (quiz.answered ? 1 : 0);
  const baseXp = score * (config.quiz?.xpPerCorrect || 5);
  const doubleXp = isDoubleXpActive(session);
  const earnedXp = doubleXp ? baseXp * 2 : baseXp;

  session.xp = (session.xp || 0) + earnedXp;
  leaderboardService.recordXpChange(session, earnedXp);
  userService.recordTestCompleted(session);

  if (doubleXp && earnedXp > 0) {
    delete session.activeBuff;
    delete session.buffExpiresAt;
  }

  saveSession(userId, session);

  if (!stoppedEarly) {
    questHandler.applyQuestTrigger(bot, chatId, userId, 'complete_test', session, saveSession);
  }

  clearQuizSession(chatId);
  userStates[chatId] = session.selectedSubject ? 'subject_selected' : 'main_menu';

  const title = stoppedEarly
    ? config.messages.quizStopped
    : config.messages.quizFinished;

  const message = [
    title,
    '',
    `✅ Правильних: <b>${score}</b> / <b>${total}</b>`,
    stoppedEarly ? `Відповіли на: <b>${Math.min(answeredCount, total)}</b> з ${total}` : null,
    `🏅 XP за тест: <b>+${earnedXp}</b>${doubleXp ? ' (x2 бонус)' : ''}`,
    `Твій XP зараз: <b>${session.xp}</b>`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  await bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    ...getActionKeyboard(session),
  });
}

async function generateAndStartQuiz(bot, chatId, userId, session, userStates, config, saveSession) {
  const quiz = quizSessions[chatId];
  if (!quiz || !quiz.material || !quiz.questionCount || !quiz.difficulty) {
    await bot.sendMessage(chatId, config.messages.quizGenerateError, getActionKeyboard(session));
    clearQuizSession(chatId);
    userStates[chatId] = session.selectedSubject ? 'subject_selected' : 'main_menu';
    return;
  }

  userStates[chatId] = 'quiz_generating';
  await bot.sendMessage(chatId, config.messages.quizGenerating, { parse_mode: 'HTML' });

  try {
    session.totalAiRequests = (session.totalAiRequests || 0) + 1;
    saveSession(userId, session);

    const questions = await generateQuizFromAi({
      subject: quiz.subject,
      grade: quiz.grade,
      material: quiz.material,
      questionCount: quiz.questionCount,
      difficulty: quiz.difficulty,
    });

    quiz.questions = questions;
    quiz.currentIndex = 0;
    quiz.score = 0;
    quiz.answered = false;
    userStates[chatId] = 'quiz_taking';

    await bot.sendMessage(
      chatId,
      config.messages.quizReady
        .replace('{count}', String(questions.length))
        .replace('{difficulty}', DIFFICULTIES[quiz.difficulty] || quiz.difficulty),
      { parse_mode: 'HTML' }
    );

    await sendCurrentQuestion(bot, chatId, quiz);
  } catch (error) {
    console.error('Create test error:', error);
    clearQuizSession(chatId);
    userStates[chatId] = session.selectedSubject ? 'subject_selected' : 'main_menu';

    const message =
      error instanceof AIServiceError
        ? config.messages.quizGenerateError
        : config.messages.quizGenerateError;

    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    });
  }
}

function askForCount(bot, chatId, config) {
  bot.sendMessage(chatId, config.messages.quizAskCount, {
    parse_mode: 'HTML',
    reply_markup: buildCountKeyboard(),
  });
}

function askForDifficulty(bot, chatId, config) {
  bot.sendMessage(chatId, config.messages.quizAskDifficulty, {
    parse_mode: 'HTML',
    reply_markup: buildDifficultyKeyboard(),
  });
}

function acceptTopicMaterial(bot, chatId, material, userStates, config) {
  const quiz = quizSessions[chatId];
  if (!quiz) {
    return false;
  }

  const trimmed = String(material || '').trim();
  if (trimmed.length < 2) {
    bot.sendMessage(chatId, config.messages.quizTopicTooShort);
    return true;
  }

  quiz.material = trimmed.slice(0, 8000);
  userStates[chatId] = 'quiz_ask_count';
  askForCount(bot, chatId, config);
  return true;
}

function downloadTelegramFile(bot, fileId) {
  return bot.getFile(fileId).then((file) => {
    const token = bot.token || process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to download file: ${res.statusCode}`));
            res.resume();
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        })
        .on('error', reject);
    });
  });
}

async function handleQuizDocument(bot, msg, session, userStates, config) {
  const chatId = msg.chat.id;
  if (userStates[chatId] !== 'quiz_ask_topic') {
    return false;
  }

  const doc = msg.document;
  if (!doc) {
    return false;
  }

  const fileName = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  const isTextLike =
    mime.startsWith('text/') ||
    fileName.endsWith('.txt') ||
    fileName.endsWith('.md') ||
    fileName.endsWith('.csv');

  if (!isTextLike) {
    await bot.sendMessage(chatId, config.messages.quizUnsupportedFile, {
      parse_mode: 'HTML',
    });
    return true;
  }

  if (doc.file_size && doc.file_size > 200 * 1024) {
    await bot.sendMessage(chatId, config.messages.quizFileTooLarge);
    return true;
  }

  try {
    await bot.sendMessage(chatId, config.messages.quizReadingFile);
    const buffer = await downloadTelegramFile(bot, doc.file_id);
    const text = buffer.toString('utf8').trim();

    if (text.length < 2) {
      await bot.sendMessage(chatId, config.messages.quizTopicTooShort);
      return true;
    }

    acceptTopicMaterial(bot, chatId, text, userStates, config);
  } catch (error) {
    console.error('Quiz document error:', error);
    await bot.sendMessage(chatId, config.messages.quizFileReadError);
  }

  return true;
}

function handleQuizMessage(bot, chatId, userId, text, session, userStates, config, saveSession) {
  const state = userStates[chatId];
  if (!state || !String(state).startsWith('quiz_')) {
    return false;
  }

  // Let bot.js handle navigation so the user can exit the quiz flow.
  if (text === '⬅️ Повернутися в меню' || text === '📋 Головне меню') {
    return false;
  }

  if (state === 'quiz_generating' || state === 'quiz_taking') {
    bot.sendMessage(
      chatId,
      state === 'quiz_generating'
        ? config.messages.quizWaitGenerating
        : config.messages.quizUseButtons,
      { parse_mode: 'HTML' }
    );
    return true;
  }

  if (state === 'quiz_ask_topic') {
    return acceptTopicMaterial(bot, chatId, text, userStates, config);
  }

  if (state === 'quiz_ask_count') {
    const count = parseInt(text, 10);
    if (!ALLOWED_COUNTS.includes(count)) {
      bot.sendMessage(chatId, config.messages.quizAskCount, {
        parse_mode: 'HTML',
        reply_markup: buildCountKeyboard(),
      });
      return true;
    }

    quizSessions[chatId].questionCount = count;
    userStates[chatId] = 'quiz_ask_difficulty';
    askForDifficulty(bot, chatId, config);
    return true;
  }

  if (state === 'quiz_ask_difficulty') {
    const normalized = text.trim().toLowerCase();
    const map = {
      легкий: 'easy',
      easy: 'easy',
      середній: 'medium',
      средний: 'medium',
      medium: 'medium',
      складний: 'hard',
      сложный: 'hard',
      hard: 'hard',
    };

    const difficulty = map[normalized];
    if (!difficulty) {
      bot.sendMessage(chatId, config.messages.quizAskDifficulty, {
        parse_mode: 'HTML',
        reply_markup: buildDifficultyKeyboard(),
      });
      return true;
    }

    quizSessions[chatId].difficulty = difficulty;
    generateAndStartQuiz(bot, chatId, userId, session, userStates, config, saveSession).catch(
      (error) => console.error('Quiz generate error:', error)
    );
    return true;
  }

  return false;
}

async function handleQuizCallback(bot, query, session, userStates, config, saveSession) {
  const data = query.data || '';
  if (!data.startsWith('quiz_')) {
    return false;
  }

  const chatId = query.message.chat.id;
  const userId = query.from.id;

  if (data === 'quiz_cancel') {
    clearQuizSession(chatId);
    userStates[chatId] = session?.selectedSubject ? 'subject_selected' : 'main_menu';
    await bot.answerCallbackQuery(query.id, { text: 'Скасовано' });
    await bot.sendMessage(chatId, config.messages.quizCancelled, getActionKeyboard(session));
    return true;
  }

  if (data === 'quiz_stop') {
    await bot.answerCallbackQuery(query.id);
    await finishQuiz(bot, chatId, userId, session, userStates, config, saveSession, true);
    return true;
  }

  if (data.startsWith('quiz_count:')) {
    const count = parseInt(data.split(':')[1], 10);
    if (!ALLOWED_COUNTS.includes(count) || !quizSessions[chatId]) {
      await bot.answerCallbackQuery(query.id, { text: 'Обери кількість ще раз' });
      return true;
    }

    quizSessions[chatId].questionCount = count;
    userStates[chatId] = 'quiz_ask_difficulty';
    await bot.answerCallbackQuery(query.id, { text: `${count} запитань` });
    askForDifficulty(bot, chatId, config);
    return true;
  }

  if (data.startsWith('quiz_diff:')) {
    const difficulty = data.split(':')[1];
    if (!DIFFICULTIES[difficulty] || !quizSessions[chatId]) {
      await bot.answerCallbackQuery(query.id, { text: 'Обери складність ще раз' });
      return true;
    }

    quizSessions[chatId].difficulty = difficulty;
    await bot.answerCallbackQuery(query.id, { text: DIFFICULTIES[difficulty] });
    await generateAndStartQuiz(bot, chatId, userId, session, userStates, config, saveSession);
    return true;
  }

  if (data.startsWith('quiz_ans:')) {
    const parts = data.split(':');
    const questionIndex = parseInt(parts[1], 10);
    const answerIndex = parseInt(parts[2], 10);
    const quiz = quizSessions[chatId];

    if (!quiz || userStates[chatId] !== 'quiz_taking') {
      await bot.answerCallbackQuery(query.id, { text: 'Тест уже завершено' });
      return true;
    }

    if (quiz.answered || questionIndex !== quiz.currentIndex) {
      await bot.answerCallbackQuery(query.id, { text: 'Це запитання вже пройдено' });
      return true;
    }

    const question = quiz.questions[questionIndex];
    if (!question || answerIndex < 0 || answerIndex >= question.options.length) {
      await bot.answerCallbackQuery(query.id, { text: 'Невірна відповідь' });
      return true;
    }

    quiz.answered = true;
    const isCorrect = answerIndex === question.correctIndex;

    if (isCorrect) {
      quiz.score += 1;
    }

    const correctLabel = OPTION_LABELS[question.correctIndex] || String(question.correctIndex + 1);
    const feedback = isCorrect
      ? config.messages.quizAnswerCorrect
      : config.messages.quizAnswerWrong.replace('{answer}', correctLabel);

    const explanation = question.explanation
      ? `\n\n💡 ${escapeHtml(question.explanation)}`
      : '';

    await bot.answerCallbackQuery(query.id, {
      text: isCorrect ? 'Правильно!' : 'Неправильно',
    });

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: query.message.message_id }
    ).catch(() => {});

    await bot.sendMessage(chatId, `${feedback}${explanation}`, { parse_mode: 'HTML' });

    if (quiz.currentIndex >= quiz.questions.length - 1) {
      await finishQuiz(bot, chatId, userId, session, userStates, config, saveSession, false);
      return true;
    }

    quiz.currentIndex += 1;
    await sendCurrentQuestion(bot, chatId, quiz);
    return true;
  }

  return false;
}

module.exports = {
  startCreateTest,
  handleQuizMessage,
  handleQuizCallback,
  handleQuizDocument,
  clearQuizSession,
  getQuizSession,
  ALLOWED_COUNTS,
  DIFFICULTIES,
};
