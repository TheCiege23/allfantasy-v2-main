import { weekdayEs } from '@/lib/core-app/kickoffText'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core home's client-side time pieces (components/core-app/screens/Dashboard34Live.tsx):
 * `Dash34When`'s day-and-time label. Every value is the one the component used before the move, in
 * both languages — a relocation, not a rewrite.
 *
 * `whenLocale` is the locale handed to `toLocaleString`; English's empty string means "none", i.e.
 * the browser's own locale, exactly as before (an empty string is not a valid locale tag, so the
 * component turns it into `undefined`).
 */
export const dashboard34LiveMessages = defineMessages({
  en: {
    whenLocale: '',
    /** The server / first-paint label's weekday ("Sun"), before the reader's own zone replaces it. */
    utcWeekday: (day: string): string => day,
  },
  es: {
    whenLocale: 'es',
    utcWeekday: (day) => weekdayEs(day),
  },
})
