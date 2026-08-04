const SUITS = ['s', 'h', 'd', 'c'];
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_LABELS = {
  14: 'A',
  13: 'K',
  12: 'Q',
  11: 'J',
  10: '10',
  9: '9',
  8: '8',
  7: '7',
  6: '6',
  5: '5',
  4: '4',
  3: '3',
  2: '2',
};

const HAND_NAMES = {
  9: 'Роял-флеш',
  8: 'Стріт-флеш',
  7: 'Каре',
  6: 'Фул-хаус',
  5: 'Флеш',
  4: 'Стріт',
  3: 'Трійка',
  2: 'Дві пари',
  1: 'Пара',
  0: 'Старша карта',
};

function getConfig(config) {
  return config?.poker || {};
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank += 1) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffleDeck(deck, random = Math.random) {
  const cards = deck.slice();
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function deal(deck, count) {
  if (deck.length < count) {
    throw new Error('Not enough cards in deck');
  }
  return deck.splice(0, count);
}

function formatCard(card) {
  return `${RANK_LABELS[card.rank] || card.rank}${SUIT_SYMBOLS[card.suit] || card.suit}`;
}

function formatCards(cards) {
  return (cards || []).map(formatCard).join(' ');
}

function cardKey(card) {
  return `${card.rank}${card.suit}`;
}

function sortByRankDesc(cards) {
  return cards.slice().sort((a, b) => b.rank - a.rank);
}

function isStraightRanks(ranksDesc) {
  const unique = [...new Set(ranksDesc)].sort((a, b) => b - a);
  if (unique.length < 5) return null;

  for (let i = 0; i <= unique.length - 5; i += 1) {
    const slice = unique.slice(i, i + 5);
    if (slice[0] - slice[4] === 4) {
      return slice[0];
    }
  }

  // Wheel: A-5-4-3-2
  if (unique.includes(14) && unique.includes(5) && unique.includes(4) && unique.includes(3) && unique.includes(2)) {
    return 5;
  }
  return null;
}

function evaluateFive(cards) {
  if (!cards || cards.length !== 5) {
    throw new Error('evaluateFive requires exactly 5 cards');
  }

  const sorted = sortByRankDesc(cards);
  const ranks = sorted.map((c) => c.rank);
  const suits = sorted.map((c) => c.suit);
  const flush = suits.every((s) => s === suits[0]);
  const straightHigh = isStraightRanks(ranks);

  const counts = {};
  for (const rank of ranks) {
    counts[rank] = (counts[rank] || 0) + 1;
  }
  const groups = Object.entries(counts)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  const primary = groups[0];
  const secondary = groups[1];

  let category = 0;
  let tiebreakers = ranks;

  if (flush && straightHigh === 14) {
    category = 9;
    tiebreakers = [14];
  } else if (flush && straightHigh) {
    category = 8;
    tiebreakers = [straightHigh];
  } else if (primary.count === 4) {
    category = 7;
    tiebreakers = [primary.rank, secondary.rank];
  } else if (primary.count === 3 && secondary.count === 2) {
    category = 6;
    tiebreakers = [primary.rank, secondary.rank];
  } else if (flush) {
    category = 5;
    tiebreakers = ranks;
  } else if (straightHigh) {
    category = 4;
    tiebreakers = [straightHigh];
  } else if (primary.count === 3) {
    category = 3;
    tiebreakers = [primary.rank, ...groups.slice(1).map((g) => g.rank)];
  } else if (primary.count === 2 && secondary.count === 2) {
    const highPair = Math.max(primary.rank, secondary.rank);
    const lowPair = Math.min(primary.rank, secondary.rank);
    const kicker = groups[2].rank;
    category = 2;
    tiebreakers = [highPair, lowPair, kicker];
  } else if (primary.count === 2) {
    category = 1;
    tiebreakers = [primary.rank, ...groups.slice(1).map((g) => g.rank)];
  } else {
    category = 0;
    tiebreakers = ranks;
  }

  return {
    category,
    name: HAND_NAMES[category],
    tiebreakers,
    cards: sorted,
  };
}

function combinations(arr, k) {
  const result = [];
  function helper(start, path) {
    if (path.length === k) {
      result.push(path.slice());
      return;
    }
    for (let i = start; i < arr.length; i += 1) {
      path.push(arr[i]);
      helper(i + 1, path);
      path.pop();
    }
  }
  helper(0, []);
  return result;
}

function bestHand(cards) {
  if (!cards || cards.length < 5) {
    throw new Error('bestHand requires at least 5 cards');
  }
  if (cards.length === 5) {
    return evaluateFive(cards);
  }

  let best = null;
  for (const combo of combinations(cards, 5)) {
    const scored = evaluateFive(combo);
    if (!best || compareHands(scored, best) > 0) {
      best = scored;
    }
  }
  return best;
}

function compareHands(a, b) {
  if (a.category !== b.category) {
    return a.category - b.category;
  }
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i += 1) {
    const left = a.tiebreakers[i] || 0;
    const right = b.tiebreakers[i] || 0;
    if (left !== right) return left - right;
  }
  return 0;
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

function startDrawHand(random = Math.random) {
  const deck = shuffleDeck(createDeck(), random);
  const playerCards = deal(deck, 5);
  const aiCards = deal(deck, 5);
  return {
    variant: 'draw',
    deck,
    playerCards,
    aiCards,
    discardMask: [false, false, false, false, false],
    stage: 'discard',
  };
}

function chooseAiDiscardIndexes(cards) {
  const evaluated = evaluateFive(cards);
  const keep = new Set();

  if (evaluated.category >= 4) {
    return [];
  }

  if (evaluated.category === 3 || evaluated.category === 1 || evaluated.category === 2) {
    const counts = {};
    cards.forEach((c, idx) => {
      counts[c.rank] = counts[c.rank] || [];
      counts[c.rank].push(idx);
    });
    Object.values(counts).forEach((indexes) => {
      if (indexes.length >= 2) {
        indexes.forEach((i) => keep.add(i));
      }
    });
    if (evaluated.category === 3) {
      // keep trips only; discard kickers
      return cards.map((_, i) => i).filter((i) => !keep.has(i));
    }
    return cards.map((_, i) => i).filter((i) => !keep.has(i));
  }

  // Flush draw: keep 4 of same suit
  const bySuit = {};
  cards.forEach((c, idx) => {
    bySuit[c.suit] = bySuit[c.suit] || [];
    bySuit[c.suit].push(idx);
  });
  const flushDraw = Object.values(bySuit).find((indexes) => indexes.length >= 4);
  if (flushDraw) {
    const keepSet = new Set(flushDraw);
    return cards.map((_, i) => i).filter((i) => !keepSet.has(i));
  }

  // Keep two highest cards
  const ranked = cards
    .map((c, idx) => ({ idx, rank: c.rank }))
    .sort((a, b) => b.rank - a.rank);
  keep.add(ranked[0].idx);
  keep.add(ranked[1].idx);
  return cards.map((_, i) => i).filter((i) => !keep.has(i));
}

function applyDraw(game, playerDiscardIndexes, random = Math.random) {
  const discardSet = new Set(playerDiscardIndexes || []);
  const nextPlayer = game.playerCards.slice();
  const replacements = deal(game.deck, discardSet.size);
  let ri = 0;
  for (let i = 0; i < nextPlayer.length; i += 1) {
    if (discardSet.has(i)) {
      nextPlayer[i] = replacements[ri];
      ri += 1;
    }
  }

  const aiDiscard = chooseAiDiscardIndexes(game.aiCards);
  const nextAi = game.aiCards.slice();
  const aiReplacements = deal(game.deck, aiDiscard.length);
  aiDiscard.forEach((idx, n) => {
    nextAi[idx] = aiReplacements[n];
  });

  // Touch random so seeded tests remain stable if they pass a stub
  void random;

  return {
    ...game,
    playerCards: nextPlayer,
    aiCards: nextAi,
    playerDiscarded: [...discardSet],
    aiDiscarded: aiDiscard,
    stage: 'showdown',
  };
}

function startHoldemHand(random = Math.random) {
  const deck = shuffleDeck(createDeck(), random);
  const playerCards = deal(deck, 2);
  const aiCards = deal(deck, 2);
  return {
    variant: 'holdem',
    deck,
    playerCards,
    aiCards,
    community: [],
    stage: 'preflop',
  };
}

function advanceHoldem(game) {
  if (game.stage === 'preflop') {
    return {
      ...game,
      community: [...game.community, ...deal(game.deck, 3)],
      stage: 'flop',
    };
  }
  if (game.stage === 'flop') {
    return {
      ...game,
      community: [...game.community, ...deal(game.deck, 1)],
      stage: 'turn',
    };
  }
  if (game.stage === 'turn') {
    return {
      ...game,
      community: [...game.community, ...deal(game.deck, 1)],
      stage: 'river',
    };
  }
  return { ...game, stage: 'showdown' };
}

function resolveShowdown(game, bet, config) {
  const settings = getConfig(config);
  const winMultiplier = Number(settings.winMultiplier ?? 1.5);
  const tieRefund = settings.tieRefund !== false;

  let playerHand;
  let aiHand;

  if (game.variant === 'draw') {
    playerHand = evaluateFive(game.playerCards);
    aiHand = evaluateFive(game.aiCards);
  } else {
    playerHand = bestHand([...game.playerCards, ...game.community]);
    aiHand = bestHand([...game.aiCards, ...game.community]);
  }

  const cmp = compareHands(playerHand, aiHand);
  if (cmp > 0) {
    const profit = Math.max(1, Math.floor(bet * winMultiplier));
    return {
      outcome: 'win',
      playerHand,
      aiHand,
      profit,
      netChange: profit,
      payout: bet + profit,
    };
  }
  if (cmp < 0) {
    return {
      outcome: 'loss',
      playerHand,
      aiHand,
      profit: 0,
      netChange: -bet,
      payout: 0,
    };
  }
  return {
    outcome: 'tie',
    playerHand,
    aiHand,
    profit: 0,
    netChange: tieRefund ? 0 : 0,
    payout: tieRefund ? bet : 0,
  };
}

function variantLabel(variant) {
  if (variant === 'draw') return '5-карточний Дро-покер';
  if (variant === 'holdem') return 'Техаський Холдем';
  return 'Покер';
}

module.exports = {
  SUITS,
  HAND_NAMES,
  createDeck,
  shuffleDeck,
  deal,
  formatCard,
  formatCards,
  cardKey,
  evaluateFive,
  bestHand,
  compareHands,
  validateBet,
  startDrawHand,
  chooseAiDiscardIndexes,
  applyDraw,
  startHoldemHand,
  advanceHoldem,
  resolveShowdown,
  variantLabel,
};
