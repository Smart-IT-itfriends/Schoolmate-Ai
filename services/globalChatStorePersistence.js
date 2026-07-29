const fs = require('fs');
const path = require('path');

const CHAT_FILE = path.join(__dirname, '..', 'data', 'global_chat.json');

function emptyStore() {
  return {
    messages: [],
    mutes: [],
    reports: [],
  };
}

function loadStore() {
  try {
    const raw = fs.readFileSync(CHAT_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      mutes: Array.isArray(parsed.mutes) ? parsed.mutes : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(store, null, 2), 'utf8');
}

module.exports = {
  loadStore,
  saveStore,
};
