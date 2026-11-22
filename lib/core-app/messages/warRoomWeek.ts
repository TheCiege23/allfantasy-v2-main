import { defineMessages } from '@/lib/i18n/messages'

/**
 * War Room week strip (components/core-app/screens/WarRoomWeek.tsx). Every string is the one the
 * screen printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 */
export const warRoomWeekMessages = defineMessages({
  en: {
    chopped: 'You were chopped',
    noHeadToHead: 'No head-to-head this week',
    eliminationWeek: 'Elimination week · ',
    of: 'of',
    atTheCut: ' · at the cut',
    overTheCut: (pts: string) => ` · ${pts} over the cut`,
    projected: ' (projected)',
    notStarted: 'Not started',
    level: 'level',
    aheadBy: (pts: string) => `ahead by ${pts}`,
    behindBy: (pts: string) => `behind by ${pts}`,
    lastImport: ' · last import',
    heading: (week: number) => `Week ${week} across your leagues`,
    matchups: (n: number): string => (n === 1 ? 'matchup' : 'matchups'),
    aheadBehind: (ahead: number, behind: number) => ` · ahead in ${ahead}, behind in ${behind}`,
    onAnotherWeek: (n: number) => ` · ${n} on another week`,
    week: 'week',
    yourTeam: 'Your team',
    you: 'You',
    unnamedTeam: 'an unnamed team',
    boardLink: 'Every matchup, ranked by win probability',
  },
  es: {
    chopped: 'Te eliminaron',
    noHeadToHead: 'Sin enfrentamiento directo esta semana',
    eliminationWeek: 'Semana de eliminación · ',
    of: 'de',
    atTheCut: ' · en el corte',
    overTheCut: (pts) => ` · ${pts} por encima del corte`,
    projected: ' (proyectado)',
    notStarted: 'Sin empezar',
    level: 'empatados',
    aheadBy: (pts) => `ganando por ${pts}`,
    behindBy: (pts) => `perdiendo por ${pts}`,
    lastImport: ' · última importación',
    heading: (week) => `Semana ${week} en tus ligas`,
    matchups: (n) => (n === 1 ? 'enfrentamiento' : 'enfrentamientos'),
    aheadBehind: (ahead, behind) => ` · ganando en ${ahead}, perdiendo en ${behind}`,
    onAnotherWeek: (n) => ` · ${n} en otra semana`,
    week: 'semana',
    yourTeam: 'Tu equipo',
    you: 'Tú',
    unnamedTeam: 'un equipo sin nombre',
    boardLink: 'Todos los enfrentamientos, por probabilidad de ganar',
  },
})
