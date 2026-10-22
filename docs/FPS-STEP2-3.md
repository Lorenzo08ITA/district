# Crossfire — FPS Steps 2 e 3

Crossfire nel catalogo usa ora il nuovo motore FPS. Il precedente modulo ThreeGame non gestisce più lo sparatutto. La piattaforma continua a usare Next.js/React, lo stesso account e PostgreSQL/PGlite per i progressi; un servizio WebSocket dedicato isola la simulazione competitiva dagli altri giochi.

## Avvio e prova multiplayer

```sh
npm ci
npm run dev
```

Aprire http://localhost:3000, accedere, scegliere Crossfire e premere Inizia. Partita rapida cerca una stanza compatibile; Crea lobby permette di scegliere Nexus/Sandstorm, modalità e 0–5 bot. Condividere il codice di sei caratteri tramite il pulsante Lobby. Il creatore avvia; nuovi giocatori possono entrare anche durante il round. Concludi e salva termina la partecipazione e attende il risultato persistito dal server.

Per due account distinti usare profili browser separati. Per due schede dello stesso account, attivare **Debug in entrambe prima di collegarsi**: creare una lobby nella prima, inserire il codice nella seconda, avviare. Ogni connessione conserva un UUID di scheda in sessionStorage e nel Worker; le riconnessioni dello stesso Worker mantengono la stessa identità. Le schede duplicate ricevono un nuovo UUID al collegamento. Anche `?debug=true` preseleziona Debug; F3 prima del collegamento lo abilita. Il pannello F3 mostra FPS misurati, tick, input non confermati e permette al creatore di aggiungere Strafe Bot fino a cinque, con reazione 100–2000 ms. Le normali schede sullo stesso account nella stessa stanza si sostituiscono.

Debug resta autenticato e i suoi risultati sono salvati **non verificati**. In produzione è disabilitato salvo `FPS_DEBUG=true`; non attivarlo automaticamente per tutti gli utenti.

## Controlli e regole

- WASD movimento, Shift corsa, Spazio salto, Ctrl/C scivolata, mouse visuale.
- Clic sinistro spara; destro mira; 1–6 selezionano Vanguard AR, Kraber, Vector, Cerberus, Sheriff e Karambit. R ricarica; F ispeziona; Tab espande la classifica; Esc libera mouse e azzera i tasti premuti.
- FFA: 25 eliminazioni. TDM: 50 eliminazioni di squadra. Respawn dopo 90 tick (1,5 s), protezione di 60 tick che termina sparando. Il server sceglie uno spawn libero, penalizzando vicinanza e visibilità dei nemici.
- CTF: tre catture. La propria bandiera deve essere alla base per segnare. Quella persa torna dopo 900 tick. Il portatore usa Sheriff/Karambit; le posizioni delle bandiere sono visibili e il server pubblica un impulso radar ogni tre secondi.
- Hardpoint: punto ogni secondo di controllo non contestato, vittoria a 150; zona diversa ogni 2700 tick (45 s).
- Ogni round ha limite di otto minuti. Alla scadenza vince il maggior numero di eliminazioni in FFA o il punteggio di squadra; la parità usa l'ordine stabile del server. Un'uscita volontaria salva una sconfitta per abbandono.

## File principali

```text
packages/shared/src/fps/arena.ts                  geometrie condivise, spawn, jump-pad e waypoint
packages/shared/src/fps/{math,bvh,kinematics}.ts  movimento/collisioni e raggi
packages/shared/src/fps/{weapons,protocol}.ts     armi e frame binari FPS1
packages/server/src/fps/History.ts               64 pose storiche, sei OBB per attore
packages/server/src/fps/GameRoom.ts              simulazione 60 Hz, danni, modalità, bot
packages/server/src/fps/service.ts               autenticazione, stanze, WebSocket, limiti e salvataggi
packages/client/src/fps/worker.ts                rete, prediction, ACK/replay, riconnessione
packages/client/src/fps/Runtime.ts               renderer Three.js e interpolazione remota
packages/client/src/fps/Assets.ts                armi/personaggi/materiali/arena procedurali
packages/client/src/fps/SecondOrderSpring3D.ts   integrazione analitica delle molle
packages/client/src/fps/Effects.ts               pool istanziati di traccianti, bossoli, scintille e decal
packages/client/src/fps/Audio.ts                 sintesi Web Audio, HRTF e feedback colpi
server/fps.ts                                   account, PostgreSQL/PGlite e recupero dopo arresto
server/schema.sql                               fps_matches e tabelle runs/progress condivise
games/crossfire.tsx                             lobby, input, inviti e HUD
```

## Rete e autorità

`/fps/socket` accetta solo l'Origin configurato e cookie di sessione validi; autenticazione ricontrollata ogni minuto e logout revocato immediatamente. Frame massimi 8 KiB, 100 messaggi/s, 10 controlli/s, 128 connessioni, 32 stanze, 12 attori per stanza e backpressure a 256 KiB. Sono limiti configurati, non capacità di carico misurate.

Il server esegue input a 60 Hz, snapshot a 20 Hz e metadata a 10 Hz. Il client non trasmette coordinate, HP o risultati. Sequenze duplicate/fuori finestra sono rifiutate; il server consuma un input per attore per tick, riducendo gli arretrati e impedendo di accelerare la fisica tramite invii multipli. Il Worker quantizza prima di simulare, conserva 128 input, riapplica quelli non confermati e smorza l'errore visuale in 80 ms. Gli attori remoti usano un buffer di otto snapshot e interpolazione di 100 ms. Quando una pausa lunga svuota la finestra utile viene richiesta una risincronizzazione.

Il rewind usa ricezione server, RTT misurato/2, ritardo di interpolazione e frazione sub-tick, entro la storia di 64 tick. Le sei OBB vengono interpolate senza attraversare respawn. Raggi e penetrazione sono valutati sul server; danni per zona, spread, cadenze, munizioni, ricariche e bandiere restano autoritativi. HitConfirm binari contengono sequenza, vittima, danno, posizione, zona e flag testa/eliminazione. Gli eventi pubblici alimentano traccianti, audio e killfeed. Il pool dei pacchetti mantiene i buffer fino alla callback del trasporto.

L'uso del Worker separa la fisica dal rendering, ma il browser può comunque limitare o sospendere una scheda in background. Non viene promessa una frequenza di 60 Hz client durante la sospensione del sistema; il server resta autoritativo e la replica si riallinea al rientro.

## Rendering e audio

PBR con illuminazione ambientale procedurale PMREM, sole/ombre e neon emissivi; mesh smussate, canne/ottiche/tamburi animabili e personaggi articolati. World camera con FOV dinamico 100–116°, pass arma/braccia separato a 68° dopo clearDepth, scope Kraber in render target separato a 6×. Molle analitiche per posizione/rotazione, rinculo, oscillazione, impatto a terra e ricarica; shader olografico, tone mapping ACES, bloom locale e vignetta direzionale. I pool di effetti sono a capacità fissa e le varianti delle armi remote vengono riutilizzate.

Sui renderer software SwiftShader/llvmpipe vengono disattivati PMREM, ombre e MSAA e ridotta la risoluzione interna; il percorso completo dei materiali e dello scope viene comunque esercitato da un test browser dedicato.

Audio generato senza file esterni: rumore filtrato, bassi sintetici, meccanica metallica, passi HRTF e conferme testa/eliminazione saturate. Audio e pointer lock si attivano con un gesto utente. Bossoli/scintille hanno rimbalzo semplice sul piano base; non simulano collisioni complete con ogni mesh della mappa. I modelli sono procedurali, non asset fotorealistici o animazioni mocap.

## Persistenza ed errori

`fps_matches` conserva snapshot statistici ogni cinque secondi e a ingresso/avvio/conclusione. `runs` e `progress` usano il salvataggio atomico già esistente, con UUID stabile per partecipante e match: le due schede debug dello stesso account producono risultati distinti senza duplicazione ai ritenti. Vengono registrati punteggio, durata, vittoria, modalità/mappa, eliminazioni, morti, danni, colpi alla testa, catture, tempo sulla zona e colpi sparati.

Una riconnessione nella pagina riusa codice e identità del Worker. Al riavvio del processo i round interrotti vengono conclusi dall'ultimo checkpoint riuscito con `interrupted: true`; non viene ripristinata una partita FPS in corso. Un arresto improvviso può perdere gli ultimi cinque secondi statistici. Le stanze senza connessioni vengono concluse dopo due minuti. Errori di persistenza/simulazione sospendono la stanza con messaggio esplicito; la rete tenta la riconnessione, mentre sessioni scadute richiedono un nuovo accesso.

## Verifica

```sh
npm run typecheck
npm test
npm run build
npx playwright test
npm run test:offline
```

I test FPS verificano geometria e movimento, armi/protocollo, replay Node/Worker, OBB storiche tra vite diverse, colpi/blocco muri/friendly fire, respawn, bandiere, hardpoint, bot deterministici, cadenza degli input, capienza e reset dei posti riusati, autenticazione/Origin, identità debug, permessi host, validazione e salvataggi verificati/non verificati. Il test browser usa due schede dello stesso account, lobby con codice, vero pointer lock, cambio arma, movimento, sparo, bot e due risultati nel database. Il test di due profili verifica anche il matchmaking normale.

Nessuna promessa di 144 FPS costanti o latenza zero: servono misure su GPU/rete reali e collaudo di carico. L'architettura è a singola istanza Node persistente; PostgreSQL esterno, HTTPS/proxy, backup e deploy pubblico richiedono l'ambiente di destinazione. Il progetto non contiene una destinazione di pubblicazione configurata.
