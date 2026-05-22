const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || process.env.BISCA_LOBBY_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'dist');
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 5 * 60 * 1000);
const lobbies = new Map();

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function makeLobbyId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(ws, message) {
  if (ws?.readyState === ws.OPEN) {
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
    name: client.name,
    connected: Boolean(client.ws),
    isHost: client.clientId === lobby.hostClientId,
  }));
}

function publishMembers(lobby) {
  broadcast(lobby, { type: 'members', lobbyId: lobby.id, members: members(lobby) });
}

function cleanName(name, fallback) {
  const clean = String(name || '').trim().slice(0, 18);
  return clean || fallback;
}

function createLobby(ws, name) {
  let id = makeLobbyId();
  while (lobbies.has(id)) {
    id = makeLobbyId();
  }

  const client = { ws, clientId: randomUUID(), playerId: 0, name: cleanName(name, 'Host'), cleanupTimer: null };
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

function joinLobby(ws, lobbyId, name) {
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

  const client = { ws, clientId: randomUUID(), playerId, name: cleanName(name, `Giocatore ${playerId + 1}`), cleanupTimer: null };
  ws.lobbyId = lobby.id;
  ws.clientId = client.clientId;
  lobby.clients.push(client);

  send(ws, { type: 'joined', lobbyId: lobby.id, clientId: client.clientId, playerId });
  if (lobby.snapshot) {
    send(ws, { type: 'snapshot', payload: lobby.snapshot });
  }
  publishMembers(lobby);
}

function resumeLobby(ws, lobbyId, clientId) {
  const lobby = lobbies.get(String(lobbyId || '').toUpperCase());
  if (!lobby) {
    send(ws, { type: 'error', message: 'Lobby non trovata' });
    return;
  }

  const client = lobby.clients.find((candidate) => candidate.clientId === clientId);
  if (!client) {
    send(ws, { type: 'error', message: 'Sessione lobby scaduta' });
    return;
  }

  if (client.cleanupTimer) {
    clearTimeout(client.cleanupTimer);
    client.cleanupTimer = null;
  }

  client.ws = ws;
  ws.lobbyId = lobby.id;
  ws.clientId = client.clientId;

  send(ws, {
    type: 'resumed',
    lobbyId: lobby.id,
    clientId: client.clientId,
    playerId: client.playerId,
    name: client.name,
    isHost: client.clientId === lobby.hostClientId,
  });
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
    createLobby(ws, message.name);
    return;
  }

  if (message.type === 'join') {
    joinLobby(ws, message.lobbyId, message.name);
    return;
  }

  if (message.type === 'resume') {
    resumeLobby(ws, message.lobbyId, message.clientId);
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
    if (!host?.ws) {
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

  if (message.type === 'leave') {
    leave(ws, true);
  }
}

function removeClient(lobby, client) {
  lobby.clients = lobby.clients.filter((candidate) => candidate.clientId !== client.clientId);
  if (client.cleanupTimer) {
    clearTimeout(client.cleanupTimer);
    client.cleanupTimer = null;
  }
}

function leave(ws, explicit = false) {
  const lobby = getLobbyFor(ws);
  if (!lobby) {
    return;
  }

  const client = lobby.clients.find((candidate) => candidate.clientId === ws.clientId);
  if (!client) {
    return;
  }

  if (explicit) {
    removeClient(lobby, client);
  } else {
    client.ws = null;
    if (client.cleanupTimer) {
      clearTimeout(client.cleanupTimer);
    }
    client.cleanupTimer = setTimeout(() => {
      const currentLobby = lobbies.get(lobby.id);
      const currentClient = currentLobby?.clients.find((candidate) => candidate.clientId === client.clientId);
      if (!currentLobby || !currentClient || currentClient.ws) {
        return;
      }

      removeClient(currentLobby, currentClient);
      if (currentLobby.clients.length === 0 || currentClient.clientId === currentLobby.hostClientId) {
        broadcast(currentLobby, { type: 'closed' });
        lobbies.delete(currentLobby.id);
        return;
      }

      publishMembers(currentLobby);
    }, RECONNECT_GRACE_MS);
  }

  if (lobby.clients.length === 0 || (explicit && ws.clientId === lobby.hostClientId)) {
    broadcast(lobby, { type: 'closed' });
    lobbies.delete(lobby.id);
    return;
  }

  publishMembers(lobby);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, lobbies: lobbies.size, web: fs.existsSync(PUBLIC_DIR) }));
    return;
  }

  const requestedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(requestedUrl.pathname);
  const normalizedPath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = path.join(PUBLIC_DIR, normalizedPath);
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  const filePath = fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile() ? requestedPath : indexPath;

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bisca lobby server');
      return;
    }

    res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
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
