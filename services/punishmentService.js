const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

function getHoursSince(lastActivityDate) {
  if (!lastActivityDate) {
    return 0;
  }

  const lastActivity = new Date(lastActivityDate);
  if (Number.isNaN(lastActivity.getTime())) {
    return 0;
  }

  return (Date.now() - lastActivity.getTime()) / MS_HOUR;
}

function getDaysSince(lastActivityDate) {
  return getHoursSince(lastActivityDate) / 24;
}

function fillTemplate(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );
}

function checkInactivityPunishment(session, config) {
  if (!session || session.step !== 'completed') {
    return { session, messages: [], changed: false };
  }

  const punishmentConfig = config.punishment || {};
  const softThresholdHours = punishmentConfig.softThresholdHours ?? 24;
  const hardThresholdDays = punishmentConfig.hardThresholdDays ?? 3;
  const xpPenalty = punishmentConfig.xpPenalty ?? 50;

  const hoursSince = getHoursSince(session.lastActivityDate);
  if (hoursSince < softThresholdHours) {
    return { session, messages: [], changed: false };
  }

  if (session.hasFreezeItem) {
    session.hasFreezeItem = false;
    return {
      session,
      messages: [config.messages.punishmentFreezeUsed],
      changed: true,
    };
  }

  const messages = [];
  let changed = false;
  const daysSince = getDaysSince(session.lastActivityDate);

  if ((session.dailyStreak || 0) > 0) {
    session.dailyStreak = 0;
    changed = true;
  }

  if (daysSince >= hardThresholdDays) {
    const previousXp = session.xp || 0;
    session.xp = Math.max(0, previousXp - xpPenalty);
    const deductedXp = previousXp - session.xp;
    changed = true;

    messages.push(
      fillTemplate(config.messages.punishmentHard, {
        xp: deductedXp,
        remaining: session.xp,
      })
    );
  } else {
    messages.push(config.messages.punishmentSoft);
  }

  return { session, messages, changed };
}

function getActivityStatus(session, config) {
  const punishmentConfig = config.punishment || {};
  const riskThresholdHours = punishmentConfig.riskThresholdHours ?? 18;

  const hoursSince = getHoursSince(session.lastActivityDate);
  const streak = session.dailyStreak || 0;

  if (streak === 0) {
    return config.messages.progressStatusCold;
  }

  if (hoursSince >= riskThresholdHours) {
    return config.messages.progressStatusRisk;
  }

  return config.messages.progressStatusActive;
}

function touchActivity(session) {
  session.lastActivityDate = new Date().toISOString();
  return session;
}

function buyFreezeItem(session, config) {
  const cost = config.punishment?.freezeItemCost ?? 100;
  const xp = session.xp || 0;

  if (session.hasFreezeItem) {
    return { success: false, message: config.messages.freezeAlreadyOwned };
  }

  if (xp < cost) {
    return {
      success: false,
      message: fillTemplate(config.messages.freezeNotEnoughXp, { cost }),
    };
  }

  session.xp = xp - cost;
  session.hasFreezeItem = true;

  return {
    success: true,
    message: fillTemplate(config.messages.freezePurchased, { cost }),
  };
}

function countAtRiskUsers(userService, config) {
  const users = userService.loadUsers();
  const softThresholdHours = config.punishment?.softThresholdHours ?? 24;
  let atRisk = 0;

  for (const session of Object.values(users)) {
    if (session.step !== 'completed') {
      continue;
    }

    if (getHoursSince(session.lastActivityDate) >= softThresholdHours) {
      atRisk += 1;
    }
  }

  return atRisk;
}

module.exports = {
  getHoursSince,
  getDaysSince,
  checkInactivityPunishment,
  getActivityStatus,
  touchActivity,
  buyFreezeItem,
  countAtRiskUsers,
};
