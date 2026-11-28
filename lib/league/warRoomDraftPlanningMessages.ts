import { defineMessages } from '@/lib/i18n/messages'

/**
 * The War Room's `draft_prep` card (app/league/[leagueId]/tabs/WarRoomTab.tsx), in English and Spanish.
 *
 * 🛑 IT DESCRIBES ONLY WHAT `draft_prep` UNLOCKS (owner, 2026-11-28): the War Room prep flows. It used to read
 * "Pick explanations and prep flows tied to your draft", which promised AF Pro users something this card locks
 * them out of — the draft-room pick explanation is its own key since 2026-11-28 (`draft_room_ai_explanation`:
 * AF Pro, AF Legacy, AF Supreme), while `draft_prep` stays AF Legacy (Supreme through Legacy).
 */
export const warRoomDraftPlanningMessages = defineMessages({
  en: {
    title: 'Draft planning',
    description: 'War Room prep flows to plan your draft before it starts.',
    cta: 'Start planning',
  },
  es: {
    title: 'Planificación del draft',
    description: 'Flujos de preparación de War Room para planear tu draft antes de que empiece.',
    cta: 'Empezar a planear',
  },
})
