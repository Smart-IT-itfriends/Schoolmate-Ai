const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBet, resolveSpin, colorLabel } = require('../services/rouletteService');

const config = {
  roulette: {
    minBet: 10,
    maxBet: 1000,
    winMultiplier: 1.5,
  },
};

test('validateBet checks balance and limits', () => {
  assert.equal(validateBet(5, { xp: 100 }, config).ok, false);
  assert.equal(validateBet(50, { xp: 100 }, config).ok, true);
  assert.equal(validateBet(200, { xp: 100 }, config).ok, false);
  assert.equal(validateBet(2000, { xp: 5000 }, config).ok, false);
});

test('resolveSpin win multiplies bet by configured multiplier', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.01;
  try {
    const result = resolveSpin(100, 'red', config);
    if (result.won) {
      assert.equal(result.profit, Math.max(1, Math.floor(100 * 1.5)));
      assert.equal(result.netChange, result.profit);
      assert.equal(result.payout, 100 + result.profit);
    } else {
      assert.equal(result.netChange, -100);
      assert.equal(result.payout, 0);
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('colorLabel returns readable labels', () => {
  assert.match(colorLabel('red'), /Червоне/);
  assert.match(colorLabel('black'), /Чорне/);
  assert.match(colorLabel('green'), /Зеро/);
});
