function getConfig(config) {
  return config?.roulette || {};
}

function validateBet(amount, session, config) {
  const settings = getConfig(config);
  const minBet = Number(settings.minBet || 5);
  const maxBet = Number(settings.maxBet || 5000);
  const bet = Number(amount);

  if (!Number.isFinite(bet) || bet <= 0) {
    return { ok: false, message: 'Введи коректну суму ставки (ціле число).' };
  }

  if (bet < minBet) {
    return { ok: false, message: `Мінімальна ставка: ${minBet} XP.` };
  }

  if (bet > maxBet) {
    return { ok: false, message: `Максимальна ставка: ${maxBet} XP.` };
  }

  const balance = Number.isFinite(session?.xp) ? session.xp : 0;
  if (bet > balance) {
    return { ok: false, message: `Недостатньо XP. У тебе ${balance} XP.` };
  }

  return { ok: true, bet: Math.floor(bet) };
}

function spinWheel() {
  const pocket = Math.floor(Math.random() * 37);
  let color = 'green';
  if (pocket >= 1 && pocket <= 36) {
    const reds = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    color = reds.has(pocket) ? 'red' : 'black';
  }
  return { pocket, color };
}

function resolveSpin(bet, chosenColor, config) {
  const settings = getConfig(config);
  const winMultiplier = Number(settings.winMultiplier ?? settings.winProfitPercent ?? 1.5);
  const wheel = spinWheel();
  const won = wheel.color === chosenColor;

  if (won) {
    const profit = Math.max(1, Math.floor(bet * winMultiplier));
    return {
      won: true,
      wheel,
      profit,
      netChange: profit,
      payout: bet + profit,
    };
  }

  return {
    won: false,
    wheel,
    profit: 0,
    netChange: -bet,
    payout: 0,
  };
}

function colorLabel(color) {
  if (color === 'red') return '🔴 Червоне';
  if (color === 'black') return '⚫ Чорне';
  return '🟢 Зеро';
}

module.exports = {
  validateBet,
  spinWheel,
  resolveSpin,
  colorLabel,
};
