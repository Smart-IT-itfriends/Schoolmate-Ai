const test = require('node:test');
const assert = require('node:assert/strict');
const rankService = require('../services/rankService');
const config = require('../config');

test('calculateLevel uses quadratic thresholds', () => {
  assert.equal(rankService.calculateLevel(0, config).currentLevel, 1);
  assert.equal(rankService.calculateLevel(100, config).currentLevel, 2);
  assert.equal(rankService.calculateLevel(400, config).currentLevel, 3);
  assert.equal(rankService.calculateLevel(750, config).currentLevel, 3);
  assert.equal(rankService.calculateLevel(900, config).currentLevel, 4);
});

test('progress bar and xp to next level', () => {
  const stats = rankService.calculateLevel(750, config);
  assert.equal(stats.currentRankTitle, 'Знавець');
  assert.equal(stats.nextLevelXp, 900);
  assert.equal(stats.xpToNextLevel, 150);
  assert.match(rankService.buildProgressBar(stats.progressPercent), /\[▓+░+\]/);
});

test('applyXpChange levels up and clamps negative xp', () => {
  const session = { xp: 90, level: 1 };
  const result = rankService.applyXpChange(session, 20, config);
  assert.equal(result.leveledUp, true);
  assert.equal(session.level, 2);
  assert.equal(session.xp, 110);

  rankService.applyXpChange(session, -9999, config);
  assert.equal(session.xp, 0);
  assert.equal(session.level, 1);
});

test('setLevel forces minimum xp for level', () => {
  const session = { xp: 50, level: 1 };
  const result = rankService.setLevel(session, 3, config);
  assert.equal(session.xp, 400);
  assert.equal(result.stats.currentLevel, 3);
});

test('normalizeXp handles large values safely', () => {
  const session = { xp: 0, level: 1 };
  rankService.applyXpChange(session, 99999999, config);
  assert.ok(session.level > 5);
  assert.ok(session.xp <= rankService.MAX_XP);
});
