const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DUELS_FILE = path.join(__dirname, '..', 'data', 'duels.json');

function emptyStore() {
  return {
    duels: [],
    matchmakingPool: [],
    invites: [],
  };
}

function loadStore() {
  try {
    const data = fs.readFileSync(DUELS_FILE, 'utf8');
    const parsed = JSON.parse(data || '{}');
    return {
      duels: Array.isArray(parsed.duels) ? parsed.duels : [],
      matchmakingPool: Array.isArray(parsed.matchmakingPool) ? parsed.matchmakingPool : [],
      invites: Array.isArray(parsed.invites) ? parsed.invites : [],
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(DUELS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function createDuelId() {
  return `d${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

function createInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getPool() {
  return loadStore().matchmakingPool;
}

function upsertPoolEntry(entry) {
  const store = loadStore();
  store.matchmakingPool = store.matchmakingPool.filter(
    (item) => String(item.userId) !== String(entry.userId)
  );
  store.matchmakingPool.push({
    userId: String(entry.userId),
    chatId: entry.chatId,
    name: entry.name || 'Гравець',
    class: entry.class || null,
    subject: entry.subject || null,
    joinedAt: entry.joinedAt || new Date().toISOString(),
  });
  saveStore(store);
  return store.matchmakingPool;
}

function removeFromPool(userId) {
  const store = loadStore();
  const before = store.matchmakingPool.length;
  store.matchmakingPool = store.matchmakingPool.filter(
    (item) => String(item.userId) !== String(userId)
  );
  saveStore(store);
  return before !== store.matchmakingPool.length;
}

function findOpponentInPool(userId) {
  const store = loadStore();
  return (
    store.matchmakingPool.find((item) => String(item.userId) !== String(userId)) || null
  );
}

function getPoolEntry(userId) {
  return getPool().find((item) => String(item.userId) === String(userId)) || null;
}

function createDuel(payload) {
  const store = loadStore();
  const duel = {
    id: createDuelId(),
    player1Id: String(payload.player1Id),
    player2Id: String(payload.player2Id),
    player1ChatId: payload.player1ChatId,
    player2ChatId: payload.player2ChatId,
    player1Name: payload.player1Name || 'Гравець 1',
    player2Name: payload.player2Name || 'Гравець 2',
    status: 'generating',
    currentQuestion: 0,
    scores: {
      [String(payload.player1Id)]: 0,
      [String(payload.player2Id)]: 0,
    },
    answers: {},
    questions: [],
    questionStartedAt: null,
    class: payload.class || null,
    subject: payload.subject || null,
    vsAi: Boolean(payload.vsAi),
    createdAt: new Date().toISOString(),
    finishedAt: null,
    winnerId: null,
    result: null,
  };

  store.duels.push(duel);
  saveStore(store);
  return duel;
}

function getDuelById(duelId) {
  return loadStore().duels.find((d) => d.id === duelId) || null;
}

function updateDuel(duelId, patch) {
  const store = loadStore();
  const index = store.duels.findIndex((d) => d.id === duelId);
  if (index === -1) {
    return null;
  }

  store.duels[index] = { ...store.duels[index], ...patch };
  saveStore(store);
  return store.duels[index];
}

function findActiveDuelForUser(userId) {
  const id = String(userId);
  return (
    loadStore().duels.find(
      (d) =>
        (d.status === 'generating' || d.status === 'active') &&
        (String(d.player1Id) === id || String(d.player2Id) === id)
    ) || null
  );
}

function listRecentDuels(limit = 20) {
  return loadStore()
    .duels
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function cancelInvitesForUser(userId) {
  const store = loadStore();
  const id = String(userId);
  store.invites = store.invites.map((invite) => {
    if (invite.status === 'pending' && String(invite.fromUserId) === id) {
      return { ...invite, status: 'cancelled' };
    }
    return invite;
  });
  saveStore(store);
}

function createInvite(payload) {
  const store = loadStore();
  const id = String(payload.fromUserId);

  // One pending invite per host.
  store.invites = store.invites.filter(
    (invite) => !(invite.status === 'pending' && String(invite.fromUserId) === id)
  );

  const invite = {
    id: `inv${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    code: createInviteCode(),
    fromUserId: id,
    fromChatId: payload.fromChatId,
    fromName: payload.fromName || 'Гравець',
    fromClass: payload.fromClass || null,
    fromSubject: payload.fromSubject || null,
    toUserId: payload.toUserId ? String(payload.toUserId) : null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (payload.ttlMs || 15 * 60 * 1000)).toISOString(),
  };

  store.invites.push(invite);
  saveStore(store);
  return invite;
}

function getInviteByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const invite = loadStore().invites.find(
    (item) => item.status === 'pending' && String(item.code).toUpperCase() === normalized
  );

  if (!invite) {
    return null;
  }

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    updateInvite(invite.id, { status: 'expired' });
    return null;
  }

  return invite;
}

function getInviteById(inviteId) {
  return loadStore().invites.find((item) => item.id === inviteId) || null;
}

function updateInvite(inviteId, patch) {
  const store = loadStore();
  const index = store.invites.findIndex((item) => item.id === inviteId);
  if (index === -1) {
    return null;
  }

  store.invites[index] = { ...store.invites[index], ...patch };
  saveStore(store);
  return store.invites[index];
}

function findPendingInviteFrom(userId) {
  const id = String(userId);
  return (
    loadStore().invites.find(
      (invite) => invite.status === 'pending' && String(invite.fromUserId) === id
    ) || null
  );
}

module.exports = {
  loadStore,
  saveStore,
  getPool,
  upsertPoolEntry,
  removeFromPool,
  findOpponentInPool,
  getPoolEntry,
  createDuel,
  getDuelById,
  updateDuel,
  findActiveDuelForUser,
  listRecentDuels,
  createDuelId,
  createInviteCode,
  createInvite,
  getInviteByCode,
  getInviteById,
  updateInvite,
  findPendingInviteFrom,
  cancelInvitesForUser,
};
