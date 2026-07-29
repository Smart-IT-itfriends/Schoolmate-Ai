const fs = require('fs');
const path = require('path');

const RANKS_FILE = path.join(__dirname, '..', 'data', 'ranks.json');
const MAX_XP = 999_999_999;
const MAX_LEVEL = 10_000;

function loadRankOverrides() {
  try {
    const raw = fs.readFileSync(RANKS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function saveRankOverrides(data) {
  fs.writeFileSync(RANKS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getRankConfig(config) {
  const overrides = loadRankOverrides();
  const fromConfig = config?.ranks || {};
  return {
    base: overrides.base ?? fromConfig.base ?? 100,
    maxLevel: overrides.maxLevel ?? fromConfig.maxLevel ?? MAX_LEVEL,
    titles: overrides.titles?.length ? overrides.titles : (fromConfig.titles || getDefaultTitles()),
    customThresholds: overrides.customThresholds?.length
      ? overrides.customThresholds
      : (fromConfig.customThresholds || []),
  };
}

function getDefaultTitles() {
  return [
    { level: 1, title: 'Новачок', badge: '🌱' },
    { level: 2, title: 'Учень', badge: '📘' },
    { level: 3, title: 'Знавець', badge: '🎓' },
    { level: 4, title: 'Майстер', badge: '🏅' },
    { level: 5, title: 'Легенда', badge: '🚀' },
  ];
}

function normalizeXp(xp) {
  const value = Number(xp);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(Math.floor(value), MAX_XP);
}

function getMinXpForLevel(level, rankConfig) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));

  if (rankConfig.customThresholds?.length) {
    const exact = rankConfig.customThresholds.find((item) => item.level === lvl);
    if (exact && Number.isFinite(exact.minXp)) {
      return exact.minXp;
    }
  }

  return rankConfig.base * (lvl - 1) ** 2;
}

function getTitleForLevel(level, rankConfig) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  const titles = rankConfig.titles || getDefaultTitles();
  let matched = titles[0];

  for (const entry of titles) {
    if (lvl >= entry.level) {
      matched = entry;
    }
  }

  if (lvl >= 5 && !titles.some((entry) => entry.level === lvl)) {
    const legend = titles.find((entry) => entry.level === 5) || { title: 'Легенда', badge: '🚀' };
    if (lvl > 5) {
      return {
        ...legend,
        title: `${legend.title} ${lvl}`,
      };
    }
    return legend;
  }

  return matched;
}

function calculateLevel(xp, config) {
  const rankConfig = getRankConfig(config);
  const safeXp = normalizeXp(xp);
  let currentLevel = 1;

  while (
    currentLevel < rankConfig.maxLevel
    && getMinXpForLevel(currentLevel + 1, rankConfig) <= safeXp
  ) {
    currentLevel += 1;
  }

  const currentMinXp = getMinXpForLevel(currentLevel, rankConfig);
  const nextLevel = currentLevel >= rankConfig.maxLevel ? null : currentLevel + 1;
  const nextLevelXp = nextLevel ? getMinXpForLevel(nextLevel, rankConfig) : null;
  const rank = getTitleForLevel(currentLevel, rankConfig);

  let progressPercent = 100;
  if (nextLevelXp !== null && nextLevelXp > currentMinXp) {
    progressPercent = Math.floor(((safeXp - currentMinXp) / (nextLevelXp - currentMinXp)) * 100);
    progressPercent = Math.max(0, Math.min(100, progressPercent));
  }

  return {
    currentLevel,
    currentRankTitle: rank.title,
    rankBadge: rank.badge || '🎖',
    currentMinXp,
    nextLevel,
    nextLevelXp,
    progressPercent,
    xp: safeXp,
    xpToNextLevel: nextLevelXp === null ? 0 : Math.max(0, nextLevelXp - safeXp),
    isMaxLevel: nextLevel === null,
  };
}

function buildProgressBar(percent, width = 10) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((safePercent / 100) * width);
  const empty = Math.max(0, width - filled);
  return `[${'▓'.repeat(filled)}${'░'.repeat(empty)}] ${safePercent}%`;
}

function syncSessionLevel(session, config) {
  if (!session) {
    return null;
  }
  session.xp = normalizeXp(session.xp || 0);
  const stats = calculateLevel(session.xp, config);
  session.level = stats.currentLevel;
  return stats;
}

function applyXpChange(session, delta, config) {
  if (!session) {
    return { changed: false };
  }

  const rankConfig = getRankConfig(config);
  const before = calculateLevel(session.xp || 0, config);
  const oldLevel = before.currentLevel;

  let newXp = normalizeXp((session.xp || 0) + Number(delta || 0));
  session.xp = newXp;

  const after = calculateLevel(session.xp, config);
  session.level = after.currentLevel;

  return {
    changed: true,
    oldLevel,
    newLevel: after.currentLevel,
    leveledUp: after.currentLevel > oldLevel,
    leveledDown: after.currentLevel < oldLevel,
    levelsGained: after.currentLevel - oldLevel,
    stats: after,
    delta: Number(delta || 0),
  };
}

function setLevel(session, targetLevel, config) {
  if (!session) {
    return null;
  }

  const rankConfig = getRankConfig(config);
  const level = Math.max(1, Math.min(rankConfig.maxLevel, Math.floor(Number(targetLevel) || 1)));
  const minXp = getMinXpForLevel(level, rankConfig);
  const oldLevel = session.level || calculateLevel(session.xp || 0, config).currentLevel;

  if ((session.xp || 0) < minXp) {
    session.xp = minXp;
  }

  session.level = level;
  const stats = calculateLevel(session.xp, config);
  session.level = stats.currentLevel;

  return {
    oldLevel,
    newLevel: stats.currentLevel,
    stats,
    forcedLevel: level,
  };
}

function buildProfileRankBlock(session, config, username) {
  const stats = calculateLevel(session?.xp || 0, config);
  const userLabel = username ? `@${username}` : (session?.name || 'користувач');

  return [
    `👤 <b>Профіль:</b> ${userLabel}`,
    `🎖 <b>Ранг:</b> [Lvl ${stats.currentLevel}] ${stats.rankBadge} ${stats.currentRankTitle}`,
    `⭐ <b>XP:</b> ${stats.xp}${stats.isMaxLevel ? '' : ` / ${stats.nextLevelXp}`}`,
    `📊 <b>Прогрес:</b> ${buildProgressBar(stats.progressPercent)}`,
    stats.isMaxLevel
      ? '🏆 Ти досяг(ла) максимального рівня!'
      : `До наступного рівня: <b>${stats.xpToNextLevel} XP</b>`,
  ].join('\n');
}

function getRankTable(config, limit = 15) {
  const rankConfig = getRankConfig(config);
  const rows = [];

  for (let level = 1; level <= limit; level += 1) {
    const minXp = getMinXpForLevel(level, rankConfig);
    const rank = getTitleForLevel(level, rankConfig);
    rows.push({
      level,
      title: rank.title,
      badge: rank.badge || '🎖',
      minXp,
    });
  }

  return rows;
}

function updateRankThreshold(level, minXp, title, badge) {
  const overrides = loadRankOverrides();
  if (!Array.isArray(overrides.customThresholds)) {
    overrides.customThresholds = [];
  }

  const idx = overrides.customThresholds.findIndex((item) => item.level === level);
  const entry = {
    level: Number(level),
    minXp: Number(minXp),
    title: title || getTitleForLevel(level, getRankConfig(require('../config'))).title,
    badge: badge || '🎖',
  };

  if (idx >= 0) {
    overrides.customThresholds[idx] = { ...overrides.customThresholds[idx], ...entry };
  } else {
    overrides.customThresholds.push(entry);
  }

  overrides.customThresholds.sort((a, b) => a.level - b.level);
  saveRankOverrides(overrides);
  return overrides;
}

module.exports = {
  MAX_XP,
  getRankConfig,
  getMinXpForLevel,
  calculateLevel,
  buildProgressBar,
  syncSessionLevel,
  applyXpChange,
  setLevel,
  buildProfileRankBlock,
  getRankTable,
  updateRankThreshold,
  loadRankOverrides,
  saveRankOverrides,
};
