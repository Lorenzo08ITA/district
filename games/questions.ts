export type Question = { prompt: string; answer: string; choices: string[]; flag?: string };
const capitals = [
  ['Italia', 'Roma'],
  ['Francia', 'Parigi'],
  ['Spagna', 'Madrid'],
  ['Portogallo', 'Lisbona'],
  ['Germania', 'Berlino'],
  ['Austria', 'Vienna'],
  ['Svizzera', 'Berna'],
  ['Grecia', 'Atene'],
  ['Norvegia', 'Oslo'],
  ['Svezia', 'Stoccolma'],
  ['Finlandia', 'Helsinki'],
  ['Danimarca', 'Copenaghen'],
  ['Polonia', 'Varsavia'],
  ['Ungheria', 'Budapest'],
  ['Romania', 'Bucarest'],
  ['Irlanda', 'Dublino'],
  ['Islanda', 'Reykjavík'],
  ['Giappone', 'Tokyo'],
  ['Canada', 'Ottawa'],
  ['Australia', 'Canberra'],
  ['Brasile', 'Brasilia'],
  ['Argentina', 'Buenos Aires'],
  ['Egitto', 'Il Cairo'],
  ['Marocco', 'Rabat'],
  ['India', 'Nuova Delhi'],
  ['Corea del Sud', 'Seul'],
  ['Turchia', 'Ankara'],
  ['Croazia', 'Zagabria'],
  ['Slovenia', 'Lubiana'],
  ['Cechia', 'Praga'],
];
const flags = [
  ['🇮🇹', 'Italia'],
  ['🇫🇷', 'Francia'],
  ['🇪🇸', 'Spagna'],
  ['🇵🇹', 'Portogallo'],
  ['🇩🇪', 'Germania'],
  ['🇦🇹', 'Austria'],
  ['🇨🇭', 'Svizzera'],
  ['🇬🇷', 'Grecia'],
  ['🇳🇴', 'Norvegia'],
  ['🇸🇪', 'Svezia'],
  ['🇫🇮', 'Finlandia'],
  ['🇩🇰', 'Danimarca'],
  ['🇵🇱', 'Polonia'],
  ['🇭🇺', 'Ungheria'],
  ['🇷🇴', 'Romania'],
  ['🇮🇪', 'Irlanda'],
  ['🇮🇸', 'Islanda'],
  ['🇯🇵', 'Giappone'],
  ['🇨🇦', 'Canada'],
  ['🇦🇺', 'Australia'],
  ['🇧🇷', 'Brasile'],
  ['🇦🇷', 'Argentina'],
  ['🇪🇬', 'Egitto'],
  ['🇲🇦', 'Marocco'],
  ['🇮🇳', 'India'],
  ['🇰🇷', 'Corea del Sud'],
  ['🇹🇷', 'Turchia'],
  ['🇭🇷', 'Croazia'],
  ['🇸🇮', 'Slovenia'],
  ['🇨🇿', 'Cechia'],
];
const trivia: [string, string, string, string, string][] = [
  ['Quale pianeta ha gli anelli più visibili?', 'Saturno', 'Marte', 'Venere', 'Mercurio'],
  ['Quanti lati ha un esagono?', '6', '5', '7', '8'],
  ['Chi ha scritto la Divina Commedia?', 'Dante Alighieri', 'Petrarca', 'Boccaccio', 'Manzoni'],
  ['Qual è il simbolo chimico dell’oro?', 'Au', 'Ag', 'Fe', 'O'],
  ['Quale organo pompa il sangue?', 'Cuore', 'Fegato', 'Polmone', 'Rene'],
  ['Quanto fa 12 × 12?', '144', '124', '132', '156'],
  ['Quale oceano è il più grande?', 'Pacifico', 'Atlantico', 'Indiano', 'Artico'],
  ['Chi dipinse la Gioconda?', 'Leonardo da Vinci', 'Raffaello', 'Caravaggio', 'Botticelli'],
  ['Quanti colori ha tradizionalmente l’arcobaleno?', '7', '5', '6', '8'],
  [
    'Qual è il mammifero più grande?',
    'Balenottera azzurra',
    'Elefante africano',
    'Capodoglio',
    'Giraffa',
  ],
  [
    'Quale gas assorbono le piante nella fotosintesi?',
    'Anidride carbonica',
    'Ossigeno',
    'Elio',
    'Idrogeno',
  ],
  ['In che anno arrivò il primo uomo sulla Luna?', '1969', '1965', '1972', '1959'],
  ['Quanti bit formano un byte?', '8', '4', '16', '32'],
  [
    'Quale strumento misura la pressione atmosferica?',
    'Barometro',
    'Termometro',
    'Anemometro',
    'Igrometro',
  ],
  ['Qual è il numero primo tra questi?', '17', '15', '21', '27'],
  ['Quale metallo è liquido a temperatura ambiente?', 'Mercurio', 'Rame', 'Zinco', 'Piombo'],
  ['Chi compose Le quattro stagioni?', 'Vivaldi', 'Mozart', 'Bach', 'Verdi'],
  ['Quante ossa ha normalmente un adulto?', '206', '180', '240', '300'],
  ['Quale animale subisce una metamorfosi da bruco?', 'Farfalla', 'Formica', 'Ragno', 'Lumaca'],
  ['Quale unità misura la resistenza elettrica?', 'Ohm', 'Volt', 'Watt', 'Ampere'],
  ['Quanto vale la somma degli angoli interni di un triangolo?', '180°', '90°', '270°', '360°'],
  ['Qual è la stella più vicina alla Terra?', 'Sole', 'Sirio', 'Polare', 'Vega'],
  ['Quale città ospita il Colosseo?', 'Roma', 'Atene', 'Napoli', 'Milano'],
  [
    'Quale linguaggio viene eseguito nativamente nei browser?',
    'JavaScript',
    'Python',
    'Ruby',
    'Rust',
  ],
  ['Quanti giocatori per squadra iniziano una partita di calcio?', '11', '9', '10', '12'],
  ['Quale materiale si ottiene dalla sabbia silicea?', 'Vetro', 'Carta', 'Acciaio', 'Lana'],
  [
    'Quale scienziata vinse due Nobel in discipline diverse?',
    'Marie Curie',
    'Ada Lovelace',
    'Rosalind Franklin',
    'Rita Levi-Montalcini',
  ],
  ['Quale pianeta è più vicino al Sole?', 'Mercurio', 'Venere', 'Terra', 'Marte'],
  ['Qual è il plurale di uovo?', 'Uova', 'Uovi', 'Uove', 'Uovai'],
  [
    'Quale forza mantiene i pianeti in orbita?',
    'Gravità',
    'Attrito',
    'Magnetismo',
    'Spinta idrostatica',
  ],
];
export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function quizQuestions(kind: string): Question[] {
  if (kind === 'trivia')
    return shuffle(trivia)
      .slice(0, 10)
      .map(([prompt, answer, ...others]) => ({
        prompt,
        answer,
        choices: shuffle([answer, ...others]),
      }));
  const dataset = kind === 'flags' ? flags : capitals;
  return shuffle(dataset)
    .slice(0, 10)
    .map(([a, b]) => ({
      prompt: kind === 'flags' ? 'A quale paese appartiene?' : `Qual è la capitale di ${a}?`,
      answer: b,
      flag: kind === 'flags' ? a : undefined,
      choices: shuffle([
        b,
        ...shuffle(dataset.filter((v) => v[1] !== b))
          .slice(0, 3)
          .map((v) => v[1]),
      ]),
    }));
}
