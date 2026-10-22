import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'District — giochi, senza rumore',
  description:
    'Un piccolo distretto di giochi indipendenti. Sfide veloci, mondi condivisi e progressi che restano.',
  manifest: '/manifest.json',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
