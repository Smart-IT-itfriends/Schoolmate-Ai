const { loadStore, saveStore } = require('./globalChatStorePersistence');

const DEFAULT_PROFANITY = [  'бля', 'блять', 'хуй', 'хуя', 'пizd', 'pizda', 'сука', 'сукa', 'fuck', 'shit', 'bitch',
];

function generateMessageId() {
  const crypto = require('crypto');
  return `m_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

function normalizeText(text) {
  return String(text || '').trim();
}

function containsLink(text) {
  return /(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)/i.test(text);
}

function containsProfanity(text, words) {
  const lower = String(text || '').toLowerCase();
  const list = words && words.length ? words : DEFAULT_PROFANITY;
  return list.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(lower)
      || lower.includes(word.toLowerCase());
  });
}

function validateMessage(text, config) {
  const normalized = normalizeText(text);
  const maxLen = config.globalChat?.maxMessageLength || 250;

  if (!normalized) {
    return { ok: false, code: 'empty', message: 'Повідомлення не може бути порожнім.' };
  }

  if (normalized.length > maxLen) {
    return {
      ok: false,
      code: 'too_long',
      message: `Занадто довге повідомлення. Максимум ${maxLen} символів.`,
    };
  }

  if (config.globalChat?.blockLinks !== false && containsLink(normalized)) {
    return { ok: false, code: 'links', message: 'Посилання заборонені в глобальному чаті.' };
  }

  if (containsProfanity(normalized, config.globalChat?.profanityWords)) {
    return { ok: false, code: 'profanity', message: 'Повідомлення містить заборонені слова.' };
  }

  return { ok: true, text: normalized };
}

function isUserMuted(userId, store = loadStore()) {
  const now = Date.now();
  const mute = store.mutes.find((item) => String(item.userId) === String(userId));
  if (!mute) {
    return null;
  }

  const until = Date.parse(mute.until);
  if (Number.isNaN(until) || until <= now) {
    return null;
  }

  return mute;
}

function muteUser(userId, minutes, reason, actorId) {
  const store = loadStore();
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  store.mutes = store.mutes.filter((item) => String(item.userId) !== String(userId));
  const mute = {
    userId: String(userId),
    until,
    reason: reason || 'Порушення правил чату',
    mutedBy: String(actorId || 'system'),
    createdAt: new Date().toISOString(),
  };
  store.mutes.push(mute);
  saveStore(store);
  return mute;
}

function unmuteUser(userId) {
  const store = loadStore();
  const before = store.mutes.length;
  store.mutes = store.mutes.filter((item) => String(item.userId) !== String(userId));
  saveStore(store);
  return before !== store.mutes.length;
}

function addReport(messageId, reporterId, reason) {
  const store = loadStore();
  const report = {
    id: `r_${Date.now().toString(36)}`,
    messageId,
    reporterId: String(reporterId),
    reason: reason || 'report',
    createdAt: new Date().toISOString(),
  };
  store.reports.push(report);
  saveStore(store);
  return report;
}

module.exports = {
  DEFAULT_PROFANITY,
  validateMessage,
  containsLink,
  containsProfanity,
  isUserMuted,
  muteUser,
  unmuteUser,
  addReport,
  generateMessageId,
  normalizeText,
};
