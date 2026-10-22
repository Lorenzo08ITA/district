export type GameId =
  | 'pulse'
  | 'wing'
  | 'crossfire'
  | 'orbit'
  | 'frontier'
  | 'drift'
  | 'trivia'
  | 'geography'
  | 'flags'
  | 'parola'
  | 'flux'
  | 'prism';
export type Game = {
  id: GameId;
  title: string;
  subtitle: string;
  category: string;
  dimension: '2D' | '3D';
  online: boolean;
  offline: boolean;
  color: string;
  symbol: string;
  controls: string;
};
export const games: Game[] = [
  {
    id: 'pulse',
    title: 'Pulse Run',
    subtitle: 'Un tasto. Nessun margine.',
    category: 'Ritmo',
    dimension: '2D',
    online: true,
    offline: true,
    color: '#f1b657',
    symbol: '◈',
    controls: 'Spazio / tocco: salta. R: riparti.',
  },
  {
    id: 'wing',
    title: 'Neon Wing',
    subtitle: 'Trova il varco.',
    category: 'Riflessi',
    dimension: '2D',
    online: true,
    offline: true,
    color: '#eb8cb5',
    symbol: '⌁',
    controls: 'Spazio / tocco: vola. R: riparti.',
  },
  {
    id: 'crossfire',
    title: 'Crossfire',
    subtitle: 'Entra. Mira. Sopravvivi.',
    category: 'Azione',
    dimension: '3D',
    online: true,
    offline: false,
    color: '#b6be9c',
    symbol: '⌖',
    controls: 'WASD: muovi · mouse: mira · clic: spara · Esc: libera mouse.',
  },
  {
    id: 'orbit',
    title: 'Little Orbit',
    subtitle: 'Mangia. Cresci. Scappa.',
    category: 'Arcade',
    dimension: '2D',
    online: true,
    offline: false,
    color: '#80b9cd',
    symbol: '◉',
    controls: 'Mouse / tocco: nuota verso il cursore.',
  },
  {
    id: 'frontier',
    title: 'Frontier',
    subtitle: 'Ogni confine è una scelta.',
    category: 'Strategia',
    dimension: '2D',
    online: true,
    offline: true,
    color: '#d4a47e',
    symbol: '▧',
    controls: 'Clic: conquista / costruisci · trascina: muovi · rotella: zoom · diplomazia e flotte.',
  },
  {
    id: 'drift',
    title: 'Night Circuit',
    subtitle: 'La prossima curva è tua.',
    category: 'Guida',
    dimension: '3D',
    online: true,
    offline: true,
    color: '#b8acf3',
    symbol: '↗',
    controls: 'WASD / frecce: guida · Spazio: frena · completa 3 giri.',
  },
  {
    id: 'trivia',
    title: 'Dieci domande',
    subtitle: 'Quanto ne sai davvero?',
    category: 'Quiz',
    dimension: '2D',
    online: false,
    offline: true,
    color: '#e1bc71',
    symbol: '?',
    controls: 'Scegli una risposta. 10 domande per sessione.',
  },
  {
    id: 'geography',
    title: 'Altrove',
    subtitle: 'Il mondo, a memoria.',
    category: 'Quiz',
    dimension: '2D',
    online: false,
    offline: true,
    color: '#8cbaa6',
    symbol: '◎',
    controls: 'Scegli la capitale corretta.',
  },
  {
    id: 'flags',
    title: 'Flag Club',
    subtitle: 'Riconosci quei colori?',
    category: 'Quiz',
    dimension: '2D',
    online: false,
    offline: true,
    color: '#e99b81',
    symbol: '⚑',
    controls: 'Associa bandiera e paese.',
  },
  {
    id: 'parola',
    title: 'Parola',
    subtitle: 'Cinque lettere. Sei tentativi.',
    category: 'Parole',
    dimension: '2D',
    online: false,
    offline: true,
    color: '#a8b998',
    symbol: 'Aa',
    controls: 'Scrivi una parola italiana di 5 lettere. Invio: verifica.',
  },
  {
    id: 'flux',
    title: 'Flux Grid',
    subtitle: 'Spegni tutto. Pensa avanti.',
    category: 'Puzzle',
    dimension: '2D',
    online: false,
    offline: true,
    color: '#91aacc',
    symbol: '⊞',
    controls: 'Clic: inverti casella e vicini. Spegni tutte le luci.',
  },
  {
    id: 'prism',
    title: 'Prism Fall',
    subtitle: 'Cambia corsia. Resta intero.',
    category: 'Riflessi',
    dimension: '3D',
    online: false,
    offline: true,
    color: '#c9a0d4',
    symbol: '◇',
    controls: 'A / D o frecce: cambia corsia. Evita i prismi rossi.',
  },
];
export const getGame = (id: string) => games.find((g) => g.id === id);
export type Result = {
  id: string;
  game: GameId;
  mode: 'offline' | 'online';
  score: number;
  durationMs: number;
  won: boolean;
  stats: Record<string, number | string | boolean>;
};
export type Progress = {
  game_id: GameId;
  best: number;
  plays: number;
  wins: number;
  total_ms: number;
  stats: Record<string, unknown>;
};
