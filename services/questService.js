const fs = require('fs');
const path = require('path');

const QUESTS_FILE = path.join(__dirname, '..', 'data', 'quests.json');
const USER_QUESTS_FILE = path.join(__dirname, '..', 'data', 'user_quests.json');

function loadQuests() {
  try {
    const data = JSON.parse(fs.readFileSync(QUESTS_FILE, 'utf8') || '{"quests":[]}');
    return Array.isArray(data.quests) ? data.quests : [];
  } catch {
    return [];
  }
}

function loadUserQuestsData() {
  try {
    const data = JSON.parse(fs.readFileSync(USER_QUESTS_FILE, 'utf8') || '{"userQuests":{}}');
    return data.userQuests && typeof data.userQuests === 'object' ? data : { userQuests: {} };
  } catch {
    return { userQuests: {} };
  }
}

function saveUserQuestsData(data) {
  fs.writeFileSync(USER_QUESTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getQuestById(questId) {
  return loadQuests().find((quest) => quest.id === questId) || null;
}

function getActiveQuests() {
  return loadQuests();
}

function createProgressRecord() {
  return {
    currentProgress: 0,
    isCompleted: false,
    completedAt: null,
  };
}

function ensureUserQuests(userId) {
  const data = loadUserQuestsData();
  const key = String(userId);

  if (!data.userQuests[key]) {
    data.userQuests[key] = {};
  }

  const userProgress = data.userQuests[key];
  let changed = false;

  for (const quest of getActiveQuests()) {
    if (!userProgress[quest.id]) {
      userProgress[quest.id] = createProgressRecord();
      changed = true;
    }
  }

  if (changed) {
    saveUserQuestsData(data);
  }

  return userProgress;
}

function getUserQuestEntries(userId) {
  const progressMap = ensureUserQuests(userId);
  const quests = getActiveQuests();

  return quests.map((quest) => {
    const progress = progressMap[quest.id] || createProgressRecord();
    return { quest, progress };
  });
}

function buildProgressBar(current, total, width = 10) {
  if (total <= 0) {
    return `[${'░'.repeat(width)}]`;
  }

  const safeCurrent = Math.max(0, Math.min(current, total));
  const filled = Math.round((safeCurrent / total) * width);
  return `[${'▓'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}

function formatQuestEntry(quest, progress) {
  const current = progress.isCompleted
    ? quest.targetCount
    : Math.min(progress.currentProgress || 0, quest.targetCount);
  const bar = buildProgressBar(current, quest.targetCount);
  const status = progress.isCompleted ? ' ✅' : '';

  return [
    `${quest.emoji || '🎯'} <b>${quest.title}</b>${status}`,
    quest.description,
    `Прогрес: ${bar} ${current}/${quest.targetCount}`,
    `Нагорода: <b>+${quest.rewardPoints} балів</b>`,
  ].join('\n');
}

function formatQuestsList(userId) {
  const entries = getUserQuestEntries(userId);

  if (entries.length === 0) {
    return '🏆 <b>Твої квести:</b>\n\nПоки що немає доступних квестів.';
  }

  const body = entries.map(({ quest, progress }) => formatQuestEntry(quest, progress)).join('\n\n');
  return `🏆 <b>Твої квести:</b>\n\n${body}`;
}

function buildTriumphMessage(quest) {
  return `🎉 Вітаємо! Квест «<b>${quest.title}</b>» виконано! Тобі нараховано <b>+${quest.rewardPoints}</b> балів! 🏆`;
}

/**
 * Event-driven progress update for matching active quests.
 * Awards XP once when a non-repeatable quest reaches target_count.
 */
function triggerQuestProgress(userId, targetType, session) {
  const data = loadUserQuestsData();
  const key = String(userId);

  if (!data.userQuests[key]) {
    data.userQuests[key] = {};
  }

  const userProgress = data.userQuests[key];
  const completions = [];
  let changed = false;

  for (const quest of getActiveQuests()) {
    if (quest.targetType !== targetType) {
      continue;
    }

    if (!userProgress[quest.id]) {
      userProgress[quest.id] = createProgressRecord();
      changed = true;
    }

    const progress = userProgress[quest.id];

    if (progress.isCompleted && !quest.repeatable) {
      continue;
    }

    if (progress.isCompleted && quest.repeatable) {
      progress.isCompleted = false;
      progress.currentProgress = 0;
      progress.completedAt = null;
    }

    progress.currentProgress = (progress.currentProgress || 0) + 1;
    changed = true;

    if (progress.currentProgress >= quest.targetCount) {
      progress.currentProgress = quest.targetCount;
      progress.isCompleted = true;
      progress.completedAt = new Date().toISOString();

      if (session) {
        session.xp = (session.xp || 0) + quest.rewardPoints;
      }

      completions.push({
        questId: quest.id,
        title: quest.title,
        rewardPoints: quest.rewardPoints,
        message: buildTriumphMessage(quest),
      });
    }
  }

  if (changed) {
    saveUserQuestsData(data);
  }

  return { completions, changed };
}

module.exports = {
  loadQuests,
  getQuestById,
  getActiveQuests,
  ensureUserQuests,
  getUserQuestEntries,
  buildProgressBar,
  formatQuestsList,
  buildTriumphMessage,
  triggerQuestProgress,
};
