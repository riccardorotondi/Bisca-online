import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { CardView } from './src/components/CardView';
import {
  BiscaSolver,
  Card,
  GameState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TrickHistory,
  cardLabel,
  cardName,
  chooseLegalBid,
  createHand,
  createNewGame,
  getAllowedBids,
  getBidTotal,
  getCardsForHand,
  isGameOver,
  isJoker,
  playCard,
  playerLabel,
  setBid,
} from './src/game/bisca';

type Phase = 'setup' | 'bidding' | 'playing' | 'handOver' | 'matchOver';
type OnlineRole = 'offline' | 'host' | 'guest';
type LobbyMember = { clientId: string; playerId: number; isHost: boolean };
type OnlineAction =
  | { kind: 'bid'; bid: number }
  | { kind: 'play'; card: Card; asZero: boolean }
  | { kind: 'nextHand' };
type OnlineSnapshot = {
  playerCount: number;
  startingLives: number;
  livesByPlayerId: Record<number, number>;
  activePlayerIds: number[];
  eliminatedPlayerIds: number[];
  lastHandDamagedIds: number[];
  handNumber: number;
  game: GameState;
  phase: Phase;
  currentBidderIndex: number;
  trickPause: boolean;
  completedTrick: TrickHistory | null;
  lastMove: string | null;
  matchWinnerId: number | null;
};

const PLAYER_OPTIONS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => index + MIN_PLAYERS);
const LIFE_OPTIONS = [1, 2, 3, 4, 5];
const AI_PLAY_DELAY_MS = 1100;
const TRICK_REVEAL_MS = 2300;
const LOBBY_PORT = 8787;

function getPublicEnv(name: string) {
  const maybeProcess = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };

  return maybeProcess.process?.env?.[name];
}

function getBrowserLocation() {
  return (globalThis as unknown as { location?: Location }).location;
}

function getInitialLobbyId() {
  const location = getBrowserLocation();
  if (!location?.search) {
    return '';
  }

  return new URLSearchParams(location.search).get('lobby') ?? '';
}

function getLobbyWsUrl() {
  const configuredUrl = getPublicEnv('EXPO_PUBLIC_LOBBY_WS_URL');
  if (configuredUrl) {
    return configuredUrl;
  }

  const location = getBrowserLocation();
  const host = location?.hostname || 'localhost';
  return `ws://${host}:${LOBBY_PORT}`;
}

function getInviteLink(lobbyId: string) {
  const location = getBrowserLocation();
  if (!location) {
    return lobbyId;
  }

  return `${location.protocol}//${location.host}${location.pathname}?lobby=${lobbyId}`;
}

export default function App() {
  const solverRef = useRef(new BiscaSolver());
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<{
    game: GameState;
    phase: Phase;
    currentBidderIndex: number;
    activePlayerIds: number[];
    livesByPlayerId: Record<number, number>;
    startingLives: number;
    onlineRole: OnlineRole;
    trickPause: boolean;
  } | null>(null);
  const initialLobbyId = useMemo(getInitialLobbyId, []);
  const [playerCount, setPlayerCount] = useState(MIN_PLAYERS);
  const [startingLives, setStartingLives] = useState(3);
  const [livesByPlayerId, setLivesByPlayerId] = useState<Record<number, number>>({ 0: 3, 1: 3 });
  const [activePlayerIds, setActivePlayerIds] = useState<number[]>([0, 1]);
  const [eliminatedPlayerIds, setEliminatedPlayerIds] = useState<number[]>([]);
  const [lastHandDamagedIds, setLastHandDamagedIds] = useState<number[]>([]);
  const [handNumber, setHandNumber] = useState(1);
  const [game, setGame] = useState<GameState>(() => createNewGame(MIN_PLAYERS));
  const [phase, setPhase] = useState<Phase>('setup');
  const [currentBidderIndex, setCurrentBidderIndex] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [trickPause, setTrickPause] = useState(false);
  const [completedTrick, setCompletedTrick] = useState<TrickHistory | null>(null);
  const [selectedJoker, setSelectedJoker] = useState<Card | null>(null);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [matchWinnerId, setMatchWinnerId] = useState<number | null>(null);
  const [onlineRole, setOnlineRole] = useState<OnlineRole>('offline');
  const [lobbyId, setLobbyId] = useState(initialLobbyId);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [myPlayerId, setMyPlayerId] = useState(0);
  const [onlineStatus, setOnlineStatus] = useState(initialLobbyId ? 'Link lobby rilevato' : 'Offline');

  const isOnline = onlineRole !== 'offline';
  const isHost = onlineRole === 'host';
  const localPlayerId = isOnline ? myPlayerId : 0;
  const connectedPlayerIds = useMemo(
    () => lobbyMembers.map((member) => member.playerId).sort((a, b) => a - b),
    [lobbyMembers],
  );
  const human = game.players.find((player) => player.id === localPlayerId);
  const currentBidder = game.players[currentBidderIndex];
  const latestTrick = completedTrick ?? game.history[game.history.length - 1] ?? null;
  const tableCards = game.trickCards.length > 0 ? game.trickCards : trickPause && completedTrick ? completedTrick.cards : [];
  const totalBid = getBidTotal(game);
  const isBlindOneCardBid = phase === 'bidding' && game.cardsPerPlayer === 1;
  const bidOptions = useMemo(() => Array.from({ length: game.cardsPerPlayer + 1 }, (_, bid) => bid), [game.cardsPerPlayer]);
  const allowedCurrentBids = useMemo(
    () => (currentBidder ? getAllowedBids(game, currentBidder.id) : []),
    [currentBidder, game],
  );
  const isHumanTurn = phase === 'playing' && game.currentPlayer === localPlayerId && !isGameOver(game) && !trickPause;
  const forbiddenLastBid = useMemo(() => {
    if (!currentBidder || currentBidderIndex !== game.players.length - 1) {
      return null;
    }

    const previousTotal = game.players
      .filter((player) => player.id !== currentBidder.id)
      .reduce((total, player) => total + Math.max(player.bid, 0), 0);
    const forbidden = game.cardsPerPlayer - previousTotal;
    return forbidden >= 0 && forbidden <= game.cardsPerPlayer ? forbidden : null;
  }, [currentBidder, currentBidderIndex, game]);

  function labelPlayer(playerId: number) {
    if (isOnline) {
      if (playerId === localPlayerId) {
        return 'Tu';
      }

      return playerId === 0 ? 'Host' : `Giocatore ${playerId + 1}`;
    }

    return playerLabel(playerId);
  }

  function sendOnline(message: unknown) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }

  function makeSnapshot(): OnlineSnapshot {
    return {
      playerCount,
      startingLives,
      livesByPlayerId,
      activePlayerIds,
      eliminatedPlayerIds,
      lastHandDamagedIds,
      handNumber,
      game,
      phase,
      currentBidderIndex,
      trickPause,
      completedTrick,
      lastMove,
      matchWinnerId,
    };
  }

  function applySnapshot(snapshot: OnlineSnapshot) {
    setPlayerCount(snapshot.playerCount);
    setStartingLives(snapshot.startingLives);
    setLivesByPlayerId(snapshot.livesByPlayerId);
    setActivePlayerIds(snapshot.activePlayerIds);
    setEliminatedPlayerIds(snapshot.eliminatedPlayerIds);
    setLastHandDamagedIds(snapshot.lastHandDamagedIds);
    setHandNumber(snapshot.handNumber);
    setGame(snapshot.game);
    setPhase(snapshot.phase);
    setCurrentBidderIndex(snapshot.currentBidderIndex);
    setThinking(false);
    setTrickPause(snapshot.trickPause);
    setCompletedTrick(snapshot.completedTrick);
    setSelectedJoker(null);
    setLastMove(snapshot.lastMove);
    setMatchWinnerId(snapshot.matchWinnerId);
  }

  function connectLobby(kind: 'create' | 'join', targetLobbyId = lobbyId) {
    wsRef.current?.close();
    setOnlineStatus('Connessione lobby...');

    const ws = new WebSocket(getLobbyWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      sendOnline(kind === 'create' ? { type: 'create' } : { type: 'join', lobbyId: targetLobbyId });
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));

      if (message.type === 'created') {
        setOnlineRole('host');
        setLobbyId(message.lobbyId);
        setMyPlayerId(message.playerId);
        setOnlineStatus('Lobby creata');
        return;
      }

      if (message.type === 'joined') {
        setOnlineRole('guest');
        setLobbyId(message.lobbyId);
        setMyPlayerId(message.playerId);
        setOnlineStatus('Entrato in lobby');
        return;
      }

      if (message.type === 'members') {
        setLobbyMembers(message.members ?? []);
        return;
      }

      if (message.type === 'snapshot' && message.payload) {
        if (stateRef.current?.onlineRole !== 'host') {
          applySnapshot(message.payload);
        }
        return;
      }

      if (message.type === 'action' && stateRef.current?.onlineRole === 'host') {
        handleRemoteAction(message.playerId, message.action);
        return;
      }

      if (message.type === 'closed') {
        setOnlineRole('offline');
        setOnlineStatus('Lobby chiusa');
        setLobbyMembers([]);
        return;
      }

      if (message.type === 'error') {
        setOnlineStatus(message.message ?? 'Errore lobby');
      }
    };

    ws.onclose = () => {
      setOnlineStatus((status) => (status === 'Offline' ? status : 'Disconnesso dalla lobby'));
    };
  }

  function leaveLobby() {
    wsRef.current?.close();
    wsRef.current = null;
    setOnlineRole('offline');
    setLobbyMembers([]);
    setLobbyId('');
    setMyPlayerId(0);
    setOnlineStatus('Offline');
  }

  useEffect(() => {
    stateRef.current = {
      game,
      phase,
      currentBidderIndex,
      activePlayerIds,
      livesByPlayerId,
      startingLives,
      onlineRole,
      trickPause,
    };
  });

  useEffect(() => {
    if (initialLobbyId) {
      connectLobby('join', initialLobbyId);
    }

    return () => wsRef.current?.close();
  }, []);

  useEffect(() => {
    if (isHost) {
      sendOnline({ type: 'snapshot', payload: makeSnapshot() });
    }
  }, [
    isHost,
    playerCount,
    startingLives,
    livesByPlayerId,
    activePlayerIds,
    eliminatedPlayerIds,
    lastHandDamagedIds,
    handNumber,
    game,
    phase,
    currentBidderIndex,
    trickPause,
    completedTrick,
    lastMove,
    matchWinnerId,
  ]);

  useEffect(() => {
    if (isOnline || phase !== 'bidding' || !currentBidder || currentBidder.id === localPlayerId) {
      return;
    }

    setThinking(true);
    const timer = setTimeout(() => {
      const preferred = solverRef.current.findOptimalBid(currentBidder.cards);
      const legalBid = chooseLegalBid(game, currentBidder.id, preferred);
      const next = setBid(game, currentBidder.id, legalBid);

      setGame(next);
      setThinking(false);
      advanceBidder(next, currentBidderIndex + 1);
    }, AI_PLAY_DELAY_MS);

    return () => clearTimeout(timer);
  }, [currentBidder, currentBidderIndex, game, isOnline, localPlayerId, phase]);

  useEffect(() => {
    if (isOnline || phase !== 'playing' || trickPause || game.currentPlayer === localPlayerId || isGameOver(game)) {
      return;
    }

    const aiPlayer = game.players.find((player) => player.id === game.currentPlayer);
    if (!aiPlayer) {
      return;
    }

    setThinking(true);
    const timer = setTimeout(() => {
      const depth = game.players.length <= 3 ? 4 : game.players.length <= 5 ? 2 : 1;
      const move = solverRef.current.getBestMove(game, aiPlayer.id, depth);
      const next = playCard(game, aiPlayer.id, move.card, move.asZero);
      const suffix = isJoker(move.card) ? (move.asZero ? ' come zero' : ' come alta') : '';

      setLastMove(`${labelPlayer(aiPlayer.id)}: ${cardName(move.card)}${suffix}`);
      setThinking(false);
      applyPlayedState(game, next);
    }, AI_PLAY_DELAY_MS);

    return () => clearTimeout(timer);
  }, [game, isOnline, localPlayerId, phase, trickPause]);

  useEffect(() => {
    if (!trickPause || (isOnline && !isHost)) {
      return;
    }

    const timer = setTimeout(() => {
      setTrickPause(false);
      setCompletedTrick(null);

      if (isGameOver(game)) {
        concludeHand(game);
      }
    }, TRICK_REVEAL_MS);

    return () => clearTimeout(timer);
  }, [game, isHost, isOnline, trickPause]);

  function makeLives(ids: number[], lives: number) {
    return Object.fromEntries(ids.map((id) => [id, lives]));
  }

  function prepareTable(count: number, lives = startingLives) {
    const ids = Array.from({ length: count }, (_, id) => id);
    setPlayerCount(count);
    setStartingLives(lives);
    setLivesByPlayerId(makeLives(ids, lives));
    setActivePlayerIds(ids);
    setEliminatedPlayerIds([]);
    setLastHandDamagedIds([]);
    setHandNumber(1);
    setMatchWinnerId(null);
    setGame(createHand(ids, getCardsForHand(1)));
    setPhase('setup');
    setCurrentBidderIndex(0);
    setThinking(false);
    setTrickPause(false);
    setCompletedTrick(null);
    setSelectedJoker(null);
    setLastMove(null);
  }

  function beginHand(ids = activePlayerIds, nextHandNumber = handNumber) {
    setActivePlayerIds(ids);
    setLivesByPlayerId((currentLives) => ({
      ...makeLives(ids, startingLives),
      ...currentLives,
    }));
    setGame(createHand(ids, getCardsForHand(nextHandNumber)));
    setHandNumber(nextHandNumber);
    setPhase('bidding');
    setCurrentBidderIndex(0);
    setThinking(false);
    setTrickPause(false);
    setCompletedTrick(null);
    setSelectedJoker(null);
    setLastMove(null);
    setLastHandDamagedIds([]);
  }

  function resetMatch() {
    prepareTable(playerCount);
  }

  function handleRemoteAction(playerId: number, action?: OnlineAction) {
    if (!action) {
      return;
    }

    if (action.kind === 'bid') {
      const current = stateRef.current;
      const bidder = current?.game.players[current.currentBidderIndex];
      const allowed = current && bidder ? getAllowedBids(current.game, bidder.id) : [];
      if (!current || !bidder || bidder.id !== playerId || !allowed.includes(action.bid)) {
        return;
      }

      const next = setBid(current.game, playerId, action.bid);
      setGame(next);
      advanceBidder(next, current.currentBidderIndex + 1);
      return;
    }

    if (action.kind === 'play') {
      const current = stateRef.current;
      if (!current || current.phase !== 'playing' || current.game.currentPlayer !== playerId || current.trickPause) {
        return;
      }

      const next = playCard(current.game, playerId, action.card, action.asZero);
      const suffix = isJoker(action.card) ? (action.asZero ? ' come zero' : ' come alta') : '';
      setLastMove(`${labelPlayer(playerId)}: ${cardName(action.card)}${suffix}`);
      setGame(next);

      if (next.history.length > current.game.history.length) {
        setCompletedTrick(next.history[next.history.length - 1] ?? null);
        setTrickPause(true);
      }
    }
  }

  function advanceBidder(nextGame: GameState, nextIndex: number) {
    if (nextIndex >= nextGame.players.length) {
      setPhase('playing');
      setCurrentBidderIndex(0);
      return;
    }

    setCurrentBidderIndex(nextIndex);
  }

  function applyBid(playerId: number, bid: number) {
    const bidder = game.players[currentBidderIndex];
    const allowed = bidder ? getAllowedBids(game, bidder.id) : [];
    if (!bidder || bidder.id !== playerId || !allowed.includes(bid)) {
      return;
    }

    const next = setBid(game, playerId, bid);
    setGame(next);
    advanceBidder(next, currentBidderIndex + 1);
  }

  function submitHumanBid(bid: number) {
    if (phase !== 'bidding' || currentBidder?.id !== localPlayerId || !allowedCurrentBids.includes(bid)) {
      return;
    }

    if (isOnline && !isHost) {
      sendOnline({ type: 'action', action: { kind: 'bid', bid } });
      return;
    }

    applyBid(localPlayerId, bid);
  }

  function applyPlayedState(previous: GameState, next: GameState) {
    setGame(next);

    if (next.history.length > previous.history.length) {
      setCompletedTrick(next.history[next.history.length - 1] ?? null);
      setTrickPause(true);
    }
  }

  function applyPlay(playerId: number, card: Card, asZero = false) {
    if (phase !== 'playing' || game.currentPlayer !== playerId || trickPause) {
      return;
    }

    const next = playCard(game, playerId, card, asZero);
    const suffix = isJoker(card) ? (asZero ? ' come zero' : ' come alta') : '';

    setSelectedJoker(null);
    setLastMove(`${labelPlayer(playerId)}: ${cardName(card)}${suffix}`);
    applyPlayedState(game, next);
  }

  function playHumanCard(card: Card, asZero = false) {
    if (!isHumanTurn) {
      return;
    }

    if (isOnline && !isHost) {
      sendOnline({ type: 'action', action: { kind: 'play', card, asZero } });
      setSelectedJoker(null);
      return;
    }

    applyPlay(localPlayerId, card, asZero);
  }

  function concludeHand(finalGame: GameState) {
    const damaged = finalGame.players
      .filter((player) => player.bid < 0 || player.tricksWon !== player.bid)
      .map((player) => player.id);
    const updatedLives = { ...livesByPlayerId };

    for (const playerId of damaged) {
      updatedLives[playerId] = Math.max(0, (updatedLives[playerId] ?? startingLives) - 1);
    }

    const survivors = activePlayerIds.filter((id) => (updatedLives[id] ?? 0) > 0);
    const newlyEliminated = activePlayerIds.filter((id) => (updatedLives[id] ?? 0) <= 0);

    setLivesByPlayerId(updatedLives);
    setLastHandDamagedIds(damaged);
    setEliminatedPlayerIds((ids) => [...new Set([...ids, ...newlyEliminated])]);
    setActivePlayerIds(survivors);

    if (survivors.length === 1) {
      setMatchWinnerId(survivors[0] ?? null);
      setPhase('matchOver');
      return;
    }

    if (survivors.length === 0) {
      const bestPlayer = finalGame.players
        .slice()
        .sort((a, b) => (b.tricksWon === b.bid ? 1 : 0) - (a.tricksWon === a.bid ? 1 : 0))[0];
      setMatchWinnerId(bestPlayer?.id ?? null);
      setPhase('matchOver');
      return;
    }
    
    setPhase('handOver');
  }

  const currentTurnLabel = game.players.find((player) => player.id === game.currentPlayer)
    ? labelPlayer(game.currentPlayer)
    : '-';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Bisca</Text>
            <Text style={styles.title}>
              {phase === 'setup'
                ? 'Nuovo tavolo'
                : phase === 'bidding'
                  ? `Mano ${handNumber}: chiamate`
                  : phase === 'handOver'
                    ? `Fine mano ${handNumber}`
                    : phase === 'matchOver'
                      ? 'Vincitore'
                      : `Mano ${handNumber} · Round ${Math.min(game.roundNumber, game.cardsPerPlayer)}/${game.cardsPerPlayer}`}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={resetMatch} style={styles.iconButton}>
            <Text style={styles.iconText}>↻</Text>
          </Pressable>
        </View>

        <View style={styles.scoreBand}>
          {game.players.map((player) => (
            <ScoreBlock
              key={player.id}
              label={labelPlayer(player.id)}
              tricks={player.tricksWon}
              bid={player.bid}
              active={phase === 'playing' && game.currentPlayer === player.id && !trickPause}
            />
          ))}
        </View>

        <View style={styles.table}>
          {phase === 'setup' ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Multiplayer</Text>
              <Text style={styles.helperText}>{onlineStatus}</Text>
              {lobbyId ? <Text style={styles.inviteText}>{getInviteLink(lobbyId)}</Text> : null}
              {lobbyMembers.length > 0 ? (
                <Text style={styles.helperText}>
                  In lobby: {lobbyMembers.map((member) => labelPlayer(member.playerId)).join(', ')}
                </Text>
              ) : null}
              <View style={styles.optionGrid}>
                <Pressable accessibilityRole="button" onPress={() => connectLobby('create')} style={styles.secondaryButton}>
                  <Text style={styles.secondaryText}>Crea lobby</Text>
                </Pressable>
                {initialLobbyId ? (
                  <Pressable accessibilityRole="button" onPress={() => connectLobby('join', initialLobbyId)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryText}>Entra dal link</Text>
                  </Pressable>
                ) : null}
                {isOnline ? (
                  <Pressable accessibilityRole="button" onPress={leaveLobby} style={styles.secondaryButton}>
                    <Text style={styles.secondaryText}>Esci lobby</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {phase === 'setup' ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Giocatori</Text>
              <View style={styles.optionGrid}>
                {PLAYER_OPTIONS.map((count) => (
                  <Pressable
                    key={count}
                    accessibilityRole="button"
                    onPress={() => prepareTable(count)}
                    style={[styles.smallButton, playerCount === count && styles.selectedButton]}
                  >
                    <Text style={styles.smallButtonText}>{count}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.panelTitle}>Vite</Text>
              <View style={styles.optionGrid}>
                {LIFE_OPTIONS.map((lives) => (
                  <Pressable
                    key={lives}
                    accessibilityRole="button"
                    onPress={() => prepareTable(playerCount, lives)}
                    style={[styles.smallButton, startingLives === lives && styles.selectedButton]}
                  >
                    <Text style={styles.smallButtonText}>{lives}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isOnline && (!isHost || connectedPlayerIds.length < MIN_PLAYERS)}
                onPress={() => beginHand(isOnline ? connectedPlayerIds : activePlayerIds, 1)}
                style={[styles.actionButton, isOnline && (!isHost || connectedPlayerIds.length < MIN_PLAYERS) && styles.disabledButton]}
              >
                <Text style={styles.actionText}>
                  {isOnline ? `Avvia online (${connectedPlayerIds.length})` : 'Avvia partita'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {phase === 'bidding' ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>
                {currentBidder?.id === localPlayerId ? 'La tua chiamata' : `${currentBidder ? labelPlayer(currentBidder.id) : '-'} sta chiamando`}
              </Text>
              <Text style={styles.helperText}>
                Carte per giocatore: {game.cardsPerPlayer} · Totale chiamate: {totalBid}/{game.cardsPerPlayer}
                {forbiddenLastBid === null ? '' : ` · vietato ${forbiddenLastBid}`}
              </Text>
              {isBlindOneCardBid ? (
                <View style={styles.visibleCardsPanel}>
                  <Text style={styles.sectionLabel}>Carte visibili</Text>
                  <View style={styles.visibleCardsGrid}>
                    {game.players
                      .filter((player) => player.id !== localPlayerId)
                      .map((player) => (
                        <View key={player.id} style={styles.playedCard}>
                          <CardView card={player.cards[0]} compact />
                          <Text style={styles.playedBy}>{labelPlayer(player.id)}</Text>
                        </View>
                      ))}
                  </View>
                </View>
              ) : null}
              {currentBidder?.id === localPlayerId ? (
                <View style={styles.optionGrid}>
                  {bidOptions.map((bid) => {
                    const disabled = !allowedCurrentBids.includes(bid);
                    return (
                      <Pressable
                        key={bid}
                        accessibilityRole="button"
                        disabled={disabled}
                        onPress={() => submitHumanBid(bid)}
                        style={[styles.bidButton, disabled && styles.disabledButton]}
                      >
                        <Text style={[styles.bidButtonText, disabled && styles.disabledText]}>{bid}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.waitingText}>{thinking ? 'Chiamata in corso...' : 'Pronto'}</Text>
              )}
            </View>
          ) : null}

          {phase !== 'setup' ? (
            <View style={styles.matchPanel}>
              <Text style={styles.sectionLabel}>Vite</Text>
              <Text style={styles.helperText}>
                {activePlayerIds.map((id) => `${labelPlayer(id)} ${livesByPlayerId[id] ?? 0}`).join(' · ')}
              </Text>
              {eliminatedPlayerIds.length > 0 ? (
                <Text style={styles.helperText}>Eliminati: {eliminatedPlayerIds.map(labelPlayer).join(', ')}</Text>
              ) : null}
            </View>
          ) : null}

          {phase === 'playing' || phase === 'handOver' || phase === 'matchOver' ? (
            <View style={styles.trickArea}>
              <Text style={styles.sectionLabel}>Tavolo</Text>
              <View style={styles.trickCards}>
                {tableCards.length === 0 ? (
                  <Text style={styles.emptyTrick}>
                    {latestTrick ? `Ultima presa: ${labelPlayer(latestTrick.winner)}` : 'Nessuna carta sul tavolo'}
                  </Text>
                ) : (
                  tableCards.map((entry) => (
                    <View key={`${entry.playerId}-${entry.card.value}-${entry.card.suit}`} style={styles.playedCard}>
                      <CardView card={entry.card} compact label={entry.asZero ? 'zero' : undefined} />
                      <Text style={styles.playedBy}>{labelPlayer(entry.playerId)}</Text>
                    </View>
                  ))
                )}
              </View>
              <Text style={styles.helperText}>
                {trickPause
                  ? `Presa a ${latestTrick ? labelPlayer(latestTrick.winner) : '-'}`
                  : thinking
                    ? `${currentTurnLabel} sta giocando...`
                    : lastMove ?? `${currentTurnLabel} deve giocare`}
              </Text>
            </View>
          ) : null}

          {selectedJoker && phase === 'playing' ? (
            <View style={styles.jokerPanel}>
              <Text style={styles.panelTitle}>Asso di ori</Text>
              <View style={styles.jokerActions}>
                <Pressable accessibilityRole="button" onPress={() => playHumanCard(selectedJoker, false)} style={styles.actionButton}>
                  <Text style={styles.actionText}>Alta</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => playHumanCard(selectedJoker, true)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryText}>Zero</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {phase === 'handOver' ? (
            <View style={styles.resultPanel}>
              <Text style={styles.panelTitle}>Fine mano</Text>
              <Text style={styles.helperText}>
                {lastHandDamagedIds.length > 0
                  ? `${lastHandDamagedIds.map(labelPlayer).join(', ')} perdono una vita.`
                  : 'Tutti hanno centrato la chiamata.'}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => beginHand(activePlayerIds, handNumber + 1)} style={styles.actionButton}>
                <Text style={styles.actionText}>Prossima mano · {getCardsForHand(handNumber + 1)} carte</Text>
              </Pressable>
            </View>
          ) : null}

          {phase === 'matchOver' ? (
            <View style={styles.resultPanel}>
              <Text style={styles.panelTitle}>{matchWinnerId === 0 ? 'Hai vinto la partita' : `Vince ${matchWinnerId === null ? '-' : labelPlayer(matchWinnerId)}`}</Text>
              <Text style={styles.helperText}>
                Ultima mano: {lastHandDamagedIds.length > 0 ? `${lastHandDamagedIds.map(labelPlayer).join(', ')} hanno perso una vita.` : 'nessuna vita persa.'}
              </Text>
              <Pressable accessibilityRole="button" onPress={resetMatch} style={styles.actionButton}>
                <Text style={styles.actionText}>Nuova partita</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.handSection}>
          <View style={styles.handHeader}>
            <Text style={styles.sectionLabel}>La tua mano</Text>
            <Text style={styles.helperText}>
              {!activePlayerIds.includes(0)
                ? 'Sei eliminato'
                : isHumanTurn
                  ? 'Tocca a te'
                  : phase === 'playing'
                    ? 'Attendi'
                    : human && human.bid >= 0
                      ? `${human.tricksWon}/${human.bid}`
                      : 'Chiamata aperta'}
            </Text>
          </View>
          <View style={styles.hand}>
            {human?.cards.map((card) =>
              isBlindOneCardBid ? (
                <CardView key={`${card.value}-${card.suit}`} hidden />
              ) : (
                <CardView
                  key={`${card.value}-${card.suit}`}
                  card={card}
                  disabled={!isHumanTurn}
                  selected={selectedJoker ? selectedJoker.value === card.value && selectedJoker.suit === card.suit : false}
                  onPress={() => (isJoker(card) ? setSelectedJoker(card) : playHumanCard(card))}
                />
              ),
            ) ?? <Text style={styles.helperText}>Osservi il resto della partita.</Text>}
          </View>
        </View>

        <View style={styles.history}>
          <Text style={styles.sectionLabel}>Storico mano</Text>
          {game.history.length === 0 ? (
            <Text style={styles.helperText}>Le prese vinte appariranno qui.</Text>
          ) : (
            game.history.map((trick) => (
              <Text key={trick.round} style={styles.historyText}>
                Round {trick.round}: {trick.cards.map((entry) => `${labelPlayer(entry.playerId)} ${entry.asZero ? 'zero ' : ''}${cardLabel(entry.card)}`).join(' / ')} - vince {labelPlayer(trick.winner)}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ScoreBlock({
  label,
  tricks,
  bid,
  active,
}: {
  label: string;
  tricks: number;
  bid: number;
  active?: boolean;
}) {
  return (
    <View style={[styles.scoreBlock, active && styles.activeScoreBlock]}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <Text style={styles.scoreValue}>{bid < 0 ? '-' : `${tricks}/${bid}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111827',
  },
  screen: {
    flexGrow: 1,
    padding: 18,
    gap: 14,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    color: '#facc15',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: '#f9fafb',
    fontSize: 28,
    fontWeight: '900',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#374151',
  },
  iconText: {
    color: '#f9fafb',
    fontSize: 24,
    fontWeight: '900',
  },
  scoreBand: {
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: 8,
  },
  scoreBlock: {
    minWidth: 72,
    minHeight: 54,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
    paddingHorizontal: 8,
  },
  activeScoreBlock: {
    backgroundColor: '#facc15',
  },
  scoreLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  scoreValue: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '900',
  },
  table: {
    borderRadius: 8,
    backgroundColor: '#0f766e',
    padding: 14,
    gap: 14,
    borderWidth: 1,
    borderColor: '#14b8a6',
  },
  panel: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#134e4a',
    gap: 12,
  },
  matchPanel: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#115e59',
    gap: 5,
  },
  visibleCardsPanel: {
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#0f766e',
    gap: 10,
  },
  visibleCardsGrid: {
    minHeight: 82,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  panelTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '900',
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallButton: {
    minWidth: 45,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  selectedButton: {
    backgroundColor: '#facc15',
  },
  smallButtonText: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '900',
  },
  bidButton: {
    minWidth: 48,
    minHeight: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#facc15',
  },
  disabledButton: {
    backgroundColor: '#475569',
  },
  bidButtonText: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '900',
  },
  disabledText: {
    color: '#94a3b8',
  },
  actionButton: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#facc15',
  },
  actionText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  secondaryText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  helperText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  inviteText: {
    color: '#fef3c7',
    fontSize: 12,
    fontWeight: '800',
  },
  waitingText: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '800',
  },
  sectionLabel: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  trickArea: {
    minHeight: 170,
    justifyContent: 'center',
    gap: 10,
  },
  trickCards: {
    minHeight: 96,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyTrick: {
    color: '#ccfbf1',
    fontSize: 16,
    fontWeight: '700',
  },
  playedCard: {
    alignItems: 'center',
    gap: 6,
  },
  playedBy: {
    color: '#ecfeff',
    fontSize: 12,
    fontWeight: '800',
  },
  jokerPanel: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#164e63',
    gap: 10,
  },
  jokerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  resultPanel: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#134e4a',
    gap: 10,
  },
  handSection: {
    gap: 10,
  },
  handHeader: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hand: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  history: {
    borderRadius: 8,
    backgroundColor: '#1f2937',
    padding: 12,
    gap: 7,
  },
  historyText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
});
