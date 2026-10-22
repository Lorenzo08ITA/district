// A curated, redistributable vocabulary; unlimited rounds, not an infinite dictionary.
export const words = Array.from(
  new Set(
    `abete aceto acido acque adagi adito agave agire aiuto alato alibi alice alito alone amata amato ambra amica amico amore anice anima ansia arabo arata arena argon asilo asini asino asola astro atomo atti avida avido bacio bagni bagno balsa banca bando barca barba barbo basta becco bella bello belva benda berlo bimba bimbo birra bolla borsa bosco botte brama brano brava bravo breve brodo buche buono burla burro busta cacio caldo calma calmo campi campo canna canto capra capro carta casco cassa cause causa cedro cesta certo cento cervo chilo cigno cielo cinta circo clone colla colli collo colma colmo colpa conto coppa corno corpi corpo corsa corso corta corto costa cotta cotto crudo curva curvo danno dardo datai debba densa denso dente desco detta detto dieci dolce donna dopo drago drena dritta duomo ebano edera elica epica epico erede esame esile esito extra falco falsa falso fame fango farro farse farlo fatta fatto fauna felce felpa ferma fermo ferro festa fetta fiaba fiato fichi fieno fiera fiero figlio figli finta finto fiori firma fissa fisso fiume flora flusso fogli fogna fondo fonte forma forno forse forte forza frana frate frase freno frigo fruga frugo frutta fuchi fulvo fumo funge fungo furba furbo furia furto fusto gamba gamma gatta gatto gemma gente germe gesto ghisa gioco giova giove gocce grado grana grano grate grato grave grida grido grigi guado guaio guari gufo guida gusto hanno hotel icona idolo igloo india indio intero invio isola ladra ladro laghi lampi lampo lana larga largo larva latte lauro legge leggi legna legno lenta lento lente leone lepre libro lieve lista litro luogo lungo lunga lutto macco macro madre magia magro malta manca manco manda mango mania manto marzo massa matta matto media medio mente menta messa messo metro miele mista misto molto mondo monte morsa mosca mossa mosso motto mucca mucchio mulo mura museo mutua mutuo nanna nasco naspo natta nervo netta netto ninja ninna nitro nonna nonno norma notte nozze nuova nuovo occhi odore ombra onere opera orata orchi ordine organo origo orina orizzonte orma orso osare ostia ovale ovile pacco pace padre paese paghe pagna palco palio palla palma panca panni panno pansa pante pardo parla parlo parte parto passa passo pasta patto pausa pazza pazzo pecca pecco pelle penna pensa penso perde perla perno pesca pesce pesto petto pezza pezzo piano picco pieve pigna pinna pista pizza poche pochi podio poeta polpa polpo pompa ponte porco porre porta porto posta posto pozza pozzo prato prega prego premi prima primo prova provo prua pugni pugno punto punta quale quasi quota radio ragno ramo rampa rango rapa rapida raspa ratto rauco razza razzo reame reato regge regia regno rende renna resta resto retta retto ricca ricco ride riga righe rigid rigore rione risma ritmo rizzo rocca rossa rosso rotta rotto ruota ruspa sacco sacra sacro sagra salda saldo salma salsa salva salvo santa santo saper sasso sazio scala scalpo scavo scena scesa sceso scopa scopo scudo scura scuro sedia segna segno selce selva senza serba serbo seria serio serpe serre sesta sesto seta sfera sfida sfido sfogo siepe sigla sogno soldi somma sonno sopra sorda sordo sorge sorta sorte sotto spada spago spalla spazi spesa speso spiga spina spira sposa sposo stadi stame stare stati stato stava stelo stesa steso stilo stima stiro stiva stoffa stola stoppa stufa stufo succo sudore sughi sugo suola suolo suona suono svelta tagli taglia talco tanta tanto tappa targa tasca tasso tazza teatro teche tela tempo tenda tende tener tenue tergo terra terza terzo testa tetto tigre tinge tinta tinto tocca tocco tomba tonda tondo tonno torna torno torre torta torto tosta tosto trame trama trave treni treno trema tremo tribu trota trova trovo truce trucco tuono turno umana umano umida umido unica unico unire unita unito urina usato utile valli valsa vanto varia vario vasca vasta vasto vello venne vento verba verde verso vetro vetta vezzo viale vibra video viola virus vista visto vitto viva voce voglia volta volto vuota vuoto zaino zampa zanna zappa zebra zitta zitto zolla zucca`
      .split(/\s+/)
      .filter((w) => /^[a-z]{5}$/.test(w)),
  ),
);
export function evaluateGuess(guess: string, target: string) {
  const result = Array(5).fill('absent');
  const remaining = target.split('');
  for (let i = 0; i < 5; i++)
    if (guess[i] === target[i]) {
      result[i] = 'exact';
      remaining[i] = '';
    }
  for (let i = 0; i < 5; i++)
    if (result[i] !== 'exact') {
      const found = remaining.indexOf(guess[i]);
      if (found >= 0) {
        result[i] = 'present';
        remaining[found] = '';
      }
    }
  return result as ('exact' | 'present' | 'absent')[];
}
