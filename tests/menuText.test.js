const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMenuText, matchesMenuText } = require('../services/menuText');

test('normalizes corrupted labels for leaderboard and daily reward', () => {
  assert.equal(normalizeMenuText('🏆 Лідерборд'), 'лідерборд');
  assert.equal(normalizeMenuText('� Лідерборд'), 'лідерборд');
  assert.equal(normalizeMenuText('🎁 Забрати нагороду'), 'забрати нагороду');
  assert.equal(normalizeMenuText('�🎁 Забрати нагороду'), 'забрати нагороду');
});

test('matches menu labels even when the text contains replacement characters', () => {
  assert.equal(matchesMenuText('� Лідерборд', '🏆 Лідерборд'), true);
  assert.equal(matchesMenuText('�🎁 Забрати нагороду', '🎁 Забрати нагороду'), true);
  assert.equal(matchesMenuText('📈 Мій прогрес', '📈 Мій прогрес'), true);
});
