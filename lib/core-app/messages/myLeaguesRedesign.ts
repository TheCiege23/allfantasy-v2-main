import { defineMessages } from '@/lib/i18n/messages'

/**
 * The My Leagues header line restyled to the My Leagues board (2026-11-05): one mono eyebrow over
 * the title that sums the account — live leagues, sports, and how many need you. Every number comes
 * from the server's `counts` and the sport tabs, never from the designer's own account.
 */
export const myLeaguesRedesignMessages = defineMessages({
  en: {
    leagues: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`,
    sports: (n: number) => `${n} ${n === 1 ? 'sport' : 'sports'}`,
    needYou: (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} you`,
    commissioner: (n: number) => `${n} you run`,
  },
  es: {
    leagues: (n: number) => `${n} ${n === 1 ? 'liga' : 'ligas'}`,
    sports: (n: number) => `${n} ${n === 1 ? 'deporte' : 'deportes'}`,
    needYou: (n: number) => `${n} ${n === 1 ? 'te necesita' : 'te necesitan'}`,
    commissioner: (n: number) => `${n} que diriges`,
  },
})
