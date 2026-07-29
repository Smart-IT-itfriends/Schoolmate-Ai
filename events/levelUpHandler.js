const rankService = require('../services/rankService');

const pending = new Map();
const DEBOUNCE_MS = 2000;

function buildLevelUpMessage(session, fromLevel, toLevel, config) {
  const stats = rankService.calculateLevel(session.xp || 0, config);
  const username = session.username ? `@${session.username}` : (session.name || 'друже');

  return [
    '🎉 <b>Вітаємо!</b>',
    '',
    `${username}, ти досяг(ла) <b>${toLevel} рівня</b>!`,
    `Новий ранг: <b>${stats.rankBadge} ${stats.currentRankTitle}</b> 🚀`,
    '',
    `⭐ XP: <b>${stats.xp}</b>`,
    stats.isMaxLevel
      ? '🏆 Це максимальний рівень — неймовірно!'
      : `📊 ${rankService.buildProgressBar(stats.progressPercent)}`,
    '',
    'Продовжуй вчитися — попереду ще більше досягнень!',
  ].join('\n');
}

function queueLevelUp(bot, userId, fromLevel, toLevel, session, config) {
  if (!bot || !userId || toLevel <= fromLevel) {
    return;
  }

  const key = String(userId);
  const existing = pending.get(key);

  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const entry = {
    fromLevel: existing ? existing.fromLevel : fromLevel,
    toLevel: Math.max(existing?.toLevel || fromLevel, toLevel),
    session,
    config,
    timer: setTimeout(async () => {
      pending.delete(key);
      const message = buildLevelUpMessage(session, entry.fromLevel, entry.toLevel, config);
      try {
        await bot.sendMessage(Number(userId), message, { parse_mode: 'HTML' });
      } catch (err) {
        console.error('Level up notification failed:', err.message || err);
      }
    }, DEBOUNCE_MS),
  };

  pending.set(key, entry);
}

function flushAll() {
  for (const [key, entry] of pending.entries()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    pending.delete(key);
  }
}

module.exports = {
  queueLevelUp,
  buildLevelUpMessage,
  flushAll,
};
