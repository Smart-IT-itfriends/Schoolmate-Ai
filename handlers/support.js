const supportService = require('../services/supportService');
const { buildBotKnowledge } = require('../services/supportKnowledge');
const { askAI, askAIWithMedia, AIServiceError } = require('../services/aiService');
const { downloadTelegramFile, guessMimeFromPath } = require('../services/telegramFiles');
const { mainKeyboard } = require('../keyboards');

const supportKeyboard = {
  reply_markup: {
    keyboard: [['❌ Скасувати звернення']],
    resize_keyboard: true,
  },
};

const TELEGRAM_TEXT_LIMIT = 3900;

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function splitMessage(text, limit = TELEGRAM_TEXT_LIMIT) {
  const source = String(text || '');
  if (source.length <= limit) {
    return [source];
  }

  const chunks = [];
  let remaining = source;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) {
      cut = limit;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function buildUserContext(session) {
  if (!session) {
    return '';
  }

  return [
    '',
    '## Профіль користувача (для персоналізації відповіді)',
    `Ім'я: ${session.name || 'невідомо'}`,
    `Клас: ${session.class || 'невідомо'}`,
    `Обраний предмет: ${session.selectedSubject || 'не обрано'}`,
    `XP: ${session.xp || 0}`,
    `Стрік: ${session.dailyStreak || 0}`,
    `Premium: ${session.premiumUntil && Date.parse(session.premiumUntil) > Date.now() ? 'активний' : 'неактивний'}`,
  ].join('\n');
}

function buildConversationHistory(ticketId) {
  const messages = supportService.getTicketMessages(ticketId);
  if (messages.length === 0) {
    return '';
  }

  const lines = messages.map((msg) => {
    const role = msg.senderType === 'user' ? 'Користувач' : 'Помічник';
    return `${role}: ${msg.text}`;
  });

  return `\n\n## Попередній діалог у цій сесії\n${lines.join('\n')}`;
}

function buildSupportPrompt(question, session, config, ticketId) {
  const knowledge = buildBotKnowledge(config);
  const userContext = buildUserContext(session);
  const history = buildConversationHistory(ticketId);

  return [
    knowledge,
    userContext,
    history,
    '',
    '## Нове питання користувача',
    question,
    '',
    'Дай корисну відповідь українською. Якщо питання не про бота — ввічливо перенаправ до навчальних функцій.',
  ].join('\n');
}

function buildSupportVisionPrompt(caption, session, config, ticketId) {
  const knowledge = buildBotKnowledge(config);
  const userContext = buildUserContext(session);
  const history = buildConversationHistory(ticketId);
  const question = caption?.trim()
    ? caption.trim()
    : 'Користувач надіслав скріншот. Проаналізуй зображення — це може бути інтерфейс бота або помилка. Допоможи вирішити проблему.';

  return [
    knowledge,
    userContext,
    history,
    '',
    '## Запит користувача (зі скріншотом)',
    question,
    '',
    'Опиши, що бачиш на зображенні (якщо це бот), і дай покрокову допомогу українською.',
  ].join('\n');
}

async function sendAiReply(bot, chatId, replyText) {
  const safeText = escapeHtml(replyText);
  const chunks = splitMessage(safeText);

  for (let i = 0; i < chunks.length; i += 1) {
    const prefix = i === 0 ? '💬 <b>Підтримка SchoolMate:</b>\n\n' : '';
    await bot.sendMessage(chatId, prefix + chunks[i], {
      parse_mode: 'HTML',
      ...(i === chunks.length - 1 ? supportKeyboard : {}),
    });
  }
}

async function processSupportQuestion(bot, chatId, userId, session, question, userStates, config) {
  const ticket = supportService.getOrCreateOpenTicket(userId, chatId);
  supportService.addMessage(ticket.id, 'user', question);

  await bot.sendMessage(chatId, config.messages.supportThinking, {
    parse_mode: 'HTML',
    ...supportKeyboard,
  });

  try {
    const prompt = buildSupportPrompt(question, session, config, ticket.id);
    const reply = await askAI(prompt);
    supportService.addMessage(ticket.id, 'assistant', reply);
    await sendAiReply(bot, chatId, reply);
  } catch (error) {
    console.error('Support AI error:', error);
    const message = error instanceof AIServiceError
      ? error.message
      : config.messages.supportAiError;
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...supportKeyboard,
    });
  }
}

function startSupport(bot, chatId, userStates, config) {
  userStates[chatId] = 'support_composing';
  bot.sendMessage(chatId, config.messages.supportStart, {
    parse_mode: 'HTML',
    ...supportKeyboard,
  });
}

function cancelSupport(bot, chatId, userId, userStates, config) {
  delete userStates[chatId];
  supportService.closeOpenTicketByUser(userId);
  bot.sendMessage(chatId, config.messages.supportCancelled, {
    parse_mode: 'HTML',
    ...mainKeyboard,
  });
}

function isSupportCancelText(text) {
  return text === '❌ Скасувати звернення';
}

function isSupportMenuText(text) {
  return text === '💬 Підтримка / Запитання' || text === '💬 Підтримка';
}

async function handleSupportText(bot, chatId, userId, text, session, userStates, config) {
  if (userStates[chatId] !== 'support_composing') {
    return false;
  }

  if (!text || text.trim().length < 2) {
    await bot.sendMessage(chatId, config.messages.supportTextTooShort, {
      parse_mode: 'HTML',
      ...supportKeyboard,
    });
    return true;
  }

  await processSupportQuestion(bot, chatId, userId, session, text.trim(), userStates, config);
  return true;
}

async function handleSupportPhoto(bot, msg, session, userStates, config) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userStates[chatId] !== 'support_composing') {
    return false;
  }

  const photos = msg.photo || [];
  const fileId = photos.length ? photos[photos.length - 1].file_id : null;
  if (!fileId) {
    return true;
  }

  const caption = msg.caption || '';
  const ticket = supportService.getOrCreateOpenTicket(userId, chatId);
  supportService.addMessage(ticket.id, 'user', caption || '[скріншот]', 'photo', fileId);

  await bot.sendMessage(chatId, config.messages.supportThinking, {
    parse_mode: 'HTML',
    ...supportKeyboard,
  });

  try {
    const { buffer, filePath } = await downloadTelegramFile(bot, fileId);
    const mimeType = guessMimeFromPath(filePath, 'image/jpeg');
    const prompt = buildSupportVisionPrompt(caption, session, config, ticket.id);
    const reply = await askAIWithMedia({
      prompt,
      mimeType,
      dataBase64: buffer.toString('base64'),
    });

    supportService.addMessage(ticket.id, 'assistant', reply);
    await sendAiReply(bot, chatId, reply);
  } catch (error) {
    console.error('Support vision error:', error);
    const message = error instanceof AIServiceError
      ? error.message
      : config.messages.supportAiError;
    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...supportKeyboard,
    });
  }

  return true;
}

async function handleSupportDocument(bot, msg, session, userStates, config) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userStates[chatId] !== 'support_composing') {
    return false;
  }

  const document = msg.document;
  if (!document?.file_id) {
    return true;
  }

  const mimeType = document.mime_type || '';
  const isImage = mimeType.startsWith('image/');

  if (isImage) {
    return handleSupportPhoto(bot, msg, session, userStates, config);
  }

  const caption = msg.caption || document.file_name || '';
  await processSupportQuestion(
    bot,
    chatId,
    userId,
    session,
    caption
      ? `Користувач надіслав файл «${document.file_name}». Коментар: ${caption}. Поясни, як у боті працювати з файлами.`
      : `Користувач надіслав файл «${document.file_name}». Поясни, як у боті працювати з файлами.`,
    userStates,
    config
  );

  return true;
}

function clearSupportState(chatId, userId, userStates) {
  if (userStates[chatId] === 'support_composing') {
    delete userStates[chatId];
    if (userId) {
      supportService.closeOpenTicketByUser(userId);
    }
  }
}

module.exports = {
  startSupport,
  cancelSupport,
  isSupportMenuText,
  isSupportCancelText,
  handleSupportText,
  handleSupportPhoto,
  handleSupportDocument,
  clearSupportState,
};
