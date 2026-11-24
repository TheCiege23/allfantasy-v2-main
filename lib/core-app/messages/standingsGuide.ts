import { defineMessages } from '@/lib/i18n/messages'
import { ordinalEn } from '@/lib/core-app/standingsGuide'

/**
 * The Standings guide (components/core-app/screens/Standings.tsx, lib/core-app/standingsGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
/*
 * 2026-11-14: the headline no longer carries the playoff odds. It printed them rounded ("0%") while the
 * "What is at stake" box right under it printed the same number formatted ("<1%"), so one fact read two
 * ways. The odds now appear once, in that box. `odds` stays in the signatures so callers need not change.
 */

export const standingsGuideMessages = defineMessages({
  en: {
    eyebrow: (league: string) => `Standings · ${league}`,
    headUnknown: 'League standings',
    headPlace: (seed: number, of: number) => `You’re ${ordinalEn(seed)} of ${of}`,
    headClinched: (seed: number, of: number, bye: boolean) =>
      `You’re ${ordinalEn(seed)} of ${of} and have clinched a playoff ${bye ? 'bye' : 'spot'}`,
    headEliminated: (seed: number, of: number) => `You’re ${ordinalEn(seed)} of ${of}, out of the playoff race`,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    headIn: (seed: number, of: number, _odds: number | null, bubble = false) =>
      `You’re ${ordinalEn(seed)} of ${of}, ${bubble ? 'in a playoff spot but on the bubble' : 'in a playoff spot'}`,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    headOut: (seed: number, of: number, gb: number | null, _odds: number | null, bubble = false) =>
      `You’re ${ordinalEn(seed)} of ${of}, ${gb != null && gb > 0 ? `${gb} ${gb === 1 ? 'game' : 'games'} out of the playoffs` : bubble ? 'just outside the playoffs' : 'outside the playoffs'}`,
    /*
     * Says how THIS league is ordered (record vs points), which the old subtitle carried and pinned tests
     * protect: a points-only league has no playoff race to root for, so it is not promised one.
     */
    intro: (p: { headToHead: boolean; seasonComplete: boolean; week: number; throughWeek: number | null }) =>
      `${p.headToHead
        ? 'Your record decides the seeding.'
        : 'In this league, points decide the order — there are no head-to-head records.'}${p.seasonComplete ? ` Season complete after week ${p.week}.` : p.throughWeek != null ? ` Results through week ${p.throughWeek}.` : ''}`,
    ifTheyWin: 'if they win',
    ifNot: 'if not',
    why: 'Why it matters',
    stakesTeach:
      'Your own result moves your odds the most, but other games matter too. Rooting for the right teams is how a 50/50 race becomes a sure thing.',
    deeperBoard: 'How the table got here — tiebreakers, head to head, and the season by week',
    deeperSeason: 'Your season so far — place by week, recent scores, projected points and this week’s lineups',
    recordBook: (seasons: number) => `Franchise record book (${seasons} ${seasons === 1 ? 'season' : 'seasons'})`,
    allPlay: (record: string) => `If you played everyone each week: ${record}`,
    moreColumns: 'More columns',
    fewerColumns: 'Fewer columns',
    moreViews: 'More views',
    backToTable: 'Back to the league table',
    ifScoresHeld: 'If scores held',
    pendingShort: (weeks: string, through: number) => `Week ${weeks} is still being played, so the table counts results through week ${through}.`,
    pendingLiveHint: 'Turn on “If scores held” to count it now.',
    keyPlayoffs: (n: number) => `Playoffs (top ${n})`,
    keyBye: (n: number) => `Bye (top ${n})`,
    keyBubble: 'Bubble',
    keyOut: 'Out',
    keyClinched: 'Clinched',
  },
  es: {
    eyebrow: (league: string) => `Clasificación · ${league}`,
    headUnknown: 'Clasificación de la liga',
    headPlace: (seed: number, of: number) => `Vas ${seed}.º de ${of}`,
    headClinched: (seed: number, of: number, bye: boolean) => `Vas ${seed}.º de ${of} y tienes ${bye ? 'el descanso asegurado en playoffs' : 'lugar asegurado en playoffs'}`,
    headEliminated: (seed: number, of: number) => `Vas ${seed}.º de ${of}, fuera de la carrera por playoffs`,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    headIn: (seed: number, of: number, _odds: number | null, bubble = false) =>
      `Vas ${seed}.º de ${of}, ${bubble ? 'en zona de playoffs pero en la cuerda floja' : 'en zona de playoffs'}`,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    headOut: (seed: number, of: number, gb: number | null, _odds: number | null, bubble = false) =>
      `Vas ${seed}.º de ${of}, ${gb != null && gb > 0 ? `a ${gb} ${gb === 1 ? 'partido' : 'partidos'} de los playoffs` : bubble ? 'justo fuera de los playoffs' : 'fuera de los playoffs'}`,
    intro: (p: { headToHead: boolean; seasonComplete: boolean; week: number; throughWeek: number | null }) =>
      `${p.headToHead
        ? 'Tu récord determina los puestos de playoffs.'
        : 'En esta liga los puntos determinan el orden: no hay récords de enfrentamientos directos.'}${p.seasonComplete ? ` Temporada terminada tras la semana ${p.week}.` : p.throughWeek != null ? ` Resultados hasta la semana ${p.throughWeek}.` : ''}`,
    ifTheyWin: 'si ganan',
    ifNot: 'si no',
    why: 'Por qué importa',
    stakesTeach:
      'Tu propio resultado es lo que más mueve tus probabilidades, pero otros partidos también cuentan. Apoyar a los equipos correctos convierte una carrera pareja en algo seguro.',
    deeperBoard: 'Cómo se armó la tabla: desempates, enfrentamientos directos y la temporada por semana',
    deeperSeason: 'Tu temporada hasta ahora: puesto por semana, puntos recientes, puntos proyectados y alineaciones de esta semana',
    recordBook: (seasons: number) => `Libro de récords de la franquicia (${seasons} ${seasons === 1 ? 'temporada' : 'temporadas'})`,
    allPlay: (record: string) => `Si jugaras contra todos cada semana: ${record}`,
    moreColumns: 'Más columnas',
    fewerColumns: 'Menos columnas',
    moreViews: 'Más vistas',
    backToTable: 'Volver a la tabla de la liga',
    ifScoresHeld: 'Si los puntos se mantienen',
    pendingShort: (weeks: string, through: number) => `La semana ${weeks} aún se está jugando, así que la tabla cuenta resultados hasta la semana ${through}.`,
    pendingLiveHint: 'Activa «Si los puntos se mantienen» para contarla ya.',
    keyPlayoffs: (n: number) => `Playoffs (top ${n})`,
    keyBye: (n: number) => `Descanso (top ${n})`,
    keyBubble: 'En la cuerda floja',
    keyOut: 'Fuera',
    keyClinched: 'Asegurado',
  },
})
