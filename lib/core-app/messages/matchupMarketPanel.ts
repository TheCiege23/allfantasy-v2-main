import { defineMessages } from '@/lib/i18n/messages'

/**
 * "Scoring environment" (components/core-app/MatchupMarketPanel.tsx). Every string is the one the
 * panel wrote before the move, byte for byte, in both languages — a relocation, not a rewrite. The
 * info tip's four paragraphs were an array; they are `tip1`…`tip4` here, rendered in that order.
 * ⚠ The wording is the betting boundary the panel's header describes: expected points, never a line.
 */
export const matchupMarketPanelMessages = defineMessages({
  en: {
    title: 'Scoring environment',
    tipLabel: 'How to read the scoring environment',
    tip1: 'Each of your starters, with the points the betting market expects his team’s offense to score this week — a forecast of the game, read the way a projection is.',
    tip2: '“Favored by 3.5” means the market expects his team to win by about that much; “combined” is the points it expects both teams to score together.',
    tip3: 'It is not the win probability above, which is your fantasy matchup, and it is not a wager: no prices and no sportsbooks are shown.',
    tip4: 'A market read posts about two days before kickoff, so early in the week most starters have none yet.',
    expected: (pts: string) => `${pts} expected pts`,
    where: (home: boolean, opponent: string): string => `${home ? 'vs' : 'at'} ${opponent}`,
    favored: (n: number) => `favored by ${n}`,
    underdog: (n: number) => `underdog by ${n}`,
    even: 'even game',
    combined: (t: string) => `${t} combined`,
    stale: 'Past its refresh window — re-check before locking.',
    partial: (n: number) => `No market read yet for ${n} of your starters — it posts closer to kickoff.`,
    empty: 'No market read yet — expected team scoring posts closer to kickoff.',
    footer: 'Market-implied team scoring. Not a wager, and not your matchup win chance.',
    failed: 'The scoring environment did not load. Reload the page to try again.',
  },
  es: {
    title: 'Entorno de anotación',
    tipLabel: 'Cómo leer el entorno de anotación',
    tip1: 'Cada uno de tus titulares, con los puntos que el mercado de apuestas espera que anote la ofensiva de su equipo esta semana: un pronóstico del partido, leído como una proyección.',
    tip2: '«Favorito por 3.5» significa que el mercado espera que su equipo gane por más o menos esa diferencia; «entre ambos» son los puntos que espera que anoten los dos equipos juntos.',
    tip3: 'No es la probabilidad de ganar de arriba, que es la de tu enfrentamiento de fantasía, ni es una apuesta: no se muestran cuotas ni casas de apuestas.',
    tip4: 'La lectura del mercado se publica unos dos días antes del inicio, así que al principio de la semana la mayoría de los titulares aún no la tiene.',
    expected: (pts) => `${pts} pts esperados`,
    where: (home, opponent) => `${home ? 'vs' : 'en'} ${opponent}`,
    favored: (n) => `favorito por ${n}`,
    underdog: (n) => `no favorito por ${n}`,
    even: 'partido parejo',
    combined: (t) => `${t} entre ambos`,
    stale: 'Fuera de su ventana de actualización: vuelve a revisarla antes de cerrar tu alineación.',
    partial: (n) => `Aún no hay lectura del mercado para ${n} de tus titulares: se publica más cerca del inicio.`,
    empty: 'Aún no hay lectura del mercado: la anotación esperada de cada equipo se publica más cerca del inicio.',
    footer: 'Anotación por equipo implícita en el mercado. No es una apuesta ni tu probabilidad de ganar el enfrentamiento.',
    failed: 'El entorno de anotación no se cargó. Recarga la página para intentarlo de nuevo.',
  },
})
