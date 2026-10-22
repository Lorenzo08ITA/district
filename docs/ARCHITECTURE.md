# Database e protocollo

## Relazioni

- `players`: UUID, email unica, nome, hash password, preferenze JSONB.
- `sessions`: hash token, proprietario e scadenza; eliminazione con account.
- `games`: registro del catalogo e autorità prevista.
- `matches`: gioco, inizio/fine e ultimo stato durevole o risultati finali.
- `runs`: un risultato per giocatore e UUID; partita opzionale, modalità, punteggio, durata, vittoria, statistiche, verifica e data.
- `progress`: chiave composta giocatore/gioco, massimo, contatori e tempo totale. Si aggiorna solo se viene inserito un nuovo `run`.
- `checkpoints`: stato di ripresa per giocatore/gioco offline. Timestamp per aggiornamenti fuori ordine e tombstone alla conclusione.

I dati dei giochi restano JSONB per evitare colonne inutilizzate e poter aggiungere giochi senza migrazioni dello schema. Tutti i risultati vengono conservati; l’API della cronologia restituisce le ultime 100 partite, mentre i riepiloghi coprono tutta la cronologia. I checkpoint fra dispositivi usano l’ultimo timestamp: non fondono due partite simultanee dello stesso gioco. Occorrono orologi di dispositivo corretti.

## HTTP stessa origine

| Metodo e percorso                     | Autenticazione | Uso                                          |
| ------------------------------------- | -------------- | -------------------------------------------- |
| GET /api/health                       | no             | Readiness del database                       |
| GET /api/games                        | no             | Catalogo                                     |
| POST /api/auth/register               | no             | Email, password di almeno 10 caratteri, nome |
| POST /api/auth/login                  | no             | Nuova sessione                               |
| GET /api/me                           | opzionale      | Identità corrente o null                     |
| POST /api/auth/logout                 | sì             | Revoca sessione e socket                     |
| GET /api/progress                     | sì             | Riepiloghi del proprio account               |
| GET /api/runs                         | sì             | Ultimi 100 risultati del proprio account     |
| POST /api/results                     | sì             | Solo risultati offline non verificati        |
| GET/PUT/DELETE /api/checkpoints/:game | sì             | Stato della partita offline                  |
| PUT /api/preferences                  | sì             | Tema, colore, layout e preferiti             |

Gli errori ritornano `{ "error": "messaggio" }`, con 400, 401, 403, 409, 413, 429 o 503. Le API non sono memorizzate dal Service Worker. Le modifiche richiedono `Origin` uguale a `PUBLIC_ORIGIN`.

## Socket.IO

1. Handshake con cookie di sessione e Origin valido.
2. Client `join {game}` con acknowledgment `{room, playerId}` o `{error}`. Stanze aperte agli ingressi per venti secondi, massimo otto giocatori. Il rientro dello stesso account recupera la stessa partita attiva; un secondo socket sostituisce il primo.
3. Client `input`: schema validato in `lib/validation.ts`. FPS invia assi, yaw, pitch e fuoco; Frontier invia un indice di territorio; gli altri inviano coordinate e punteggio. Posizione, HP e punteggio dichiarati dal client sono ignorati per l’FPS.
4. Server `snapshot`: attori, eventuale mappa, inizio e tempo rimanente. Il server avanza a 30 Hz e trasmette a 15 Hz. Nessun input da un altro gioco può controllare uno sparatutto o una conquista.
5. Server `finished`: risultato personale, solo dopo persistenza. `notice` segnala problemi recuperabili. Client `leave` o disconnessione rimuove il socket; il match continua e conserva il partecipante per riconnessione e risultato finale.

Il client interpola gli avversari. L’FPS prevede il proprio movimento con correzione verso gli snapshot; il server applica cooldown e collisioni, inclusa occlusione dei colpi. Questo descrive il trasporto originale. Crossfire usa ora il servizio dedicato /fps/socket con rewind storico delle hitbox: vedere [FPS-STEP2-3.md](FPS-STEP2-3.md).

Frontier usa capitale e produzione delle truppe a tempo discreto, attacco al 60% dall’adiacente più forte, montagne e trasferimento dei territori alla caduta della capitale. Offline usa le medesime regole con tre bot. Online le otto capitali sono predisposte dall’inizio per evitare reset della mappa agli ingressi; le capitali dei posti vuoti sono neutrali di fatto, senza bot.

Little Orbit ha cibo simulato dal client e crescita limitata dal server. Gli incontri tra pesci sono valutati dal client: una validazione minima, deliberatamente non sufficiente per tornei o premi. Runner e Flappy confrontano punteggi in finestre di 90 secondi, con ostacoli generati localmente. La gara di guida dura 90 secondi online; il circuito offline termina dopo tre giri.

## Aggiungere un gioco

Aggiungi un ID e i metadati in `lib/catalog.ts`, un modulo `games/<id>.tsx` conforme a `GameProps`, e il suo import lazy in `components/GameShell.tsx`. `onEnd` produce un risultato offline; i moduli online inviano input e aspettano `finished`. Aggiungi regole server dedicate se il gioco richiede autorità del server. La migrazione registra automaticamente il nuovo gioco. Aggiungi almeno un test delle regole o delle interazioni critiche.

## Servizi dedicati attuali

Frontier usa `/rts/socket` (10 Hz, replica deterministica, snapshot/journal); Crossfire usa `/fps/socket` (60 Hz, prediction e rewind). I vecchi join Socket.IO per questi due giochi vengono rifiutati. Gli altri giochi continuano a usare Socket.IO. [FPS](FPS-STEP2-3.md) e [RTS](RTS-STEP3.md) documentano i protocolli correnti.
