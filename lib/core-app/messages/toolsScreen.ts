import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Tools launcher's redesign chrome (components/core-app/screens/Tools.tsx, from the Tools
 * board 2026-11-05): the eyebrow, the plan chip, the Chimmy card, the plan filter and each card's
 * plan badge and action. Group headings, card titles and descriptions still come from the loader
 * through coreUiCopy, unchanged.
 */
export const toolsScreenMessages = defineMessages({
  en: {
    eyebrow: 'All your leagues · Your tools',
    planChip: (planName: string) => `Your plan · ${planName}`,
    planFree: 'Free',
    chimmyTitle: 'Chimmy, your AF assistant',
    chimmyBody: 'Ask in plain words: who to start, whether an offer is fair, what to bid on a pickup.',
    askChimmy: 'Ask Chimmy',
    filterAria: 'Filter tools',
    filterAll: 'All tools',
    filterIncluded: 'Included in your plan',
    filterUpgrade: 'Needs an upgrade',
    badgeFree: 'Free',
    badgeIncluded: 'Included',
    open: 'Open',
    seePlans: 'See plans',
    empty: 'No tools match this filter.',
  },
  es: {
    eyebrow: 'Todas tus ligas · Tus herramientas',
    planChip: (planName: string) => `Tu plan · ${planName}`,
    planFree: 'Gratis',
    chimmyTitle: 'Chimmy, tu asistente de AF',
    chimmyBody: 'Pregunta con tus palabras: a quién alinear, si una oferta es justa, cuánto pujar por un jugador.',
    askChimmy: 'Preguntar a Chimmy',
    filterAria: 'Filtrar herramientas',
    filterAll: 'Todas',
    filterIncluded: 'Incluidas en tu plan',
    filterUpgrade: 'Requieren otro plan',
    badgeFree: 'Gratis',
    badgeIncluded: 'Incluida',
    open: 'Abrir',
    seePlans: 'Ver planes',
    empty: 'Ninguna herramienta coincide con este filtro.',
  },
})
