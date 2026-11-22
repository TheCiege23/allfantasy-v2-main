import { defineMessages } from '@/lib/i18n/messages'

/**
 * Draft lottery page (components/draft/LotteryDraw.tsx): odds, the pick-by-pick reveal, the final
 * order and the commissioner's lock-in.
 * Spanish is complete: `__tests__/core-app/message-catalogs-complete.test.ts` fails on a missing key.
 */

function enOrdinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

export const draftLotteryMessages = defineMessages({
  en: {
    eyebrow: (league: string): string => `Draft lottery · ${league}`,
    eyebrowNoLeague: 'Draft lottery',
    title: 'Who picks first?',
    rulesDrawn: (teams: number, picks: number): string =>
      picks <= 1
        ? `These ${teams} teams are drawn for the No. 1 pick, and worse records get better odds.`
        : `These ${teams} teams are drawn for picks 1–${picks}, and worse records get better odds.`,
    rulesRest: (from: number, to: number): string => (from === to ? `Pick ${from} follows the standings.` : `Picks ${from}–${to} follow the standings.`),
    oddsAria: 'Lottery odds',
    colRank: 'Rank',
    colTeam: 'Team',
    colRecord: 'Record',
    colOdds: 'Odds of the No. 1 pick',
    rank: (n: number): string => enOrdinal(n),
    ordinal: (n: number): string => enOrdinal(n),
    you: 'you',

    commissioner: 'Commissioner',
    runTitle: 'Run the lottery',
    revealLegend: 'How should the results appear?',
    revealOneByOne: 'One pick at a time, last to first',
    revealAll: 'The whole order at once',
    runButton: 'Run the lottery',
    running: 'Drawing…',
    notFinal: 'Nothing is final until you lock the order in.',
    runFailed: 'Couldn’t run the lottery. Try again.',
    waitingTitle: 'Waiting for the commissioner',
    waitingBody: 'The draft order appears here once the commissioner runs the lottery and locks it in.',

    revealAria: 'Lottery reveal',
    pickLabel: (n: number): string => `PICK ${n}`,
    movedUp: (by: number, from: number): string => `Record had them at pick ${from} · up ${by}`,
    movedDown: (by: number, from: number): string => `Record had them at pick ${from} · down ${by}`,
    asProjected: 'Right where their record had them',
    hadOdds: (record: string, odds: string): string => `${record ? `${record} · ` : ''}had ${odds} odds of the No. 1 pick`,
    revealNext: (n: number): string => `Reveal pick ${n}`,
    showOrder: 'See the full order',
    pace: 'You control the pace, which works well screen-shared on a league call.',
    stillInTitle: (from: number, to: number): string => (from === to ? `Still in for pick ${from}` : `Still in for picks ${from}–${to}`),
    youGuaranteed: (n: number): string => (n === 1 ? 'You’re getting the No. 1 pick.' : `You’re guaranteed a top-${n} pick.`),
    revealed: 'Revealed',
    shortUp: (by: number): string => `↑ ${by}`,
    shortDown: (by: number): string => `↓ ${by}`,

    orderTitle: 'The draft order',
    orderBody: 'Each lottery team shows where its record had it against where it landed.',
    orderAria: 'Draft order',
    byStandings: 'By standings',
    moveUpLong: (by: number, from: string): string => `↑ ${by} · from ${from}`,
    moveDownLong: (by: number, from: string): string => `↓ ${by} · from ${from}`,
    asProjectedShort: 'as projected',
    youGot: (n: number): string => `You got the No. ${n} pick`,
    youUp: (from: string, odds: string | null): string => `Up from ${from}${odds ? `, on ${odds} odds` : ''}.`,
    youDown: (from: string): string => `Down from ${from}.`,
    youSame: 'Right where your record had you.',
    youStandings: (n: string): string => `You pick ${n}, by the standings.`,

    lockTitle: 'Lock in this order',
    lockBody: 'This sets the draft order for everyone. Members see it once it’s locked.',
    lockButton: 'Lock in this order',
    locking: 'Locking in…',
    lockFailed: 'Couldn’t lock the order in. Try again.',
    audit: (time: string, seed: string): string => `Drawn ${time} · audit seed ${seed}`,
    lockedTitle: 'Order locked in',
    lockedBody: 'This is the draft order for everyone.',
    openBoard: 'Open the draft board',

    loading: 'Loading the lottery…',
    loadFailed: 'Couldn’t load the lottery. Refresh to try again.',
    noTeams: 'No teams are eligible for the lottery yet. Check the lottery settings.',
  },
  es: {
    eyebrow: (league: string): string => `Lotería del draft · ${league}`,
    eyebrowNoLeague: 'Lotería del draft',
    title: '¿Quién elige primero?',
    rulesDrawn: (teams: number, picks: number): string =>
      picks <= 1
        ? `Estos ${teams} equipos se sortean la primera selección, y los peores récords tienen más probabilidades.`
        : `Estos ${teams} equipos se sortean las selecciones 1–${picks}, y los peores récords tienen más probabilidades.`,
    rulesRest: (from: number, to: number): string =>
      from === to ? `La selección ${from} sigue la clasificación.` : `Las selecciones ${from}–${to} siguen la clasificación.`,
    oddsAria: 'Probabilidades de la lotería',
    colRank: 'Puesto',
    colTeam: 'Equipo',
    colRecord: 'Récord',
    colOdds: 'Probabilidad de la 1.ª selección',
    rank: (n: number): string => `${n}.º`,
    ordinal: (n: number): string => `${n}.º`,
    you: 'tú',

    commissioner: 'Comisionado',
    runTitle: 'Realiza la lotería',
    revealLegend: '¿Cómo deben aparecer los resultados?',
    revealOneByOne: 'Una selección a la vez, de la última a la primera',
    revealAll: 'Todo el orden de una vez',
    runButton: 'Realizar la lotería',
    running: 'Sorteando…',
    notFinal: 'Nada es definitivo hasta que fijes el orden.',
    runFailed: 'No se pudo realizar la lotería. Inténtalo de nuevo.',
    waitingTitle: 'Esperando al comisionado',
    waitingBody: 'El orden del draft aparecerá aquí cuando el comisionado realice la lotería y lo fije.',

    revealAria: 'Revelación de la lotería',
    pickLabel: (n: number): string => `SELECCIÓN ${n}`,
    movedUp: (by: number, from: number): string => `Su récord lo ponía en la ${from} · sube ${by}`,
    movedDown: (by: number, from: number): string => `Su récord lo ponía en la ${from} · baja ${by}`,
    asProjected: 'Justo donde lo ponía su récord',
    hadOdds: (record: string, odds: string): string => `${record ? `${record} · ` : ''}tenía ${odds} de probabilidad de la 1.ª selección`,
    revealNext: (n: number): string => `Revelar la selección ${n}`,
    showOrder: 'Ver el orden completo',
    pace: 'Tú marcas el ritmo; funciona bien compartiendo pantalla en una llamada de la liga.',
    stillInTitle: (from: number, to: number): string => (from === to ? `Aún en juego por la selección ${from}` : `Aún en juego por las selecciones ${from}–${to}`),
    youGuaranteed: (n: number): string => (n === 1 ? 'Te llevas la primera selección.' : `Tienes asegurada una selección entre las ${n} primeras.`),
    revealed: 'Reveladas',
    shortUp: (by: number): string => `↑ ${by}`,
    shortDown: (by: number): string => `↓ ${by}`,

    orderTitle: 'El orden del draft',
    orderBody: 'Cada equipo de la lotería muestra dónde lo ponía su récord y dónde quedó.',
    orderAria: 'Orden del draft',
    byStandings: 'Por clasificación',
    moveUpLong: (by: number, from: string): string => `↑ ${by} · desde ${from}`,
    moveDownLong: (by: number, from: string): string => `↓ ${by} · desde ${from}`,
    asProjectedShort: 'según lo previsto',
    youGot: (n: number): string => `Te tocó la selección ${n}`,
    youUp: (from: string, odds: string | null): string => `Subiste desde ${from}${odds ? `, con ${odds} de probabilidad` : ''}.`,
    youDown: (from: string): string => `Bajaste desde ${from}.`,
    youSame: 'Justo donde te ponía tu récord.',
    youStandings: (n: string): string => `Eliges ${n}, por la clasificación.`,

    lockTitle: 'Fija este orden',
    lockBody: 'Esto fija el orden del draft para todos. Los miembros lo verán cuando esté fijado.',
    lockButton: 'Fijar este orden',
    locking: 'Fijando…',
    lockFailed: 'No se pudo fijar el orden. Inténtalo de nuevo.',
    audit: (time: string, seed: string): string => `Sorteado ${time} · semilla de auditoría ${seed}`,
    lockedTitle: 'Orden fijado',
    lockedBody: 'Este es el orden del draft para todos.',
    openBoard: 'Abrir el tablero del draft',

    loading: 'Cargando la lotería…',
    loadFailed: 'No se pudo cargar la lotería. Actualiza para intentarlo de nuevo.',
    noTeams: 'Todavía no hay equipos elegibles para la lotería. Revisa la configuración de la lotería.',
  },
})
