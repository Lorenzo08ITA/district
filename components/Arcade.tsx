'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { games, type Game, type Result, type Progress } from '../lib/catalog';
import {
  api,
  defaultPreferences,
  localRuns,
  readLocal,
  recordLocal,
  summarize,
  syncResults,
  writeLocal,
  type Player,
  type Preferences,
} from '../lib/client';
const GameShell = dynamic(() => import('./GameShell'), {
  ssr: false,
  loading: () => <div className="loading">Preparazione gioco…</div>,
});
export default function Arcade() {
  const [player, setPlayer] = useState<Player | null>(null),
    [ready, setReady] = useState(false),
    [prefs, setPrefs] = useState<Preferences>(defaultPreferences),
    [selected, setSelected] = useState<Game | null>(null),
    [online, setOnline] = useState(false),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('Tutti'),
    [auth, setAuth] = useState(false),
    [register, setRegister] = useState(false),
    [settings, setSettings] = useState(false),
    [progress, setProgress] = useState<Progress[]>([]),
    [message, setMessage] = useState(''),
    [connected, setConnected] = useState(true),
    [busy, setBusy] = useState(false),
    [view, setView] = useState('catalogo');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (auth) dialog.current?.showModal();
  }, [auth]);
  const owner = player?.id || 'guest';
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  async function refresh(id = owner) {
    const local = summarize(localRuns(id));
    if (id === 'guest') {
      setProgress(local);
      return;
    }
    try {
      await syncResults(id);
      const remote = await api<Progress[]>('progress');
      if (ownerRef.current === id) setProgress(remote);
    } catch (e: any) {
      if (ownerRef.current === id) {
        setProgress(local);
        setMessage(e.message);
      }
    }
  }
  useEffect(() => {
    const cached = readLocal<Player | null>('arcade:player', null);
    setPlayer(cached);
    setPrefs(readLocal('arcade:preferences', defaultPreferences));
    setConnected(navigator.onLine);
    api<Player | null>('me')
      .then((p) => {
        setPlayer(p);
        writeLocal('arcade:player', p);
        if (p?.preferences?.theme) setPrefs(p.preferences);
      })
      .catch((e) => setMessage(e.message))
      .finally(() => setReady(true));
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => setMessage('Cache offline non disponibile'));
    const showError = (e: Event) => setMessage((e as CustomEvent).detail);
    window.addEventListener('arcade-error', showError);
    const update = () => setConnected(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('arcade-error', showError);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    if (ready) void refresh(owner);
  }, [owner, ready, connected]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.accent = prefs.accent;
  }, [prefs]);
  function changePrefs(next: Preferences) {
    setPrefs(next);
    try {
      writeLocal('arcade:preferences', next);
    } catch (e: any) {
      setMessage(e.message);
    }
    if (player)
      api('preferences', { method: 'PUT', body: JSON.stringify(next) }).catch((e) =>
        setMessage(e.message),
      );
  }
  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const p = await api<Player>(`auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form)),
      });
      setPlayer(p);
      writeLocal('arcade:player', p);
      if (p.preferences?.theme) setPrefs(p.preferences);
      setAuth(false);
      setMessage('Account connesso');
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api('auth/logout', { method: 'POST' });
      setPlayer(null);
      writeLocal('arcade:player', null);
      setSelected(null);
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  async function finish(result: Result) {
    try {
      if (result.mode === 'offline') recordLocal(owner, result);
      setMessage(
        result.mode === 'online'
          ? 'Risultato registrato dal server'
          : player
            ? 'Risultato salvato · sincronizzazione…'
            : 'Risultato salvato sul dispositivo',
      );
      await refresh(owner);
    } catch (e: any) {
      setMessage(e.message);
      const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `district-result-${result.id}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  }
  function play(game: Game, network = false) {
    if (network && (!player || !connected)) {
      setMessage(
        !connected ? 'Serve una connessione per giocare online' : 'Accedi per giocare online',
      );
      if (!player) setAuth(true);
      return;
    }
    setOnline(network);
    setSelected(game);
  }
  const filtered = games.filter(
    (g) =>
      (filter === 'Tutti' ||
        (filter === 'Preferiti' && prefs.favorites.includes(g.id)) ||
        (filter === 'Multiplayer' && g.online) ||
        (filter === '3D' && g.dimension === '3D') ||
        g.category === filter) &&
      `${g.title} ${g.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  const totalPlays = progress.reduce((s, p) => s + p.plays, 0);
  return (
    <div className="district" data-ready={ready}>
      <aside className="sidebar">
        <a href="/" className="brand" aria-label="District home">
          <span className="brandmark">d.</span>district<span className="branddot">®</span>
        </a>
        <div className="side-label">IL TUO SPAZIO</div>
        <nav>
          <button
            className={view === 'catalogo' ? 'active' : ''}
            onClick={() => {
              setView('catalogo');
              setSelected(null);
            }}
          >
            ▦ <span>Scopri</span>
            <small>12</small>
          </button>
          <button
            className={filter === 'Preferiti' ? 'active' : ''}
            onClick={() => {
              setFilter('Preferiti');
              setSelected(null);
              setView('catalogo');
            }}
          >
            ♡ <span>La tua selezione</span>
          </button>
          <button
            className={view === 'progressi' ? 'active' : ''}
            onClick={() => {
              setView('progressi');
              setSelected(null);
            }}
          >
            ◴ <span>I tuoi progressi</span>
          </button>
        </nav>
        <div className="side-note">
          <span className="tiny-orbit">✳</span>
          <p>
            Un altro giro?
            <br />
            <strong>Il prossimo è quello buono.</strong>
          </p>
        </div>
        <button className="settings-button" onClick={() => setSettings(!settings)}>
          ☷ Personalizza
        </button>
        <div className="connection">
          <i className={connected ? '' : 'off'} />
          {connected ? 'Tutto connesso' : 'Modalità offline'}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="breadcrumb">
            Il tuo piccolo universo di giochi <span> / </span>{' '}
            <b>{selected?.title || 'Benvenuto'}</b>
          </span>
          <div className="top-actions">
            <span className="date-label">GIOCA. STACCA. RIPETI.</span>
            {player ? (
              <button className="profile" onClick={logout} title="Esci dall’account">
                <span>{player.name.slice(0, 1).toUpperCase()}</span>
                {player.name} ↗
              </button>
            ) : (
              <button className="login" onClick={() => setAuth(true)}>
                Accedi <span>↗</span>
              </button>
            )}
          </div>
        </header>
        {message && (
          <div className="notice" role="status">
            <span>{message}</span>
            <button aria-label="Chiudi notifica" onClick={() => setMessage('')}>
              ×
            </button>
          </div>
        )}
        {selected ? (
          <GameShell
            owner={owner}
            key={`${selected.id}-${online}`}
            game={selected}
            online={online}
            onExit={() => {
              setSelected(null);
              void refresh();
            }}
            onFinish={finish}
          />
        ) : view === 'progressi' ? (
          <section className="progress-page">
            <div className="eyebrow">IL TUO PERCORSO</div>
            <h1>Ogni partita conta.</h1>
            <p>
              {totalPlays} partite ·{' '}
              {player ? 'Sincronizzate con il tuo account' : 'Salvate su questo dispositivo'}
            </p>
            <button onClick={() => void refresh()}>Sincronizza</button>
            <button
              onClick={() => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(
                  new Blob([JSON.stringify(localRuns(owner), null, 2)], {
                    type: 'application/json',
                  }),
                );
                a.download = 'district-progressi.json';
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Esporta dati locali
            </button>
            {player && localRuns('guest').length > 0 && (
              <button
                onClick={async () => {
                  try {
                    for (const r of localRuns('guest')) recordLocal(owner, r);
                    await refresh();
                    setMessage('Risultati ospite importati');
                  } catch (e: any) {
                    setMessage(e.message);
                  }
                }}
              >
                Importa risultati ospite
              </button>
            )}
            <div className="progress-list">
              {progress.length ? (
                progress.map((p) => (
                  <article key={p.game_id}>
                    <strong>{games.find((g) => g.id === p.game_id)?.title}</strong>
                    <span>Record {p.best}</span>
                    <span>
                      {p.plays} partite · {p.wins} vittorie ·{' '}
                      {Math.round(Number(p.total_ms) / 60000)} min
                    </span>
                    <details>
                      <summary>Ultima partita</summary>
                      <pre>{JSON.stringify(p.stats, null, 2)}</pre>
                    </details>
                  </article>
                ))
              ) : (
                <p>Il primo record ti aspetta.</p>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="intro">
              <div>
                <div className="eyebrow">
                  <i /> PICCOLE PAUSE, GRANDI PARTITE
                </div>
                <h1>
                  Entra in gioco<span>.</span>
                </h1>
                <p>Nessun download. Solo un’altra partita.</p>
              </div>
              <span className="issue">
                VOL. 01
                <br />
                <b>THE PLAY ISSUE</b>
              </span>
            </section>
            <section className="hero">
              <div className="hero-copy">
                <div className="pill">
                  SCELTO DAL DISTRETTO <span>01 / 12</span>
                </div>
                <h2>
                  Segui il ritmo.
                  <br />
                  Sfida il limite.
                </h2>
                <p>
                  Un salto tra te e il prossimo record.
                  <br />
                  Quanto lontano riesci ad arrivare?
                </p>
                <button className="primary" onClick={() => play(games[0])}>
                  Gioca a Pulse Run <span>↗</span>
                </button>
                <div className="hero-meta">
                  SPACE PER SALTARE <i /> 2D RUNNER <i /> ANCHE OFFLINE
                </div>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="sun" />
                <div className="orbit-line" />
                <div className="art-floor" />
                <div className="art-cube" />
                <div className="art-spike s1" />
                <div className="art-spike s2" />
                <div className="art-spike s3" />
                <span className="art-tag">
                  KEEP
                  <br />
                  MOVING.
                </span>
                <span className="art-number">P/01</span>
              </div>
            </section>
            <section className="catalog">
              <div className="catalog-heading">
                <h2>
                  Trova il tuo prossimo giro <span>({filtered.length})</span>
                </h2>
                <label className="search">
                  <span>⌕</span>
                  <input
                    aria-label="Cerca un gioco"
                    placeholder="Cerca nel distretto"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <kbd>/</kbd>
                </label>
              </div>
              <div className="filters">
                {['Tutti', 'Multiplayer', '3D', 'Riflessi', 'Quiz', 'Puzzle', 'Strategia'].map(
                  (f) => (
                    <button
                      key={f}
                      className={filter === f ? 'selected' : ''}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                      {f === 'Multiplayer' && <i />}
                    </button>
                  ),
                )}
                <span>12 giochi. Zero attese.</span>
              </div>
              <div className={`game-grid ${prefs.layout}`}>
                {filtered.map((g, index) => (
                  <article className={`game-card game-${g.id}`} key={g.id}>
                    <button
                      aria-label={`Gioca a ${g.title}`}
                      className="thumbnail"
                      style={{ '--card-color': g.color } as React.CSSProperties}
                      onClick={() => play(g, !g.offline)}
                    >
                      <span className="dimension">{g.dimension}</span>
                      <div className="thumbnail-art">
                        <span className="shape-one" />
                        <span className="shape-two" />
                        <span className="shape-three" />
                        <strong>{g.symbol}</strong>
                      </div>
                      <span className="card-serial">
                        DISTRICT / {String(games.indexOf(g) + 1).padStart(2, '0')}
                      </span>
                      <span className="play-hover">GIOCA ↗</span>
                    </button>
                    <div className="card-title">
                      <button onClick={() => play(g, !g.offline)}>{g.title}</button>
                      <button
                        className={`favorite ${prefs.favorites.includes(g.id) ? 'saved' : ''}`}
                        aria-label={`Preferito: ${g.title}`}
                        aria-pressed={prefs.favorites.includes(g.id)}
                        onClick={() =>
                          changePrefs({
                            ...prefs,
                            favorites: prefs.favorites.includes(g.id)
                              ? prefs.favorites.filter((id) => id !== g.id)
                              : [...prefs.favorites, g.id],
                          })
                        }
                      >
                        {prefs.favorites.includes(g.id) ? '♥' : '♡'}
                      </button>
                    </div>
                    <p>{g.subtitle}</p>
                    <div className="card-bottom">
                      <span>{g.category}</span>
                      {g.online ? (
                        <button onClick={() => play(g, true)}>
                          <i /> Online ↗
                        </button>
                      ) : (
                        <span>Solo tu</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {!filtered.length && <p className="empty">Nessun gioco trovato.</p>}
            </section>
            <footer>
              <span className="brand-small">district.</span>
              <p>Il bello è giocare.</p>
              <span>Fatto per le tue pause. © 2026</span>
            </footer>
          </>
        )}
      </main>
      {settings && (
        <section className="settings panel" aria-label="Personalizza">
          <button className="close" onClick={() => setSettings(false)}>
            ×
          </button>
          <h2>A modo tuo.</h2>
          <label>
            Tema
            <select
              aria-label="Tema"
              value={prefs.theme}
              onChange={(e) =>
                changePrefs({ ...prefs, theme: e.target.value as Preferences['theme'] })
              }
            >
              <option value="dark">Notte</option>
              <option value="light">Giorno</option>
            </select>
          </label>
          <label>
            Colore
            <select
              aria-label="Colore"
              value={prefs.accent}
              onChange={(e) =>
                changePrefs({ ...prefs, accent: e.target.value as Preferences['accent'] })
              }
            >
              <option value="lime">Lime</option>
              <option value="peach">Pesca</option>
              <option value="blue">Blu</option>
            </select>
          </label>
          <label>
            Catalogo
            <select
              aria-label="Catalogo"
              value={prefs.layout}
              onChange={(e) =>
                changePrefs({ ...prefs, layout: e.target.value as Preferences['layout'] })
              }
            >
              <option value="grid">Spazioso</option>
              <option value="compact">Compatto</option>
            </select>
          </label>
        </section>
      )}
      {auth && (
        <dialog
          ref={dialog}
          aria-label="Account"
          className="modal-backdrop"
          onCancel={() => setAuth(false)}
          onClick={() => setAuth(false)}
        >
          <section className="auth panel" aria-label="Account" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setAuth(false)}>
              ×
            </button>
            <div className="eyebrow">IL TUO DISTRETTO</div>
            <h2>{register ? 'Fai spazio ai record.' : 'Bentornato.'}</h2>
            <p>I tuoi progressi, su ogni dispositivo.</p>
            <form onSubmit={authenticate}>
              {register && (
                <label>
                  Nome
                  <input
                    name="name"
                    minLength={2}
                    maxLength={24}
                    required
                    autoComplete="nickname"
                  />
                </label>
              )}
              <label>
                Email
                <input name="email" type="email" required autoComplete="email" />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={10}
                  maxLength={128}
                  required
                  autoComplete={register ? 'new-password' : 'current-password'}
                />
              </label>
              <button disabled={busy} className="primary">
                {busy ? 'Un momento…' : register ? 'Crea account' : 'Entra'} ↗
              </button>
            </form>
            <button className="text-button" onClick={() => setRegister(!register)}>
              {register ? 'Hai già un account? Accedi' : 'Prima volta? Registrati'}
            </button>
            <button className="text-button" onClick={() => setAuth(false)}>
              Continua come ospite
            </button>
          </section>
        </dialog>
      )}
    </div>
  );
}
