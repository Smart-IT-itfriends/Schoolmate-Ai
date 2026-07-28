const { getActionKeyboard } = require('../keyboards');
const { askAIWithMedia, synthesizeSpeech, AIServiceError } = require('../services/aiService');
const { downloadTelegramFile, guessMimeFromPath } = require('../services/telegramFiles');
const premiumService = require('../services/premiumService');

const FOREIGN_SUBJECTS = [
  'Англійська мова',
  'Німецька мова',
  'Французька мова',
  'Польська мова',
  'Іспанська мова',
];

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const TELEGRAM_TEXT_LIMIT = 3900;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function isForeignLanguageSubject(session) {
  const subject = session?.selectedSubject || '';
  return FOREIGN_SUBJECTS.some((name) => subject.includes(name.replace(' мова', '')) || subject === name);
}

function buildVisionPrompt(session, caption) {
  const subject = session?.selectedSubject
    ? `Предмет: ${session.selectedSubject}.`
    : '';
  const grade = session?.class ? `Клас учня: ${session.class}.` : '';
  const extra = caption && caption.trim()
    ? `Додатковий запит користувача: ${caption.trim()}`
    : 'Додаткового тексту немає — проаналізуй зображення самостійно.';

  return [
    'Ти — шкільний AI-репетитор SchoolMate AI.',
    'Проаналізуй зображення (рукописна задача, графік, текст підручника, розв’язання тощо).',
    subject,
    grade,
    extra,
    '',
    'Зроби відповідь українською мовою (або мовою завдання, якщо це іноземна мова) у такій структурі:',
    '1) Що зображено / умова задачі (коротко).',
    '2) Пошук помилок у розв’язанні (якщо є розв’язок) — вкажи конкретні місця.',
    '3) Правильний розбір кроків (покроково, зрозуміло для школяра).',
    '4) Коротка підказка / висновок.',
    'Не вигадуй умови, яких немає на зображенні. Якщо фото нечитабельне — чесно скажи про це.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVoicePrompt(session) {
  const subject = session?.selectedSubject
    ? `Предмет: ${session.selectedSubject}.`
    : '';
  const grade = session?.class ? `Клас учня: ${session.class}.` : '';

  return [
    'Ти — шкільний AI-репетитор SchoolMate AI.',
    'Користувач надіслав голосове повідомлення.',
    'Спочатку розпізнай, що сказано, потім дай корисну навчальну відповідь.',
    subject,
    grade,
    '',
    'Формат відповіді українською (або мовою запиту, якщо це іноземна мова):',
    '1) Коротко: «Ти запитав(ла): …» (розпізнаний текст).',
    '2) Зрозуміла відповідь / пояснення з прикладом за потреби.',
    'Будь дружнім і стислим.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVideoPrompt(session, caption) {
  const subject = session?.selectedSubject
    ? `Предмет: ${session.selectedSubject}.`
    : '';
  const grade = session?.class ? `Клас учня: ${session.class}.` : '';
  const extra = caption && caption.trim()
    ? `Додатковий запит користувача: ${caption.trim()}`
    : 'Додаткового тексту немає — поясни відео самостійно.';

  return [
    'Ти — шкільний AI-репетитор SchoolMate AI.',
    'Користувач надіслав відео. Проаналізуй навчальний або пояснювальний контент у відео.',
    subject,
    grade,
    extra,
    '',
    'Надай відповідь українською мовою (або мовою відео, якщо це іноземна мова):',
    '1) Коротко: що показано у відео.',
    '2) Основна ідея або навчальний зміст.',
    '3) Покрокове пояснення або коментар до кожного важливого моменту.',
    '4) Коротке резюме / висновок.',
    'Якщо відео містить задачу або розв’язання, поясни його кроки чітко для школяра.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendLongHtmlReply(bot, chatId, title, body, session) {
  const header = `${title}\n\n`;
  const chunks = splitMessage(escapeHtml(body));

  for (let i = 0; i < chunks.length; i += 1) {
    const prefix = i === 0 ? header : '';
    await bot.sendMessage(chatId, `${prefix}${chunks[i]}`, {
      parse_mode: 'HTML',
      ...(i === chunks.length - 1 ? getActionKeyboard(session) : {}),
    });
  }
}

async function maybeSendTts(bot, chatId, text, session) {
  if (!isForeignLanguageSubject(session)) {
    return;
  }

  const speech = await synthesizeSpeech(text);
  if (!speech || !speech.data || speech.data.length === 0) {
    return;
  }

  try {
    await bot.sendVoice(chatId, speech.data, {
      caption: '🔊 Озвучка відповіді (Premium TTS)',
    });
  } catch (error) {
    // Gemini TTS may return raw PCM that Telegram rejects — soft-fail.
    console.error('Failed to send TTS voice:', error.message || error);
  }
}

async function analyzeMediaBuffer({
  bot,
  chatId,
  userId,
  session,
  saveSession,
  buffer,
  mimeType,
  prompt,
  waitingMessage,
  resultTitle,
  config,
}) {
  const maxBytes = mimeType.startsWith('audio/')
    ? MAX_VOICE_BYTES
    : mimeType.startsWith('video/')
    ? MAX_VIDEO_BYTES
    : MAX_PHOTO_BYTES;

  if (buffer.length > maxBytes) {
    await bot.sendMessage(chatId, config.messages.premiumMediaTooLarge, {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    });
    return;
  }

  await bot.sendMessage(chatId, waitingMessage, { parse_mode: 'HTML' });

  try {
    session.totalAiRequests = (session.totalAiRequests || 0) + 1;
    saveSession(userId, session);

    const answer = await askAIWithMedia({
      prompt,
      mimeType,
      dataBase64: buffer.toString('base64'),
    });

    await sendLongHtmlReply(bot, chatId, resultTitle, answer, session);
    await maybeSendTts(bot, chatId, answer, session);
  } catch (error) {
    console.error('Premium media analysis error:', error);
    const message =
      error instanceof AIServiceError
        ? config.messages.premiumMediaError
        : config.messages.premiumMediaError;

    await bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    });
  }
}

/**
 * Handle photo / voice / audio for Premium users.
 * Returns true if the update was handled (including premium-denied reply).
 */
async function handlePremiumMedia(bot, msg, session, config, saveSession) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  const hasVoice = Boolean(msg.voice);
  const hasAudio = Boolean(msg.audio);
  const hasVideo = Boolean(msg.video);
  const isImageDocument =
    msg.document &&
    typeof msg.document.mime_type === 'string' &&
    msg.document.mime_type.startsWith('image/');
  const isVideoDocument =
    msg.document &&
    typeof msg.document.mime_type === 'string' &&
    msg.document.mime_type.startsWith('video/');

  if (!hasPhoto && !hasVoice && !hasAudio && !hasVideo && !isImageDocument && !isVideoDocument) {
    return false;
  }

  if (!session || session.step !== 'completed') {
    await bot.sendMessage(chatId, 'Спочатку заверши реєстрацію через /start');
    return true;
  }

  if (!premiumService.isPremium(session, userId)) {
    await bot.sendMessage(chatId, config.messages.premiumRequired, {
      parse_mode: 'HTML',
      ...getActionKeyboard(session),
    });
    return true;
  }

  if (hasPhoto) {
    const largest = msg.photo[msg.photo.length - 1];
    const { buffer, filePath } = await downloadTelegramFile(bot, largest.file_id);
    const mimeType = guessMimeFromPath(filePath, 'image/jpeg');

    await analyzeMediaBuffer({
      bot,
      chatId,
      userId,
      session,
      saveSession,
      buffer,
      mimeType,
      prompt: buildVisionPrompt(session, msg.caption),
      waitingMessage: config.messages.premiumPhotoAnalyzing,
      resultTitle: '🖼️ <b>Розбір зображення (Premium)</b>',
      config,
    });
    return true;
  }

  if (isImageDocument) {
    const { buffer, filePath } = await downloadTelegramFile(bot, msg.document.file_id);
    const mimeType =
      msg.document.mime_type || guessMimeFromPath(filePath, 'image/jpeg');

    await analyzeMediaBuffer({
      bot,
      chatId,
      userId,
      session,
      saveSession,
      buffer,
      mimeType,
      prompt: buildVisionPrompt(session, msg.caption),
      waitingMessage: config.messages.premiumPhotoAnalyzing,
      resultTitle: '🖼️ <b>Розбір зображення (Premium)</b>',
      config,
    });
    return true;
  }

  if (hasVideo) {
    const { buffer, filePath } = await downloadTelegramFile(bot, msg.video.file_id);
    const mimeType =
      msg.video.mime_type || guessMimeFromPath(filePath, 'video/mp4');

    await analyzeMediaBuffer({
      bot,
      chatId,
      userId,
      session,
      saveSession,
      buffer,
      mimeType,
      prompt: buildVideoPrompt(session, msg.caption),
      waitingMessage: config.messages.premiumVideoAnalyzing,
      resultTitle: '🎬 <b>Розбір відео (Premium)</b>',
      config,
    });
    return true;
  }

  if (isVideoDocument) {
    const { buffer, filePath } = await downloadTelegramFile(bot, msg.document.file_id);
    const mimeType =
      msg.document.mime_type || guessMimeFromPath(filePath, 'video/mp4');

    await analyzeMediaBuffer({
      bot,
      chatId,
      userId,
      session,
      saveSession,
      buffer,
      mimeType,
      prompt: buildVideoPrompt(session, msg.caption),
      waitingMessage: config.messages.premiumVideoAnalyzing,
      resultTitle: '🎬 <b>Розбір відео (Premium)</b>',
      config,
    });
    return true;
  }

  if (hasVoice || hasAudio) {
    const media = msg.voice || msg.audio;
    const { buffer, filePath } = await downloadTelegramFile(bot, media.file_id);
    const mimeType =
      media.mime_type ||
      guessMimeFromPath(filePath, hasVoice ? 'audio/ogg' : 'audio/mpeg');

    await analyzeMediaBuffer({
      bot,
      chatId,
      userId,
      session,
      saveSession,
      buffer,
      mimeType,
      prompt: buildVoicePrompt(session),
      waitingMessage: config.messages.premiumVoiceAnalyzing,
      resultTitle: '🎤 <b>Відповідь на голосове (Premium)</b>',
      config,
    });
    return true;
  }

  return false;
}

module.exports = {
  handlePremiumMedia,
  FOREIGN_SUBJECTS,
  isForeignLanguageSubject,
};
