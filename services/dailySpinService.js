const leaderboardService = require('./leaderboardService');
const rankService = require('./rankService');

const DEFAULT_REWARDS = [
  { id: 'nothing', label: 'Нічого 😔', weight: 35, type: 'none' },
  { id: 'xp_10', label: '+10 XP', weight: 40, type: 'xp', amount: 10 },
  { id: 'xp_25', label: '+25 XP', weight: 15, type: 'xp', amount: 25 },
  { id: 'freeze', label: '🧊 Заморозка стріку', weight: 10, type: 'freeze' },
];

function isSameDay(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

function getRewards(config) {
  const configured = config?.dailySpin?.rewards;
  return Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_REWARDS;
}

function canSpinToday(session) {
  if (!session?.lastDailySpinDate) {
    return true;
  }
  return !isSameDay(session.lastDailySpinDate, new Date());
}

function pickReward(config) {
  const rewards = getRewards(config);
  const totalWeight = rewards.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  if (totalWeight <= 0) {
    return rewards[0] || { id: 'nothing', type: 'none', label: 'Нічого' };
  }

  let roll = Math.random() * totalWeight;
  for (const reward of rewards) {
    roll -= Number(reward.weight) || 0;
    if (roll <= 0) {
      return reward;
    }
  }

  return rewards[rewards.length - 1];
}

function applyReward(session, reward, config) {
  const item = reward || { type: 'none', label: 'Нічого' };

  if (item.type === 'xp') {
    const amount = Number(item.amount) || 0;
    rankService.applyXpChange(session, amount, config);
    if (amount > 0) {
      leaderboardService.recordXpChange(session, amount);
    }
    return {
      type: 'xp',
      label: item.label,
      amount,
      message: `🎉 Ти виграв <b>${item.label}</b>!`,
    };
  }

  if (item.type === 'freeze') {
    if (session.hasFreezeItem) {
      const fallbackXp = Number(config?.dailySpin?.freezeFallbackXp || 15);
      rankService.applyXpChange(session, fallbackXp, config);
      leaderboardService.recordXpChange(session, fallbackXp);
      return {
        type: 'xp',
        label: `+${fallbackXp} XP`,
        amount: fallbackXp,
        message: `🧊 Заморозка вже є в інвентарі — замість неї <b>+${fallbackXp} XP</b>!`,
      };
    }

    session.hasFreezeItem = true;
    return {
      type: 'freeze',
      label: item.label,
      message: `🎉 Ти виграв <b>${item.label}</b>!`,
    };
  }

  return {
    type: 'none',
    label: item.label || 'Нічого',
    message: '😔 На жаль, сьогодні без нагороди. Спробуй завтра!',
  };
}

function spinDaily(session, config) {
  if (!canSpinToday(session)) {
    return {
      ok: false,
      code: 'already_spun',
    };
  }

  const levelBefore = rankService.calculateLevel(session.xp || 0, config).currentLevel;
  const reward = pickReward(config);
  const applied = applyReward(session, reward, config);
  session.lastDailySpinDate = new Date().toISOString();

  return {
    ok: true,
    reward,
    applied,
    levelBefore,
  };
}

module.exports = {
  DEFAULT_REWARDS,
  canSpinToday,
  pickReward,
  applyReward,
  spinDaily,
  isSameDay,
};
