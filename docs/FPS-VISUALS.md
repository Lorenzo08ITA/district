# Crossfire — nitidezza, movimento e mappe

## Riferimento e contenuti

È stato aperto e osservato [Deadshot.io](https://deadshot.io/), compresi menu, selezione della classe e partita. Il riferimento guida la leggibilità delle corsie industriali, la visuale in prima persona e l'HUD essenziale. Crossfire mantiene codice, regole e modelli propri: non è una replica completa del prodotto e non contiene asset estratti dal sito.

Cinque mappe usano gli stessi solidi e rampe nel renderer e nella simulazione autoritativa:

- **Depot**, predefinita: magazzini attraversabili, soppalchi, passerella, casse e container centrali, corsie laterali e segnaletica.
- **Bastione**: edifici mediterranei su due livelli, mercato e costa.
- **Cedar**: quartiere con case, balconi, veicoli e giardini.
- **Nexus**: laboratorio con passerelle e jump-pad.
- **Sandstorm**: avamposto industriale con tunnel.

Pavimenti e pareti ripetono le texture ogni quattro metri, evitando di allargare 128 texel sull’intera mappa. Le strutture architettoniche hanno spigoli regolari; le sagome sagomate rimangono sulle armi e sugli accessori. Gli operatori conservano arti articolati e armature colorate per squadra. Le palette del corpo vengono consolidate con colori per vertice, riducendo i materiali e le chiamate di disegno senza eliminare le animazioni.

## Correzione della pixelatura

Il vecchio percorso disegnava la scena in un render target HDR senza MSAA, arrivava al 55–65% della dimensione CSS e ingrandiva il risultato. L'antialiasing del canvas finale non poteva correggere i bordi già rasterizzati nella texture.

Il nuovo percorso disegna direttamente sul framebuffer del canvas. Non usa il passaggio HDR, il bloom a otto campioni o l'ingrandimento di un'immagine sottocampionata. La risoluzione minima è **un pixel interno per pixel CSS**, anche in modalità Fluidità. Su GPU hardware è attivo il MSAA del contesto. Il renderer software conserva la risoluzione nativa e disabilita il MSAA: può mostrare bordi seghettati, ma evita il costo della rasterizzazione multisample sulla CPU.

La modalità automatica può ridurre soltanto l'eventuale supersampling su schermi ad alta densità; non scende sotto la risoluzione CSS. Qualità alta abilita ombre statiche e fino a 1,5 pixel per pixel CSS. Il menu include lo schermo intero. F3 mostra FPS, intervallo del fotogramma, draw call e scala effettiva.

Le grandi superfici usano texture diffuse e illuminazione Lambert invece di normali e rugosità PBR per pixel. Armi e accessori mantengono il percorso PBR/PMREM su GPU; il renderer software usa materiali Phong più economici. Cielo e mare hanno un percorso semplificato; la geometria distante resta a dettaglio limitato. Le ombre non vengono rigenerate ad ogni fotogramma.

## Correzione del movimento

Il renderer viene creato quando inizia la partita, evitando lavoro 3D durante il collegamento alla lobby. Il Worker continua a simulare a 60 Hz e a riconciliare gli snapshot autoritativi. Durante un recupero di tick invia una sola posa al termine del ciclo, evitando raffiche di messaggi intermedi. Ogni posa porta il timestamp della simulazione, convertito nell'orologio del thread principale tramite `performance.timeOrigin`.

Durante una risincronizzazione il Worker aspetta il nuovo handshake prima di applicare snapshot propri, non riavvolge le sequenze degli input e conserva la selezione dell’arma. I controlli WebSocket vengono elaborati in ordine con una coda limitata: risincronizzazione, ping e salvataggio non si scartano a vicenda quando arrivano ravvicinati.

La presentazione interpola usando questi timestamp, con un tick di buffer, invece di assumere che ogni messaggio arrivi a distanza esatta di 16,67 ms. I campioni obsoleti vengono ignorati. Respawn, morte e teletrasporti interrompono l'interpolazione. La mira usa gli input mouse ancora non confermati dal Worker e non viene interpolata insieme alla posizione. Il FOV varia meno durante la corsa.

## Misure riproducibili

Con la build ottimizzata avviata:

```sh
node scripts/fps-visual-benchmark.mjs depot docs/benchmarks/fps-native-depot.json
```

Chromium headless apre una lobby con cinque bot, tiene W per due secondi e D per un secondo, poi campiona altri tre secondi. Il JSON contiene dimensioni reali del buffer e del canvas CSS, intervalli RAF e chiamate WebGL. Le vecchie catture `fps-visual-before.json` e `fps-visual-after.json` restano storiche: usavano una risoluzione inferiore, nessun movimento e spawn differenti, quindi non costituiscono un confronto controllato con la nuova cattura nativa.

Le misure locali usano WebGL software, non la GPU dell'utente. Non dimostrano 60/144 FPS costanti, assenza assoluta di scatti o prestazioni su Internet. La risoluzione nativa è verificata; le prestazioni sul dispositivo reale devono essere misurate lì.

## Verifiche

I test coprono spawn, geometria riproducibile, percorsi fra le basi, registrazione delle stanze, batching e pivot animati, materiali, terreno, timestamp irregolari, campioni obsoleti e limite minimo di risoluzione. I browser verificano due schede debug, movimento, cambio arma, sparo, scope, ricarica, mappe e salvataggio dei risultati, oltre alle dimensioni reali del drawing buffer e allo schermo intero. Un test sospende intenzionalmente il Worker per 350 ms e verifica cambio arma, movimento e salvataggio dopo la risincronizzazione; un test di servizio invia comandi ravvicinati mentre la persistenza è in corso.

## Ultima cattura e verifica

La cattura `fps-native-depot.json` registra un buffer di **1136×560**, identico alla dimensione CSS, con cinque bot e movimento: mediana RAF **33,3 ms**, 95° percentile **50 ms**. Lo spawn e la visibilità dei bot sono casuali; il risultato non è un confronto controllato con le catture precedenti. Su questo renderer software non vengono dichiarati 60 FPS.

Verifica finale: **196 test automatici, 22 test browser e 2 test offline**, oltre alla build ottimizzata con controllo TypeScript.
