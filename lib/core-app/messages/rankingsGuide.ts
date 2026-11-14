import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core/rankings guide (2026-11-14): the headline per tab, the movement line, the "you" row's buttons,
 * the folded filters, and the one line under the community board with its "How this board is scored"
 * fold (lib/core-app/rankingsGuide.ts, components/core-app/rankings/RankingsHero.tsx and RankingsGuide.tsx).
 * Numbers arrive formatted, so a Spanish reader gets the same digits the board shows.
 */
const signed = (n: number) => `${n > 0 ? 'up' : 'down'} ${Math.abs(n)}`
const signedEs = (n: number) => `${n > 0 ? 'subes' : 'bajas'} ${Math.abs(n)}`

export const rankingsGuideMessages = defineMessages({
  en: {
    eyebrow: 'Rankings',
    /** `board` is null on Overall, which is the community board itself. */
    headBoard: (rank: number, of: number, board: string | null) =>
      board ? `You’re #${rank} of ${of} on the ${board} board` : `You’re #${rank} of ${of} in the community`,
    headTop: (of: number, board: string | null) =>
      board ? `You’re #1 of ${of} on the ${board} board` : `You’re #1 of ${of} in the community`,
    headBehind: (rank: number, of: number, gap: string, handle: string) => `You’re #${rank} of ${of} — ${gap} behind @${handle}`,
    headNotRanked: (min: number) => `You’re not on this board yet — it needs ${min}+ league-seasons with results`,
    headPortfolio: (score: string, rank: number | null, of: number | null) =>
      rank != null && of != null ? `Your manager score is ${score} — #${rank} of ${of} in the community` : `Your manager score is ${score}`,
    headPortfolioEmpty: 'Your imports have no scored seasons yet',
    headLeague: (rank: number, of: number, league: string) => `You’re #${rank} of ${of} in ${league}`,
    headLeaguePick: 'Pick a league to see its standings',
    headClass: (division: number, rating: string) => `You’re in Division ${division} — Class rating ${rating}`,
    headClassProvisional: (games: number) => `Your Class rating is still settling — ${games} ${games === 1 ? 'game' : 'games'} so far`,
    headAboutGlobal: 'Every ranked AllFantasy manager, on one board',
    headAboutPortfolio: 'Your score across everything you’ve imported',
    headAboutLeague: 'One league’s standings',
    headAboutClass: 'Your weight class, rated every week',

    introGlobal: 'How you compare with every ranked AllFantasy manager. Press Why on any row to see how a rank was worked out.',
    introPortfolio: 'Your AF manager score across all your imports, and the seasons behind it.',
    introLeague: 'One league’s standings, with power scores where they’ve been run.',
    introClass: 'Your weight class, rated every week from your head-to-head results.',

    /** "up 1 this week" / "down 13 since last season" — joined with " · ". */
    moveWeek: (n: number) => `${signed(n)} this week`,
    moveSevenDay: (n: number) => `${signed(n)} in 7 days`,
    moveSeason: (n: number) => `${signed(n)} since last season`,
    movementAria: 'How your place has moved',
    whyRank: 'Why this rank?',
    askChimmy: 'Ask Chimmy',

    filters: 'Filters',
    filtersAll: 'All leagues',

    boardLine: (shown: number, population: number) => `${shown} of ${population} ${population === 1 ? 'manager' : 'managers'} ranked`,
    boardBelow: (n: number, min: number) => `${n} more ${n === 1 ? 'needs' : 'need'} ${min} league-seasons`,
    boardUpdated: (when: string) => `updated ${when}`,
    howScored: 'How this board is scored',
  },
  es: {
    eyebrow: 'Clasificaciones',
    headBoard: (rank, of, board) =>
      board ? `Eres #${rank} de ${of} en la tabla de ${board}` : `Eres #${rank} de ${of} en la comunidad`,
    headTop: (of, board) => (board ? `Eres #1 de ${of} en la tabla de ${board}` : `Eres #1 de ${of} en la comunidad`),
    headBehind: (rank, of, gap, handle) => `Eres #${rank} de ${of}: a ${gap} de @${handle}`,
    headNotRanked: (min) => `Aún no estás en esta tabla: necesita ${min}+ temporadas de liga con resultados`,
    headPortfolio: (score, rank, of) =>
      rank != null && of != null ? `Tu puntuación de mánager es ${score}: #${rank} de ${of} en la comunidad` : `Tu puntuación de mánager es ${score}`,
    headPortfolioEmpty: 'Tus importaciones aún no tienen temporadas puntuadas',
    headLeague: (rank, of, league) => `Eres #${rank} de ${of} en ${league}`,
    headLeaguePick: 'Elige una liga para ver su clasificación',
    headClass: (division, rating) => `Estás en la División ${division}: rating de Clase ${rating}`,
    headClassProvisional: (games) => `Tu rating de Clase aún se está asentando: ${games} ${games === 1 ? 'partido' : 'partidos'} hasta ahora`,
    headAboutGlobal: 'Todos los mánagers clasificados de AllFantasy, en una tabla',
    headAboutPortfolio: 'Tu puntuación en todo lo que has importado',
    headAboutLeague: 'La clasificación de una liga',
    headAboutClass: 'Tu categoría de peso, calificada cada semana',

    introGlobal: 'Cómo te comparas con todos los mánagers clasificados de AllFantasy. Pulsa Por qué en cualquier fila para ver cómo se calculó un puesto.',
    introPortfolio: 'Tu puntuación de mánager en todas tus importaciones, y las temporadas que la forman.',
    introLeague: 'La clasificación de una liga, con puntuaciones de poder donde se hayan calculado.',
    introClass: 'Tu categoría de peso, calificada cada semana con tus resultados cara a cara.',

    moveWeek: (n) => `${signedEs(n)} ${Math.abs(n) === 1 ? 'puesto' : 'puestos'} esta semana`,
    moveSevenDay: (n) => `${signedEs(n)} ${Math.abs(n) === 1 ? 'puesto' : 'puestos'} en 7 días`,
    moveSeason: (n) => `${signedEs(n)} ${Math.abs(n) === 1 ? 'puesto' : 'puestos'} desde la temporada pasada`,
    movementAria: 'Cómo ha cambiado tu puesto',
    whyRank: '¿Por qué este puesto?',
    askChimmy: 'Pregunta a Chimmy',

    filters: 'Filtros',
    filtersAll: 'Todas las ligas',

    boardLine: (shown, population) => `${shown} de ${population} ${population === 1 ? 'mánager clasificado' : 'mánagers clasificados'}`,
    boardBelow: (n, min) => `${n} más ${n === 1 ? 'necesita' : 'necesitan'} ${min} temporadas de liga`,
    boardUpdated: (when) => `actualizado ${when}`,
    howScored: 'Cómo se puntúa esta tabla',
  },
})
