const http = require('http');
const userService = require('./userService');

const PERIODS = {
  all_time: 'all_time',
  weekly: 'weekly',
  monthly: 'monthly',
};

const CACHE_TTL_MS = 20 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_LEADERBOARD_PAGES = 5;

let leaderboardCache = {
  timestamp: 0,
  values: {},
};

function getWeekStart(date = new Date()) {
  const result = new Date(date);
  const day = result.getDay();
  const distance = (day + 6) % 7; // Monday as start of week
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - distance);
  return result;
}

function getMonthStart(date = new Date()) {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function normalizePeriod(period) {
  const normalized = String(period || '').trim().toLowerCase();
  if (['weekly', 'week', 'weekend', 'this_week'].includes(normalized)) {
    return PERIODS.weekly;
  }

  if (['monthly', 'month', 'this_month'].includes(normalized)) {
    return PERIODS.monthly;
  }

  return PERIODS.all_time;
}

function ensureLeaderboardFields(session) {
  if (!session) {
    return null;
  }

  if (!session.leaderboard || typeof session.leaderboard !== 'object') {
    session.leaderboard = {};
  }

  session.leaderboard.weeklyXp = Number.isFinite(session.leaderboard.weeklyXp)
    ? session.leaderboard.weeklyXp
    : 0;
  session.leaderboard.monthlyXp = Number.isFinite(session.leaderboard.monthlyXp)
    ? session.leaderboard.monthlyXp
    : 0;
  session.leaderboard.lastWeeklyResetAt = session.leaderboard.lastWeeklyResetAt || '';
  session.leaderboard.lastMonthlyResetAt = session.leaderboard.lastMonthlyResetAt || '';

  return session.leaderboard;
}

function shouldReset(period, lastResetAt) {
  if (!lastResetAt) {
    return true;
  }

  const lastReset = new Date(lastResetAt);
  if (Number.isNaN(lastReset.getTime())) {
    return true;
  }

  if (period === PERIODS.weekly) {
    return getWeekStart(lastReset) < getWeekStart();
  }

  if (period === PERIODS.monthly) {
    return getMonthStart(lastReset) < getMonthStart();
  }

  return false;
}

function refreshUserPeriods(session) {
  const board = ensureLeaderboardFields(session);
  if (!board) {
    return false;
  }

  let changed = false;
  if (shouldReset(PERIODS.weekly, board.lastWeeklyResetAt)) {
    board.weeklyXp = 0;
    board.lastWeeklyResetAt = getWeekStart().toISOString();
    changed = true;
  }

  if (shouldReset(PERIODS.monthly, board.lastMonthlyResetAt)) {
    board.monthlyXp = 0;
    board.lastMonthlyResetAt = getMonthStart().toISOString();
    changed = true;
  }

  return changed;
}

function resetAllPeriod(period) {
  const users = userService.loadUsers();
  const now = new Date();
  const periodStart = period === PERIODS.weekly ? getWeekStart(now) : getMonthStart(now);
  let changed = false;

  for (const session of Object.values(users)) {
    const board = ensureLeaderboardFields(session);
    if (period === PERIODS.weekly) {
      if (board.weeklyXp !== 0 || board.lastWeeklyResetAt !== periodStart.toISOString()) {
        board.weeklyXp = 0;
        board.lastWeeklyResetAt = periodStart.toISOString();
        changed = true;
      }
    } else if (period === PERIODS.monthly) {
      if (board.monthlyXp !== 0 || board.lastMonthlyResetAt !== periodStart.toISOString()) {
        board.monthlyXp = 0;
        board.lastMonthlyResetAt = periodStart.toISOString();
        changed = true;
      }
    }
  }

  if (changed) {
    userService.saveUsers(users);
    clearCache();
  }
}

function clearCache() {
  leaderboardCache = { timestamp: 0, values: {} };
}

function getSortingValue(session, period) {
  if (!session) {
    return 0;
  }

  if (period === PERIODS.weekly) {
    return session.leaderboard?.weeklyXp || 0;
  }

  if (period === PERIODS.monthly) {
    return session.leaderboard?.monthlyXp || 0;
  }

  return Number.isFinite(session.xp) ? session.xp : 0;
}

function refreshAllUserPeriods(users) {
  let changed = false;

  for (const session of Object.values(users)) {
    ensureLeaderboardFields(session);
    if (refreshUserPeriods(session)) {
      changed = true;
    }
  }

  if (changed) {
    userService.saveUsers(users);
  }
}

function buildLeaderboardRows(period) {
  const users = userService.loadUsers();
  refreshAllUserPeriods(users);

  const rows = [];
  for (const [userId, session] of Object.entries(users)) {
    ensureLeaderboardFields(session);
    rows.push({
      userId,
      session,
      score: getSortingValue(session, period),
    });
  }

  rows.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  return rows;
}

function getLeaderboard(period = PERIODS.all_time, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const normalizedPeriod = normalizePeriod(period);
  const safePageSize = Math.max(1, Math.min(pageSize, DEFAULT_PAGE_SIZE));
  const safePage = Math.max(1, Number.isFinite(Number(page)) ? Number(page) : 1);

  const now = Date.now();
  if (now - leaderboardCache.timestamp > CACHE_TTL_MS || !leaderboardCache.values[normalizedPeriod]) {
    leaderboardCache.timestamp = now;
    leaderboardCache.values[normalizedPeriod] = buildLeaderboardRows(normalizedPeriod);
  }

  const rows = leaderboardCache.values[normalizedPeriod] || [];
  const totalCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / safePageSize));
  const adjustedPage = Math.min(safePage, pageCount);
  const startIndex = (adjustedPage - 1) * safePageSize;
  const pageEntries = rows.slice(startIndex, startIndex + safePageSize);

  return {
    period: normalizedPeriod,
    entries: pageEntries,
    page: adjustedPage,
    pageSize: safePageSize,
    pageCount,
    totalCount,
  };
}

function getUserRank(userId, period = PERIODS.all_time) {
  const normalizedPeriod = normalizePeriod(period);
  const rows = buildLeaderboardRows(normalizedPeriod);
  const rank = rows.findIndex((row) => String(row.userId) === String(userId));
  if (rank === -1) {
    return null;
  }
  return {
    rank: rank + 1,
    score: rows[rank].score,
    userId: rows[rank].userId,
    session: rows[rank].session,
    totalCount: rows.length,
  };
}

function recordXpChange(session, amount) {
  ensureLeaderboardFields(session);
  const delta = Number(amount);
  if (!Number.isFinite(delta) || delta <= 0) {
    return;
  }

  refreshUserPeriods(session);
  session.leaderboard.weeklyXp = Math.max(0, (session.leaderboard.weeklyXp || 0) + delta);
  session.leaderboard.monthlyXp = Math.max(0, (session.leaderboard.monthlyXp || 0) + delta);
  clearCache();
}

function createApiServer(port = 3001) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      if (req.method !== 'GET' || url.pathname !== '/leaderboard') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const period = normalizePeriod(url.searchParams.get('period') || 'all_time');
      const page = Number(url.searchParams.get('page') || '1');
      const pageSize = Number(url.searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE));
      const leaderboard = getLeaderboard(period, page, pageSize);
      const userId = url.searchParams.get('userId');
      const userRank = userId ? getUserRank(userId, period) : null;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        period,
        page: leaderboard.page,
        pageSize: leaderboard.pageSize,
        pageCount: leaderboard.pageCount,
        totalCount: leaderboard.totalCount,
        entries: leaderboard.entries.map((item, index) => ({
          rank: (leaderboard.page - 1) * leaderboard.pageSize + index + 1,
          userId: item.userId,
          username: item.session?.username || null,
          name: item.session?.name || null,
          score: item.score,
        })),
        userRank,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Server error' }));
    }
  });

  server.listen(port, () => {
    console.log(`Leaderboard API running on http://localhost:${port}/leaderboard`);
  });

  server.on('error', (error) => {
    console.error('Leaderboard API server error:', error.message || error);
  });

  return server;
}

module.exports = {
  PERIODS,
  normalizePeriod,
  ensureLeaderboardFields,
  getLeaderboard,
  getUserRank,
  recordXpChange,
  createApiServer,
  DEFAULT_PAGE_SIZE,
  MAX_LEADERBOARD_PAGES,
};
