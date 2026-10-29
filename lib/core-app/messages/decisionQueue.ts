import { defineMessages } from '@/lib/i18n/messages'

/**
 * Top decisions (components/core-app/home/DecisionQueue.tsx). Every string is the one the card
 * printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 * (The new-tab note was JSX with `&rsquo;`; it is the same rendered character, ’, here.)
 */
export const decisionQueueMessages = defineMessages({
  en: {
    opensInNewTab: ' (opens the league’s platform in a new tab)',
    title: 'Top decisions',
    openCount: (total: number) => `${total} OPEN`,
    mostUrgentFirst: 'Most urgent first',
    nothingToDecide: 'Nothing to decide yet.',
    connectALeague: 'Connect a league and this fills with what needs you: empty slots, injured starters, drafts and trades.',
    nothingWaiting: 'Nothing is waiting on you.',
    emptyNone: 'No empty slots, injured starters, drafts or stale leagues',
    emptyInAnyLeague: ' in any league',
    emptyInYour: ' in your ',
    emptyWeCanRead: ' that we can read.',
    topUrgentLabel: (n: number) => `The ${n} most urgent`,
    now: 'NOW',
    inWhen: (when: string) => `IN ${when}`,
    showFewer: 'Show fewer',
    showMore: (n: number) => `Show ${n} more`,
    acrossYourLeagues: 'Across your leagues',
  },
  es: {
    opensInNewTab: ' (abre la plataforma de la liga en una pestaña nueva)',
    title: 'Decisiones principales',
    openCount: (total) => `${total} ${total === 1 ? 'ABIERTA' : 'ABIERTAS'}`,
    mostUrgentFirst: 'Lo más urgente primero',
    nothingToDecide: 'Todavía no hay nada que decidir.',
    connectALeague: 'Conecta una liga y esto se llena con lo que te necesita: puestos vacíos, titulares lesionados, drafts e intercambios.',
    nothingWaiting: 'Nada te está esperando.',
    emptyNone: 'Sin puestos vacíos, titulares lesionados, drafts ni ligas desactualizadas',
    emptyInAnyLeague: ' en ninguna liga',
    emptyInYour: ' en tus ',
    emptyWeCanRead: ' que podamos leer.',
    topUrgentLabel: (n) => `Las ${n} más urgentes`,
    now: 'AHORA',
    inWhen: (when) => `EN ${when}`,
    showFewer: 'Mostrar menos',
    showMore: (n) => `Mostrar ${n} más`,
    acrossYourLeagues: 'En todas tus ligas',
  },
})
