const fs = require('fs');
const path = require('path');
const config = require('../config');
const userService = require('./userService');
const leaderboardService = require('./leaderboardService');
const rankService = require('./rankService');

const AUDIT_LOG_FILE = path.join(__dirname, '..', config.admin.auditLogFile || 'data/admin_audit.log');

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@/, '').toLowerCase();
}

function isAdminUser(user) {
  if (!user) return false;

  const username = normalizeUsername(user.username);
  const allowedUsernames = (config.admin.usernames || []).map(normalizeUsername);
  if (username && allowedUsernames.includes(username)) {
    return true;
  }

  const allowedIds = (config.admin.allowedIds || []).map((id) => String(id).trim());
  if (allowedIds.includes(String(user.id))) {
    return true;
  }

  return false;
}

function getUserByIdentifier(identifier) {
  if (!identifier || !String(identifier).trim()) {
    return null;
  }

  const normalized = String(identifier).trim();
  const id = Number(normalized);
  if (!Number.isNaN(id) && String(normalized).length >= 5) {
    return { id: String(id), session: userService.getSession(id) };
  }

  const username = normalizeUsername(normalized);
  const users = userService.loadUsers();

  for (const [userId, session] of Object.entries(users)) {
    if (normalizeUsername(session.username) === username) {
      return { id: userId, session };
    }
  }

  return null;
}

function getUserCard(session, userId) {
  if (!session) return null;

  return [
    `<b>Користувач:</b> ${session.name || 'Невідомо'} ${session.username ? `(@${session.username})` : ''}`,
    `<b>User ID:</b> <code>${userId}</code>`,
    `<b>Клас:</b> ${session.class || 'Невідомо'}`,
    `<b>Предмет:</b> ${session.selectedSubject || 'Не обрано'}`,
    `<b>XP:</b> ${session.xp || 0}`,
    `<b>Рівень:</b> ${session.level || rankService.calculateLevel(session.xp || 0, config).currentLevel}`,
    `<b>Ранг:</b> ${rankService.calculateLevel(session.xp || 0, config).currentRankTitle}`,
    `<b>Premium:</b> ${isPremium(session) ? '⭐ Так' : 'Ні'}`,
    `<b>Заблоковано:</b> ${session.banned ? 'Так' : 'Ні'}`,
    `<b>Стрік:</b> ${session.dailyStreak || 0}`,
    `<b>AI-запитів:</b> ${session.totalAiRequests || 0}`,
    `<b>Остання активність:</b> ${formatDate(session.lastActivityDate)}`,
  ].join('\n');
}

function formatDate(value) {
  if (!value) return 'Не вказано';
  try {
    return new Date(value).toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function ensureDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function logAction(actor, action, targetId, details = '') {
  try {
    ensureDirectory(AUDIT_LOG_FILE);
    const timestamp = new Date().toISOString();
    const line = `${timestamp} | actor=${actor.username || actor.id} (${actor.id}) | action=${action} | target=${targetId || 'N/A'} | ${details}\n`;
    fs.appendFileSync(AUDIT_LOG_FILE, line, 'utf8');
  } catch (err) {
    console.error('Admin audit log write failed:', err.message || err);
  }
}

function adjustXp(userId, amount) {
  const session = userService.getSession(userId);
  if (!session) return null;

  const xpResult = rankService.applyXpChange(session, Number(amount) || 0, config);
  if (Number(amount) > 0) {
    leaderboardService.recordXpChange(session, Number(amount));
  }
  userService.saveSession(userId, session, { levelBefore: xpResult.oldLevel });
  return session;
}

function setUserLevel(userId, level) {
  const session = userService.getSession(userId);
  if (!session) return null;

  const result = rankService.setLevel(session, level, config);
  userService.saveSession(userId, session, { levelBefore: result.oldLevel });
  return session;
}

function setPremiumDays(userId, days) {
  const session = userService.getSession(userId);
  if (!session) return null;

  const now = Date.now();
  const existingUntil = session.premiumUntil ? Date.parse(session.premiumUntil) : 0;
  const base = existingUntil > now ? existingUntil : now;
  session.premiumUntil = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
  userService.saveSession(userId, session);
  return session;
}

function banUser(userId, reason) {
  const session = userService.getSession(userId);
  if (!session) return null;
  session.banned = true;
  session.banReason = reason || 'Не вказано';
  userService.saveSession(userId, session);
  return session;
}

function unbanUser(userId) {
  const session = userService.getSession(userId);
  if (!session) return null;
  session.banned = false;
  delete session.banReason;
  userService.saveSession(userId, session);
  return session;
}

function getSystemStats() {
  const users = userService.loadUsers();
  const now = Date.now();
  const activeSeconds = 15 * 60 * 1000;
  let totalXp = 0;
  let premiumCount = 0;
  let bannedCount = 0;
  let activeCount = 0;
  let userCount = 0;

  for (const session of Object.values(users)) {
    userCount += 1;
    totalXp += Number.isFinite(session.xp) ? session.xp : 0;
    if (session.premiumUntil && Date.parse(session.premiumUntil) > now) premiumCount += 1;
    if (session.banned) bannedCount += 1;
    const lastActivity = Date.parse(session.lastActivityDate || 0);
    if (!Number.isNaN(lastActivity) && now - lastActivity <= activeSeconds) {
      activeCount += 1;
    }
  }

  return {
    userCount,
    totalXp,
    premiumCount,
    bannedCount,
    onlineCount: activeCount,
    averageXp: userCount > 0 ? Math.round(totalXp / userCount) : 0,
  };
}

function isPremium(session) {
  if (!session) return false;
  const now = Date.now();
  const until = session.premiumUntil || session.premium_until;
  return until && Date.parse(until) > now;
}

module.exports = {
  isAdminUser,
  getUserByIdentifier,
  getUserCard,
  logAction,
  adjustXp,
  setUserLevel,
  setPremiumDays,
  banUser,
  unbanUser,
  getSystemStats,
  isPremium,
};
