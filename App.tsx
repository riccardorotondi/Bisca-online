import { useEffect, useMemo, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  useWindowDimensions,
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
type LobbyMember = { clientId: string; playerId: number; name?: string; connected?: boolean; isHost: boolean };
type LobbySession = {
  lobbyId: string;
  clientId: string;
  playerId: number;
  name: string;
  role: OnlineRole;
};
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
  lastHandPenaltiesByPlayerId: Record<number, number>;
  handStarterId: number | null;
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
const LOBBY_SESSION_KEY = 'biscaLobbySession';
const CELEBRATION_PIECES = [
  { left: '12%', delay: 0, color: '#f6c75a', size: 9 },
  { left: '25%', delay: 220, color: '#ef4444', size: 7 },
  { left: '38%', delay: 80, color: '#fff1ad', size: 8 },
  { left: '52%', delay: 310, color: '#22c55e', size: 7 },
  { left: '67%', delay: 120, color: '#f6c75a', size: 10 },
  { left: '81%', delay: 260, color: '#38bdf8', size: 7 },
];

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
  if (!location) {
    return `ws://localhost:${LOBBY_PORT}`;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const host = isLocalHost ? `${location.hostname}:${LOBBY_PORT}` : location.host;
  return `${protocol}//${host}`;
}

function getInviteLink(lobbyId: string) {
  const location = getBrowserLocation();
  if (!location) {
    return lobbyId;
  }

  return `${location.protocol}//${location.host}${location.pathname}?lobby=${lobbyId}`;
}

function getLocalStorage() {
  return (globalThis as unknown as { localStorage?: Storage }).localStorage;
}

function readLobbySession(): LobbySession | null {
  const raw = getLocalStorage()?.getItem(LOBBY_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as Partial<LobbySession>;
    if (!session.lobbyId || !session.clientId || typeof session.playerId !== 'number') {
      return null;
    }

    return {
      lobbyId: session.lobbyId,
      clientId: session.clientId,
      playerId: session.playerId,
      name: session.name || '',
      role: session.role === 'host' ? 'host' : 'guest',
    };
  } catch {
    return null;
  }
}

function saveLobbySession(session: LobbySession) {
  getLocalStorage()?.setItem(LOBBY_SESSION_KEY, JSON.stringify(session));
}

function clearLobbySession() {
  getLocalStorage()?.removeItem(LOBBY_SESSION_KEY);
}

function getBrowserDocument() {
  return (globalThis as unknown as { document?: Document }).document;
}

function getBrowserWindow() {
  return (globalThis as unknown as { addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] });
}

export default function App() {
  const { width } = useWindowDimensions();
  const solverRef = useRef(new BiscaSolver());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false);
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
  const savedLobbySession = useMemo(readLobbySession, []);
  const resumableSession = savedLobbySession && (!initialLobbyId || savedLobbySession.lobbyId === initialLobbyId) ? savedLobbySession : null;
  const [playerCount, setPlayerCount] = useState(MIN_PLAYERS);
  const [startingLives, setStartingLives] = useState(3);
  const [livesByPlayerId, setLivesByPlayerId] = useState<Record<number, number>>({ 0: 3, 1: 3 });
  const [activePlayerIds, setActivePlayerIds] = useState<number[]>([0, 1]);
  const [eliminatedPlayerIds, setEliminatedPlayerIds] = useState<number[]>([]);
  const [lastHandDamagedIds, setLastHandDamagedIds] = useState<number[]>([]);
  const [lastHandPenaltiesByPlayerId, setLastHandPenaltiesByPlayerId] = useState<Record<number, number>>({});
  const [handStarterId, setHandStarterId] = useState<number | null>(null);
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
  const [lobbyId, setLobbyId] = useState(initialLobbyId || resumableSession?.lobbyId || '');
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [myPlayerId, setMyPlayerId] = useState(resumableSession?.playerId ?? 0);
  const [playerName, setPlayerName] = useState(resumableSession?.name ?? '');
  const [onlineStatus, setOnlineStatus] = useState(
    resumableSession ? 'Rientro nella lobby...' : initialLobbyId ? 'Link lobby rilevato' : 'Pronto per creare una partita online',
  );

  const isOnline = onlineRole !== 'offline';
  const isHost = onlineRole === 'host';
  const isPhoneLayout = width < 430;
  const localPlayerId = isOnline ? myPlayerId : 0;
  const trimmedPlayerName = playerName.trim();
  const canEnterLobby = trimmedPlayerName.length > 0;
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
      const member = lobbyMembers.find((candidate) => candidate.playerId === playerId);
      if (member?.name) {
        return playerId === localPlayerId ? `${member.name} (tu)` : member.name;
      }

      if (playerId === localPlayerId) {
        return 'Tu';
      }

      return playerId === 0 ? 'Host' : `Giocatore ${playerId + 1}`;
    }

    return playerLabel(playerId);
  }

  function getRandomPlayerId(ids: number[]) {
    return ids[Math.floor(Math.random() * ids.length)] ?? ids[0] ?? 0;
  }

  function getNextStarterId(ids: number[], previousStarterId: number | null) {
    if (ids.length === 0) {
      return 0;
    }

    const sortedIds = [...ids].sort((a, b) => a - b);
    if (previousStarterId === null) {
      return getRandomPlayerId(sortedIds);
    }

    const currentIndex = sortedIds.indexOf(previousStarterId);
    if (currentIndex >= 0) {
      return sortedIds[(currentIndex + 1) % sortedIds.length] ?? sortedIds[0] ?? 0;
    }

    return sortedIds.find((id) => id > previousStarterId) ?? sortedIds[0] ?? 0;
  }

  function formatPenaltySummary(ids = lastHandDamagedIds, penalties = lastHandPenaltiesByPlayerId) {
    return ids
      .map((id) => {
        const penalty = penalties[id] ?? 1;
        const lifeLabel = penalty === 1 ? '1 vita' : `${penalty} vite`;
        return `${labelPlayer(id)} perde ${lifeLabel}`;
      })
      .join(', ');
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
      lastHandPenaltiesByPlayerId,
      handStarterId,
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
    setLastHandPenaltiesByPlayerId(snapshot.lastHandPenaltiesByPlayerId ?? {});
    setHandStarterId(snapshot.handStarterId ?? null);
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

  function connectLobby(kind: 'create' | 'join' | 'resume', targetLobbyId = lobbyId, session = resumableSession) {
    if (kind !== 'resume' && !canEnterLobby) {
      setOnlineStatus('Scegli un nome prima di entrare');
      return;
    }

    if (kind === 'resume' && !session) {
      setOnlineStatus('Sessione lobby non trovata');
      return;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    intentionalDisconnectRef.current = false;
    setOnlineStatus(kind === 'resume' ? 'Rientro nella lobby...' : 'Connessione lobby...');

    const ws = new WebSocket(getLobbyWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (kind === 'resume') {
        sendOnline({ type: 'resume', lobbyId: targetLobbyId, clientId: session?.clientId });
        return;
      }

      sendOnline(kind === 'create' ? { type: 'create', name: trimmedPlayerName } : { type: 'join', lobbyId: targetLobbyId, name: trimmedPlayerName });
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));

      if (message.type === 'created') {
        setOnlineRole('host');
        setLobbyId(message.lobbyId);
        setMyPlayerId(message.playerId);
        saveLobbySession({
          lobbyId: message.lobbyId,
          clientId: message.clientId,
          playerId: message.playerId,
          name: trimmedPlayerName,
          role: 'host',
        });
        setOnlineStatus('Lobby creata');
        return;
      }

      if (message.type === 'joined') {
        setOnlineRole('guest');
        setLobbyId(message.lobbyId);
        setMyPlayerId(message.playerId);
        saveLobbySession({
          lobbyId: message.lobbyId,
          clientId: message.clientId,
          playerId: message.playerId,
          name: trimmedPlayerName,
          role: 'guest',
        });
        setOnlineStatus('Entrato in lobby');
        return;
      }

      if (message.type === 'resumed') {
        const role: OnlineRole = message.isHost ? 'host' : 'guest';
        const restoredName = message.name ?? session?.name ?? '';
        setOnlineRole(role);
        setLobbyId(message.lobbyId);
        setMyPlayerId(message.playerId);
        setPlayerName(restoredName);
        saveLobbySession({
          lobbyId: message.lobbyId,
          clientId: message.clientId,
          playerId: message.playerId,
          name: restoredName,
          role,
        });
        setOnlineStatus('Rientrato in lobby');
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
        clearLobbySession();
        return;
      }

      if (message.type === 'error') {
        setOnlineStatus(message.message ?? 'Errore lobby');
        if (String(message.message ?? '').includes('scaduta') || String(message.message ?? '').includes('non trovata')) {
          clearLobbySession();
        }
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (intentionalDisconnectRef.current) {
        return;
      }

      setOnlineStatus('Connessione persa, provo a rientrare...');
      const sessionToResume = readLobbySession();
      if (!sessionToResume) {
        return;
      }

      reconnectTimerRef.current = setTimeout(() => {
        connectLobby('resume', sessionToResume.lobbyId, sessionToResume);
      }, 900);
    };
  }

  function reconnectIfNeeded() {
    const sessionToResume = readLobbySession();
    if (!sessionToResume || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    connectLobby('resume', sessionToResume.lobbyId, sessionToResume);
  }

  function leaveLobby() {
    intentionalDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    sendOnline({ type: 'leave' });
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    wsRef.current = null;
    setOnlineRole('offline');
    setLobbyMembers([]);
    setLobbyId('');
    setMyPlayerId(0);
    clearLobbySession();
    setOnlineStatus('Pronto per creare una partita online');
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
    if (resumableSession) {
      connectLobby('resume', resumableSession.lobbyId, resumableSession);
    }

    const documentRef = getBrowserDocument();
    const windowRef = getBrowserWindow();
    const handleVisible = () => {
      if (!documentRef || documentRef.visibilityState === 'visible') {
        reconnectIfNeeded();
      }
    };

    documentRef?.addEventListener('visibilitychange', handleVisible);
    windowRef.addEventListener?.('focus', reconnectIfNeeded);
    windowRef.addEventListener?.('pageshow', reconnectIfNeeded);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      documentRef?.removeEventListener('visibilitychange', handleVisible);
      windowRef.removeEventListener?.('focus', reconnectIfNeeded);
      windowRef.removeEventListener?.('pageshow', reconnectIfNeeded);
      wsRef.current?.close();
    };
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
    lastHandPenaltiesByPlayerId,
    handStarterId,
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
    setLastHandPenaltiesByPlayerId({});
    setHandStarterId(null);
    setHandNumber(1);
    setMatchWinnerId(null);
    const starterId = getRandomPlayerId(ids);
    setHandStarterId(starterId);
    setGame(createHand(ids, getCardsForHand(1), starterId));
    setPhase('setup');
    setCurrentBidderIndex(0);
    setThinking(false);
    setTrickPause(false);
    setCompletedTrick(null);
    setSelectedJoker(null);
    setLastMove(null);
  }

  function beginHand(ids = activePlayerIds, nextHandNumber = handNumber) {
    const starterId = nextHandNumber <= 1 ? getRandomPlayerId(ids) : getNextStarterId(ids, handStarterId);
    const nextGame = createHand(ids, getCardsForHand(nextHandNumber), starterId);

    setActivePlayerIds(ids);
    setLivesByPlayerId((currentLives) => ({
      ...makeLives(ids, startingLives),
      ...currentLives,
    }));
    setGame(nextGame);
    setHandStarterId(starterId);
    setHandNumber(nextHandNumber);
    setPhase('bidding');
    setCurrentBidderIndex(0);
    setThinking(false);
    setTrickPause(false);
    setCompletedTrick(null);
    setSelectedJoker(null);
    setLastMove(null);
    setLastHandDamagedIds([]);
    setLastHandPenaltiesByPlayerId({});
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
    const penaltiesByPlayerId = Object.fromEntries(
      finalGame.players
        .map((player) => [player.id, player.bid < 0 ? 1 : Math.abs(player.bid - player.tricksWon)] as const)
        .filter(([, penalty]) => penalty > 0),
    );
    const damaged = Object.keys(penaltiesByPlayerId).map(Number);
    const updatedLives = { ...livesByPlayerId };

    for (const playerId of damaged) {
      updatedLives[playerId] = Math.max(0, (updatedLives[playerId] ?? startingLives) - (penaltiesByPlayerId[playerId] ?? 1));
    }

    const survivors = activePlayerIds.filter((id) => (updatedLives[id] ?? 0) > 0);
    const newlyEliminated = activePlayerIds.filter((id) => (updatedLives[id] ?? 0) <= 0);

    setLivesByPlayerId(updatedLives);
    setLastHandDamagedIds(damaged);
    setLastHandPenaltiesByPlayerId(penaltiesByPlayerId);
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
  const seatPlayerIds = useMemo(() => {
    const playerIds = game.players.map((player) => player.id);
    const localIndex = playerIds.indexOf(localPlayerId);
    if (localIndex < 0) {
      return playerIds;
    }

    return [...playerIds.slice(localIndex), ...playerIds.slice(0, localIndex)];
  }, [game.players, localPlayerId]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={[styles.screen, isPhoneLayout && styles.screenPhone]}>
        <View style={[styles.header, isPhoneLayout && styles.headerPhone]}>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>Bisca</Text>
            <Text style={[styles.title, isPhoneLayout && styles.titlePhone]}>
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

        <View style={[styles.table, phase !== 'setup' && styles.tableInGame, isPhoneLayout && styles.tablePhone, phase !== 'setup' && isPhoneLayout && styles.tableInGamePhone]}>
          <View style={[styles.tableFelt, isPhoneLayout && styles.tableFeltPhone]} pointerEvents="none" />
          {phase !== 'setup' ? (
            <View style={styles.seatLayer} pointerEvents="none">
              {seatPlayerIds.map((playerId, index) => {
                const player = game.players.find((candidate) => candidate.id === playerId);
                return (
                  <PlayerSeat
                    key={playerId}
                    label={labelPlayer(playerId)}
                    lives={livesByPlayerId[playerId] ?? 0}
                    score={player ? (player.bid < 0 ? '-' : `${player.tricksWon}/${player.bid}`) : '-'}
                    active={phase === 'playing' && game.currentPlayer === playerId && !trickPause}
                    compact={isPhoneLayout}
                    eliminated={!activePlayerIds.includes(playerId)}
                    style={getSeatPosition(index, seatPlayerIds.length, isPhoneLayout)}
                  />
                );
              })}
            </View>
          ) : null}
          {phase === 'setup' && !isOnline && !initialLobbyId ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Crea partita</Text>
              <TextInput
                autoCapitalize="words"
                maxLength={18}
                onChangeText={setPlayerName}
                placeholder="Il tuo nome"
                placeholderTextColor="#7f8f99"
                style={styles.nameInput}
                value={playerName}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!canEnterLobby}
                onPress={() => connectLobby('create')}
                style={[styles.actionButton, !canEnterLobby && styles.disabledButton]}
              >
                <Text style={styles.actionText}>Crea partita</Text>
              </Pressable>
            </View>
          ) : null}

          {phase === 'setup' && (isOnline || initialLobbyId) ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{isHost ? 'Lobby host' : 'Lobby'}</Text>
              <Text style={styles.helperText}>{onlineStatus}</Text>
              {!isOnline ? (
                <TextInput
                  autoCapitalize="words"
                  maxLength={18}
                  onChangeText={setPlayerName}
                  placeholder="Il tuo nome"
                  placeholderTextColor="#7f8f99"
                  style={styles.nameInput}
                  value={playerName}
                />
              ) : null}
              {lobbyId && isHost ? (
                <Text selectable style={styles.inviteText}>
                  {getInviteLink(lobbyId)}
                </Text>
              ) : null}
              {lobbyMembers.length > 0 ? (
                <Text style={styles.helperText}>
                  In lobby: {lobbyMembers.map((member) => labelPlayer(member.playerId)).join(', ')}
                </Text>
              ) : null}
              <View style={styles.optionGrid}>
                {initialLobbyId && !isOnline ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!canEnterLobby}
                    onPress={() => connectLobby('join', initialLobbyId)}
                    style={[styles.actionButton, !canEnterLobby && styles.disabledButton]}
                  >
                    <Text style={styles.actionText}>Entra in lobby</Text>
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

          {phase === 'setup' && isHost ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Vite</Text>
              <View style={styles.optionGrid}>
                {LIFE_OPTIONS.map((lives) => (
                  <Pressable
                    key={lives}
                    accessibilityRole="button"
                    onPress={() => prepareTable(Math.max(connectedPlayerIds.length, MIN_PLAYERS), lives)}
                    style={[styles.smallButton, startingLives === lives && styles.selectedButton]}
                  >
                    <Text style={[styles.smallButtonText, startingLives === lives && styles.selectedButtonText]}>{lives}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={connectedPlayerIds.length < MIN_PLAYERS}
                onPress={() => beginHand(connectedPlayerIds, 1)}
                style={[styles.actionButton, connectedPlayerIds.length < MIN_PLAYERS && styles.disabledButton]}
              >
                <Text style={styles.actionText}>Avvia online ({connectedPlayerIds.length})</Text>
              </Pressable>
            </View>
          ) : null}

          {phase === 'setup' && isOnline && !isHost ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>In attesa dell'host</Text>
              <Text style={styles.helperText}>La partita partirà appena l'host avvia il tavolo.</Text>
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
                  ? `${formatPenaltySummary()}.`
                  : 'Tutti hanno centrato la chiamata.'}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => beginHand(activePlayerIds, handNumber + 1)} style={styles.actionButton}>
                <Text style={styles.actionText}>Prossima mano · {getCardsForHand(handNumber + 1)} carte</Text>
              </Pressable>
            </View>
          ) : null}

          {phase === 'matchOver' ? (
            <View style={styles.resultPanel}>
              <VictoryCelebration />
              <Text style={styles.panelTitle}>{matchWinnerId === localPlayerId ? 'Hai vinto la partita' : `Vince ${matchWinnerId === null ? '-' : labelPlayer(matchWinnerId)}`}</Text>
              <Text style={styles.helperText}>
                Ultima mano: {lastHandDamagedIds.length > 0 ? `${formatPenaltySummary()}.` : 'nessuna vita persa.'}
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
              {!activePlayerIds.includes(localPlayerId)
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
          <View style={[styles.hand, isPhoneLayout && styles.handPhone]}>
            {human?.cards.map((card) =>
              isBlindOneCardBid ? (
                <CardView key={`${card.value}-${card.suit}`} hidden compact={isPhoneLayout} />
              ) : (
                <CardView
                  key={`${card.value}-${card.suit}`}
                  card={card}
                  compact={isPhoneLayout}
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

const SEAT_ORDERS: Record<number, number[]> = {
  1: [0],
  2: [0, 4],
  3: [0, 3, 5],
  4: [0, 2, 4, 6],
  5: [0, 2, 3, 5, 6],
  6: [0, 1, 2, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
  8: [0, 1, 2, 3, 4, 5, 6, 7],
};

const DESKTOP_SEAT_POSITIONS: ViewStyle[] = [
  { bottom: 8, left: '50%', marginLeft: -58 },
  { bottom: 54, right: 20 },
  { top: 138, right: 20 },
  { top: 46, right: '18%' },
  { top: 22, left: '50%', marginLeft: -58 },
  { top: 46, left: '18%' },
  { top: 138, left: 20 },
  { bottom: 54, left: 20 },
];

const PHONE_SEAT_POSITIONS: ViewStyle[] = [
  { bottom: 6, left: '50%', marginLeft: -48 },
  { bottom: 52, right: 8 },
  { top: 118, right: 8 },
  { top: 42, right: 16 },
  { top: 16, left: '50%', marginLeft: -48 },
  { top: 42, left: 16 },
  { top: 118, left: 8 },
  { bottom: 52, left: 8 },
];

function getSeatPosition(index: number, total: number, isPhoneLayout: boolean): StyleProp<ViewStyle> {
  const positions = isPhoneLayout ? PHONE_SEAT_POSITIONS : DESKTOP_SEAT_POSITIONS;
  const order = SEAT_ORDERS[Math.max(1, Math.min(total, 8))] ?? [0];
  return positions[order[index] ?? index] ?? positions[0];
}

function VictoryCelebration() {
  const pulse = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
      ]),
    );
    const floatLoop = Animated.loop(
      Animated.timing(float, { toValue: 1, duration: 1800, useNativeDriver: true }),
    );

    pulseLoop.start();
    floatLoop.start();

    return () => {
      pulseLoop.stop();
      floatLoop.stop();
    };
  }, [float, pulse]);

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.68] });
  const chipY = float.interpolate({ inputRange: [0, 1], outputRange: [26, -36] });
  const chipRotate = float.interpolate({ inputRange: [0, 1], outputRange: ['-10deg', '18deg'] });

  return (
    <View pointerEvents="none" style={styles.victoryLayer}>
      <Animated.View style={[styles.victoryGlow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
      <Animated.View style={[styles.victoryChip, styles.victoryChipLeft, { transform: [{ translateY: chipY }, { rotate: chipRotate }] }]}>
        <Text style={styles.victoryChipText}>★</Text>
      </Animated.View>
      <Animated.View style={[styles.victoryChip, styles.victoryChipRight, { transform: [{ translateY: chipY }, { rotate: chipRotate }] }]}>
        <Text style={styles.victoryChipText}>♥</Text>
      </Animated.View>
      {CELEBRATION_PIECES.map((piece, index) => {
        const delayed = Animated.modulo(Animated.add(float, piece.delay / 1800), 1);
        const translateY = delayed.interpolate({ inputRange: [0, 1], outputRange: [14, -70] });
        const opacity = delayed.interpolate({ inputRange: [0, 0.16, 0.82, 1], outputRange: [0, 1, 1, 0] });
        const rotate = delayed.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '220deg'] });

        return (
          <Animated.View
            key={index}
            style={[
              styles.confettiPiece,
              {
                width: piece.size,
                height: piece.size * 1.6,
                backgroundColor: piece.color,
                left: piece.left as `${number}%`,
                opacity,
                transform: [{ translateY }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function PlayerSeat({
  label,
  lives,
  score,
  active,
  compact,
  eliminated,
  style,
}: {
  label: string;
  lives: number;
  score: string;
  active?: boolean;
  compact?: boolean;
  eliminated?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.playerSeat, compact && styles.playerSeatPhone, active && styles.activePlayerSeat, eliminated && styles.eliminatedPlayerSeat, style]}>
      <Text numberOfLines={1} style={styles.playerSeatName}>{label}</Text>
      <View style={styles.playerSeatMeta}>
        <Text style={styles.lifeBadge}>♥ {lives}</Text>
        <Text style={styles.playerSeatScore}>{score}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1116',
  },
  screen: {
    flexGrow: 1,
    padding: 18,
    gap: 16,
    backgroundColor: '#0b1116',
  },
  screenPhone: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 12,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  headerPhone: {
    minHeight: 56,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  kicker: {
    color: '#f6c75a',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff7df',
    fontSize: 30,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  titlePhone: {
    fontSize: 23,
    lineHeight: 28,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f2933',
    borderWidth: 1,
    borderColor: '#44515f',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  iconText: {
    color: '#f8d874',
    fontSize: 24,
    fontWeight: '900',
  },
  scoreBand: {
    minHeight: 82,
    borderRadius: 8,
    backgroundColor: '#141b22',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: 10,
    borderWidth: 1,
    borderColor: '#3a4651',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  scoreBlock: {
    minWidth: 72,
    minHeight: 54,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202a33',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#46535f',
  },
  activeScoreBlock: {
    backgroundColor: '#7f1d1d',
    borderColor: '#f6c75a',
    shadowColor: '#f6c75a',
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  scoreLabel: {
    color: '#bac6d0',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  scoreValue: {
    color: '#fff7df',
    fontSize: 20,
    fontWeight: '900',
  },
  table: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 44,
    backgroundColor: '#681c1b',
    padding: 18,
    gap: 14,
    borderWidth: 5,
    borderColor: '#2a1513',
    shadowColor: '#000',
    shadowOpacity: 0.36,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  tableInGame: {
    minHeight: 390,
    paddingTop: 108,
    paddingBottom: 92,
  },
  tablePhone: {
    borderRadius: 30,
    borderWidth: 4,
    padding: 11,
    gap: 11,
  },
  tableInGamePhone: {
    minHeight: 350,
    paddingTop: 88,
    paddingBottom: 76,
  },
  tableFelt: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 14,
    bottom: 14,
    borderRadius: 34,
    backgroundColor: '#0b6b52',
    borderWidth: 2,
    borderColor: '#19a579',
    opacity: 0.95,
  },
  tableFeltPhone: {
    left: 9,
    right: 9,
    top: 9,
    bottom: 9,
    borderRadius: 22,
  },
  panel: {
    position: 'relative',
    borderRadius: 8,
    padding: 14,
    backgroundColor: 'rgba(8, 35, 31, 0.88)',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(246, 199, 90, 0.22)',
  },
  nameInput: {
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 14,
    color: '#fff7df',
    backgroundColor: '#0f1921',
    borderWidth: 1,
    borderColor: '#46535f',
    fontSize: 16,
    fontWeight: '800',
  },
  seatLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 3,
  },
  playerSeat: {
    position: 'absolute',
    width: 116,
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: '#121a22',
    borderWidth: 1,
    borderColor: '#41505d',
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  playerSeatPhone: {
    width: 96,
    minHeight: 44,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  activePlayerSeat: {
    backgroundColor: '#7f1d1d',
    borderColor: '#f6c75a',
    shadowColor: '#f6c75a',
    shadowOpacity: 0.38,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  eliminatedPlayerSeat: {
    opacity: 0.48,
  },
  playerSeatName: {
    color: '#fff7df',
    fontSize: 12,
    fontWeight: '900',
  },
  playerSeatMeta: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  lifeBadge: {
    color: '#ff6b6b',
    fontSize: 12,
    fontWeight: '900',
  },
  playerSeatScore: {
    color: '#f6c75a',
    fontSize: 12,
    fontWeight: '900',
  },
  matchPanel: {
    position: 'relative',
    borderRadius: 8,
    padding: 12,
    backgroundColor: 'rgba(7, 50, 42, 0.78)',
    gap: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  visibleCardsPanel: {
    borderRadius: 8,
    padding: 10,
    backgroundColor: 'rgba(5, 83, 64, 0.78)',
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
    position: 'relative',
    zIndex: 1,
    color: '#fff7df',
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
    backgroundColor: '#17212b',
    borderWidth: 1,
    borderColor: '#46535f',
  },
  selectedButton: {
    backgroundColor: '#f6c75a',
    borderColor: '#fff1ad',
  },
  selectedButtonText: {
    color: '#111827',
  },
  smallButtonText: {
    color: '#fff7df',
    fontSize: 17,
    fontWeight: '900',
  },
  bidButton: {
    minWidth: 48,
    minHeight: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6c75a',
    borderWidth: 1,
    borderColor: '#fff1ad',
  },
  disabledButton: {
    backgroundColor: '#35414c',
    borderColor: '#4f5f6d',
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
    position: 'relative',
    zIndex: 1,
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6c75a',
    borderWidth: 1,
    borderColor: '#fff1ad',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  actionText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    position: 'relative',
    zIndex: 1,
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#17212b',
    borderWidth: 1,
    borderColor: '#46535f',
  },
  secondaryText: {
    color: '#fff7df',
    fontSize: 15,
    fontWeight: '900',
  },
  helperText: {
    position: 'relative',
    zIndex: 1,
    color: '#d7e5dd',
    fontSize: 13,
    fontWeight: '600',
  },
  inviteText: {
    color: '#ffe69a',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  waitingText: {
    color: '#fff7df',
    fontSize: 18,
    fontWeight: '800',
  },
  sectionLabel: {
    color: '#f6c75a',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  trickArea: {
    position: 'relative',
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
    color: '#c9f7e5',
    fontSize: 16,
    fontWeight: '700',
  },
  playedCard: {
    alignItems: 'center',
    gap: 6,
  },
  playedBy: {
    color: '#fff7df',
    fontSize: 12,
    fontWeight: '800',
  },
  jokerPanel: {
    position: 'relative',
    borderRadius: 8,
    padding: 12,
    backgroundColor: 'rgba(91, 27, 27, 0.9)',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(246, 199, 90, 0.32)',
  },
  jokerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  resultPanel: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 8,
    padding: 12,
    backgroundColor: 'rgba(8, 35, 31, 0.9)',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(246, 199, 90, 0.22)',
  },
  victoryLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 0,
  },
  victoryGlow: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    top: 8,
    bottom: 8,
    borderRadius: 90,
    backgroundColor: '#f6c75a',
  },
  victoryChip: {
    position: 'absolute',
    top: 18,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7f1d1d',
    borderWidth: 3,
    borderColor: '#f6c75a',
  },
  victoryChipLeft: {
    left: 18,
  },
  victoryChipRight: {
    right: 18,
  },
  victoryChipText: {
    color: '#fff7df',
    fontSize: 15,
    fontWeight: '900',
  },
  confettiPiece: {
    position: 'absolute',
    bottom: 12,
    borderRadius: 2,
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
    minHeight: 128,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  handPhone: {
    minHeight: 98,
    gap: 4,
    paddingVertical: 2,
  },
  history: {
    borderRadius: 8,
    backgroundColor: '#141b22',
    padding: 12,
    gap: 7,
    borderWidth: 1,
    borderColor: '#2d3944',
  },
  historyText: {
    color: '#dbe6ee',
    fontSize: 13,
    fontWeight: '600',
  },
});
