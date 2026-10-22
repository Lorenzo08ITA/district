# Frontier 2.0 — Step 3

Il nuovo motore RTS sostituisce Frontier nel catalogo District. Gli Step 1–3 del percorso OpenFront sono implementati. Il percorso FPS successivo è documentato in [FPS-STEP2-3.md](FPS-STEP2-3.md).

## Esecuzione

Node.js 22 o successivo. Dalla radice:

```sh
npm ci
npm run dev
```

Aprire http://localhost:3000. Il comando prepara automaticamente i pacchetti TypeScript e il Worker. Per una build ottimizzata: `npm run build && npm run preview`. Il server locale usa PGlite persistente; `DATABASE_URL` abilita PostgreSQL. La modalità `npm start` richiede PostgreSQL e `PUBLIC_ORIGIN` HTTPS, come il resto della piattaforma.

- **Locale:** Frontier → Inizia → scegliere mappa → Nuova partita. Tre nazioni bot; Riprendi mondo riapre un salvataggio esistente.
- **Online:** registrare due account in due profili browser o contesti separati; Frontier → Online → Inizia. Il primo crea una lobby, copia il codice di sei caratteri; il secondo lo inserisce. Il creatore avvia. Le schede dello stesso profilo condividono il cookie e non rappresentano due account.
- La mappa predefinita Mondo reale usa le coste Natural Earth a 512×256 tile; sono disponibili anche Continenti, Arcipelago e Lo stretto a 192×128. Fonte e rigenerazione in [data/geography/README.md](../data/geography/README.md). Le lobby ammettono sei persone e fino a sei bot. Non è possibile entrare come nuovo partecipante a partita iniziata; i membri possono rientrare con lo stesso codice.
- Vittoria per dominio dell’80% della terra. Nessun limite artificiale di durata nel catalogo: economia e armamenti costosi possono maturare. L’HUD mostra il tempo simulato trascorso; il server supporta anche un limite di tick esplicito per partite configurate e test. Concludi salva un abbandono, senza assegnare una vittoria. Uscire al catalogo conserva una partita riprendibile.

## Controlli

Clic su un confine neutrale/nemico per lanciare un’offensiva; lo slider sceglie le truppe. Un clic su una costa non adiacente tenta uno sbarco, limitato al 20%. Trascinare per spostare la mappa; rotella, pizzico o tasti +/− per zoom centrato sul cursore; frecce per spostarsi; Centra ripristina l’inquadratura.

Selezionare Città, Fabbrica, Porto, Difesa, Silo o SAM e cliccare un proprio tile. I pulsanti mostrano il prezzo corrente. Cliccare una propria struttura per potenziarla; i porti producono navi, i silos consentono Atom/Idrogeno/MIRV e poi selezione del bersaglio. Cliccare una propria nave da guerra e poi l’acqua per assegnare una pattuglia. Diplomazia espone richieste, accettazioni e rotture; le offensive attive si possono ritirare. Esc annulla la selezione. Pausa è disponibile soltanto in locale.

## Architettura e file

```text
packages/shared/src/wire.ts           frame binari, metadata UTF-8, TypedArrays e Set
packages/engine/src/scenario.ts       terreni e spawn deterministici
packages/server/src/index.ts          WebSocket autoritativo, lobby, tick, limiti, recovery
packages/client/src/Camera.ts         coordinate e zoom ancorato al cursore
packages/client/src/Renderer.ts       shader WebGL2, dirty rows, overlay vettoriale, Canvas2D
packages/client/src/territoryLabels.ts anchor della maggiore componente territoriale
packages/client/src/worker.ts         replica online / simulazione locale a 10 Hz
packages/client/src/messages.ts       contratto Worker e frame di rendering
packages/client/src/storage.ts        checkpoint binari IndexedDB per account
server/rts.ts                        adattatore autenticazione / PostgreSQL / risultati
server/schema.sql                    tabelle stanze, journal e checkpoint RTS
games/frontier.tsx                   HUD, strumenti, lobby e controller della sessione
scripts/build-rts-client.mjs          bundle Worker servito da /generated/rts-worker.js
```

Il renderer mantiene una texture RGBA della dimensione della mappa. I tile modificati vengono raggruppati per riga e caricati con texSubImage2D; acqua animata nello shader, confini scuri, elevazione e contaminazione. Un secondo Canvas disegna strutture vettoriali, ferrovie, unità interpolate, missili, intercettori, proiettili, anteprime dei raggi e nomi/truppe. Gli anchor sono tile della maggiore componente connessa, aggiornati ogni secondo simulato. In assenza di WebGL2 si usa Canvas2D. Il renderer non modifica mai la simulazione.

Il Worker copia i buffer destinati al rendering prima del trasferimento: i TypedArrays vivi del motore non vengono staccati. Le entità vengono aggiornate al tick, non interrogate a ogni requestAnimationFrame. Il pacchetto client non dipende dal backend; il server riceve autenticazione e persistenza tramite interfacce iniettate.

## Rete e ordine degli eventi

Endpoint **/rts/socket**, WebSocket nativo ws, stesso processo HTTP di Next.js e Socket.IO. Il vecchio ingresso Socket.IO a Frontier viene rifiutato. Gli upgrade richiedono cookie di sessione valido e Origin esatto; logout e scadenza chiudono la connessione.

1. Ready; create/join; lobby; avvio del creatore; snapshot completo con playerId e checksum.
2. Il client invia un comando nel codec binario dello Step 1. Il server verifica identità, frequenza, dimensione e ammissione; assegna il prossimo tick. Non accetta truppe, oro o proprietà dichiarati dal client.
3. Ogni tick è serializzato per stanza. Gli input ammessi vengono scritti nel journal prima di avanzare il motore e inviare il frame. I bot restano deterministici e vengono eseguiti in entrambi i motori.
4. Il frame contiene tick, comandi accettati, eventi e checksum ogni dieci tick. Il Worker applica esattamente quel tick; nessun avanzamento autonomo della replica online.
5. Seguono delta tile binari, suddivisi in blocchi da massimo 50.000 record. La replica confronta proprietà, strutture, terreno e confini con quelli autoritativi.
6. Un tick mancante o checksum/delta divergente sospende la replica e richiede uno snapshot; la partita riprende senza usare lo stato errato.

Limiti: 20 messaggi/s per connessione, 64 KiB in ingresso, 128 input in attesa per stanza, 256 connessioni e 32 stanze residenti. Oltre 2 MiB di dati in uscita accodati la connessione lenta viene chiusa e può rientrare. Snapshot applicativi massimo 32 MiB; il decoder limita metadati, profondità, numero di sezioni e allocazioni e rifiuta riferimenti binari ripetuti. Heartbeat ogni 30s; sessione ricontrollata almeno ogni 60s. Una sola connessione attiva per account nella stessa stanza.

## Persistenza

- **rts_rooms:** UUID, codice unico, stato binario e timestamp. Include configurazione, membri, snapshot e risultati già conclusi.
- **rts_frames:** (room_id, tick) univoco e comandi binari. Ogni tick viene scritto prima della trasmissione. Snapshot/compattazione ogni 100 tick; la transazione elimina soltanto i frame già inclusi.
- **rts_checkpoints:** player_id collegato a players, snapshot binario e timestamp, separato dai piccoli checkpoint dei giochi precedenti.
- Risultati online in runs/progress con verified=true, UUID stabile della stanza e chiave composta giocatore/risultato. Ritentare o rientrare restituisce il primo risultato persistito. Alla fine si salvano anche i membri disconnessi.

Quando una stanza viene ricaricata, il server ripristina lo snapshot e riproduce il journal ordinato prima di ammettere il giocatore. Se il database fallisce, la stanza si sospende e chiude le connessioni; nessun tick non persistito viene annunciato. Il rientro carica lo stato durabile. Una stanza senza partecipanti attivi si ferma; dopo cinque minuti senza connessioni viene rimossa dalla memoria ma resta nel database.

Offline: IndexedDB per account/ospite ogni 20 tick (due secondi simulati), più tentativo di salvataggio all’uscita e quando la pagina diventa nascosta. Gli account inviano anche un checkpoint cloud almeno ogni dieci secondi mentre giocano e la rete è disponibile. Al rientro viene scelto il timestamp più recente; una conclusione cloud impedisce il ripristino di checkpoint precedenti. Una conclusione offline conserva anche un timestamp locale: al successivo ingresso con rete elimina il vecchio checkpoint cloud anziché riaprire la partita. Le richieste cloud scadono dopo cinque secondi; i checkpoint caricati via HTTP sono limitati a 4 MiB. Le partite concorrenti usano ultimo timestamp, non fusione. Errori di quota o cloud vengono mostrati. I risultati offline passano dalla coda idempotente già esistente della piattaforma.

L’offline dopo ricaricamento richiede una prima visita online con il service worker attivo, così vengono memorizzati il modulo e il Worker. Una chiusura improvvisa può perdere gli ultimi due secondi simulati; la sincronizzazione cloud può essere più vecchia se la rete non era disponibile. I checkpoint della precedente versione semplificata di Frontier non vengono convertiti; i risultati storici rimangono.

## Verifica e limiti operativi

Comandi: npm run typecheck, npm test, npm run test:e2e, npm run build, npm run test:offline. I test includono wire/snapshot/replay, zoom, componenti territoriali, due identità WebSocket, spoofing, recovery, guasti del journal, risultati idempotenti e dei disconnessi; nel browser conquista/costruzione/ripresa, due Worker sincronizzati, risincronizzazione dopo checksum alterato, account/cloud/CSRF, mobile e fallback Canvas2D. Il test PWA riapre Frontier completamente senza rete.

La mappa mondiale è **512×256 tile**, i tre layout procedurali **192×128 tile**. Il benchmark 2000×2000 dello Step 2 riguarda il motore; non dimostra quella scala nella rete/GUI. Nessuna prova di carico o capacità dichiarata per i tetti configurati. Nessuna fog of war: ogni partecipante conosce l’intero stato.

Usare **un solo processo autoritativo**: non sono implementati lease distribuiti o spostamento delle stanze tra istanze. Il journal attende il database; con I/O lento la simulazione può rallentare anziché saltare tick. Per scalare servono instradamento delle stanze e storage misurato. Un proxy deve inoltrare gli upgrade sia /socket.io/ sia /rts/socket con timeout adeguati.

PostgreSQL esterno, Docker, HTTPS pubblico, prove di backup, hardware reale e carico multiplayer non sono stati verificati in questa sessione. Restano requisiti di collaudo prima di dichiarare il servizio pronto al rilascio pubblico. Il nuovo FPS è descritto in FPS-STEP2-3.md; gli aggiornamenti agli altri giochi restano separati.
