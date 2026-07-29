const globalChatService = require('../services/globalChatService');
const adminService = require('../services/adminService');
const { createWebToken } = require('../services/globalChatRealtime');
const { mainKeyboard } = require('../keyboards');

const globalChatKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔄 Оновити онлайн', '🚩 Поскаржитись'],
      ['⬅️ Вийти з чату'],
    ],
    resize_keyboard: true,
  },
};

const REPORT_HINT = '🚩 Поскаржитись';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function buildProfile(session, user) {
  return {
    name: session?.name || user?.first_name || 'Користувач',
    username: user?.username || session?.username || null,
    class: session?.class || null,
  };
}

function formatHistoryLine(message) {
  const klass = message.userClass ? ` (${message.userClass} клас)` : '';
  return `<b>${escapeHtml(message.userName)}</b>${klass} · ${formatTime(message.createdAt)}\n${escapeHtml(message.text)}\n<code>#${message.id}</code>`;
}

function buildHistoryBlock(messages, onlineCount) {
  if (!messages.length) {
    return '📭 Поки що немає повідомлень. Напиши перше!';
  }

  return messages.map(formatHistoryLine).join('\n\n');
}

function getWebChatUrl(userId, config) {
  const port = Number(process.env.GLOBAL_CHAT_PORT || config.globalChat?.port || 3002);
  const token = createWebToken(userId);
  return `http://localhost:${port}/global-chat?userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
}

function isGlobalChatMenuText(text) {
  return text === '🌐 Глобальний чат';
}

function isLeaveGlobalChatText(text) {
  return text === '⬅️ Вийти з чату';
}

function isRefreshOnlineText(text) {
  return text === '🔄 Оновити онлайн';
}

function isReportText(text) {
  return text === REPORT_HINT;
}

async function enterGlobalChat(bot, chatId, userId, session, user, userStates, config) {
  const profile = buildProfile(session, user);
  globalChatService.touchPresence(userId, chatId, profile);
  userStates[chatId] = 'global_chat';

  const history = globalChatService.getHistory();
  const online = globalChatService.getOnlineCount();
  const slowMode = config.globalChat?.slowModeSeconds || 4;
  const maxLen = config.globalChat?.maxMessageLength || 250;
  const webUrl = getWebChatUrl(userId, config);

  const header = [
    '🌐 <b>Глобальний чат SchoolMate</b>',
    `🟢 Онлайн: <b>${online}</b> користувач(ів)`,
    `⏱ Slowmode: <b>${slowMode} с</b> · max <b>${maxLen}</b> символів`,
    '',
    '<b>Останні повідомлення:</b>',
    buildHistoryBlock(history, online),
    '',
    'Надішли текст або емодзі — його побачать усі онлайн.',
    `<i>Веб-версія:</i> ${webUrl}`,
  ].join('\n');

  await bot.sendMessage(chatId, header, {
    parse_mode: 'HTML',
    ...globalChatKeyboard,
  });
}

function leaveGlobalChat(bot, chatId, userId, userStates) {
  delete userStates[chatId];
  globalChatService.leavePresence(userId);
  bot.sendMessage(chatId, '👋 Ти вийшов(ла) з глобального чату.', mainKeyboard);
}

function clearGlobalChatState(chatId, userId, userStates) {
  if (userStates[chatId] === 'global_chat') {
    delete userStates[chatId];
    if (userId) {
      globalChatService.leavePresence(userId);
    }
  }
}

function formatLiveMessage(message, onlineCount) {
  const klass = message.userClass ? ` (${message.userClass} клас)` : '';
  return [
    '💬 <b>Нове в глобальному чаті</b>',
    `<b>${escapeHtml(message.userName)}</b>${klass} · ${formatTime(message.createdAt)}`,
    escapeHtml(message.text),
    '',
    `🟢 Онлайн: ${onlineCount} · <code>#${message.id}</code>`,
  ].join('\n');
}

async function broadcastToOnline(bot, message, senderUserId, config) {
  const onlineUsers = globalChatService.getOnlineUsers();
  const onlineCount = onlineUsers.length;
  const text = formatLiveMessage(message, onlineCount);

  const sendTasks = onlineUsers.map(async (participant) => {
    if (String(participant.userId) === String(senderUserId)) {
      return null;
    }

    try {
      const sent = await bot.sendMessage(participant.chatId, text, { parse_mode: 'HTML' });
      globalChatService.recordDelivery(message.id, participant.userId, sent.message_id);
      return sent;
    } catch (err) {
      if (err.response?.body?.error_code === 403) {
        globalChatService.leavePresence(participant.userId);
      }
      return null;
    }
  });

  await Promise.allSettled(sendTasks);
}

async function handleGlobalChatMessage(bot, chatId, userId, text, session, user, userStates, config) {
  if (userStates[chatId] !== 'global_chat') {
    return false;
  }

  const profile = buildProfile(session, user);
  globalChatService.touchPresence(userId, chatId, profile);

  if (isLeaveGlobalChatText(text)) {
    leaveGlobalChat(bot, chatId, userId, userStates);
    return true;
  }

  if (isRefreshOnlineText(text)) {
    const online = globalChatService.getOnlineCount();
    await bot.sendMessage(chatId, `🟢 Зараз онлайн: <b>${online}</b>`, {
      parse_mode: 'HTML',
      ...globalChatKeyboard,
    });
    return true;
  }

  if (isReportText(text)) {
    await bot.sendMessage(chatId, config.messages.globalChatReportHint, {
      parse_mode: 'HTML',
      ...globalChatKeyboard,
    });
    return true;
  }

  if (text.startsWith('/report ') || text.startsWith('🚩 ')) {
    const messageId = text.replace(/^\/report\s+|^🚩\s+/, '').trim();
    if (!messageId) {
      await bot.sendMessage(chatId, config.messages.globalChatReportHint, { parse_mode: 'HTML', ...globalChatKeyboard });
      return true;
    }
    globalChatService.addReport(messageId, userId, 'user_report');
    await bot.sendMessage(chatId, config.messages.globalChatReportSent, { parse_mode: 'HTML', ...globalChatKeyboard });
    return true;
  }

  const result = globalChatService.addMessage(userId, profile, text, config);
  if (!result.ok) {
    let extra = result.error.message;
    if (result.error.retryAfterSec) {
      extra += `\n⏳ Cooldown: <b>${result.error.retryAfterSec}</b> с`;
    }
    await bot.sendMessage(chatId, extra, { parse_mode: 'HTML', ...globalChatKeyboard });
    return true;
  }

  const online = globalChatService.getOnlineCount();
  await bot.sendMessage(chatId, `✅ Надіслано · 🟢 Онлайн: ${online}`, globalChatKeyboard);
  return true;
}

async function deleteMessageForEveryone(bot, messageId, actor) {
  const deleted = globalChatService.deleteMessage(messageId, actor.id);
  if (!deleted.ok) {
    return deleted;
  }

  const deliveryList = globalChatService.getDeliveries(messageId);
  await Promise.allSettled(deliveryList.map(async (item) => {
    try {
      await bot.deleteMessage(item.userId, item.telegramMessageId);
    } catch {
      // message may already be gone
    }
  }));
  globalChatService.clearDeliveries(messageId);
  return deleted;
}

async function handleGlobalChatCallback(bot, query, config) {
  const data = String(query.data || '');
  if (!data.startsWith('gchat:')) {
    return false;
  }

  const user = query.from;
  const chatId = query.message?.chat?.id || user.id;

  if (!adminService.isAdminUser(user)) {
    await bot.answerCallbackQuery(query.id, { text: config.messages.adminAccessDenied, show_alert: true });
    return true;
  }

  const parts = data.split(':');
  const action = parts[1];
  const target = parts[2];
  const extra = parts[3];

  if (action === 'del' && target) {
    await deleteMessageForEveryone(bot, target, user);
    await bot.answerCallbackQuery(query.id, { text: 'Повідомлення видалено' });
    await bot.sendMessage(chatId, `🗑 Повідомлення <code>#${target}</code> видалено.`, { parse_mode: 'HTML' });
    return true;
  }

  if (action === 'mute' && target) {
    const minutes = Number(extra || config.globalChat?.defaultMuteMinutes || 30);
    globalChatService.muteUser(target, minutes, 'Мут з чату', user.id);
    await bot.answerCallbackQuery(query.id, { text: `Мут на ${minutes} хв` });
    await bot.sendMessage(chatId, `🔇 Користувач <code>${target}</code> у муті на ${minutes} хв.`, { parse_mode: 'HTML' });
    return true;
  }

  return false;
}

async function handleChatMuteCommand(bot, msg, config) {
  const user = msg.from;
  const chatId = msg.chat.id;
  if (!adminService.isAdminUser(user)) {
    await bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return true;
  }

  const match = msg.text.match(/\/chat_mute(?:@\w+)?\s+(\S+)(?:\s+(\d+))?(?:\s+(.+))?/);
  if (!match) {
    await bot.sendMessage(chatId, 'Використання: /chat_mute <user_id> [хвилини] [причина]', { parse_mode: 'HTML' });
    return true;
  }

  const targetId = match[1];
  const minutes = Number(match[2] || config.globalChat?.defaultMuteMinutes || 30);
  const reason = match[3] || 'Порушення правил чату';
  globalChatService.muteUser(targetId, minutes, reason, user.id);
  adminService.logAction(user, 'chat_mute', targetId, `minutes=${minutes}; reason=${reason}`);
  await bot.sendMessage(chatId, `🔇 Користувач <code>${targetId}</code> у муті на ${minutes} хв.`, { parse_mode: 'HTML' });
  return true;
}

async function handleChatUnmuteCommand(bot, msg, config) {
  const user = msg.from;
  const chatId = msg.chat.id;
  if (!adminService.isAdminUser(user)) {
    await bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return true;
  }

  const match = msg.text.match(/\/chat_unmute(?:@\w+)?\s+(\S+)/);
  if (!match) {
    await bot.sendMessage(chatId, 'Використання: /chat_unmute <user_id>', { parse_mode: 'HTML' });
    return true;
  }

  const ok = globalChatService.unmuteUser(match[1]);
  await bot.sendMessage(chatId, ok ? '✅ Мут знято.' : 'ℹ️ Користувач не був у муті.', { parse_mode: 'HTML' });
  return true;
}

async function handleChatDeleteCommand(bot, msg, config) {
  const user = msg.from;
  const chatId = msg.chat.id;
  if (!adminService.isAdminUser(user)) {
    await bot.sendMessage(chatId, config.messages.adminAccessDenied);
    return true;
  }

  let messageId = null;
  const match = msg.text.match(/\/chat_delete(?:@\w+)?\s+(\S+)/);
  if (match) {
    messageId = match[1].replace(/^#/, '');
  } else if (msg.reply_to_message?.text) {
    const idMatch = msg.reply_to_message.text.match(/#(m_[a-z0-9]+)/i);
    if (idMatch) {
      messageId = idMatch[1];
    }
  }

  if (!messageId) {
    await bot.sendMessage(chatId, 'Використання: /chat_delete <message_id> або reply на повідомлення чату', { parse_mode: 'HTML' });
    return true;
  }

  const result = await deleteMessageForEveryone(bot, messageId, user);
  if (!result.ok) {
    await bot.sendMessage(chatId, '❌ Повідомлення не знайдено.', { parse_mode: 'HTML' });
    return true;
  }

  adminService.logAction(user, 'chat_delete', messageId);
  await bot.sendMessage(chatId, `🗑 Повідомлення <code>#${messageId}</code> видалено.`, { parse_mode: 'HTML' });
  return true;
}

module.exports = {
  globalChatKeyboard,
  isGlobalChatMenuText,
  isLeaveGlobalChatText,
  enterGlobalChat,
  leaveGlobalChat,
  clearGlobalChatState,
  handleGlobalChatMessage,
  handleGlobalChatCallback,
  handleChatMuteCommand,
  handleChatUnmuteCommand,
  handleChatDeleteCommand,
  broadcastToOnline,
};
