# OpenFront 2.0 — Step 1

Documento dello Step 1. Stato corrente e protocollo aggiornato: [RTS-STEP2.md](RTS-STEP2.md).

Il nuovo RTS è un sottoprogetto di District. Questo step implementa il codice eseguibile dei pacchetti `shared` ed `engine`; `server` e `client` hanno manifest, configurazione e contratti per lo Step 3. Nessun gioco esistente è stato sostituito. Le modifiche richieste a Pulse Run, Neon Wing, Crossfire, Little Orbit, Night Circuit, quiz, bandiere, Wordle e Prism Fall restano nel backlog, senza dichiararle completate.

## File del monorepo RTS

```text
Games/
├── package.json                    npm workspaces e comandi di build/test
├── package-lock.json
├── tsconfig.json                   piattaforma Next.js esistente
├── tsconfig.base.json              TypeScript rigoroso per i pacchetti
├── tsconfig.rts.json               build ordinata con project references
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── constants.ts        tick, limiti e bilanciamento
│   │       ├── types.ts            enum, giocatori, delta, eventi ed entità
│   │       ├── commands.ts         union discriminata, validazione Zod
│   │       └── binary.ts           encoding/decoding binario
│   ├── engine/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── prng.ts             Mulberry32 e validazione interi
│   │       ├── collections.ts      lista densa con storage TypedArray
│   │       ├── GameMap.ts          tile, confini, centroidi e dirty updates
│   │       ├── state.ts            configurazione e stato dei giocatori
│   │       ├── AttackExecution.ts  wavefront e heap delle priorità
│   │       ├── GameEngine.ts       tick, crescita, comandi e vittoria
│   │       └── hash.ts             checksum canonico little-endian
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md               contratto della rete nello Step 3
│   └── client/
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md               contratto renderer/worker nello Step 3
├── scripts/
│   ├── rts-demo.mjs
│   └── rts-benchmark.mjs
├── tests/
│   ├── rts/
│   │   ├── protocol.test.ts
│   │   ├── engine.test.ts
│   │   └── replay.ts
│   └── e2e/
│       └── rts.spec.ts              confronto Node/Web Worker reale
└── docs/
    └── RTS-STEP1.md
```

Gli output `packages/*/dist` sono generati e ignorati da Git. Le cartelle della piattaforma esistente non sono duplicate nell'albero sopra. Non sono presenti file sorgente segnaposto per meccaniche ancora da implementare.

## Esecuzione

Richiede Node.js 22+; verificato con Node 24. Dalla radice:

```sh
npm ci
npm run build:rts
npm run demo:rts
npm run test:rts
npm run benchmark:rts
```

La demo costruisce una mappa, codifica e decodifica due comandi, esegue 200 tick e verifica uno snapshot ripreso. Non serve un database né un browser.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

La suite browser comprende il confronto fra Node e un Web Worker Chromium. Il bundler esbuild viene usato solo nel test per creare un Worker autosufficiente. Il test non richiede un nuovo renderer o server RTS.

## Determinismo e tick

`tick()` avanza esattamente di 100 ms simulati. Non legge l'orologio, non usa temporizzatori e non dipende dal frame rate. Il server dello Step 3 pianificherà le chiamate a 10 Hz; il Worker eseguirà gli stessi tick ricevuti/ricostruiti.

Ordine di ogni tick:

1. Aggiornamento dei cap e crescita delle truppe in ordine crescente di ID giocatore.
2. Esecuzione degli input per `(executeTick, playerId, sequence)`.
3. Avanzamento degli attacchi nell'ordine stabile di creazione.
4. Aggiornamento cap, eliminazioni e verifica della dominazione.
5. Emissione degli eventi e dei soli tile modificati.

Ogni connessione deve conservare sequenze crescenti per il proprio giocatore. Input validi ma tardivi, duplicati o troppo anticipati vengono rifiutati. Le alleanze iniziali devono essere reciproche. Gli schemi invalidi causano un errore Zod; i rifiuti di gioco usano codici espliciti.

Mulberry32 conserva uno stato uint32 ripristinabile. `nextInt` usa rejection sampling per evitare il bias del modulo. La simulazione non contiene casualità nativa, trigonometria, dipendenze da locale o API di sistema. Il seed è disponibile per le meccaniche probabilistiche dei prossimi step; l'espansione corrente non richiede estrazioni casuali.

Truppe e oro sono interi sicuri. Il prodotto della crescita logistica usa `BigInt` per evitare perdita di precisione quando il cap è elevato; il risultato torna un `number` intero. Il tasso è definito per tick, con crescita massima intorno alla metà del cap e rallentamento vicino al limite. Una popolazione sotto il cap cresce almeno di una unità, evitando uno stato bloccato a zero. I giocatori senza terra hanno cap e truppe a zero.

## Mappa e memoria

Indice: `y * width + x`. Nessun oggetto per tile.

| Campo               | Storage     | Byte/tile |
| ------------------- | ----------- | --------: |
| terreno             | Uint8Array  |         1 |
| elevazione          | Uint8Array  |         1 |
| proprietario        | Uint16Array |         2 |
| bitmask confini     | Uint8Array  |         1 |
| edificio            | Uint32Array |         4 |
| copertura difensiva | Uint8Array  |         1 |

I campi di gioco occupano 10 byte/tile. Gli indici ausiliari aggiungono 9 byte/tile: flag dirty, coda dirty e posizione nell'indice dei confini. Le liste dei confini crescono in TypedArray separati per giocatore. Contatori e somme delle coordinate mantengono land size e centroide senza scansioni globali a ogni tick.

`setOwner` aggiorna il tile conquistato e i suoi quattro vicini. Le liste dense dei confini rimuovono gli elementi tramite scambio con l'ultimo, in O(1). `consumeDirtyTiles()` restituisce una copia di proprietà del chiamante e azzera solo i flag interessati. Il primo consumo contiene tutti i tile; snapshot iniziali grandi devono essere spezzati dalla rete dello Step 3.

Le TypedArray sono leggibili direttamente per velocità, ma vanno modificate solo attraverso i metodi di `GameMap`. Scriverci direttamente aggira contatori e dirty tracking. Le dimensioni massime sono 4096 per lato e 4.194.304 tile complessivi. Le coste sono terra; acqua profonda e bassa non sono conquistabili. L'elevazione influenza il costo anche per colline e montagne.

`isBorder` usa N=1, E=2, S=4, W=8. Un bordo può quindi valere 15; il renderer deve verificare un valore diverso da zero.

## Espansione

L'input Attack specifica un bersaglio adiacente e l'allocazione in basis point: 1000=10%, 10000=100%. La quantità viene sottratta subito dal pool del giocatore e assegnata a un `AttackExecution`.

Il bersaglio seleziona il proprietario da attaccare. L'attacco avanza su tutti i confini contro quel proprietario, come un fronte territoriale, non come un proiettile verso un singolo pixel. Un heap riutilizzabile ordina ogni wavefront per costo crescente, distanza dal centroide dell'attaccante e indice tile come spareggio stabile. Le priorità sono ricostruite all'inizio di ogni tick; il costo effettivo viene ricalcolato prima dell'addebito.

Costo:

```text
base = ceil(100 * (255 + elevation) / 255)
resistenza = ceil(truppe_difensore / tile_difensore), oppure zero per neutrali
costo = base + resistenza
se copertura difensiva del tile nemico > 0: costo *= 5
```

Un tick dispone di 12 unità di lavoro; un tile normale costa 1 unità, uno protetto 3. La copertura viene azzerata al cambio di proprietario, impedendo di ereditare difese nemiche. La produzione e il ricalcolo dei Defense Post reali arrivano nello Step 2.

Ogni cattura aggiorna le frontiere degli altri attacchi dello stesso giocatore. Un tile viene nuovamente validato prima della conquista: un confine perso non permette espansioni remote. I tile della nuova wave diventano candidati dal tick successivo. Gli attacchi terminano se esauriscono risorse o candidati; le truppe residue rientrano entro il nuovo cap se il giocatore possiede ancora terra. CancelAttack può annullare solo gli attacchi propri. Limite: quattro attacchi simultanei per giocatore.

Il cap è `tile * 5000 + livelliCittà * 250000`. In questo step `cityLevels` è un valore di setup/snapshot per verificare il calcolo; la costruzione reale delle città è rinviata allo Step 2. Il saldo gold è conservato ma non genera ancora economia automatica.

La vittoria scatta con almeno l'80% della terra, escludendo l'acqua. Dopo una vittoria ulteriori tick generano un errore, e nuovi input sono rifiutati.

## Protocollo binario

Little-endian, versione 1. Header comune di 16 byte:

| Offset | Tipo   | Campo            |
| -----: | ------ | ---------------- |
|      0 | uint32 | magic `RTS2`     |
|      4 | uint16 | versione         |
|      6 | uint8  | tipo pacchetto   |
|      7 | uint8  | riservato, zero  |
|      8 | uint32 | byte del payload |
|     12 | uint16 | numero record    |
|     14 | uint16 | riservato, zero  |

Ogni comando ha un header di 16 byte: lunghezza record uint16, tipo uint8, riservato uint8, player uint16, riservato uint16, sequenza uint32 e tick uint32. Seguono 4–12 byte specifici del comando. Il modulo comprende Attack, CancelAttack, Build, Upgrade, Transport, Patrol, LaunchNuke e diplomazia. I comandi oltre Attack/CancelAttack vengono decodificati ma il core dello Step 1 risponde `UNSUPPORTED_COMMAND` senza eseguirli.

Il delta tile contiene tick e checksum uint32, poi record da 16 byte: indice uint32, proprietario uint16, confini uint8, copertura uint8, edificio uint32, terreno uint8, elevazione uint8, riservato uint16. Gli indici devono essere univoci e crescenti. I dirty tile dell'engine non sono ordinati: ordinarli prima di creare il delta.

Limiti: 1 MiB per pacchetto, 4096 comandi per frame, 60.000 tile per delta. I decoder rifiutano troncamenti, byte finali inattesi, versioni sconosciute, campi riservati non nulli e valori fuori schema. Sono supportate view `Uint8Array`/Buffer con offset, senza leggere byte esterni alla view.

Il codec non autentica né cifra i pacchetti. Identità, TLS, rate limit e associazione a una stanza appartengono al server dello Step 3. L'indice uint32 decodificato va inoltre verificato rispetto alla mappa della stanza.

## Snapshot e diagnostica

`snapshot()` produce copie dei buffer e dello stato dinamico: giocatori, alleanze, attacchi/frontiere, coda input, sequenze e stato del PRNG. `fromSnapshot()` ricostruisce contatori e confini e valida gli invarianti. Gli snapshot sono dati strutturati con TypedArray, adatti a structured clone; non sono JSON diretto e non costituiscono ancora un formato binario di persistenza.

`stateHash()` usa FNV-1a canonico little-endian. È un controllo diagnostico, non un MAC di sicurezza. Comprende stato della mappa, risorse, attacchi, PRNG e input in attesa; esclude la coda dirty, che è un dettaglio del trasporto. È O(numero tile): non viene eseguito automaticamente a ogni tick sulle mappe grandi.

## Misure e limiti

Benchmark sintetico eseguito su Windows/Node 24 durante questa sessione: 2000×2000 tile, due giocatori, due espansioni neutrali, 300 tick. Prima misura: inizializzazione circa 96 ms, tick medio circa 0,031 ms, p95 circa 0,096 ms, massimo circa 0,77 ms, circa 88 MiB di ArrayBuffer osservati. La copia iniziale di quattro milioni di dirty tile è misurata separatamente. La misura comprende anche i tick successivi alla conclusione delle espansioni. I numeri dipendono dalla macchina e non includono renderer, rete, costruzioni o migliaia di attacchi.

Non è una prova della capacità di un server multiplayer né una certificazione di produzione. Il core ha limiti espliciti, test e replay deterministici; restano da misurare battaglie dense con 64 giocatori, pathfinding e unità degli step successivi, carico rete, recovery e persistenza del nuovo RTS.

## Prossimi step, previa conferma

- Step 2: A*, edifici/upgrade, logistica ferroviaria e navale, guerra navale, testate, MIRV e SAM. Gli enum, comandi e contratti delle entità sono già nel pacchetto shared; non sono presentati come meccaniche operative.
- Step 3: server WebSocket RTS, sincronizzazione, renderer, HUD e Worker applicativo, integrazione nel catalogo.
- Richieste agli altri giochi: conservate come lavoro distinto; nessuna modifica grafica o nuova modalità Crossfire è stata inclusa implicitamente in questo Step 1.
