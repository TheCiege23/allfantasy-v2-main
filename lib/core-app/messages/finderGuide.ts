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
    /** The fallback headline, when no game-day read is on the page (signed out, or the read failed). */
    homeTitle: 'Find any player across all your leagues',
    /**
     * 2026-11-14: the headline answers. The first thing on the home is your flagged starters, so the h2
     * says how many — "Find any player across all your leagues" said what the page could do, not what to do.
     */
    homeFlagged: (n: number) => (n === 1 ? '1 of your starters may not play this week' : `${n} of your starters may not play this week`),
    homeClear: 'None of your starters is flagged this week',
    homeSub: 'Search any player by name or team to see every league he’s in.',
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
    homeFlagged: (n) => (n === 1 ? '1 de tus titulares podría no jugar esta semana' : `${n} de tus titulares podrían no jugar esta semana`),
    homeClear: 'Ninguno de tus titulares está en duda esta semana',
    homeSub: 'Busca cualquier jugador por nombre o por equipo para ver todas las ligas donde está.',
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
