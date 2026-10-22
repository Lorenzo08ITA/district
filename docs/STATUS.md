# Stato della consegna

Verifiche eseguite il 22 ottobre 2026 su Windows, Node.js 24 e Chromium headless.

| Verifica                                   | Risultato                                              |
| ------------------------------------------ | ------------------------------------------------------ |
| TypeScript                                 | Superato                                               |
| Build Next.js ottimizzata                  | Superata                                               |
| Test unitari/integrazione                  | 188 superati                                           |
| Test browser desktop/mobile                | 21 superati                                            |
| Test offline su build ottimizzata          | 2 superati                                             |
| Dipendenze (`npm audit`)                   | Nessuna al controllo precedente; non ripetuto il 22/10 |
| Due socket con partita e risultati salvati | Superato                                               |
| Due browser nell’arena 3D                  | Superato                                               |
| Recupero partita server dopo arresto       | Superato su snapshot persistito                        |

Sono state controllate visivamente home, home mobile e arena FPS. Le immagini in `docs/screenshots` sono anteprime di sviluppo; non costituiscono misure di prestazione.

## Limiti effettivi

Il progetto è funzionante e comprende tutti i generi richiesti, ma **non è certificato pronto per un rilascio pubblico in produzione**. I giochi hanno regole complete e giocabili nella loro scala; sparatutto e conquista non hanno la profondità di contenuti dei prodotti commerciali di riferimento.

- Nessun endpoint PostgreSQL esterno o runtime Docker disponibile in questa sessione. Test locali eseguiti su PostgreSQL embedded PGlite. Il percorso `pg`, il Dockerfile, Compose e il workflow CI PostgreSQL sono forniti ma non sono stati eseguiti qui.
- Nessun dominio, servizio di hosting o credenziale di deploy fornito. Nessuna pubblicazione esterna effettuata. Occorre un processo Node persistente con WebSocket: l’hosting statico da solo non supporta questa architettura.
- Nessun test di carico, benchmark su dispositivi reali, audit indipendente o prova di backup/ripristino. Il limite di 100 stanze è un tetto configurato, non una capacità misurata.
- Simulazione multiplayer su una sola istanza. Nessuna migrazione live delle stanze, matchmaking per abilità, chat, sistema di segnalazione o anti-abuso distribuito.
- Crossfire usa ora sei armi, lag compensation con sei OBB storiche, modalità FFA/TDM/CTF/Hardpoint, lobby/codici, bot e debug per scheda. I modelli e l’audio sono procedurali; non sono asset fotografici o mocap. Le prestazioni su GPU e reti reali restano da misurare.
- Frontier 2.0 include la mappa mondiale Natural Earth a 512×256 e tre layout procedurali a 192×128, edifici, logistica, flotte, nucleare, diplomazia e bot. Le coste sono geografiche; elevazioni e risorse sono valori di gioco procedurali. Dettagli in [RTS-STEP3.md](RTS-STEP3.md).
- Fish Orbit usa crescita e predazione valutate dal client con validazione minima lato server. Cibo e collisioni non sono una simulazione globale autoritativa. È una modalità casuale.
- Corse online e sfide runner/Flappy condividono stato e classifica; nessuna collisione tra giocatori o replay deterministico condiviso.
- Il Wordle permette partite senza limite giornaliero con un vocabolario incluso finito; i quiz hanno 30 domande per categoria. Ampliare i contenuti richiede revisione editoriale.
- L’offline richiede una prima visita con connessione. I checkpoint Canvas/3D hanno una finestra di cinque secondi; la chiusura improvvisa della scheda può perdere quell’intervallo. Il risultato finale resta nella coda locale fino a conferma server.
- Le partite simultanee dello stesso gioco su più dispositivi condividono un checkpoint con criterio ultimo timestamp, senza fusione. I risultati completi restano invece distinti grazie agli UUID.

Per il rilascio: eseguire il workflow PostgreSQL, collaudare proxy HTTPS e cookie Secure, misurare il carico previsto, configurare backup e monitoraggio, verificare dispositivi reali e approvare una revisione di sicurezza. Nessun test passato qui sostituisce queste verifiche.

## Aggiornamento RTS — Step 1

Aggiunti i workspace shared/engine e la configurazione dei workspace server/client. Il nuovo core deterministico non è ancora integrato nel catalogo: renderer e server RTS attendono lo Step 3. Superati 34 test RTS, incluso snapshot/protocollo; 55 test automatici complessivi, 11 browser inclusa uguaglianza del replay Node/Web Worker, e 1 offline. Specifiche e misure in [RTS-STEP1.md](RTS-STEP1.md). Le altre modifiche ai giochi richieste successivamente alla prima consegna restano da implementare.

## Aggiornamento RTS — Step 2

Implementati edifici/upgrade, percorsi A* terra/mare, ferrovie/treni, commercio marittimo, trasporti, flotte, nucleare, MIRV/SAM, diplomazia e bot. Passati 81 test RTS e 102 test automatici complessivi; 12 test browser, con replay del mondo completo identico tra Node e Web Worker. TypeScript e build superati. Demo: `npm run demo:rts:world`. Report sintetico 2000×2000 in [benchmarks/rts-step2.json](benchmarks/rts-step2.json); regole e limiti in [RTS-STEP2.md](RTS-STEP2.md).

Al termine storico dello Step 2 il nuovo RTS non era esposto nel catalogo; lo Step 3 sotto completa questa integrazione. Non sono dichiarati completati il rilascio in produzione o gli aggiornamenti agli altri giochi.

## Aggiornamento RTS — Step 3

Frontier 2.0 sostituisce il gioco precedente nel catalogo. Implementati renderer WebGL2/shader con fallback Canvas2D, camera pan/zoom, overlay vettoriale, HUD costruzioni/flotte/nucleare/diplomazia, Worker applicativo offline e replica online, server ws autoritativo con lobby/codici e riconnessione, controlli di identità/frequenza/dimensione, journal e recovery, risultati verificati/idempotenti, checkpoint IndexedDB/cloud per account e PWA. I guasti di persistenza sospendono la stanza; i risultati finali includono i disconnessi.

Verificati 114 test automatici (93 RTS), 16 browser e 2 offline; build e TypeScript superati. Browser: due account e Worker con checksum identici, recupero dopo checksum alterato, conquista/costruzione/ripresa, cloud/CSRF, mobile senza WebGL. Controllate anteprime desktop/mobile RTS. Architettura, uso e limiti in [RTS-STEP3.md](RTS-STEP3.md). Nessun rilascio esterno o test di carico; una sola istanza autoritativa. Specifica FPS successiva e altri aggiornamenti ai giochi ancora da implementare.

## Aggiornamento FPS — Step 1

Implementato shared/src/fps senza sostituire il Crossfire esistente: matematica mutabile, ray–OBB, BVH statico e sweep capsula–triangolo, movimento a 60 Hz con air-strafing/slide-hop/slope boost/step-up/buffer/jump-pad, sei armi, protocollo binario sub-tick, input ring e pool per buffer in volo. Passati 38 test FPS; totale 152 test automatici. Replay Node/Worker verificato con tolleranza numerica esplicita; 17 browser complessivi. TypeScript e build passati. [Dettagli FPS](FPS-STEP1.md).

Il deploy pubblico è stato richiesto ma non esiste una destinazione configurata nel progetto e Sites non restituisce siti associati. È stato richiesto URL/hosting; nessuna pubblicazione esterna dichiarata. Il pacchetto sorgente .artifacts/district-source.zip è predisposto per il caricamento sul server indicato. Questo era lo stato al termine dello Step 1; gli Step 2 e 3 sono completati sotto.

## Aggiornamento FPS — Step 2 e 3, 22 ottobre 2026

Crossfire sostituito con il nuovo client/server: simulazione autoritativa 60 Hz, snapshot 20 Hz, prediction/reconciliation in Worker, rewind a 64 tick con sei OBB coerenti con il rig visibile, armi complete e wallbang limitato, respawn con valutazione della visibilità, FFA/TDM/CTF/Hardpoint, bot configurabili, codici lobby, invito copiabile, riconnessione e debug autenticato per due schede sullo stesso account. Risultati normali verificati, debug non verificati; checkpoint statistici ogni cinque secondi e recupero dei round interrotti.

Renderer Three.js a doppia camera, PBR/PMREM, ottiche e scope 6×, molle analitiche per posizione/rotazione, braccia/personaggi articolati, effetti istanziati, audio sintetico HRTF, HUD e debug F3. I renderer software usano un percorso alleggerito; un test esercita anche quello completo. Verificati 59 test FPS, 174 test automatici totali, 19 browser e 2 offline. Build e TypeScript passati. Test reali con due account, due schede dello stesso account, movimento, armi, bot, scope/ricarica e risultati persistiti. Guardie AST estese ai cicli di simulazione server e rendering del client. [Documentazione FPS](FPS-STEP2-3.md).

Verificata anche la nuova mappa mondiale di Frontier, con conquista, costruzione, salvataggio/ripresa e cloud. Il pacchetto sorgente include i dati geografici e la loro provenienza. Nessuna pubblicazione esterna: URL/hosting non forniti. Gli aggiornamenti a runner, guida, quiz e altri giochi restano separati da questo completamento FPS.

## Aggiornamento visivo Crossfire

Quattro mappe nel protocollo/lobby, aggiunte Bastione e Cedar con ingressi, finestre, livelli e rampe condivisi con la fisica. Nuovi dettagli su armi, guanti e operatori, materiali PBR procedurali, cielo/nuvole, mare, rilievi e vegetazione istanziata. Batching statico, interpolazione della camera, mira immediata con conferma del Worker, riconoscimento dei respawn, risoluzione adattiva e menu qualità. Nuovi test su geometria/spawn/percorsi, materiali, batching, atmosfera, presentazione e stanze WebSocket. [Dettagli e limiti delle misure](FPS-VISUALS.md).
