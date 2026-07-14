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

function getSession(userId) {
  const users = loadUsers();
  return users[String(userId)] || null;
}

function saveSession(userId, session) {
  const users = loadUsers();
  users[String(userId)] = session;
  saveUsers(users);
}

module.exports = {
  loadUsers,
  saveUsers,
  getSession,
  saveSession,
};
