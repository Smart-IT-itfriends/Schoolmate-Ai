const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateAnswerPoints,
  determineWinner,
  applyRatingDelta,
} = require('../services/duelScoring');

test('correct fast answer gets base + high speed bonus', () => {
  const points = calculateAnswerPoints({
    isCorrect: true,
    elapsedMs: 0,
    timeoutMs: 20000,
    basePoints: 100,
    maxSpeedBonus: 50,
  });
  assert.equal(points, 150);
});

test('correct slow answer gets lower speed bonus', () => {
  const points = calculateAnswerPoints({
    isCorrect: true,
    elapsedMs: 10000,
    timeoutMs: 20000,
    basePoints: 100,
    maxSpeedBonus: 50,
  });
  assert.equal(points, 125);
});

test('wrong answer always scores 0', () => {
  const points = calculateAnswerPoints({
    isCorrect: false,
    elapsedMs: 1000,
    timeoutMs: 20000,
    basePoints: 100,
    maxSpeedBonus: 50,
  });
  assert.equal(points, 0);
});

test('answer at exact timeout still correct but no speed bonus', () => {
  const points = calculateAnswerPoints({
    isCorrect: true,
    elapsedMs: 20000,
    timeoutMs: 20000,
    basePoints: 100,
    maxSpeedBonus: 50,
  });
  assert.equal(points, 100);
});

test('determineWinner picks higher score', () => {
  const winA = determineWinner(200, 100, 'u1', 'u2');
  assert.equal(winA.result, 'win_a');
  assert.equal(winA.winnerId, 'u1');

  const winB = determineWinner(50, 180, 'u1', 'u2');
  assert.equal(winB.result, 'win_b');
  assert.equal(winB.winnerId, 'u2');
});

test('determineWinner returns draw on equal scores', () => {
  const draw = determineWinner(150, 150, 'u1', 'u2');
  assert.equal(draw.result, 'draw');
  assert.equal(draw.winnerId, null);
});

test('applyRatingDelta updates rating with floor', () => {
  assert.equal(applyRatingDelta(1000, 'win', { win: 15 }), 1015);
  assert.equal(applyRatingDelta(1000, 'draw', { draw: 5 }), 1005);
  assert.equal(applyRatingDelta(3, 'loss', { loss: -5, min: 0 }), 0);
});
