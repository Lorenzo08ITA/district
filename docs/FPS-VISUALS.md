# Crossfire — modelli, mappe e fluidità

## Contenuti

Quattro mappe selezionabili nello stesso servizio autoritativo:

- **Bastione:** edifici mediterranei, finestre e passaggi attraversabili, mercato, passerella e rampe; costa, mare animato e rilievi sullo sfondo. La disposizione favorisce incroci fra corsie e controllo degli angoli.
- **Cedar:** due case su due livelli, balconi accessibili, coperture centrali con autobus e veicolo, giardini e alberi. Il quartiere compatto favorisce scontri rapidi e cambi di quota.
- **Nexus:** laboratorio con passerelle, rampe, jump-pad e panorama alpino.
- **Sandstorm:** avamposto industriale con tunnel, container e paesaggio desertico.

Le nuove mappe sono originali e richiamano il ritmo tattico dei riferimenti indicati; non usano asset estratti da altri giochi. Solidi, rampe, ingressi, spawn e obiettivi vengono definiti in `packages/shared/src/fps/arena.ts` e condivisi fra client e server. Il panorama esterno è scenografico; i limiti dell'arena restano quelli della simulazione.

## Modelli e materiali

Le armi hanno ricevitori dal profilo sagomato, canne più proporzionate, astine e prese d'aria, dettagli meccanici, ottiche e accessori differenziati. Caricatore, otturatore e tamburo mantengono i pivot delle animazioni. Operatori con elmetto, protezione facciale, collo, giubbotto con tasche, spallacci, ginocchiere e scarponi; braccia in prima persona con guanti e dita.

I materiali PBR usano piccole texture procedurali deterministiche per colore, rugosità e normali: metallo lavorato, polimero, tessuto, intonaco, legno, mattoni, asfalto e coperture. Non vengono scaricati modelli o texture durante la partita. Restano modelli procedurali: il progetto non viene presentato come fotogrammetria o produzione cinematografica.

Il cielo usa uno shader con gradiente atmosferico, disco solare, foschia e nuvole animate. Il rumore viene precalcolato in una texture, evitando numerose funzioni trigonometriche per pixel. Il mare usa normali animate e riflessi speculari; il terreno distante usa rumore coerente multiscala. La vegetazione è istanziata con chiome ritagliate tramite alpha test. Il percorso hardware mantiene illuminazione ambientale PMREM e ombre; quello software riduce il dettaglio distante e il costo degli effetti.

## Fluidità

- Le mesh statiche con lo stesso materiale vengono unite, conservando separati gruppi e pivot animati. Questo riduce il numero di chiamate di disegno senza alterare la geometria fisica.
- La posa della camera viene interpolata fra gli ultimi due stati simulati. La mira usa il campione corrente e gli spostamenti del mouse non ancora confermati dal Worker, evitando di aggiungere un tick di ritardo al mouse.
- Respawn e teletrasporti non vengono interpolati attraverso la mappa; anche le discontinuità degli attori remoti vengono riconosciute.
- La qualità automatica adatta lentamente la risoluzione interna al tempo dei fotogrammi, con soglie e isteresi. Il menu permette anche Fluidità e Qualità alta. Il pannello F3 mostra FPS, tempo del fotogramma, draw call e scala di rendering.
- Le ombre vengono aggiornate una volta ogni due fotogrammi e condivise fra vista normale e scope. Le schede nascoste sospendono il rendering, mentre il Worker e il server continuano a gestire la partita secondo i limiti imposti dal browser.
- Le texture vengono preparate all'avvio e liberate insieme al renderer; i cicli critici mantengono buffer preallocati.

Non è possibile garantire assenza di scatti su qualsiasi GPU, connessione o browser. La regolazione automatica non sostituisce un test sul dispositivo dell'utente.

## Riprodurre le misure

Con la build ottimizzata già avviata su localhost:3000:

```sh
node scripts/fps-visual-benchmark.mjs nexus docs/benchmarks/fps-visual-after.json
```

Il benchmark apre Chromium headless a 1440×960, crea una lobby privata con cinque bot e campiona sei secondi dopo il riscaldamento. Conta le chiamate WebGL ed espone mediana e 95° percentile degli intervalli RAF. Il file `fps-visual-before.json` conserva una cattura del renderer precedente.

Le catture usano un renderer software, spawn casuali e bot attivi: sono esempi locali, non confronti controllati su GPU fisica né prove della capacità multiplayer. Un minor numero di draw call non garantisce da solo un maggior numero di FPS quando aumentano i dettagli della scena. Le misure hardware e di rete restano da effettuare.

## Verifiche

I test verificano tutti gli spawn, la riproducibilità della geometria, un percorso fra le basi delle nuove mappe, la registrazione delle stanze nel servizio WebSocket, la conservazione di pivot e bounding box durante il batching, il limite di mesh statiche, i materiali, il terreno, l'interpolazione e la regolazione della risoluzione. I test browser controllano le quattro opzioni di mappa, Bastione e Cedar giocabili, i relativi shader, il selettore di qualità e il salvataggio dei risultati.

## Ultima cattura locale

| Renderer   | Draw call medie | Mediana RAF | 95° percentile RAF |
| ---------- | --------------: | ----------: | -----------------: |
| Precedente |             171 |     33.3 ms |            49.9 ms |
| Aggiornato |              53 |     33.3 ms |            33.4 ms |

Le catture indipendenti mostrano una riduzione delle chiamate di disegno e della coda dei tempi dei fotogrammi, mentre la mediana rimane circa 33 ms sul renderer software. Non dimostrano 60 FPS costanti né prestazioni su GPU hardware. La qualità automatica può variare la risoluzione durante il campionamento.

Verifica: 188 test automatici, 21 browser e 2 offline; TypeScript e build ottimizzata superati.
