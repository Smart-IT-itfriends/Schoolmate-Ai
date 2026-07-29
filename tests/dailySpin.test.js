const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canSpinToday,
  pickReward,
  applyReward,
  spinDaily,
  isSameDay,
} = require('../services/dailySpinService');

const config = {
  dailySpin: {
    freezeFallbackXp: 15,
    rewards: [
      { id: 'nothing', label: 'Нічого', weight: 50, type: 'none' },
      { id: 'xp_10', label: '+10 XP', weight: 50, type: 'xp', amount: 10 },
    ],
  },
};

test('canSpinToday allows one spin per calendar day', () => {
  const session = {};
  assert.equal(canSpinToday(session), true);

  session.lastDailySpinDate = new Date().toISOString();
  assert.equal(canSpinToday(session), false);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  session.lastDailySpinDate = yesterday.toISOString();
  assert.equal(canSpinToday(session), true);
});

test('isSameDay compares calendar dates', () => {
  const base = new Date();
  const morning = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 10, 0, 0);
  const evening = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 22, 0, 0);
  const nextDay = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 1, 0, 0);
  assert.equal(isSameDay(morning, evening), true);
  assert.equal(isSameDay(morning, nextDay), false);
});

test('applyReward grants xp and freeze', () => {
  const session = { xp: 0, hasFreezeItem: false };

  const xpResult = applyReward(session, { type: 'xp', amount: 10, label: '+10 XP' }, config);
  assert.equal(xpResult.type, 'xp');
  assert.equal(session.xp, 10);

  const freezeResult = applyReward(session, { type: 'freeze', label: 'Freeze' }, config);
  assert.equal(freezeResult.type, 'freeze');
  assert.equal(session.hasFreezeItem, true);

  const fallback = applyReward(session, { type: 'freeze', label: 'Freeze' }, config);
  assert.equal(fallback.type, 'xp');
  assert.equal(session.xp, 25);
});

test('spinDaily blocks second spin same day', () => {
  const session = { xp: 0, hasFreezeItem: false };
  const first = spinDaily(session, config);
  assert.equal(first.ok, true);

  const second = spinDaily(session, config);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'already_spun');
});

test('pickReward returns configured reward', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const reward = pickReward(config);
    assert.equal(reward.id, 'xp_10');
  } finally {
    Math.random = originalRandom;
  }
});
