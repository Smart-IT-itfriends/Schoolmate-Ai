const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBotKnowledge } = require('../services/supportKnowledge');
const config = require('../config');

test('support knowledge includes roulette, daily spin and global chat', () => {
  const knowledge = buildBotKnowledge(config);

  assert.match(knowledge, /Щоденна рулетка/);
  assert.match(knowledge, /Рулетка XP/);
  assert.match(knowledge, /Глобальний чат/);
  assert.match(knowledge, /\/daily_spin/);
  assert.match(knowledge, /\/roulette/);
  assert.match(knowledge, /\/global_chat/);
  assert.match(knowledge, /ОКРЕМА функція/);
});

test('support knowledge includes rank system', () => {
  const knowledge = buildBotKnowledge(config);

  assert.match(knowledge, /Система рангів/);
  assert.match(knowledge, /\/profile/);
  assert.match(knowledge, /\/top/);
  assert.match(knowledge, /Level Up/);
});
