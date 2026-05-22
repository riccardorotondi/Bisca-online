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

Senza Expo Go puoi giocare nel browser in sviluppo:

```bash
npm run web
```

Per il multiplayer locale in sviluppo avvia anche il server lobby in un secondo terminale:

```bash
npm run lobby
```

Poi crea una lobby dall'app e condividi il link generato.

## Pagina online sempre attiva

Il deploy Render serve sia la web app sia la lobby WebSocket dallo stesso dominio. In produzione apri direttamente l'URL Render dal browser, anche da telefono: l'host crea la partita dalla pagina iniziale, condivide il link lobby, e chi entra da link viene portato direttamente nella lobby.

### Deploy su Render

La repo include gia' un Blueprint Render in `render.yaml`.

1. Pusha la repo su GitHub/GitLab.
2. In Render crea un nuovo Blueprint e seleziona questa repo.
3. Lascia il Blueprint path predefinito: `render.yaml`.
4. Applica il Blueprint: Render creera' il servizio web `bisca-lobby`.
5. Quando il deploy e' finito, apri l'URL pubblico mostrato da Render: quella e' la pagina di gioco online.
6. Per controllare lo stato del servizio puoi aprire `/healthz`, per esempio:

```text
https://bisca-lobby.onrender.com/healthz
```

Se risponde con `{"ok":true,...}`, il server lobby e' online.

Configurazione inclusa:

- Runtime: Docker
- Dockerfile: `Dockerfile.lobby`
- Build web Expo servita dalla cartella `dist`
- Health check: `/healthz`
- Porta: variabile `PORT` fornita da Render
- Regione: `frankfurt`
- Auto deploy: a ogni commit

In produzione non serve configurare `EXPO_PUBLIC_LOBBY_WS_URL`: se la pagina e' aperta in HTTPS, l'app usa automaticamente `wss://` sullo stesso dominio. In sviluppo locale puoi ancora usare `.env` per puntare a un backend specifico.

## Cosa c'e'

- Tavolo da 2 a 8 giocatori.
- Pagina iniziale online con creazione partita host.
- Ingresso diretto in lobby quando apri un link invito.
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
