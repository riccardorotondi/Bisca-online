export type SuitKey = 'DIAMONDS' | 'HEARTS' | 'CLUBS' | 'SPADES';

export type Card = {
  value: number;
  suit: SuitKey;
};

export type Player = {
  id: number;
  cards: Card[];
  bid: number;
  tricksWon: number;
};

export type TrickCard = {
  playerId: number;
  card: Card;
  asZero: boolean;
};

export type TrickHistory = {
  round: number;
  cards: TrickCard[];
  winner: number;
};

export type GameState = {
  players: Player[];
  currentPlayer: number;
  trickCards: TrickCard[];
  trickStarter: number;
  roundNumber: number;
  cardsPerPlayer: number;
  history: TrickHistory[];
};

export const MAX_HAND_SIZE = 5;
export const MIN_HAND_SIZE = 1;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const SUITS: Record<SuitKey, { symbol: string; strength: number; color: string; label: string; shortLabel: string }> = {
  DIAMONDS: { symbol: '●', strength: 4, color: '#c58a06', label: 'Ori', shortLabel: 'ORI' },
  HEARTS: { symbol: '♥', strength: 3, color: '#b91c1c', label: 'Coppe', shortLabel: 'COPPE' },
  CLUBS: { symbol: '⚔', strength: 2, color: '#1f2937', label: 'Spade', shortLabel: 'SPADE' },
  SPADES: { symbol: '❚', strength: 1, color: '#7c2d12', label: 'Bastoni', shortLabel: 'BAST.' },
};

const SUIT_ORDER: SuitKey[] = ['DIAMONDS', 'HEARTS', 'CLUBS', 'SPADES'];

export function cardLabel(card: Card): string {
  return `${cardRankLabel(card)} ${SUITS[card.suit].label}`;
}

export function cardRankLabel(card: Card): string {
  const labels: Record<number, string> = { 1: 'A', 8: 'F', 9: 'C', 10: 'R' };
  return labels[card.value] ?? String(card.value);
}

export function cardName(card: Card): string {
  const labels: Record<number, string> = { 1: 'Asso', 8: 'Fante', 9: 'Cavallo', 10: 'Re' };
  return `${labels[card.value] ?? card.value} di ${SUITS[card.suit].label}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return a.value === b.value && a.suit === b.suit;
}

export function isJoker(card: Card): boolean {
  return card.value === 1 && card.suit === 'DIAMONDS';
}

export function getStrength(card: Card, asZero = false): number {
  if (isJoker(card)) {
    return asZero ? 0 : 1000;
  }

  return SUITS[card.suit].strength * 100 + card.value;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const suit of SUIT_ORDER) {
    for (let value = 1; value <= 10; value += 1) {
      deck.push({ value, suit });
    }
  }

  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex] as Card;
    shuffled[swapIndex] = current as Card;
  }

  return shuffled;
}

export function clampPlayerCount(playerCount: number): number {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
}

export function createNewGame(playerCount = MIN_PLAYERS): GameState {
  const safePlayerCount = clampPlayerCount(playerCount);
  return createHand(Array.from({ length: safePlayerCount }, (_, id) => id), MAX_HAND_SIZE);
}

export function normalizeCardsPerPlayer(cardsPerPlayer: number): number {
  return Math.max(MIN_HAND_SIZE, Math.min(MAX_HAND_SIZE, Math.floor(cardsPerPlayer)));
}

export function getCardsForHand(handNumber: number): number {
  const cycleIndex = (Math.max(1, handNumber) - 1) % MAX_HAND_SIZE;
  return MAX_HAND_SIZE - cycleIndex;
}

export function createHand(playerIds: number[], cardsPerPlayer = MAX_HAND_SIZE): GameState {
  const safeCardsPerPlayer = normalizeCardsPerPlayer(cardsPerPlayer);
  const deck = shuffleDeck(createDeck());
  const players: Player[] = playerIds.map((id, index) => ({
    id,
    cards: deck.slice(index * safeCardsPerPlayer, (index + 1) * safeCardsPerPlayer),
    bid: -1,
    tricksWon: 0,
  }));
  const firstPlayer = players[0]?.id ?? 0;

  return {
    players,
    currentPlayer: firstPlayer,
    trickCards: [],
    trickStarter: firstPlayer,
    roundNumber: 1,
    cardsPerPlayer: safeCardsPerPlayer,
    history: [],
  };
}

export function cloneState(state: GameState): GameState {
  return {
    players: state.players.map((player) => ({
      ...player,
      cards: player.cards.map((card) => ({ ...card })),
    })),
    currentPlayer: state.currentPlayer,
    trickCards: state.trickCards.map((entry) => ({ ...entry, card: { ...entry.card } })),
    trickStarter: state.trickStarter,
    roundNumber: state.roundNumber,
    cardsPerPlayer: state.cardsPerPlayer,
    history: state.history.map((trick) => ({
      ...trick,
      cards: trick.cards.map((entry) => ({ ...entry, card: { ...entry.card } })),
    })),
  };
}

export function getValidMoves(state: GameState, playerId: number): Array<{ card: Card; asZero: boolean }> {
  const player = getPlayer(state, playerId);
  if (!player) {
    return [];
  }

  return player.cards.flatMap((card) => {
    if (isJoker(card)) {
      return [
        { card, asZero: false },
        { card, asZero: true },
      ];
    }

    return [{ card, asZero: false }];
  });
}

export function playCard(state: GameState, playerId: number, card: Card, asZero = false): GameState {
  const next = cloneState(state);
  const playerIndex = getPlayerIndex(next, playerId);
  const player = next.players[playerIndex];

  if (!player || next.currentPlayer !== playerId) {
    return next;
  }

  const cardIndex = player.cards.findIndex((candidate) => sameCard(candidate, card));
  if (cardIndex < 0) {
    return next;
  }

  const [playedCard] = player.cards.splice(cardIndex, 1);
  next.trickCards.push({ playerId, card: playedCard as Card, asZero });

  if (next.trickCards.length === next.players.length) {
    resolveTrick(next);
  } else {
    const nextPlayer = next.players[(playerIndex + 1) % next.players.length];
    next.currentPlayer = nextPlayer?.id ?? next.currentPlayer;
  }

  return next;
}

function resolveTrick(state: GameState): void {
  let winner = state.trickCards[0]?.playerId ?? 0;
  let maxStrength = -1;

  for (const entry of state.trickCards) {
    const strength = getStrength(entry.card, entry.asZero);
    if (strength > maxStrength) {
      maxStrength = strength;
      winner = entry.playerId;
    }
  }

  const winningPlayer = getPlayer(state, winner);
  if (winningPlayer) {
    winningPlayer.tricksWon += 1;
  }

  state.history.push({
    round: state.roundNumber,
    cards: state.trickCards.map((entry) => ({ ...entry, card: { ...entry.card } })),
    winner,
  });

  state.trickCards = [];
  state.currentPlayer = winner;
  state.trickStarter = winner;
  state.roundNumber += 1;
}

export function isGameOver(state: GameState): boolean {
  return state.players.every((player) => player.cards.length === 0);
}

export function evaluateState(state: GameState, playerId: number): number {
  const player = getPlayer(state, playerId);
  if (!player) {
    return -100;
  }

  if (isGameOver(state)) {
    return player.tricksWon === player.bid ? 100 : -100;
  }

  const tricksRemaining = state.cardsPerPlayer - state.roundNumber + 1;
  const tricksNeeded = player.bid - player.tricksWon;

  if (tricksNeeded < 0 || tricksNeeded > tricksRemaining) {
    return -50;
  }

  const idealProgress = (player.bid * (state.roundNumber - 1)) / state.cardsPerPlayer;
  const diff = Math.abs(idealProgress - player.tricksWon);
  return 20 - diff * 10;
}

export function playerLabel(playerId: number): string {
  return playerId === 0 ? 'Tu' : `AI ${playerId}`;
}

export function getPlayerIndex(state: GameState, playerId: number): number {
  return state.players.findIndex((player) => player.id === playerId);
}

export function getPlayer(state: GameState, playerId: number): Player | undefined {
  const index = getPlayerIndex(state, playerId);
  return index >= 0 ? state.players[index] : undefined;
}

export function setBid(state: GameState, playerId: number, bid: number): GameState {
  return {
    ...state,
    players: state.players.map((player) => (player.id === playerId ? { ...player, bid } : player)),
  };
}

export function getBidTotal(state: GameState): number {
  return state.players.reduce((total, player) => total + Math.max(player.bid, 0), 0);
}

export function getAllowedBids(state: GameState, playerId: number): number[] {
  const allBids = Array.from({ length: state.cardsPerPlayer + 1 }, (_, bid) => bid);
  const isLastBidder = state.players[state.players.length - 1]?.id === playerId;

  if (!isLastBidder) {
    return allBids;
  }

  const previousTotal = state.players
    .filter((player) => player.id !== playerId)
    .reduce((total, player) => total + Math.max(player.bid, 0), 0);
  const forbiddenBid = state.cardsPerPlayer - previousTotal;

  return allBids.filter((bid) => bid !== forbiddenBid);
}

export function chooseLegalBid(state: GameState, playerId: number, preferredBid: number): number {
  const allowed = getAllowedBids(state, playerId);
  if (allowed.includes(preferredBid)) {
    return preferredBid;
  }

  return allowed.reduce((best, bid) => {
    const currentDistance = Math.abs(bid - preferredBid);
    const bestDistance = Math.abs(best - preferredBid);
    return currentDistance < bestDistance ? bid : best;
  }, allowed[0] ?? 0);
}

export class BiscaSolver {
  private transpositionTable = new Map<string, { score: number; move: { card: Card; asZero: boolean } | null }>();

  findOptimalBid(cards: Card[]): number {
    const scores = cards.map((card) => {
      if (isJoker(card)) {
        return 10;
      }

      const normalized = (getStrength(card) - 100) / 310;
      return normalized * 10;
    });

    const average = scores.reduce((total, score) => total + score, 0) / scores.length;

    if (average >= 8) return 4;
    if (average >= 6) return 3;
    if (average >= 4) return 2;
    if (average >= 2) return 1;
    return 0;
  }

  getBestMove(state: GameState, playerId: number, depth = 4): { card: Card; asZero: boolean } {
    this.transpositionTable.clear();
    const result = this.minimax(state, depth, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, playerId);
    return result.move ?? getValidMoves(state, playerId)[0] ?? { card: getPlayer(state, playerId)?.cards[0] as Card, asZero: false };
  }

  private minimax(
    state: GameState,
    depth: number,
    alpha: number,
    beta: number,
    maximizingPlayer: number,
  ): { score: number; move: { card: Card; asZero: boolean } | null } {
    if (depth === 0 || isGameOver(state)) {
      return { score: evaluateState(state, maximizingPlayer), move: null };
    }

    const key = this.hashState(state);
    const cached = this.transpositionTable.get(key);
    if (cached) {
      return cached;
    }

    const currentPlayer = state.currentPlayer;
    const isMaximizing = currentPlayer === maximizingPlayer;
    let bestMove: { card: Card; asZero: boolean } | null = null;

    if (isMaximizing) {
      let maxScore = Number.NEGATIVE_INFINITY;

      for (const move of getValidMoves(state, currentPlayer)) {
        const nextState = playCard(state, currentPlayer, move.card, move.asZero);
        const { score } = this.minimax(nextState, depth - 1, alpha, beta, maximizingPlayer);

        if (score > maxScore) {
          maxScore = score;
          bestMove = move;
        }

        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }

      const result = { score: maxScore, move: bestMove };
      this.transpositionTable.set(key, result);
      return result;
    }

    let minScore = Number.POSITIVE_INFINITY;

    for (const move of getValidMoves(state, currentPlayer)) {
      const nextState = playCard(state, currentPlayer, move.card, move.asZero);
      const { score } = this.minimax(nextState, depth - 1, alpha, beta, maximizingPlayer);

      if (score < minScore) {
        minScore = score;
        bestMove = move;
      }

      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }

    const result = { score: minScore, move: bestMove };
    this.transpositionTable.set(key, result);
    return result;
  }

  private hashState(state: GameState): string {
    const playerParts = state.players.map((player) => {
      const cards = player.cards.map(cardLabel).sort().join(',');
      return `P${player.id}:${cards}:B${player.bid}:W${player.tricksWon}`;
    });

    const trick = state.trickCards
      .map((entry) => `${entry.playerId}-${cardLabel(entry.card)}-${entry.asZero}`)
      .join(',');

    return `${playerParts.join('|')}|T:${trick}|R${state.roundNumber}:CP${state.currentPlayer}`;
  }
}
