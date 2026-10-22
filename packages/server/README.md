# Server RTS

Server WebSocket autoritativo implementato nello Step 3. Esporta attachRts; autenticazione e RoomStore sono iniettati. District lo collega in ../../server/rts.ts. Protocollo v2, tick 10 Hz, lobby, journal durabile, snapshot/recovery e risultati idempotenti.

Uso, limiti e test: [RTS-STEP3.md](../../docs/RTS-STEP3.md).
