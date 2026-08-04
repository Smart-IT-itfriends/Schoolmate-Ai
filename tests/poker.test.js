const test = require('node:test');
const assert = require('node:assert/strict');
const poker = require('../services/pokerService');

const config = {
  poker: {
    minBet: 10,
    maxBet: 1000,
    winMultiplier: 1.5,
  },
};

function card(rank, suit) {
  return { rank, suit };
}

test('validateBet checks balance and limits', () => {
  assert.equal(poker.validateBet(5, { xp: 100 }, config).ok, false);
  assert.equal(poker.validateBet(50, { xp: 100 }, config).ok, true);
  assert.equal(poker.validateBet(200, { xp: 100 }, config).ok, false);
});

test('evaluateFive detects royal flush and pairs', () => {
  const royal = poker.evaluateFive([
    card(14, 's'),
    card(13, 's'),
    card(12, 's'),
    card(11, 's'),
    card(10, 's'),
  ]);
  assert.equal(royal.category, 9);
  assert.match(royal.name, /Роял/);

  const pair = poker.evaluateFive([
    card(14, 's'),
    card(14, 'h'),
    card(3, 'd'),
    card(7, 'c'),
    card(9, 's'),
  ]);
  assert.equal(pair.category, 1);
});

test('evaluateFive detects wheel straight', () => {
  const wheel = poker.evaluateFive([
    card(14, 's'),
    card(5, 'h'),
    card(4, 'd'),
    card(3, 'c'),
    card(2, 's'),
  ]);
  assert.equal(wheel.category, 4);
  assert.equal(wheel.tiebreakers[0], 5);
});

test('compareHands ranks four of a kind over full house', () => {
  const quads = poker.evaluateFive([
    card(9, 's'),
    card(9, 'h'),
    card(9, 'd'),
    card(9, 'c'),
    card(2, 's'),
  ]);
  const boat = poker.evaluateFive([
    card(8, 's'),
    card(8, 'h'),
    card(8, 'd'),
    card(7, 'c'),
    card(7, 's'),
  ]);
  assert.ok(poker.compareHands(quads, boat) > 0);
});

test('bestHand picks strongest five from seven', () => {
  const hand = poker.bestHand([
    card(14, 's'),
    card(14, 'h'),
    card(14, 'd'),
    card(2, 'c'),
    card(5, 's'),
    card(9, 'h'),
    card(14, 'c'),
  ]);
  assert.equal(hand.category, 7);
});

test('draw and holdem deal flows produce valid showdowns', () => {
  let draw = poker.startDrawHand(() => 0.42);
  draw = poker.applyDraw(draw, [0, 1]);
  const drawResult = poker.resolveShowdown(draw, 100, config);
  assert.ok(['win', 'loss', 'tie'].includes(drawResult.outcome));
  assert.ok(drawResult.playerHand.name);
  assert.ok(drawResult.aiHand.name);

  let holdem = poker.startHoldemHand(() => 0.33);
  holdem = poker.advanceHoldem(holdem);
  assert.equal(holdem.community.length, 3);
  holdem = poker.advanceHoldem(holdem);
  holdem = poker.advanceHoldem(holdem);
  assert.equal(holdem.community.length, 5);
  const holdemResult = poker.resolveShowdown(holdem, 50, config);
  assert.ok(['win', 'loss', 'tie'].includes(holdemResult.outcome));
});

test('resolveShowdown win uses multiplier', () => {
  const game = {
    variant: 'draw',
    playerCards: [
      card(14, 's'),
      card(13, 's'),
      card(12, 's'),
      card(11, 's'),
      card(10, 's'),
    ],
    aiCards: [
      card(2, 'h'),
      card(5, 'd'),
      card(7, 'c'),
      card(9, 's'),
      card(3, 'h'),
    ],
  };
  const result = poker.resolveShowdown(game, 100, config);
  assert.equal(result.outcome, 'win');
  assert.equal(result.profit, 150);
  assert.equal(result.netChange, 150);
});

test('formatCards renders symbols', () => {
  assert.match(poker.formatCards([card(14, 's'), card(10, 'h')]), /A♠/);
  assert.match(poker.formatCards([card(14, 's'), card(10, 'h')]), /10♥/);
});
