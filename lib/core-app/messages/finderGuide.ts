import { defineMessages } from '@/lib/i18n/messages'
import type { LeagueCount } from '@/lib/core-app/finderGuide'

/**
 * The Player Finder guide (2026-11-13): what the page is for, in the words a manager uses on game day.
 * components/core-app/screens/PlayerFinder.tsx, lib/core-app/finderGuide.ts.
 */
const leaguesEn = (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`
const leaguesEs = (n: number) => `${n} ${n === 1 ? 'liga' : 'ligas'}`

export const finderGuideMessages = defineMessages({
  en: {
    homeTitle: 'Find any player across all your leagues',
    homeSub:
      'Got an injury or questionable alert? Tap it and the player opens here. Or search by name or team — "Josh Allen", "Bills", "BUF" — to see every league and platform he is on, and whether he is starting.',
    countYours: (c: LeagueCount) =>
      `In ${c.yours} of your ${leaguesEn(c.of)}${c.starting > 0 ? ` · starting in ${c.starting}` : ''}${c.benched > 0 ? ` · not starting in ${c.benched}` : ''}`,
    countNone: (of: number) => (of === 1 ? 'Not on your team in your one league' : `Not on your team in any of your ${leaguesEn(of)}`),
    countOthers: (n: number) => ` · on someone else's team in ${n}`,
    countOn: (platforms: string) => ` · on ${platforms}`,
    yoursTag: (n: number) => `yours · ${leaguesEn(n)}`,
    listToggle: 'Show or hide every league',
    readWhy: 'How many of your lineups this checked',
  },
  es: {
    homeTitle: 'Encuentra cualquier jugador en todas tus ligas',
    homeSub:
      '¿Te llegó una alerta de lesión o de duda? Tócala y el jugador se abre aquí. O busca por nombre o por equipo —"Josh Allen", "Bills", "BUF"— para ver cada liga y plataforma donde lo tienes, y si es titular.',
    countYours: (c: LeagueCount) =>
      `En ${c.yours} de tus ${leaguesEs(c.of)}${c.starting > 0 ? ` · titular en ${c.starting}` : ''}${c.benched > 0 ? ` · no es titular en ${c.benched}` : ''}`,
    countNone: (of: number) => (of === 1 ? 'No está en tu equipo en tu única liga' : `No está en tu equipo en ninguna de tus ${leaguesEs(of)}`),
    countOthers: (n: number) => ` · en el equipo de otro en ${n}`,
    countOn: (platforms: string) => ` · en ${platforms}`,
    yoursTag: (n: number) => `tuyo · ${leaguesEs(n)}`,
    listToggle: 'Mostrar u ocultar todas las ligas',
    readWhy: 'Cuántas de tus alineaciones se revisaron',
  },
})
