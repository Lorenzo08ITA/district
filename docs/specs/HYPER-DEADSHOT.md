# ROLE & OBJECTIVE
Agisci come un Principal Engine Architect (ex-id Software / Valve), Lead Graphics Programmer (WebGL2 / GLSL / Three.js) e Principal Network Engineer specializzato in Arena Shooter competitivi ad altissimo tickrate (stile **Deadshot.io**, **Titanfall 2**, **Counter-Strike 2**, **Quake III Arena**).

Il tuo obiettivo è progettare e scrivere il codice sorgente completo, privo di qualsiasi abbreviazione o placeholder (`// TODO` è severamente vietato), di **HYPER-DEADSHOT ENGINE**: un FPS competitivo multiplayer su browser capace di girare a 144+ FPS costanti con latenza percepita zero, movimento fisico basato su vettori di momento avanzati, architettura Sub-Tick per l'hitreg millimetrico, grafica PBR procedurale con shader GLSL custom, audio spaziale sintetizzato via DSP e modalità Debug Multi-Tab.

---

# 1. ARCHITETTURA CORE E DATA-ORIENTED DESIGN (ECS)
Struttura il monorepo TypeScript in 3 pacchetti altamente ottimizzati (`packages/shared`, `packages/server`, `packages/client`) seguendo questi vincoli architetturali non negoziabili:
1. **Zero Garbage Collection in Hot-Loops:** È vietato allocare `new THREE.Vector3()`, oggetti letterali `{}` o array `.map()/.filter()` all'interno dei loop `tick()` (Server/Physics) e `requestAnimationFrame()` (Client). Usa Object Pooling statico e pre-alloca registri vettoriali (`_v1`, `_v2`, `_q1`, `_m1`) e `TypedArrays` (`Float32Array`, `Uint32Array`).
2. **Spatial Indexing (Octree / BVH Statico):** Tutte le geometrie delle mappe devono essere indicizzate in una **BVH (Bounding Volume Hierarchy)** o **Uniform 3D Grid** nel pacchetto `shared` per risolvere collisioni Capsula-Triangolo e Raycasting balistico in tempo $O(\log N)$ invece di $O(N)$.
3. **Sub-Tick Timestamping (Architettura CS2):** Il server avanza a **60 Hz** (`dt = 16.666ms`), ma i pacchetti di input di movimento e sparo contengono un float normalizzato `subTickFraction` $\in [0.0, 1.0]$ che indica l'istante esatto tra due tick in cui è stato premuto il grilletto o il salto. Il server interpola linearmente le matrici delle hitbox a $\text{tick} - 1 + \text{subTickFraction}$ per una precisione di hitreg al sub-millisecondo.

---

# 2. MATEMATICA ESATTA DEL MOVIMENTO: QUAKE / TITANFALL KINEMATICS (`packages/shared`)
Non implementare un movimento arcade basico. Scrivi un risolutore cinematico **Swept-Capsule vs World BVH** con **Step-Up automatico** (gradini fino a `0.45m`) e fino a `4` iterazioni di **Slide-Plane Clipping** per frame:

### A. Equazione di Accelerazione ed Air-Strafing (Dot-Product Projection)
Implementa la funzione `accelerate(wishDir: Vec3, wishSpeed: number, accel: number, dt: number)`:
1. Calcola la proiezione della velocità corrente lungo la direzione desiderata:
   $$\text{currentSpeed} = \mathbf{v}_{\text{horiz}} \cdot \mathbf{wishDir}$$
2. Calcola il margine di velocità aggiungibile:
   $$\text{addSpeed} = \text{wishSpeed} - \text{currentSpeed}$$
   Se $\text{addSpeed} \le 0$, ritorna immediatamente (questo permette di superare il cap di velocità tramite strafe-jumping senza essere frenati).
3. Calcola la spinta:
   $$\text{accelSpeed} = \min(\text{accel} \cdot \text{dt} \cdot \text{wishSpeed}, \text{addSpeed})$$
4. Aggiorna il vettore velocità:
   $$\mathbf{v} \leftarrow \mathbf{v} + \text{accelSpeed} \cdot \mathbf{wishDir}$$
- **Parametri Fisici:**
  - *Ground:* `maxSpeed = 8.5 m/s`, `sprintSpeed = 12.8 m/s`, `groundAccel = 14.0`, `friction = 8.0`.
  - *Air (Air-Strafe):* `airWishSpeedCap = 3.2 m/s`, `airAccel = 28.0`, `gravity = -24.5 m/s²`, `jumpImpulse = 9.4 m/s`.

### B. Meccanica di Slide-Hopping, Slope Boost e Coyote Time
- **Slide Initiation:** Premendo `Crouch` con velocità orizzontale $\Vert{}\mathbf{v}_{xz}\Vert{} > 9.5\text{ m/s}$ (a terra o pre-buffered in aria entro `150ms` prima dell'impatto al suolo):
  - L'altezza della capsula passa da `1.80m` a `0.95m` e l'occhio della camera scende da `1.62m` a `0.80m` tramite interpolazione esponenziale (`decay = 18.0`).
  - L'attrito al suolo viene ridotto da `8.0` a `1.15` per i primi `550ms` di scivolata.
  - Se il giocatore atterra in scivolata su una superficie inclinata verso il basso con normale $\mathbf{n}$, applica uno **Slope-Boost** lungo il vettore tangente di discesa proporzionale a $(1 - n_y) \cdot 18.0\text{ m/s}$.
- **Slide-Hop Chaining:** Se il giocatore salta durante lo stato `SLIDING`, conserva il `100%` del momento orizzontale accumulato + un bonus impulsivo di `+1.4 m/s` nella direzione dello sguardo (con soft-cap asintotico a `22.0 m/s`), azzerando il ritardo di atterraggio.
- **Coyote Time & Jump Buffering:** Tolleranza di `90ms` per saltare dopo aver lasciato una sporgenza e buffer di `110ms` se `Space` viene premuto un istante prima di toccare terra.

---

# 3. ARSENALE, BALISTICA E PROCEDURAL 6-DOF SPRING RIG (`packages/shared` & `packages/client`)

### A. Generatore Procedurale di Armi 3D (`ProceduralWeaponFactory`)
Costruisci modelli 3D ad alto dettaglio composti da `15-25` sub-mesh ciascuno usando `ExtrudeGeometry`, `LatheGeometry`, `CylinderGeometry` e `BoxGeometry` con smussature, assemblati in un grafo gerarchico animabile (`Receiver`, `Barrel`, `MuzzleBrake`, `Magazine`, `BoltCarrier`, `Trigger`, `OpticMount`, `HoloLens`):
- Usa materiali PBR avanzati:
  - *Canna e Otturatore:* `MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.92, roughness: 0.22 })`
  - *Corpo in Polimero Tattico:* `MeshStandardMaterial({ color: 0x2b303c, metalness: 0.15, roughness: 0.75 })`
  - *Inserti Neon Emissivi:* `MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 2.5 })`
  - *Lente Mirino Olografico (Reflex / Red-Dot):* Usa uno **ShaderMaterial GLSL Custom** che proietta un reticolo collimato all'infinito (parallax-free: il punto luminoso resta sul bersaglio anche se l'arma oscilla leggermente).

### B. Specifiche Balistiche delle 5 Armi + Coltello Tattico
Implementa **Pattern di Rinculo Deterministici** (array di coordinate $(\Delta\text{pitch}, \Delta\text{yaw})$ stile CS2/Valorant) combinati con *Spread Dinamico* (bloom) e *Damage Falloff* lineare a due soglie:

| Arma | RPM | Danno (Testa / Petto / Stomaco / Arti) | Falloff (Inizio / Fine / Min%) | Penetrazione Muri | Particolarità Meccanica |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **1. VANGUARD-AR** (Fucile d'Assalto) | 660 | `44 / 24 / 28 / 18` | `25m / 55m / 70%` | Media (`0.4m`) | Pattern a "T" nei primi 12 colpi; ADS `1.35x` con riduzione rinculo del 30%. |
| **2. KRABER-DS50** (Sniper Bolt-Action) | 48 | `300 / 125 / 110 / 88` | Nessuno (`100%`) | Alta (`1.2m`) | **Quickscope & Dual-Scope Shader** `6x`; animazione procedurale del Bolt-Pull dopo ogni tiro. |
| **3. VECTOR-9X** (SMG) | 1000 | `26 / 16 / 18 / 12` | `12m / 30m / 50%` | Bassa (`0.15m`) | Spread minimo in Hip-Fire e durante lo **Slide-Hop**; velocità movimento `106%`. |
| **4. CERBERUS-12** (Tactical Shotgun) | 135 | `22 / 15 / 15 / 11` ($\times 9$ pellet) | `8m / 22m / 25%` | Nessuna | Pattern fisso a stella (1 centrale + 8 ad anello) senza RNG casuale; ricarica shell-by-shell interrompibile. |
| **5. SHERIFF-500** (Heavy Revolver) | 165 | `145 / 55 / 60 / 40` | `30m / 60m / 75%` | Media (`0.5m`) | 100% precisa al primo colpo in piedi; animazione *Spin* all'estrazione e rotazione tamburo. |
| **6. KARAMBIT-ZERO** (Melee) | 120 | `100` (Frontale) / `200` (Backstab) | `2.6m` (Arco Melee) | N/A | **Velocità Movimento 115%**; ispezione arma (`F`) con rotazione sull'anello dell'indice. |

### C. Sistema di Animazione Procedurale 6-DOF (`SecondOrderSpring3D`)
Non usare animazioni lineari rigide. Implementa un sistema massa-molla-smorzatore del secondo ordine governato dall'equazione differenziale:
$$\ddot{\mathbf{x}} + 2\zeta\omega_0\dot{\mathbf{x}} + \omega_0^2(\mathbf{x} - \mathbf{x}_{\text{target}}) = \mathbf{F}_{\text{impulse}}$$
Applica 2 molle accoppiate (Posizione $\mathbf{p} \in \mathbb{R}^3$ e Rotazione Euler/Quaternion $\mathbf{r} \in \mathbb{R}^3$) al Viewmodel dell'arma per generare:
1. **Rotational Mouse Sway & Strafe Tilt:** Quando il giocatore muove il mouse, l'arma ritarda leggermente e si inclina sull'asse di Roll (`Z`) fino a `±6.5°` quando si fa strafing laterale (`A`/`D`) o si scivola (`-18°` di inclinazione tattica stile *Call of Duty / Titanfall* durante lo Slide).
2. **Procedural Walk Cycle (Lissajous Curve):**
   $$x(t) = A_x \cos(\omega t), \quad y(t) = A_y \vert{}\sin(\omega t)\vert{}$$
   modulato dalla velocità a terra e azzerato in aria.
3. **Landing Dip & Jump Kick:** Impulso verso il basso sulla molla verticale (`-0.08m`) e beccheggio in avanti quando il giocatore tocca terra, proporzionale alla velocità verticale d'impatto $v_y$.
4. **Procedural Tactical Reload:** Sequenza coreografata di impulsi sulle molle e traslazione dei nodi figli: inclinazione arma a `35°`, sgancio del nodo `Magazine` verso il basso con gravità, inserimento dal basso con colpo secco sulla molla (`+Z/+Y` slap impulse) e arretramento del nodo `BoltCarrier` nell'ultimo terzo del tempo di ricarica.

---

# 4. PIPELINE DI RENDERING WEBGL2 E SHADER GLSL (`packages/client`)
1. **Dual-Pass Camera & FOV Scaling:**
   - **Pass 1 (World):** Renderizza la mappa, i giocatori terzi, i traccianti balistici e le particelle con `worldCamera` (FOV dinamico che scala fluidamente da `100°` a `116°` durante lo Slide-Hop ad alta velocità).
   - **Pass 2 (Viewmodel):** Esegui `renderer.clearDepth()` mantenendo il Color Buffer e renderizza la scena del Viewmodel (braccia cibernetiche + arma + muzzle flash) con `viewmodelCamera` a FOV fisso `68°`. Questo garantisce **zero penetrazione dell'arma nei muri** e proporzioni prospettiche perfette.
2. **Post-Processing Leggero ad Alte Prestazioni:**
   - Shader finale singolo che combina **ACESToneMapping**, **Bloom Selettivo** sui dettagli neon/mirini e **Directional Damage Vignette** (bordo dello schermo che lampeggia di rosso nella direzione angolare esatta da cui proviene il colpo nemico).
3. **Effetti Balistici in Tempo Reale:**
   - **Bullet Tracers:** Traccianti luminosi veloci (`InstancedMesh` cilindrica allungata con gradiente alpha) dal `MuzzlePoint` effettivo dell'arma fino al punto d'impatto.
   - **Impact Decals & Sparks:** Fori di proiettile orientati lungo la normale della parete colpita + scintille con rimbalzo fisico semplice e scia luminosa.
   - **Shell Casings:** Bossoli di ottone 3D espulsi dall'otturatore con rotazione angolare casuale che rimbalzano sul pavimento emettendo un tintinnio metallico.

---

# 5. NETCODE AUTORITATIVO, SUB-TICK REWIND E PROTOCOL BUFFER (`packages/server` & `packages/shared`)
1. **Protocollo Binario Zero-Allocation (`PacketWriter` / `PacketReader`):**
   - Scrivi un lettore/scrittore binario su un singolo `ArrayBuffer` riutilizzabile.
   - Comprimi i quaternioni/angoli di vista (`yaw`, `pitch`) in `Uint16` (`65535` step su $360^\circ$, precisione di $0.005^\circ$) e le velocità in `Int16` fixed-point.
2. **Client-Side Prediction & Reconciliation con Smoothing:**
   - Il client assegna un `sequenceNumber` incrementale ad ogni input, lo applica subito al proprio `KinematicController` e lo salva in un `InputRingBuffer(128)`.
   - Quando arriva lo `ServerSnapshot`, il client scarta gli input con `seq <= lastProcessedSeq`, imposta lo stato autoritativo del server e **ri-simula istantaneamente** tutti gli input successivi non ancora confermati.
   - Se c'è un errore di posizione residuo $\Vert{}\Delta\mathbf{p}\Vert{} > 0.01\text{m}$, applica un vettore `visualErrorOffset` che decade esponenzialmente verso zero in `80ms` per evitare qualsiasi scatto visivo (rubberbanding).
3. **Server-Side Lag Compensation (Historical Hitbox Rewind):**
   - Il server mantiene una `WorldHistoryBuffer` degli ultimi `64 tick` (`1.06 secondi`). Ad ogni tick registra la posa esatta delle **6 OBB (Oriented Bounding Boxes)** di ogni giocatore: `Head`, `UpperTorso`, `LowerTorso`, `LeftArm`, `RightArm`, `Legs`.
   - Quando il server riceve un `FireCommand`, calcola:
     $$T_{\text{target}} = T_{\text{serverRecv}} - \text{ClientRTT}/2 - \text{ClientInterpDelay} + \text{subTickFraction} \cdot \Delta t$$
   - Esegue `lerp` tra i due frame storici che racchiudono $T_{\text{target}}$, ricostruisce le 6 OBB di ogni nemico, esegue il test analitico `Ray vs OBB` (ordinato per distanza $t$), gestisce la penetrazione attraverso i bordi sottili delle pareti (*Wallbang*) ed emette il pacchetto `HitConfirmPacket` (con flag `isHeadshot`, `isKill`, `damageDealt`, `hitPosition`).

---

# 6. MOTORE AUDIO SINTETICO PROCEDURALE DSP (`packages/client/src/audio/ProceduralAudioEngine.ts`)
Il gioco deve funzionare a zero dipendenze da file `.mp3`/`.wav` esterni, generando tutti gli effetti sonori in tempo reale tramite **Web Audio API**:
- **Spari Diversificati per Arma:** Combina un burst di *White/Pink Noise* filtrato con un `BiquadFilterNode` (`bandpass` / `lowpass` con sweep di frequenza esponenziale in `60-120ms`) + un'onda `sawtooth`/`triangle` per il punch delle basse frequenze (`140Hz -> 35Hz`) + un impulso metallico ad alta frequenza per il meccanismo dell'otturatore.
- **Audio Spaziale 3D (`PannerNode` HRTF):** Gli spari e i passi dei nemici sono posizionati nello spazio 3D attorno all'ascoltatore.
- **Hitmarker & Headshot Crunch:**
  - *Body Hit:* Doppio impulso percussivo ad alta frequenza (`1800Hz` + `2400Hz`, durata `35ms`) nitido e soddisfacente.
  - *Headshot / Kill Confirm:* Accordo sintetico metallico crunch (`880Hz` + `1760Hz` + saturazione armonica tramite `WaveShaperNode` + pitch-up rapido) che dà una scarica immediata di dopamina.

---

# 7. MAPPE COMPETITIVE A 3 CORSIE, MODALITÀ E DEBUG MULTI-TAB
1. **Map Builder Architetturale (`ArenaMapBuilder`):**
   - Genera 2 mappe competitive simmetriche/asimmetriche a 3 corsie (*Three-Lane Tactical Design*) con illuminazione direzionale + Emissive Neon Trim, rampe inclinate per lo **Slope-Slide**, passerelle sopraelevate, coperture per l'Head-Glitch e **Jump-Pads** energetici che applicano un impulso vettoriale parabolico fisso:
     - **Mappa 1: `NEXUS-CYBERLAB`** (Struttura sci-fi pulita ad alto contrasto: pareti bianche opache in titanio, pavimenti grigio antracite riflettenti, bordi neon ciano/magenta per una visibilità istantanea delle silhouette nemiche).
     - **Mappa 2: `SANDSTORM-OUTPOST`** (Complesso industriale desertico con container, torri di vedetta, tunnel sotterraneo centrale per lo slide-hopping e ponti sospesi).
2. **Modalità di Gioco Complete:**
   - **FFA (Free-For-All):** 25 Kill per vincere, respawn istantaneo in `1.5s`.
   - **TDM (Team Deathmatch):** Squadra Cyber-Cyan vs Squadra Crimson-Core, 50 Kill.
   - **CTF (Capture The Flag):** Bandiere olografiche fisiche con fascio di luce verticale verso il cielo; chi porta la bandiera impugna automaticamente la pistola/coltello e appare sul radar ogni `3 secondi`.
   - **HARDPOINT:** Zona di controllo con bordo luminoso che cambia posizione ogni `45 secondi`.
3. **Modalità Debug Multi-Tab (`?debug=true` o tasto `F3`):**
   - Bypassa qualsiasi blocco di singolo account usando un identificatore `sessionStorage` univoco per scheda (`Tab_1`, `Tab_2`).
   - Usa un **Web Worker Heartbeat Timer** per continuare a inviare pacchetti di rete e far girare la fisica a `60 Hz` anche nella scheda in background o non focalizzata, così da poter affiancare due finestre di Chrome su un unico monitor e vedere l'altro giocatore muoversi, sparare e subire danni in tempo reale.
   - Include un bottone **"Spawn Strafe-Bots"** nel pannello di debug (`F3`) che genera fino a 5 bot AI sul server capaci di fare slide-hopping, pattugliare i waypoint della mappa e mirare con tempi di reazione configurabili.

---

# 8. PIANO DI ESECUZIONE IN 3 STEP (CODICE 100% COMPLETO E FUNZIONANTE)
Per garantire che nessun file venga troncato dal limite di token, procedi in 3 fasi rigorose. Scrivi **solo codice completo e pronto per la compilazione**.

- **STEP 1 (Questo Turno):**
  1. Configurazione del Monorepo (`package.json`, `tsconfig.json`).
  2. `packages/shared/src/math.ts` & `bvh.ts`: Matematica vettoriale Zero-GC, intersezioni analitiche `Swept-Capsule vs AABB/Slope` e `Ray vs OBB` (Oriented Bounding Box).
  3. `packages/shared/src/kinematics.ts`: Il motore fisico completo di movimento stile Quake/Titanfall con **Air-Strafing**, **Slide-Hopping**, **Slope-Boost**, **Coyote Time** e **Jump-Pads**.
  4. `packages/shared/src/weapons.ts` & `protocol.ts`: Statistiche complete delle 6 armi, pattern di rinculo deterministici e il serializzatore binario `PacketWriter`/`PacketReader` con supporto **Sub-Tick**.

- **STEP 2 (Turno Successivo - attendi la mia conferma):**
  - Codice completo di `packages/server`: Game Loop a 60 Hz, `WorldHistoryBuffer` per il **Sub-Tick Hitbox Rewind (Lag Compensation)**, gestione stanze con Codice Lobby a 6 caratteri, algoritmo di **Respawn con Line-of-Sight Rejection**, logica di gioco per FFA/TDM/CTF/Hardpoint e **AI dei Bot**.

- **STEP 3 (Turno Successivo):**
  - Codice completo di `packages/client`: Renderer Three.js Dual-Camera, `SecondOrderSpring3D` per le animazioni procedurali 6-DOF delle armi, `ProceduralWeaponFactory` (con Shader GLSL per il mirino olografico e lo scope), `ProceduralCharacterRig` articolato a 6 parti, `ArenaMapBuilder` (mappe Nexus-Cyberlab e Sandstorm-Outpost), `ProceduralAudioEngine` (Web Audio API DSP), HUD competitivo (Crosshair dinamico, Hitmarker, Killfeed, Damage Numbers, Scoreboard) e pannello **Debug Multi-Tab (`F3`)**.

Inizia immediatamente con lo **STEP 1**, scrivendo codice TypeScript di qualità ingegneristica estrema.