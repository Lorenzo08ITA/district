# District

Una piattaforma di giochi web in TypeScript: scegli un gioco, entra in partita e conserva i progressi nel tuo account. Dodici giochi, modalità offline e multiplayer, catalogo personalizzabile e moduli caricati su richiesta.

Crossfire include un FPS autoritativo con sei armi, quattro mappe, quattro modalità e debug su due schede. Frontier include un RTS deterministico con mappa mondiale, conquista, economia, logistica e diplomazia.

## Avvio rapido

Richiede **Node.js 22+** e npm; verificato con Node.js 24. Dalla cartella del repository:

```sh
npm ci
npm run dev
```

Apri [localhost:3000](http://localhost:3000). Senza `DATABASE_URL`, viene usato PostgreSQL embedded **PGlite**, persistente in `.data/arcade`. Per lo sviluppo locale non servono servizi esterni né un file `.env`. Non avviare due processi sullo stesso database PGlite.

I giochi offline si possono provare come ospite. Registrazione e accesso associano risultati e progressi al giocatore; il multiplayer richiede un account. I dati locali in `.data/` non sono inclusi nel repository Git.

Per la build ottimizzata e la cache offline:

```sh
npm run build
npm run preview
```

Il Service Worker è attivo nella build ottimizzata: un gioco deve essere visitato almeno una volta online prima di poterlo riaprire senza rete. Le partite multiplayer richiedono sempre il server.

## Giochi

| Gioco         | Grafica     | Modalità                                             |
| ------------- | ----------- | ---------------------------------------------------- |
| Pulse Run     | 2D          | Runner a un tasto, locale e sfide online             |
| Neon Wing     | 2D          | Volo fra ostacoli, locale e sfide online             |
| Crossfire     | Three.js    | FFA, Team Deathmatch, Cattura la bandiera, Hardpoint |
| Little Orbit  | 2D          | Crescita e predazione multiplayer                    |
| Frontier      | 2D / WebGL2 | Conquista territoriale, locale con bot e online      |
| Night Circuit | Three.js    | Guida e checkpoint, locale e online                  |
| Dieci domande | 2D          | Quiz di cultura generale                             |
| Altrove       | 2D          | Quiz geografico                                      |
| Flag Club     | 2D          | Quiz sulle bandiere                                  |
| Parola        | 2D          | Wordle italiano, partite senza limite giornaliero    |
| Flux Grid     | 2D          | Puzzle delle luci                                    |
| Prism Fall    | Three.js    | Schivata a velocità crescente                        |

Le sfide online di runner e volo condividono punteggi, senza collisioni fra giocatori. La guida online condivide posizioni e risultati, senza collisioni fra veicoli. Il vocabolario di Parola è finito: sono illimitate le partite, non il numero di parole incluse.

## Multiplayer

### Crossfire

Accedi, apri Crossfire e scegli **Partita rapida** oppure **Crea lobby**. Nelle lobby private condividi il codice di sei caratteri; il creatore avvia la partita. Bastione, Cedar, Nexus e Sandstorm offrono coperture, rampe, passerelle e jump-pad.

- WASD: movimento; Shift: corsa; Spazio: salto; Ctrl/C: scivolata.
- Mouse: visuale; sinistro: fuoco; destro: mira; 1–6: arma; R: ricarica.
- Tab: classifica; F: ispezione; Esc: libera il mouse; F3: debug.
- Per due schede dello stesso account, abilita **Debug in entrambe prima di collegarti**, crea una lobby e inserisci lo stesso codice nell'altra. Il pannello F3 permette al creatore di aggiungere bot con reazione configurabile.

Il server controlla movimento, danni, munizioni, modalità e risultati. Le normali partite usano risultati verificati; quelle debug restano non verificate. In produzione il debug richiede l'abilitazione esplicita `FPS_DEBUG=true`.

### Frontier

Scegli una partita locale con bot oppure crea una lobby online e condividi il codice. Il mondo predefinito usa coste geografiche Natural Earth a **512×256 tile**; restano disponibili tre layout procedurali a 192×128. Trascina per spostarti, usa la rotella per lo zoom e clicca sui confini per espanderti. Costruzioni, flotte, armamenti e diplomazia sono accessibili dall'HUD.

## Stack e architettura

- **Next.js, React e TypeScript:** catalogo, account, interfaccia e caricamento separato dei giochi.
- **Three.js e shader GLSL:** FPS, guida e schivata 3D; Canvas2D/WebGL2 per il RTS.
- **Node.js e `ws`:** FPS autoritativo a 60 Hz e RTS deterministico a 10 Hz, con Web Worker sul client. Socket.IO gestisce le altre sfide online.
- **PostgreSQL e `pg`:** account, risultati, riepiloghi e checkpoint, con transazioni e UUID idempotenti. PGlite usa lo stesso schema nello sviluppo locale e nei test.
- **Zod, Vitest e Playwright:** validazione degli input e verifiche di simulazione, rete, persistenza e browser.

```text
app/                   Pagine Next.js e stile
components/            Catalogo, account e contenitore dei giochi
games/                 Moduli indipendenti dei dodici giochi
lib/                   Catalogo, validazione e salvataggi client
packages/
  shared/src/          Tipi, protocolli binari e core fisico FPS
  engine/src/          Simulazione RTS deterministica
  server/src/          Servizi multiplayer RTS e FPS
  client/src/          Renderer, Worker, audio ed effetti
server/                HTTP, autenticazione, database e adattatori multiplayer
server/schema.sql      Schema relazionale e indici
data/geography/        Dati Natural Earth e provenienza
public/                Asset statici e Service Worker
scripts/               Build dei Worker, mappe, demo e benchmark
tests/                 Test unitari, integrazione, browser e offline
docs/                  Architettura, specifiche e stato delle verifiche
.github/workflows/     Verifica automatica con PostgreSQL
```

`npm run build:rts` prepara tutti i workspace e i Worker RTS/FPS; viene richiamato automaticamente prima dell'avvio di sviluppo e dalla build principale.

## Dati e sicurezza

Lo [schema SQL](server/schema.sql) collega giocatori, giochi, risultati e progressi. Le statistiche specifiche sono conservate in JSONB; i riepiloghi tengono record, partite, vittorie e tempo totale. I checkpoint permettono di riprendere le partite offline. I risultati ospite possono essere importati dopo l'accesso.

Le password usano scrypt; le sessioni usano cookie HttpOnly/SameSite e Secure in produzione. Le scritture e gli handshake WebSocket controllano l'origine. Il server valida dimensione, frequenza e contenuto degli input. Gli UUID impediscono di registrare due volte lo stesso risultato. I risultati offline restano non verificati.

## Verifiche

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:offline
```

I test browser usano la porta 3000. I test offline avviano una propria istanza: prima arresta eventuali server locali su quella porta. Non eseguire una build dei Worker mentre è in corso un test browser.

Ultima verifica completa: **188 test automatici, 21 test browser e 2 test offline**. Il dettaglio delle verifiche e dei limiti è in [docs/STATUS.md](docs/STATUS.md). La CI include PostgreSQL; l'esecuzione locale documentata usa PGlite.

## Distribuzione

Serve un processo **Node persistente** con supporto WebSocket: il solo hosting statico non basta. Per l'ambiente di produzione configura `DATABASE_URL` verso PostgreSQL e `PUBLIC_ORIGIN` con l'origine HTTPS effettiva, quindi esegui `npm run build` e `npm start`. La configurazione di esempio è in [.env.example](.env.example); non inserire credenziali nei file versionati.

Sono inclusi [Dockerfile](Dockerfile) e [compose.yaml](compose.yaml). Proxy HTTPS, backup, carico atteso e hardware reale devono essere verificati nell'ambiente di destinazione. Non sono dichiarati 144 FPS costanti, latenza zero o capacità di carico non misurate. Nessun deploy pubblico è stato effettuato in questa sessione.

## Documentazione

- [Architettura e database](docs/ARCHITECTURE.md)
- [FPS: nuovi modelli, mappe, shader e fluidità](docs/FPS-VISUALS.md)
- [FPS: server, renderer, protocollo e debug](docs/FPS-STEP2-3.md)
- [RTS: simulazione, interfaccia e persistenza](docs/RTS-STEP3.md)
- [Dati della mappa mondiale](data/geography/README.md)
- [Stato del progetto e limiti verificati](docs/STATUS.md)
- [Bozza della richiesta di crediti API](docs/API-CREDITS-APPLICATION.md)
