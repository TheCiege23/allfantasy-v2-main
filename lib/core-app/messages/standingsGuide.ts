import { defineMessages } from '@/lib/i18n/messages'
import { ordinalEn } from '@/lib/core-app/standingsGuide'

/**
 * The Standings guide (components/core-app/screens/Standings.tsx, lib/core-app/standingsGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
const oddsEn = (p: number | null) => (p == null ? '' : ` · ${p}% playoff odds`)
const oddsEs = (p: number | null) => (p == null ? '' : ` · ${p}% de llegar a playoffs`)

export const standingsGuideMessages = defineMessages({
  en: {
    eyebrow: (league: string) => `Standings · ${league}`,
    headUnknown: 'League standings',
    headPlace: (seed: number, of: number) => `${ordinalEn(seed)} of ${of}`,
    headClinched: (seed: number, of: number, bye: boolean) =>
      `${ordinalEn(seed)} of ${of} · clinched a playoff ${bye ? 'bye' : 'spot'}`,
    headEliminated: (seed: number, of: number) => `${ordinalEn(seed)} of ${of} · out of the playoff race`,
    headIn: (seed: number, of: number, odds: number | null, bubble = false) =>
      `${ordinalEn(seed)} of ${of} · ${bubble ? 'in a playoff spot, on the bubble' : 'in a playoff spot'}${oddsEn(odds)}`,
    headOut: (seed: number, of: number, gb: number | null, odds: number | null, bubble = false) =>
      `${ordinalEn(seed)} of ${of} · ${gb != null && gb > 0 ? `${gb} ${gb === 1 ? 'game' : 'games'} out of a playoff spot` : bubble ? 'just outside the playoff spots' : 'outside the playoff spots'}${oddsEn(odds)}`,
    /*
     * Says how THIS league is ordered (record vs points), which the old subtitle carried and pinned tests
     * protect: a points-only league has no playoff race to root for, so it is not promised one.
     */
    intro: (p: { headToHead: boolean; seasonComplete: boolean; week: number; throughWeek: number | null }) =>
      `${p.headToHead
        ? 'See where you stand, what it takes to make the playoffs, and whose games to root for this week. Your record decides the seeding.'
        : 'See where you stand and how far you are from the next spot. In this league points decide the order — there are no head-to-head records.'}${p.seasonComplete ? ` Season complete after week ${p.week}.` : p.throughWeek != null ? ` Results through week ${p.throughWeek}.` : ''}`,
    ifTheyWin: 'if they win',
    ifNot: 'if not',
    why: 'Why it matters',
    stakesTeach:
      'Your own result moves your odds the most, but other games matter too. Rooting for the right teams is how a 50/50 race becomes a sure thing.',
    deeperBoard: 'How the table got here — tiebreakers, head to head, and the season by week',
    deeperSeason: 'Your season so far — place by week, recent scores, projected points and this week’s lineups',
  },
  es: {
    eyebrow: (league: string) => `Clasificación · ${league}`,
    headUnknown: 'Clasificación de la liga',
    headPlace: (seed: number, of: number) => `${seed}.º de ${of}`,
    headClinched: (seed: number, of: number, bye: boolean) => `${seed}.º de ${of} · ${bye ? 'descanso asegurado en playoffs' : 'lugar asegurado en playoffs'}`,
    headEliminated: (seed: number, of: number) => `${seed}.º de ${of} · fuera de la carrera por playoffs`,
    headIn: (seed: number, of: number, odds: number | null, bubble = false) =>
      `${seed}.º de ${of} · ${bubble ? 'en zona de playoffs, en la cuerda floja' : 'en zona de playoffs'}${oddsEs(odds)}`,
    headOut: (seed: number, of: number, gb: number | null, odds: number | null, bubble = false) =>
      `${seed}.º de ${of} · ${gb != null && gb > 0 ? `a ${gb} ${gb === 1 ? 'partido' : 'partidos'} de un lugar en playoffs` : bubble ? 'justo fuera de los lugares de playoffs' : 'fuera de los lugares de playoffs'}${oddsEs(odds)}`,
    intro: (p: { headToHead: boolean; seasonComplete: boolean; week: number; throughWeek: number | null }) =>
      `${p.headToHead
        ? 'Mira dónde estás, qué te falta para llegar a playoffs y a quién apoyar esta semana. Tu récord determina los puestos de playoffs.'
        : 'Mira dónde estás y cuánto te falta para el siguiente puesto. En esta liga los puntos determinan el orden: no hay récords de enfrentamientos directos.'}${p.seasonComplete ? ` Temporada terminada tras la semana ${p.week}.` : p.throughWeek != null ? ` Resultados hasta la semana ${p.throughWeek}.` : ''}`,
    ifTheyWin: 'si ganan',
    ifNot: 'si no',
    why: 'Por qué importa',
    stakesTeach:
      'Tu propio resultado es lo que más mueve tus probabilidades, pero otros partidos también cuentan. Apoyar a los equipos correctos convierte una carrera pareja en algo seguro.',
    deeperBoard: 'Cómo se armó la tabla: desempates, enfrentamientos directos y la temporada por semana',
    deeperSeason: 'Tu temporada hasta ahora: puesto por semana, puntos recientes, puntos proyectados y alineaciones de esta semana',
  },
})
