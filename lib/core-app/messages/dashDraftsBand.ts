import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { defineMessages } from '@/lib/i18n/messages'

/** Draft statuses the shared table does not hold; the rest go through `coreUiCopy` ("paused", "in progress"). */
const STATUS_ES: Record<string, string> = { drafting: 'en curso', live: 'en vivo' }

/**
 * Drafts band (components/core-app/screens/DashDraftsBandView.tsx). Every string is the one the band
 * printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 */
export const dashDraftsBandMessages = defineMessages({
  en: {
    title: 'Drafts on the clock',
    oneDraftLive: '1 draft live now',
    draftsLive: (liveCount: number) => `${liveCount} drafts live now`,
    live: 'LIVE',
    /** A draft's own status, underscores already spaced ("in progress"), upper-cased. */
    status: (status: string): string => status.toUpperCase(),
    pickTimerExpired: 'Pick timer expired',
    underOneMin: 'Under 1 min on the pick clock',
    minsOnClock: (totalMins: number) => `${totalMins} min on the pick clock`,
    hoursOnClock: (hours: number, mins: string) => `${hours}h ${mins}m on the pick clock`,
    yourSlot: (yourSlot: number) => `Your slot ${yourSlot}`,
    picksMade: (picksMade: number) => `${picksMade} ${picksMade === 1 ? 'pick' : 'picks'} made`,
    noPicks: 'No picks recorded yet',
    noTimer: 'On the clock — no pick timer reported',
    openDraftRoom: 'Open draft room',
    moreInDraftHq: (overflow: number) => `+${overflow} more in Draft HQ`,
  },
  es: {
    title: 'Drafts en marcha',
    oneDraftLive: '1 draft en vivo ahora',
    draftsLive: (liveCount) => `${liveCount} drafts en vivo ahora`,
    live: 'EN VIVO',
    status: (status) => {
      const key = status.toLowerCase()
      return (STATUS_ES[key] ?? coreUiCopy(key, 'es')).toUpperCase()
    },
    pickTimerExpired: 'Se agotó el tiempo para elegir',
    underOneMin: 'Menos de 1 min en el reloj',
    minsOnClock: (totalMins) => `${totalMins} min en el reloj`,
    hoursOnClock: (hours, mins) => `${hours} h ${mins} min en el reloj`,
    yourSlot: (yourSlot) => `Tu posición ${yourSlot}`,
    picksMade: (picksMade) => `${picksMade} ${picksMade === 1 ? 'selección hecha' : 'selecciones hechas'}`,
    noPicks: 'Aún no hay selecciones registradas',
    noTimer: 'En el reloj: no se informó un tiempo para elegir',
    openDraftRoom: 'Abrir la sala del draft',
    moreInDraftHq: (overflow) => `+${overflow} más en ${coreUiCopy('Draft HQ', 'es')}`,
  },
})
