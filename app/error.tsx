'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal">
      <h1>Qualcosa si è fermato.</h1>
      <p>I risultati salvati sul dispositivo restano disponibili.</p>
      <button onClick={reset}>Riprova</button>
    </main>
  );
}
