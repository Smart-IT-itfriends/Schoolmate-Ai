/**
 * Pure scoring / winner helpers for Knowledge Duels (unit-tested).
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {{ isCorrect: boolean, elapsedMs: number, timeoutMs?: number, basePoints?: number, maxSpeedBonus?: number }} input
 */
function calculateAnswerPoints(input) {
  const timeoutMs = input.timeoutMs ?? 20000;
  const basePoints = input.basePoints ?? 100;
  const maxSpeedBonus = input.maxSpeedBonus ?? 50;

  if (!input.isCorrect) {
    return 0;
  }

  const elapsedMs = clamp(Number(input.elapsedMs) || 0, 0, timeoutMs);
  const remainingRatio = (timeoutMs - elapsedMs) / timeoutMs;
  const speedBonus = Math.round(maxSpeedBonus * remainingRatio);

  return basePoints + speedBonus;
}

/**
 * @param {number} scoreA
 * @param {number} scoreB
 * @param {string} playerAId
 * @param {string} playerBId
 * @returns {{ winnerId: string|null, result: 'win_a'|'win_b'|'draw' }}
 */
function determineWinner(scoreA, scoreB, playerAId, playerBId) {
  const a = Number(scoreA) || 0;
  const b = Number(scoreB) || 0;

  if (a === b) {
    return { winnerId: null, result: 'draw' };
  }

  if (a > b) {
    return { winnerId: String(playerAId), result: 'win_a' };
  }

  return { winnerId: String(playerBId), result: 'win_b' };
}

/**
 * @param {number} currentRating
 * @param {'win'|'loss'|'draw'} outcome
 * @param {{ win?: number, loss?: number, draw?: number, min?: number }} deltas
 */
function applyRatingDelta(currentRating, outcome, deltas = {}) {
  const win = deltas.win ?? 15;
  const loss = deltas.loss ?? -5;
  const draw = deltas.draw ?? 5;
  const min = deltas.min ?? 0;
  const current = Number.isFinite(currentRating) ? currentRating : 1000;

  let next = current;
  if (outcome === 'win') next += win;
  else if (outcome === 'loss') next += loss;
  else next += draw;

  return Math.max(min, next);
}

module.exports = {
  calculateAnswerPoints,
  determineWinner,
  applyRatingDelta,
  clamp,
};
