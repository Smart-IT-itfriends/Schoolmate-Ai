const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPPORT_FILE = path.join(__dirname, '..', 'data', 'support.json');
const MAX_HISTORY_MESSAGES = 10;

function emptyStore() {
  return {
    tickets: [],
    messages: [],
  };
}

function loadStore() {
  try {
    const data = fs.readFileSync(SUPPORT_FILE, 'utf8');
    const parsed = JSON.parse(data || '{}');
    return {
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(SUPPORT_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function generateId(prefix) {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function getOpenTicketByUser(userId) {
  const store = loadStore();
  return store.tickets.find(
    (ticket) => String(ticket.userId) === String(userId) && ticket.status === 'open'
  ) || null;
}

function createTicket(userId, userChatId) {
  const store = loadStore();
  const now = new Date().toISOString();
  const ticket = {
    id: generateId('t'),
    userId: String(userId),
    userChatId: Number(userChatId),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  store.tickets.push(ticket);
  saveStore(store);
  return ticket;
}

function getOrCreateOpenTicket(userId, userChatId) {
  const existing = getOpenTicketByUser(userId);
  if (existing) {
    return existing;
  }
  return createTicket(userId, userChatId);
}

function addMessage(ticketId, senderType, text, mediaType = null, mediaId = null) {
  const store = loadStore();
  const ticket = store.tickets.find((item) => item.id === ticketId);
  if (!ticket) {
    return null;
  }

  const now = new Date().toISOString();
  const message = {
    id: generateId('m'),
    ticketId,
    senderType,
    text: text || '',
    mediaType,
    mediaId,
    createdAt: now,
  };

  store.messages.push(message);
  ticket.updatedAt = now;
  saveStore(store);
  return message;
}

function closeTicket(ticketId) {
  const store = loadStore();
  const ticket = store.tickets.find((item) => item.id === ticketId);
  if (!ticket) {
    return null;
  }

  ticket.status = 'resolved';
  ticket.updatedAt = new Date().toISOString();
  ticket.resolvedAt = ticket.updatedAt;
  saveStore(store);
  return ticket;
}

function closeOpenTicketByUser(userId) {
  const ticket = getOpenTicketByUser(userId);
  if (!ticket) {
    return null;
  }
  return closeTicket(ticket.id);
}

function getTicketMessages(ticketId, limit = MAX_HISTORY_MESSAGES) {
  const store = loadStore();
  return store.messages
    .filter((message) => message.ticketId === ticketId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
}

module.exports = {
  getOpenTicketByUser,
  getOrCreateOpenTicket,
  addMessage,
  closeTicket,
  closeOpenTicketByUser,
  getTicketMessages,
  MAX_HISTORY_MESSAGES,
};
