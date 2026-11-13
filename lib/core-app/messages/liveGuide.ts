import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core/live guide (components/core-app/live/LiveGuideHead.tsx, lib/live/liveGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
export const liveGuideMessages = defineMessages({
  en: {
    eyebrow: (sport: string, scoped: boolean) => `Live · ${sport}${scoped ? ' · this league' : ''}`,
    headLive: (n: number) => `${n} of your ${n === 1 ? 'starters is' : 'starters are'} playing right now`,
    headBetween: 'Nothing of yours is playing right now',
    headNoRoster: 'Live scores for your leagues',
    headRosterFailed: 'Live scores — we couldn’t read your rosters',
    intro:
      'Open this while games are on: see who’s scoring for you and which matchups could still flip. It only reads your leagues — it never changes them.',
    introNoRoster: 'Claim your team in a league and this page follows your starters game by game.',
    chipPlaying: 'Playing now',
    chipBehind: 'Matchups behind',
    chipClose: 'Close matchups',
    chipNext: 'Next kickoff',
    chipDone: 'Done today',
    why: 'Why it matters',

    glanceTitle: 'Matchups to watch',
    glanceSub: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'} · the ones that need a look first`,
    glanceTeach:
      'A matchup is decided by who still has players left to play. If you’re behind, check how many of your starters haven’t played yet before you worry.',

    slateMine: 'Your games today',
    slateMineSub: 'Games with your starters — live first, then the ones that touch the most leagues.',
    slateAll: 'All games today',
    slateAllSub: 'Every game, live first. Your players are highlighted where you have them.',
    slateLeague: 'This league’s games today',
    slateLeagueSub: 'Only games with your starters in this league, scored with its rules.',
    slateTeach:
      'Points here follow each league’s own scoring, so the same touchdown can be worth different amounts in different leagues.',

    upNextTitle: 'Up next',
    nextSportKickoff: (sport: string) => `Next ${sport} kickoff`,
    nextPlanLink: 'Fix lineups before kickoff →',
    playsLive: 'Live plays',
    playsToday: 'Plays from today’s games',
    playsMore: (n: number) => `Show ${n} more`,
    playsLess: 'Show fewer',
    lowDataHint: 'On a slow connection?',
  },
  es: {
    eyebrow: (sport: string, scoped: boolean) => `En vivo · ${sport}${scoped ? ' · esta liga' : ''}`,
    headLive: (n: number) => `${n} de tus ${n === 1 ? 'titulares está jugando' : 'titulares están jugando'} ahora mismo`,
    headBetween: 'Ninguno de tus jugadores está jugando ahora',
    headNoRoster: 'Marcadores en vivo de tus ligas',
    headRosterFailed: 'Marcadores en vivo — no pudimos leer tus plantillas',
    intro:
      'Ábrelo mientras hay partidos: mira quién suma para ti y qué enfrentamientos aún pueden cambiar. Solo lee tus ligas; nunca las modifica.',
    introNoRoster: 'Reclama tu equipo en una liga y esta página seguirá a tus titulares partido a partido.',
    chipPlaying: 'Jugando ahora',
    chipBehind: 'Enfrentamientos abajo',
    chipClose: 'Enfrentamientos parejos',
    chipNext: 'Próximo inicio',
    chipDone: 'Terminados hoy',
    why: 'Por qué importa',

    glanceTitle: 'Enfrentamientos a vigilar',
    glanceSub: (n: number) => `${n} ${n === 1 ? 'liga' : 'ligas'} · primero las que necesitan atención`,
    glanceTeach:
      'Un enfrentamiento lo decide quién todavía tiene jugadores por jugar. Si vas abajo, mira cuántos de tus titulares aún no han jugado antes de preocuparte.',

    slateMine: 'Tus partidos de hoy',
    slateMineSub: 'Partidos con tus titulares: primero los en vivo, luego los que afectan a más ligas.',
    slateAll: 'Todos los partidos de hoy',
    slateAllSub: 'Todos los partidos, primero los en vivo. Tus jugadores aparecen resaltados.',
    slateLeague: 'Partidos de esta liga hoy',
    slateLeagueSub: 'Solo partidos con tus titulares en esta liga, con sus reglas de puntuación.',
    slateTeach:
      'Los puntos siguen la puntuación de cada liga, así que el mismo touchdown puede valer distinto en ligas distintas.',

    upNextTitle: 'Lo próximo',
    nextSportKickoff: (sport: string) => `Próximo inicio de ${sport}`,
    nextPlanLink: 'Corrige alineaciones antes del inicio →',
    playsLive: 'Jugadas en vivo',
    playsToday: 'Jugadas de los partidos de hoy',
    playsMore: (n: number) => `Mostrar ${n} más`,
    playsLess: 'Mostrar menos',
    lowDataHint: '¿Conexión lenta?',
  },
})
