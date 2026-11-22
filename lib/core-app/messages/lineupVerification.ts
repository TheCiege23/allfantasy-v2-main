import { defineMessages } from '@/lib/i18n/messages'

/**
 * Lineup verification stamps (lib/core-app/lineupVerification.ts). Every string is the one the module
 * wrote before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const lineupVerificationMessages = defineMessages({
  en: {
    timeUnavailable: 'Verification time unavailable',
    checkedJustNow: 'Checked just now',
    checkedMinutesAgo: (minutes: number) => `Checked ${minutes} min ago`,
    checkedHoursAgo: (hours: number) => `Checked ${hours} hr ago`,
    checked: 'Checked',
  },
  es: {
    timeUnavailable: 'Hora de verificación no disponible',
    checkedJustNow: 'Revisada ahora mismo',
    checkedMinutesAgo: (minutes) => `Revisada hace ${minutes} min`,
    checkedHoursAgo: (hours) => `Revisada hace ${hours} h`,
    checked: 'Revisada',
  },
})
