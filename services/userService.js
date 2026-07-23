const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

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
  }
  return session;
}

function saveSession(userId, session) {
  ensureStats(session);
  const users = loadUsers();
  users[String(userId)] = session;
  saveUsers(users);
}

module.exports = {
  loadUsers,
  saveUsers,
  getSession,
  saveSession,
  getDefaultStats,
  ensureStats,
  recordMessage,
  recordTopicExplained,
  recordTestCompleted,
};
