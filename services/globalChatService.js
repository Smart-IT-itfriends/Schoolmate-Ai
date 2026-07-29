const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const {
  loadStore: loadPersistedStore,
  saveStore: savePersistedStore,
} = require('./globalChatStorePersistence');
const {
  validateMessage,
  isUserMuted,
  muteUser,
  unmuteUser,
  addReport,
  generateMessageId,
} = require('./globalChatModeration');
const { createSlowModeLimiter } = require('./globalChatRateLimiter');

const pubsub = new EventEmitter();
pubsub.setMaxListeners(1000);

const presence = new Map();
const deliveries = new Map();
let configRef = null;
let rateLimiter = null;
let onMessageBroadcast = null;

function init(config) {
  configRef = config;
  rateLimiter = createSlowModeLimiter(config);
}

function setBroadcastHandler(handler) {
  onMessageBroadcast = handler;
}

function getOnlineTimeoutMs() {
  return (configRef?.globalChat?.onlineTimeoutSeconds || 120) * 1000;
}

function getHistoryLimit() {
  return configRef?.globalChat?.historyLimit || 40;
}

function touchPresence(userId, chatId, profile = {}) {
  presence.set(String(userId), {
    userId: String(userId),
    chatId: Number(chatId),
    name: profile.name || 'Користувач',
    username: profile.username || null,
    class: profile.class || null,
    lastSeen: Date.now(),
    joinedAt: profile.joinedAt || Date.now(),
  });
  publishOnlineCount();
}

function leavePresence(userId) {
  presence.delete(String(userId));
  publishOnlineCount();
}

function cleanupPresence() {
  const now = Date.now();
  const timeout = getOnlineTimeoutMs();
  let changed = false;

  for (const [userId, entry] of presence.entries()) {
    if (now - entry.lastSeen > timeout) {
      presence.delete(userId);
      changed = true;
    }
  }

  if (changed) {
    publishOnlineCount();
  }
}

function getOnlineUsers() {
  cleanupPresence();
  return Array.from(presence.values());
}

function getOnlineCount() {
  return getOnlineUsers().length;
}

function publishOnlineCount() {
  pubsub.emit('broadcast', {
    type: 'online',
    payload: { count: getOnlineCount() },
  });
}

function getHistory(limit = getHistoryLimit()) {
  const store = loadPersistedStore();
  return store.messages
    .filter((message) => !message.deleted)
    .slice(-limit);
}

function formatPublicMessage(message) {
  return {
    id: message.id,
    userId: message.userId,
    userName: message.userName,
    userClass: message.userClass || null,
    text: message.text,
    createdAt: message.createdAt,
  };
}

function addMessage(userId, profile, text, config) {
  const validation = validateMessage(text, config || configRef || {});
  if (!validation.ok) {
    return { ok: false, error: validation };
  }

  const mute = isUserMuted(userId);
  if (mute) {
    const until = new Date(mute.until).toLocaleString('uk-UA');
    return {
      ok: false,
      error: {
        code: 'muted',
        message: `Ти в муті до ${until}. Причина: ${mute.reason}`,
      },
    };
  }

  const limit = rateLimiter || createSlowModeLimiter(config || configRef || {});
  const rate = limit.hit(String(userId));
  if (!rate.allowed) {
    const seconds = Math.ceil(rate.retryAfterMs / 1000);
    return {
      ok: false,
      error: {
        code: 'rate_limit',
        message: `Зачекай ${seconds} с перед наступним повідомленням (slowmode).`,
        retryAfterMs: rate.retryAfterMs,
        retryAfterSec: seconds,
      },
    };
  }

  const store = loadPersistedStore();
  const message = {
    id: generateMessageId(),
    userId: String(userId),
    userName: profile.name || 'Користувач',
    userClass: profile.class || null,
    text: validation.text,
    createdAt: new Date().toISOString(),
    deleted: false,
  };

  store.messages.push(message);
  const limitCount = getHistoryLimit();
  if (store.messages.length > limitCount * 3) {
    store.messages = store.messages.slice(-limitCount * 2);
  }
  savePersistedStore(store);

  const publicMessage = formatPublicMessage(message);
  pubsub.emit('broadcast', { type: 'message', payload: publicMessage });
  if (onMessageBroadcast) {
    onMessageBroadcast(publicMessage, userId);
  }
  return { ok: true, message: publicMessage };
}

function deleteMessage(messageId, actorId) {
  const store = loadPersistedStore();
  const message = store.messages.find((item) => item.id === messageId);
  if (!message) {
    return { ok: false, reason: 'not_found' };
  }

  message.deleted = true;
  message.deletedAt = new Date().toISOString();
  message.deletedBy = String(actorId || 'system');
  savePersistedStore(store);

  pubsub.emit('broadcast', { type: 'delete', payload: { id: messageId } });
  return { ok: true, message };
}

function recordDelivery(messageId, userId, telegramMessageId) {
  if (!deliveries.has(messageId)) {
    deliveries.set(messageId, new Map());
  }
  deliveries.get(messageId).set(String(userId), telegramMessageId);
}

function getDeliveries(messageId) {
  const map = deliveries.get(messageId);
  if (!map) {
    return [];
  }
  return Array.from(map.entries()).map(([userId, telegramMessageId]) => ({
    userId,
    telegramMessageId,
  }));
}

function clearDeliveries(messageId) {
  deliveries.delete(messageId);
}

function subscribe(listener) {
  pubsub.on('broadcast', listener);
  return () => pubsub.off('broadcast', listener);
}

function emitHeartbeat() {
  pubsub.emit('broadcast', {
    type: 'heartbeat',
    payload: { ts: Date.now(), online: getOnlineCount() },
  });
}

module.exports = {
  init,
  setBroadcastHandler,
  touchPresence,
  leavePresence,
  cleanupPresence,
  getOnlineUsers,
  getOnlineCount,
  getHistory,
  addMessage,
  deleteMessage,
  muteUser,
  unmuteUser,
  isUserMuted,
  addReport,
  recordDelivery,
  getDeliveries,
  clearDeliveries,
  subscribe,
  emitHeartbeat,
  publishOnlineCount,
};
