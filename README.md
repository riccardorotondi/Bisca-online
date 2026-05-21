# Bisca Mobile

Prima versione giocabile iOS/Android creata con Expo e React Native.

## Avvio rapido

Richiede Node.js 20.19.x o superiore, in linea con Expo SDK 55.

```bash
npm install
npm run start
```

Poi apri il QR code con Expo Go su iOS/Android, oppure usa:

```bash
npm run android
npm run ios
```

Senza Expo Go puoi giocare nel browser:

```bash
npm run web
```

Per il multiplayer locale avvia anche il server lobby in un secondo terminale:

```bash
npm run lobby
```

Poi crea una lobby dall'app e condividi il link generato.

## Multiplayer online

Per giocare davvero online il server lobby deve stare su un dominio pubblico HTTPS/WSS.

1. Deploya il backend `server/lobby.js` su un servizio Node/Docker.
   - Start command: `npm run lobby`
   - Health check: `/health`
   - Porta: usa la variabile `PORT` fornita dall'hosting
   - Dockerfile: `Dockerfile.lobby`

2. Prendi l'URL pubblico del backend e trasformalo in WebSocket:

```text
https://bisca-lobby.example.com -> wss://bisca-lobby.example.com
```

3. Crea un file `.env` nell'app:

```bash
EXPO_PUBLIC_LOBBY_WS_URL=wss://bisca-lobby.example.com
```

4. Riavvia Expo:

```bash
npm run web
```

Da quel momento i link lobby generati dall'app possono essere aperti da altri giocatori online.

## Cosa c'e'

- Tavolo da 2 a 8 giocatori.
- Partita locale contro AI: tu sei il giocatore 1, gli altri posti sono gestiti dall'app.
- Multiplayer con lobby WebSocket e invito tramite link.
- Nella prima versione online l'host e' autorevole: crea la lobby, avvia la partita e sincronizza lo stato con gli invitati.
- Vite configurabili prima di avviare la partita.
- Partita su piu' mani: chi sbaglia la chiamata perde una vita, chi arriva a zero viene eliminato.
- Vince l'ultimo giocatore rimasto con vite.
- Le mani seguono il ciclo 5, 4, 3, 2, 1 carte a testa, poi ripartono da 5.
- Nelle mani da 1 carta vedi le carte degli altri giocatori ma non la tua durante la chiamata.
- Chiamata iniziale da 0 al numero di carte della mano, in ordine di tavolo.
- L'ultima chiamata e' vincolata: il totale delle chiamate non puo' essere uguale alle prese disponibili.
- Presa corrente, conteggio `prese/dichiarazione`.
- Le carte giocate restano visibili sul tavolo prima che la presa venga raccolta.
- Carte in stile trevigiano: Ori, Coppe, Spade e Bastoni.
- Design ispirato alle trevigiane reali: carte strette e alte, colori rosso/blu/giallo, ori bicolore, assi con motto e figure Fante/Cavallo/Re.
- Scala dei semi: Ori, Coppe, Spade, Bastoni.
- Gestione della matta: asso di Ori giocabile come carta massima o come zero.
- Solver AI portato da `bisca.py` in TypeScript.

## WSL

Se usi WSL, assicurati che Node arrivi da `nvm` dentro Ubuntu:

```bash
source ~/.nvm/nvm.sh
node -v
npm -v
```

Se `npm run start` segnala permessi sugli eseguibili locali, correggi i binari:

```bash
chmod +x node_modules/.bin/expo node_modules/.bin/tsc node_modules/.bin/tsserver
```

Se React Native DevTools segnala `libnspr4.so`, installa la libreria di sistema:

```bash
sudo apt install -y libnspr4
```
