const fs = require('fs');
const path = require('path');
const config = require('../config');
const rankService = require('./rankService');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

let levelUpNotifier = null;

function setLevelUpNotifier(handler) {
  levelUpNotifier = handler;
}

function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function getDefaultStats() {
  return {
    topicsExplained: 0,
    testsCompleted: 0,
    messagesCount: 0,
    duelsPlayed: 0,
    duelsWon: 0,
  };
}

function ensureStats(session) {
  if (!session) {
    return getDefaultStats();
  }

  if (!session.stats || typeof session.stats !== 'object') {
    session.stats = getDefaultStats();
  } else {
    session.stats.topicsExplained = session.stats.topicsExplained || 0;
    session.stats.testsCompleted = session.stats.testsCompleted || 0;
    session.stats.messagesCount = session.stats.messagesCount || 0;
    session.stats.duelsPlayed = session.stats.duelsPlayed || 0;
    session.stats.duelsWon = session.stats.duelsWon || 0;
  }

  if (!Number.isFinite(session.duelRating)) {
    session.duelRating = 1000;
  }

  return session.stats;
}

function recordMessage(session) {
  ensureStats(session);
  session.stats.messagesCount += 1;
}

function recordTopicExplained(session) {
  ensureStats(session);
  session.stats.topicsExplained += 1;
}

function recordTestCompleted(session) {
  ensureStats(session);
  session.stats.testsCompleted += 1;
}

function getSession(userId) {
  const users = loadUsers();
  const session = users[String(userId)] || null;
  if (session) {
    ensureStats(session);
    rankService.syncSessionLevel(session, config);
  }
  return session;
}

function saveSession(userId, session, options = {}) {
  ensureStats(session);
  const levelBefore = options.levelBefore !== undefined
    ? options.levelBefore
    : rankService.calculateLevel(session.xp || 0, config).currentLevel;
  rankService.syncSessionLevel(session, config);
  const users = loadUsers();
  users[String(userId)] = session;
  saveUsers(users);

  if (levelUpNotifier && session.level > levelBefore) {
    levelUpNotifier(userId, levelBefore, session.level, session);
  }
}

function applyXp(userId, session, amount) {
  if (!session) {
    return null;
  }
  const result = rankService.applyXpChange(session, amount, config);
  saveSession(userId, session, { levelBefore: result.oldLevel });
  return result;
}

module.exports = {
  loadUsers,
  saveUsers,
  getSession,
  saveSession,
  applyXp,
  setLevelUpNotifier,
  getDefaultStats,
  ensureStats,
  recordMessage,
  recordTopicExplained,
  recordTestCompleted,
};
