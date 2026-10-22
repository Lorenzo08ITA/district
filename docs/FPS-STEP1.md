# Hyper-Deadshot — Step 1

Implementata la base condivisa del nuovo FPS: geometria, fisica, arsenale, protocollo sub-tick e registri degli input. La specifica completa è conservata in [specs/HYPER-DEADSHOT.md](specs/HYPER-DEADSHOT.md).

Non viene sostituita l’arena Crossfire esistente con una schermata parziale. Il server FPS autoritativo a 60 Hz, rewind, modalità e bot appartengono allo Step 2; renderer, modelli, shader, audio e debug F3 allo Step 3. Il nuovo codice è eseguibile e verificabile autonomamente.

## Organizzazione

I tre workspace shared/server/client esistono già per RTS. I file FPS sono isolati nel sottopercorso shared/src/fps e nell’export **@district/rts-shared/fps**: nessun simbolo fisico FPS viene importato dal motore RTS, né il gioco esistente viene sovrascritto. Non servono altre dipendenze di runtime.

```text
packages/shared/package.json           export ./fps e configurazione workspace esistente
packages/shared/tsconfig.json          TypeScript strict, NodeNext e dichiarazioni
packages/shared/src/fps/
  index.ts                             export pubblici
  math.ts                              Vec3, Quaternion, accelerazione, ray–OBB
  bvh.ts                               BVH statico, sweep capsula–triangolo, raycast
  kinematics.ts                        controller 60 Hz, stato/input, jump-pad
  weapons.ts                           sei armi, danni, spread, rinculo, munizioni
  protocol.ts                          reader/writer, snapshot, input ring, buffer pool
tests/fps/
  geometry.test.ts                     distanze, sweep, spigoli, rampe, BVH e OBB
  kinematics.test.ts                   movimento, gradini, buffer e soffitti
  weapons.test.ts                      cadenza, falloff, pellet e ricariche
  protocol.test.ts                     codec, validazione, ring e pool
  hot-loops.test.ts                    guardia AST contro allocazioni accidentali
  replay.ts                            fixture comune Node/Worker
tests/e2e/fps.spec.ts                   replay in un vero Worker Chromium
scripts/fps-demo.mjs                    demo/benchmark locale del core
scripts/package-release.ps1            archivio sorgente privo di dati locali/segreti
```

Dalla radice, con Node.js 22 o successivo:

```sh
npm ci
npm run build:fps
npm run test:fps
npm run demo:fps
npm run typecheck
npm test
npm run build
```

Per il test Worker: avviare la piattaforma con npm run dev, poi npx playwright test tests/e2e/fps.spec.ts. Il test usa esbuild già presente e una Blob locale; nessuna dipendenza audio/grafica esterna.

## Matematica e collisioni

Vec3 e Quaternion sono registri mutabili da allocare all’inizializzazione. ObbRaycaster trasforma il raggio nello spazio locale di un OBB tramite il quaternion unitario e risolve gli intervalli dei tre slab; restituisce ingresso, uscita, normale e posizione nello stesso RayHit. L’uscita è utilizzabile per la futura penetrazione balistica. Direzioni dei raggi e quaternion devono essere normalizzati dal chiamante.

WorldBuilder costruisce triangoli, quad, box e rampe; StaticWorld valida coordinate finite e triangoli non degeneri. La BVH bilanciata è costruita una volta su TypedArrays. I nodi selezionano i triangoli candidati attraverso i bounds del movimento; il raycast visita soltanto i nodi che intersecano il raggio. Query tipica O(log N + candidati), caso peggiore O(N): la distribuzione della geometria conta.

La capsula è verticale: il riferimento position è il centro dei piedi, raggio 0,32 m, estremi del segmento centrale a radius e height−radius. La distanza capsula/triangolo usa intersezione segmento/faccia, regioni di Voronoi delle facce e distanze segmento/spigolo; gli angoli rimangono arrotondati, non vengono sostituiti da un box espanso. Lo sweep usa conservative advancement della distanza analitica, massimo 40 iterazioni per candidato e margine 1 mm, evitando il tunnelling nei muri sottili. Il recupero da sovrapposizione è limitato a otto iterazioni; chi crea uno spawn deve comunque verificare fits. Gli oggetti scratch appartengono all’istanza: le query non sono rientranti.

Il controller esegue quattro iterazioni di slide-plane clipping. Due piani concorrenti conservano la componente lungo la loro intersezione; tre piani bloccanti fermano il moto. Lo step-up confronta il progresso orizzontale con quello normale, controlla lo spazio sopra la testa e richiede un appoggio su una faccia percorribile entro 0,45 m. Il supporto distingue la normale della faccia da quella dello spigolo arrotondato della capsula. Le rampe sono percorribili fino a 50°.

## Fisica a 60 Hz

| Parametro                       | Valore                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| dt                              | 1/60 s                                                                                |
| Cammino / sprint                | 8,5 / 12,8 m/s                                                                        |
| Accelerazione terra / attrito   | 14 / 8                                                                                |
| Air wish cap / accelerazione    | 3,2 m/s / 28                                                                          |
| Gravità / salto                 | −24,5 m/s² / 9,4 m/s                                                                  |
| Capsula in piedi / accovacciata | 1,80 / 0,95 m                                                                         |
| Occhio in piedi / accovacciato  | 1,62 / 0,80 m; decay 18                                                               |
| Soglia scivolata                | velocità orizzontale > 9,5 m/s                                                        |
| Buffer scivolata                | 150 ms prima dell’atterraggio                                                         |
| Attrito scivolata iniziale      | 1,15 per 550 ms                                                                       |
| Coyote time / jump buffer       | 90 / 110 ms                                                                           |
| Slope boost all’atterraggio     | 18 × (1−normal.y), tangente di discesa                                                |
| Slide-hop                       | conserva il momento e aggiunge 1,4 × max(0, 1−speed/22) nella direzione dello sguardo |

Accelerate usa la proiezione sulla wishDir e non tronca la velocità orizzontale esistente. Il soft-cap attenua il bonus dello slide-hop; non è un limite rigido all’air-strafing. L’accovacciamento normale riduce il cammino al 55%; la scivolata mantiene il movimento. Il rilascio del tasto non rialza la capsula se il soffitto non lo consente.

Ogni step è diviso prima e dopo subTickFraction per applicare salto/accovacciamento nell’istante corretto, incluso un evento esattamente a fine tick. Il tasto salto mantenuto non genera salti automatici. JumpPads contiene record fissi di nove numeri: min xyz, max xyz, impulso xyz; applica un impulso fisso con cooldown di 350 ms per evitare attivazioni ripetute.

Lo stato include tutti i timer e i tasti precedenti necessari alla futura riconciliazione, non soltanto posizione e velocità. Il core non sceglie respawn o confini della mappa: questi appartengono al server dello Step 2.

## Arsenale

Le specifiche di danni, RPM, falloff, penetrazione, ADS e moltiplicatori di movimento delle sei armi corrispondono alla tabella dell’allegato. I parametri non definiti nella specifica sono espliciti: Vanguard 30+120 colpi/ricarica 2,2s; Kraber 5+25/3,2s; Vector 33+132/1,75s; Cerberus 8+40/inserimento iniziale 0,45s e successive cartucce ogni 0,55s; Sheriff 6+36/2,5s. Sono valori iniziali di bilanciamento, non promesse di equivalenza a giochi commerciali.

WeaponController conserva munizioni, riserve, prossimo sparo, ricarica, bloom e indice del pattern in TypedArrays. Le cadenze mantengono la frazione residua del cooldown, evitando che 1.000 RPM vengano ridotti dalla quantizzazione a tick interi. Le armi semiautomatiche richiedono un nuovo fronte del grilletto. La ricarica a cartucce è interrompibile dopo l’inserimento; la ricarica a caricatore completa il trasferimento in un solo istante.

Il rinculo è una sequenza numerica ripetibile; Vanguard ha dodici colpi iniziali a T. ADS lo riduce del 30%. Il bloom cresce per sparo e decade col tempo. La dispersione usa un PRNG Xorshift con seed, mai Math.random. La Cerberus usa un pellet centrale e otto raggi a stella fissi, indipendenti dal seed. Sheriff è precisa al primo colpo da fermo a terra. Karambit infligge 100 frontale o 200 da dietro, entro 2,6 m; animazioni, cono finale del melee e autorità dei colpi saranno collegati allo Step 2/3.

## Protocollo binario v1

Little-endian. Header di 16 byte con magic FPS1, versione, tipo, lunghezza esatta, conteggio e campi riservati nulli. Tipi: Inputs, Snapshot, Fire, HitConfirm.

| Record             | Byte | Contenuto principale                                                                                 |
| ------------------ | ---: | ---------------------------------------------------------------------------------------------------- |
| Input / Fire       |   24 | sequenceNumber, clientTick, subTickFraction float32, yaw/pitch uint16, assi int8, tasti, arma        |
| Snapshot giocatore |  128 | identità, ACK, stato cinematico completo, orientamento, HP, munizioni e stato dell’arma equipaggiata |
| HitConfirm         |   32 | sequenza, vittima, headshot/kill, zona, danno, posizione, tick e frazione                            |

Un input singolo occupa 40 byte incluso header. Fino a 32 input o conferme e 64 giocatori per frame; buffer predefinito 16 KiB, tetto 64 KiB. Angoli su 65.535 passi per giro; assi su 127 passi per verso. Le velocità sono int16 con scala 512: precisione 1/512 m/s, intervallo validato ±63,998 m/s; posizioni float64. Un valore fuori intervallo genera un errore esplicito anziché essere troncato silenziosamente. Tutti i timer cinematici necessari sono inclusi. Lo snapshot conserva l’arma equipaggiata, non l’intero inventario; il server dello Step 2 controllerà gli altri slot.

QuantizeInput produce i valori che saranno ricevuti dal server: il futuro client dovrà applicare proprio questi input alla prediction prima di registrarli. Non deve simulare un asse preciso e trasmetterne una versione diversa.

PacketWriter prealloca buffer, DataView e viste delle lunghezze consentite; finish restituisce una vista già esistente. PacketReader copia i byte ricevuti nel proprio buffer/DataView riutilizzato. I byte restituiti dal writer sono validi fino al suo riuso: per un trasporto Node asincrono usare PacketBufferPool, trattenendo il lease fino alla callback di send; l’esaurimento del pool segnala backpressure. Non riutilizzare un buffer ancora in volo.

InputRingBuffer ha 128 slot preallocati, sequenze strettamente crescenti, rimozione fino all’ACK e accesso senza copia. Non sovrascrive input non confermati: se si esaurisce richiede una risincronizzazione esplicita. La sequenza uint32 non effettua wrap automatico; una nuova sessione va inizializzata prima dell’esaurimento.

## Verifiche e limiti reali

38 test FPS coprono geometria, muri sottili, spigoli, OBB, cammino/sprint, gradini bassi e alti, soffitti, rampe in salita, slide-hop, slope boost, coyote time, buffer validi/scaduti, jump-pad, cadenze, danni, ricariche, seed, codifica, validazione, input ring e buffer in volo. Una guardia AST rileva nuove allocazioni/literal/map/filter/slice/subarray nei metodi critici; le eccezioni dei percorsi invalidi sono consentite. Il garbage collector della VM o del trasporto non è sotto il controllo del motore.

Il replay di 2.400 tick gira in Node e in un vero Web Worker Chromium, confrontando esattamente eventi/contatori/checksum e usando tolleranza di un micrometro per posizione/velocità. I risultati double delle funzioni trascendenti possono differire fra runtime: FPS usa autorità e futura riconciliazione, non il lockstep intero del RTS.

La demo misura 6.000 tick in un’arena chiusa di 74 triangoli. Le misure locali del solo core non dimostrano 144 FPS del renderer, latenza zero, capacità multiplayer o costanza su hardware reale. Non ci sono ancora il nuovo server, il nuovo renderer o un benchmark end-to-end FPS. Il vecchio Crossfire rimane disponibile mentre si completano gli step successivi.
