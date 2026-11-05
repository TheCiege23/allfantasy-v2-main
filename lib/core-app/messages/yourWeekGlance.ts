import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Your Week board's progress bar and glance tiles (components/core-app/YourWeekGlance.tsx,
 * 2026-11-05). Counts come from lib/core-app/yourWeekProgress.ts, never from the design's account.
 */
export const yourWeekGlanceMessages = defineMessages({
  en: {
    progress: (decided: number, total: number) => `${decided} of ${total} decided`,
    progressAria: 'Head-to-head games decided this week',
    glanceAria: 'This week at a glance',
    coinFlips: 'Coin flips',
    coinFlipsSub: 'Between 40% and 60%',
    live: 'Live now',
    liveSub: 'Points on the board',
    notStarted: 'Not started',
    notStartedSub: 'No points yet',
    decided: 'Decided',
    decidedSub: 'Both sides final',
  },
  es: {
    progress: (decided: number, total: number) => `${decided} de ${total} decididos`,
    progressAria: 'Partidos cara a cara decididos esta semana',
    glanceAria: 'Esta semana de un vistazo',
    coinFlips: 'Moneda al aire',
    coinFlipsSub: 'Entre 40% y 60%',
    live: 'En vivo',
    liveSub: 'Ya hay puntos',
    notStarted: 'Sin empezar',
    notStartedSub: 'Aún sin puntos',
    decided: 'Decididos',
    decidedSub: 'Ambos lados cerrados',
  },
})
