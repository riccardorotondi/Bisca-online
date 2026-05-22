const http = require('http');
const { randomUUID } = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || process.env.BISCA_LOBBY_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const lobbies = new Map();

function makeLobbyId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(lobby, message) {
  for (const client of lobby.clients) {
    send(client.ws, message);
  }
}

function members(lobby) {
  return lobby.clients.map((client) => ({
    clientId: client.clientId,
    playerId: client.playerId,
    isHost: client.clientId === lobby.hostClientId,
  }));
}

function publishMembers(lobby) {
  broadcast(lobby, { type: 'members', lobbyId: lobby.id, members: members(lobby) });
}

function createLobby(ws) {
  let id = makeLobbyId();
  while (lobbies.has(id)) {
    id = makeLobbyId();
  }

  const client = { ws, clientId: randomUUID(), playerId: 0 };
  const lobby = {
    id,
    hostClientId: client.clientId,
    nextPlayerId: 1,
    clients: [client],
    snapshot: null,
  };

  ws.lobbyId = id;
  ws.clientId = client.clientId;
  lobbies.set(id, lobby);
  send(ws, { type: 'created', lobbyId: id, clientId: client.clientId, playerId: 0 });
  publishMembers(lobby);
}

function joinLobby(ws, lobbyId) {
  const lobby = lobbies.get(String(lobbyId || '').toUpperCase());
  if (!lobby) {
    send(ws, { type: 'error', message: 'Lobby non trovata' });
    return;
  }

  if (lobby.clients.length >= 8) {
    send(ws, { type: 'error', message: 'Lobby piena' });
    return;
  }

  const playerId = lobby.nextPlayerId;
  lobby.nextPlayerId += 1;

  const client = { ws, clientId: randomUUID(), playerId };
  ws.lobbyId = lobby.id;
  ws.clientId = client.clientId;
  lobby.clients.push(client);

  send(ws, { type: 'joined', lobbyId: lobby.id, clientId: client.clientId, playerId });
  if (lobby.snapshot) {
    send(ws, { type: 'snapshot', payload: lobby.snapshot });
  }
  publishMembers(lobby);
}

function getLobbyFor(ws) {
  if (!ws.lobbyId) {
    return null;
  }
  return lobbies.get(ws.lobbyId) || null;
}

function handleMessage(ws, message) {
  if (message.type === 'create') {
    createLobby(ws);
    return;
  }

  if (message.type === 'join') {
    joinLobby(ws, message.lobbyId);
    return;
  }

  const lobby = getLobbyFor(ws);
  if (!lobby) {
    send(ws, { type: 'error', message: 'Non sei in una lobby' });
    return;
  }

  if (message.type === 'snapshot') {
    if (ws.clientId !== lobby.hostClientId) {
      send(ws, { type: 'error', message: "Solo l'host puo pubblicare lo stato" });
      return;
    }

    lobby.snapshot = message.payload;
    broadcast(lobby, { type: 'snapshot', payload: lobby.snapshot });
    return;
  }

  if (message.type === 'action') {
    const host = lobby.clients.find((client) => client.clientId === lobby.hostClientId);
    if (!host) {
      send(ws, { type: 'error', message: 'Host non disponibile' });
      return;
    }

    const sender = lobby.clients.find((client) => client.clientId === ws.clientId);
    send(host.ws, {
      type: 'action',
      clientId: ws.clientId,
      playerId: sender?.playerId,
      action: message.action,
    });
  }
}

function leave(ws) {
  const lobby = getLobbyFor(ws);
  if (!lobby) {
    return;
  }

  lobby.clients = lobby.clients.filter((client) => client.ws !== ws);
  if (lobby.clients.length === 0 || ws.clientId === lobby.hostClientId) {
    broadcast(lobby, { type: 'closed' });
    lobbies.delete(lobby.id);
    return;
  }

  publishMembers(lobby);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, lobbies: lobbies.size }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Bisca lobby server');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      handleMessage(ws, JSON.parse(raw.toString()));
    } catch (error) {
      send(ws, { type: 'error', message: 'Messaggio non valido' });
    }
  });

  ws.on('close', () => leave(ws));
});

server.listen(PORT, HOST, () => {
  console.log(`Bisca lobby server in ascolto su ${HOST}:${PORT}`);
});
