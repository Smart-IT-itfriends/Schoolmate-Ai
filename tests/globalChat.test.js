const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMessage, containsLink, containsProfanity } = require('../services/globalChatModeration');
const { SlidingWindowRateLimiter } = require('../services/globalChatRateLimiter');

const baseConfig = {
  globalChat: {
    maxMessageLength: 250,
    blockLinks: true,
    profanityWords: ['badword'],
    slowModeSeconds: 4,
  },
};

test('validateMessage rejects empty and too long text', () => {
  assert.equal(validateMessage('', baseConfig).ok, false);
  assert.equal(validateMessage('ok', baseConfig).ok, true);
  assert.equal(validateMessage('  hi  ', baseConfig).ok, true);
  assert.equal(validateMessage('x'.repeat(251), baseConfig).ok, false);
});

test('validateMessage blocks links', () => {
  assert.equal(validateMessage('дивись https://spam.com', baseConfig).ok, false);
  assert.equal(containsLink('www.example.com'), true);
  assert.equal(containsLink('просто текст'), false);
});

test('validateMessage blocks profanity', () => {
  assert.equal(validateMessage('this is badword here', baseConfig).ok, false);
  assert.equal(containsProfanity('badword', ['badword']), true);
});

test('sliding window rate limiter enforces slowmode', () => {
  const limiter = new SlidingWindowRateLimiter(4000, 1);
  assert.equal(limiter.hit('user1').allowed, true);
  const second = limiter.hit('user1', Date.now() + 1000);
  assert.equal(second.allowed, false);
  assert.ok(second.retryAfterMs > 0);
  const third = limiter.hit('user1', Date.now() + 4001);
  assert.equal(third.allowed, true);
});
