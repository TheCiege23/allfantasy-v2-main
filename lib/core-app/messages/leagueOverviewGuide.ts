import { defineMessages } from '@/lib/i18n/messages'

/**
 * The league Overview guide (components/core-app/screens/LeagueHome.tsx, lib/core-app/leagueOverviewGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): no Spanish
 * value says «waiver»; the cut of an elimination league is «el corte».
 */
const ordEn = (n: number) => {
  const mod100 = n % 100
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}
const pts = (n: number) => n.toFixed(1)

export const leagueOverviewGuideMessages = defineMessages({
  en: {
    eyebrow: 'League overview',
    headChopped: (week: number | null) =>
      week != null ? `You were chopped in week ${week} — you’re out of this league` : 'You were chopped — you’re out of this league',
    headAlive: (rank: number, outOf: number, overCut: number | null) =>
      `${ordEn(rank)} of ${outOf} still alive · ${overCut != null ? `${pts(overCut)} points over the cut` : 'you’re at the cut line'}`,
    headAliveUnranked: (outOf: number | null) =>
      outOf != null ? `${outOf} teams still alive · no scores to rank yet this week` : 'Still alive · no scores to rank yet this week',
    headPreDraft: 'Before the draft',
    headH2h: (rank: number | null, teams: number | null, record: string, opponent: string | null) =>
      `${rank != null ? `${ordEn(rank)}${teams ? ` of ${teams}` : ''} · ` : ''}${record}${opponent ? ` · this week vs ${opponent}` : ''}`,
    intro: (platform: string, elimination: boolean) =>
      elimination
        ? `This league at a glance: where you stand against the cut, and the moves to make here. Official moves are made on ${platform}.`
        : `This league at a glance: where you stand, this week’s game, and the moves to make here. Official moves are made on ${platform}.`,
    chipWin: (pct: number, opponent: string) => `${pct}% to win vs ${opponent}`,
    chipPlaces: (n: number) => `${n} ${n === 1 ? 'place' : 'places'} clear of the cut`,
    chipToDo: (n: number) => `${n} ${n === 1 ? 'thing needs' : 'things need'} you`,
    why: 'Why it matters',
    whyH2h: 'Your record decides the playoff race, and this week’s game is the one result you can still move — set the lineup that gives you the best chance.',
    whyElim: 'Each week the lowest score goes home. A few places of cushion matters more than any one big week.',
    cutLabel: 'The cut',
    cutClear: (overCut: number) => `${pts(overCut)} points over the cut`,
    cutAt: 'You’re at the cut line',
    cutChopped: 'You’re out of this league',
    cutUnranked: 'No scores to rank yet',
    cutSub: 'Standings — who’s closest to the chop →',
    winSub: (week: number, pct: number) => `Week ${week} · ${pct}% to win →`,
    more: 'More about this league — history on file, season timeline, power board, buzz and rivalries',
  },
  es: {
    eyebrow: 'Resumen de la liga',
    headChopped: (week) => (week != null ? `Te eliminaron en la semana ${week}: quedaste fuera de esta liga` : 'Te eliminaron: quedaste fuera de esta liga'),
    headAlive: (rank, outOf, overCut) =>
      `${rank}.º de ${outOf} que siguen vivos · ${overCut != null ? `${pts(overCut)} puntos sobre el corte` : 'estás en la línea de corte'}`,
    headAliveUnranked: (outOf) =>
      outOf != null ? `${outOf} equipos siguen vivos · aún no hay puntos para clasificar esta semana` : 'Sigues vivo · aún no hay puntos para clasificar esta semana',
    headPreDraft: 'Antes del draft',
    headH2h: (rank, teams, record, opponent) =>
      `${rank != null ? `${rank}.º${teams ? ` de ${teams}` : ''} · ` : ''}${record}${opponent ? ` · esta semana contra ${opponent}` : ''}`,
    intro: (platform, elimination) =>
      elimination
        ? `Esta liga de un vistazo: dónde estás respecto al corte y qué movimientos hacer aquí. Los movimientos oficiales se hacen en ${platform}.`
        : `Esta liga de un vistazo: dónde estás, el partido de esta semana y qué movimientos hacer aquí. Los movimientos oficiales se hacen en ${platform}.`,
    chipWin: (pct, opponent) => `${pct}% de ganar contra ${opponent}`,
    chipPlaces: (n) => `${n} ${n === 1 ? 'puesto' : 'puestos'} por encima del corte`,
    chipToDo: (n) => `${n} ${n === 1 ? 'cosa te necesita' : 'cosas te necesitan'}`,
    why: 'Por qué importa',
    whyH2h: 'Tu récord decide la carrera por los playoffs, y el partido de esta semana es el único resultado que aún puedes mover: pon la alineación que te da más opciones.',
    whyElim: 'Cada semana se va la puntuación más baja. Unos puestos de margen valen más que una sola gran semana.',
    cutLabel: 'El corte',
    cutClear: (overCut) => `${pts(overCut)} puntos sobre el corte`,
    cutAt: 'Estás en la línea de corte',
    cutChopped: 'Quedaste fuera de esta liga',
    cutUnranked: 'Aún no hay puntos para clasificar',
    cutSub: 'Clasificación: quién está más cerca del corte →',
    winSub: (week, pct) => `Semana ${week} · ${pct}% de ganar →`,
    more: 'Más sobre esta liga: historial, calendario de la temporada, power board, actividad y rivalidades',
  },
})
