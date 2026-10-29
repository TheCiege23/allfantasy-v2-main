import { defineMessages } from '@/lib/i18n/messages'

/**
 * Commissioner weekly plan task copy (lib/core-app/commissionerWeeklyPlan.ts). Every string is the one
 * the module wrote before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const commissionerWeeklyPlanMessages = defineMessages({
  en: {
    period: 'Period',
    reviewFollowUp: 'Review current evidence and coordinate follow-up with the manager.',
  },
  es: {
    period: 'Período',
    reviewFollowUp: 'Revisar los datos actuales y coordinar el seguimiento con el manager.',
  },
})
