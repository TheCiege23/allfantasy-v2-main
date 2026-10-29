import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core home bands' own fixed words that lib/core-app/homeBandsCopy.ts chooses by language (the
 * coarse countdown). Every string is the one the module produced before the move, byte for byte.
 * The Spanish rebuilds of loader English in that module stay there: they are keyed on the server's
 * English or a status code and fall back to it, which is not an en/es pair.
 */
export const homeBandsMessages = defineMessages({
  en: {
    // coarseCountdownText
    underway: 'underway',
    inMinutes: (mins: number) => `in ${mins}m`,
    inHours: (hours: number) => `in ${hours}h`,
    inDaysHours: (days: number, rem: number) => `in ${days}d ${rem}h`,
    inDays: (days: number) => `in ${days}d`,
  },
  es: {
    underway: 'en curso',
    inMinutes: (mins) => `en ${mins} min`,
    inHours: (hours) => `en ${hours} h`,
    inDaysHours: (days, rem) => `en ${days} d ${rem} h`,
    inDays: (days) => `en ${days} d`,
  },
})
