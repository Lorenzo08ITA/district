# OpenFront 2.0 — Step 2

Lo Step 2 implementa le meccaniche nel motore deterministico: edifici e upgrade, percorsi, ferrovie e treni, commercio, invasioni anfibie, guerra navale, nucleare, MIRV e SAM. Include inoltre diplomazia e bot Utility AI, così la parte di simulazione è pronta per l'integrazione del prossimo step.

Il nuovo RTS **non è ancora nel catalogo web**. Renderer, HUD, Web Worker applicativo, server WebSocket RTS e relativa persistenza sono lo Step 3. Il Frontier già visibile in District continua a usare il suo vecchio motore. Anche gli aggiornamenti grafici richiesti agli altri giochi restano separati.

## Esecuzione

Dalla radice, Node.js 22+:

```sh
npm ci
npm run demo:rts:world
npm run test:rts
npm run benchmark:rts:world
```

La demo costruisce due nazioni con città, fabbrica, porti, silo e SAM; avvia commercio, flotte, un trasporto e un MIRV. Esegue i tick e verifica il ripristino di uno snapshot. Non richiede database o servizi esterni. Il benchmark usa lo stesso scenario su 2000×2000 tile e riporta i tempi dei tick separatamente dall'inizializzazione e dalla verifica dello snapshot.

Verifica completa:

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:offline
```

## Sorgenti

```text
packages/shared/src/
  commands.ts          Comandi discriminati, incluso ProduceWarship
  constants.ts         Protocollo v2 e limiti dei frame
  types.ts             Strutture, unità, eventi e contaminazione nei delta
  world-balance.ts     Prezzi, HP, velocità e limiti del mondo

packages/engine/src/
  GameEngine.ts        Tick, comandi, sbarchi, snapshot v2 e migrazione v1
  GameMap.ts           TypedArray, confini e contaminazione
  AttackExecution.ts   Fronte terrestre, incluse caselle contaminate
  Pathfinder.ts        A*, heap, buffer riutilizzabili e smoothing
  WorldSystem.ts       Edifici, coperture, cap e coordinamento dei sistemi
  Logistics.ts         Rete ferroviaria, treni e commercio marittimo
  Naval.ts             Trasporti, pattuglie, proiettili e cattura delle merci
  Nuclear.ts           Testate, MIRV, SAM, intercettori e danni ad area
  Diplomacy.ts         Richieste, alleanze, tradimento e Utility AI
  world-types.ts       Contratti del mondo e snapshot
  world-snapshot.ts    Validazione e ricostruzione delle entità

scripts/rts-world-demo.mjs

tests/rts/
  pathfinder.test.ts
  buildings.test.ts
  naval.test.ts
  nuclear.test.ts
  diplomacy.test.ts
  world-replay.ts
  world-replay.test.ts

tests/e2e/rts.spec.ts   Replay del mondo completo in un vero Web Worker
```

I test dello Step 1 restano attivi; quelli sul codec sono aggiornati alla versione 2. Le configurazioni dei quattro workspace e i project references restano invariati.

## Tick e determinismo

Il tick rimane di 100 ms. Ordine operativo:

1. Scadenza della contaminazione e delle richieste diplomatiche; decremento dei cooldown.
2. Aggiornamento dei cap e crescita logistica.
3. Comandi ordinati per tick, giocatore e sequenza.
4. Espansioni terrestri.
5. Logistica, movimento navale, combattimento, missili e intercettori.
6. Aggiornamento delle difese e decisioni dei bot per il tick successivo.
7. Eliminazioni, vittoria e raccolta dei dirty tile.

Le posizioni delle unità sono interi in millesimi di tile. Distanze e avanzamento usano radice quadrata intera, non integrazione basata sul frame time. Le probabilità delle fabbriche e la distribuzione delle testate MIRV usano esclusivamente il PRNG seedable dell'engine.

`getWorldSnapshot()` restituisce copie profonde, inclusi TypedArray e Set. È un'API di ispezione/ripresa, non un metodo da chiamare a ogni frame del futuro renderer. `stateHash()` comprende anche il mondo e usa un ordine canonico delle proprietà; il checksum non cambia dopo un restore per il solo ordine dei campi JavaScript.

## A* e navigazione

A* opera su array piatti di costo, predecessore, generazione e posizione nell'heap. I buffer vengono allocati al primo percorso e riutilizzati. Le ricerche successive non azzerano la mappa intera.

- Terra: quattro vicini, costo influenzato dall'elevazione; logistica su territori propri, alleati o neutrali, evitando contaminazione.
- Mare: solo acqua; le coste sono punti di origine/destinazione, mentre la nave si muove sui tile d'acqua adiacenti.
- Smoothing: string pulling con controllo supercover, incluse le due caselle laterali di un attraversamento diagonale. Nessun taglio attraverso angoli di terra.
- Esiti espliciti: `found`, `unreachable`, `budget-exceeded`.

Il mondo dispone di 200.000 espansioni A* per tick. Un comando senza rotta o senza budget non consuma oro/truppe e ritorna `NO_PATH` o `PATH_BUDGET`. La costruzione di una stazione resta valida se una connessione automatica non può essere calcolata; `pathLimited` segnala il limite. Non è implementata una coda A* incrementale distribuita su più tick: percorsi eccezionalmente lunghi richiedono una richiesta successiva o una futura ricerca gerarchica.

## Edifici ed economia

| Edificio     |     Prezzo base | HP per livello | Livello massimo |
| ------------ | --------------: | -------------: | --------------: |
| City         |         125.000 |          2.000 |              10 |
| Factory      |         200.000 |          2.500 |              10 |
| Port         |         250.000 |          3.000 |              10 |
| Defense Post | 50.000 iniziali |          4.000 |               1 |
| Missile Silo |       1.000.000 |          2.500 |               5 |
| SAM Launcher |         750.000 |          2.200 |               5 |

I prezzi non specificati nel brief sono scelte di bilanciamento centralizzate in `world-balance.ts`, modificabili senza cambiare i sistemi.

Una costruzione normale costa `prezzoBase × (edifici dello stesso tipo posseduti + 1)`. Un upgrade costa `prezzoBase × nuovoLivello²`. I Defense Post costano 50.000 in più per ogni post precedentemente costruito dal giocatore, fino a 250.000. Distruggerli o perderli non azzera il contatore. Non sono aggiornabili.

Costruzione e upgrade validano proprietario, terreno, occupazione, contaminazione, livello, limiti e fondi prima dell'addebito. I porti richiedono una costa reale adiacente all'acqua. Le città aggiungono 250.000 truppe di cap per livello; catture e distruzioni trasferiscono/rimuovono il contributo. Il supporto `cityLevels` del setup conserva gli scenari dello Step 1 come contributo di base separato dagli edifici reali.

Un Defense Post copre le sole caselle del suo proprietario entro 30 tile. Il contatore consente costo di conquista O(1): perdite 5× e lavoro 3×. Un indice spaziale identifica i post vicini. Cattura o distruzione ricostruisce l'area interessata, senza lasciare la vecchia protezione al precedente proprietario.

### Treni

Piazzare Factory/City/Port tenta collegamenti con le stazioni entro 100 tile quando almeno uno degli estremi è una Factory. Il tracciato è A* su terra e viene conservato come TypedArray.

Ogni fabbrica di livello L esegue L tentativi a tick, con probabilità esatta `1 / ((fabbriche del proprietario + 10) × 15)`. I treni scelgono una stazione raggiungibile nella rete ferroviaria. Una visita a City o Port accredita 10.000 gold per livello al proprietario del treno e 5.000 al proprietario della stazione; ciascuna stazione viene pagata una sola volta per treno. Fra alleati diversi i pagamenti hanno moltiplicatore 1,5×. Lo stesso proprietario può ricevere entrambi i ruoli.

I treni avanzano di un tile per tick. Un percorso diventato ostile o contaminato interrompe il treno; non genera pagamenti fittizi. Distruggere una stazione rimuove i collegamenti che la terminano. Le ferrovie usano una lista di adiacenza, evitando una scansione di tutti i binari per ciascun nodo.

### Commercio marittimo

Un porto genera una nave commerciale ogni `max(10, floor(100 / livello))` tick, quando trova un altro porto proprio, alleato o neutrale raggiungibile. La nave naviga a 0,5 tile/tick; il carico vale 1.000 gold per tile di rotta. All'arrivo riceve il pagamento una sola volta; il commercio alleato applica 1,5× e una quota al porto ricevente. I carichi catturati mantengono il proprio valore, cambiano proprietario e cercano un porto amico: nessuna duplicazione del carico.

## Invasioni e guerra navale

`Transport` alloca fra il 10% e il 20% delle truppe correnti. Seleziona la costa amica più vicina con una rotta valida. Non richiede un porto: il porto sblocca invece le navi da guerra. Le truppe vengono sottratte solo dopo aver verificato la rotta.

La nave contiene le truppe impegnate e naviga fino alla costa bersaglio. Allo sbarco paga il costo della testa di ponte, conquista il primo tile e crea un normale `AttackExecution`. Il limite di quattro attacchi include i trasporti in viaggio, evitando sbarchi senza slot. Se il bersaglio è diventato proprio/alleato, le truppe rientrano nel pool entro il cap. Se la nave viene affondata, le truppe sono perse.

`ProduceWarship` richiede un porto proprio, una destinazione in acqua e 300.000 gold. La nave ha 1.000 HP, velocità 0,65 tile/tick, visuale 12 tile e proiettili da 250 danni ogni 10 tick. I proiettili inseguono il bersaglio a 3 tile/tick e rispettano le alleanze anche se cambiano durante il volo.

Una pattuglia raggiunge il punto assegnato e difende l'area. Le navi colpiscono trasporti e navi da guerra; contro il commercio effettuano una cattura, senza distruggere il carico. Ricevono esperienza per sopravvivenza, catture e affondamenti. Esperienza e danni restano nello snapshot; non viene aumentato il danno base di 250.

## Nucleare e SAM

Il silo ha una capacità simultanea pari al livello. Il lancio consuma un posto munizione; impatto/intercettazione lo restituisce se il silo esiste ancora. Cooldown: 90 tick, indipendente dalla capacità. Gli upgrade aggiungono un posto, senza ricaricare artificiosamente quelli ancora in volo.

| Testata  |                                                       Costo | Raggio interno / esterno |
| -------- | ----------------------------------------------------------: | -----------------------: |
| Atom     |                                                     750.000 |                  12 / 30 |
| Hydrogen |                                                   5.000.000 |                 80 / 100 |
| MIRV     | 25.000.000 + 15.000.000 per MIRV già lanciato nella partita |   4 / 10 per sub-testata |

I raggi delle sub-testate MIRV non erano definiti nel brief: 4/10 è il bilanciamento incluso; i raggi Atom/Hydrogen rispettano i valori richiesti.

Il MIRV sale fino al bordo superiore e campiona fino a 350 tile distinti del giocatore bersaglio, distribuendovi sub-testate indipendenti. Il campionamento usa il PRNG e non richiede una lista di oggetti per tutto il territorio. Il contatore di rincaro è globale alla partita, non azzerato alla perdita di un silo. Il bus MIRV non è una singola testata intercettabile: i SAM intercettano ciascuna sub-testata.

Il SAM scansiona un indice spaziale dei missili, con raggio `min(150, 70 + 20 × (livello - 1))` e ricarica di 90 tick. Sceglie prima le minacce più vicine all'impatto, con spareggio per ID, e non spreca un secondo intercettore su una minaccia già assegnata. Gli intercettori viaggiano a 8 tile/tick. L'intercettazione viene risolta prima degli impatti dello stesso tick.

Il raggio interno distrugge edifici/unità, neutralizza la terra, azzera l'elevazione e lascia contaminazione per 300 tick. L'anello esterno infligge danni parziali a unità, strutture e truppe. I tile contaminati non possono essere conquistati o edificati; la scadenza genera dirty update. Le coste restano coste; rilievi colpiti diventano pianure.

Gli alleati sono protetti anche dai danni collaterali; le testate in volo contro un nuovo alleato vengono rimosse. Le proprie unità/strutture possono subire danni collaterali se comprese nell'esplosione.

## Diplomazia e bot

Richiesta, accettazione e rottura sono comandi deterministici. Le richieste scadono dopo 300 tick. L'accettazione aggiorna entrambi i giocatori. Il tradimento rompe entrambi i lati e perde il 5% dell'oro del traditore. I sistemi di espansione, trasporto, commercio, proiettili e nucleare consultano le alleanze correnti.

I bot vengono selezionati tramite `EngineConfig.bots`. Ogni secondo valutano espansione economica, prima Factory, accesso al mare, difesa contro una nazione molto più grande e attacchi ai fronti accessibili. Le decisioni generano comandi per il tick successivo e rispettano costi, cap e validazioni dei giocatori umani. Sono un'AI iniziale deterministica: non una politica completa di guerra navale o nucleare.

## Snapshot, protocollo e limiti

- Snapshot engine versione **2**, con mondo, strutture, binari, unità, proiettili, testate, intercettori, contatori e diplomazia. Gli snapshot core v1 senza entità restano importabili.
- Validazione di IDs unici, riferimenti, posizioni delle unità, percorsi, HP, stock dei silos, cap e contributi delle città. Le quantità di truppe vengono ripristinate dopo aver ricostruito il cap reale.
- Protocollo binario versione **2**. Aggiunto `ProduceWarship`; i record tile passano da 16 a 20 byte con `contaminationUntil` uint32 a offset 16. Massimo 50.000 tile per frame sotto 1 MiB. I frame v1 vengono rifiutati esplicitamente.
- 4.096 edifici globali; costruzione limitata a 128 per giocatore, con possibilità di possederne di più tramite conquista. 8.192 unità globali, 256 per proprietario; 8.192 missili e 2.048 proiettili navali.
- Binari e rotte attive hanno budget separati di due milioni di indici ciascuno. Gli array base della mappa occupano ora 14 byte/tile, più 9 byte/tile per dirty/index e le liste di bordo. Il pathfinder aggiunge 16 byte/tile solo quando necessario.

Lo snapshot strutturato usa TypedArray e Set: va trasferito con structured clone o un codec dedicato nello Step 3, non serializzato direttamente come JSON ordinario. I futuri client non devono poter inviare snapshot al server come fonte autoritativa.

## Verifiche e prestazioni

Test inclusi: percorsi e angoli, rifiuti senza spesa, cap e cattura delle città, coperture dei post, probabilità/ripresa dei treni, commercio alleato, sbarco, affondamento dei trasporti, combattimento navale, cattura delle merci, atomica/H/MIRV, salve SAM, munizioni e upgrade, contaminazione, diplomazia, bot, snapshot corrotti e replay combinato.

Il replay combinato viene eseguito anche in un vero Web Worker Chromium e confrontato con Node, compresa una ripresa durante il volo delle testate.

Prima misura sintetica su Windows/Node 24: mappa 2000×2000, due giocatori, otto edifici iniziali, commercio, flotte, un trasporto e un MIRV; 600 tick. Inizializzazione circa 504 ms, tick medio circa 0,132 ms, p95 circa 0,300 ms, massimo circa 25,1 ms. Circa 286 MiB di ArrayBuffer osservati dopo aver creato anche la copia ripristinata e i buffer temporanei: non è la memoria di un'unica istanza a regime.

Questi numeri non certificano capacità multiplayer. Non includono renderer, rete, database, 64 nazioni simultanee, molteplici MIRV concorrenti o prove prolungate. Il rilascio in produzione resta subordinato a Step 3, test di carico e verifiche dell'infrastruttura.

Report di una seconda esecuzione: [benchmarks/rts-step2.json](benchmarks/rts-step2.json). I tempi variano fra esecuzioni. Verifica finale: 81 test RTS, 102 test automatici complessivi e 12 test browser superati.
