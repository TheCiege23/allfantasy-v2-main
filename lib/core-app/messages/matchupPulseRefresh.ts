import { defineMessages } from '@/lib/i18n/messages'

/**
 * The live/refresh control on both matchup screens (components/core-app/MatchupPulseRefresh.tsx).
 * Every string is the one the control printed before the move, byte for byte, in both languages —
 * a relocation, not a rewrite. A `label` the caller passes is still the caller's to translate.
 */
export const matchupPulseRefreshMessages = defineMessages({
  en: {
    refreshLabel: 'Refresh where you stand',
    updating: 'updating',
    live: 'live',
    notStarted: 'not started',
    secondsAgo: (s: number) => `${s}s ago`,
    minutesAgo: (min: number) => `${min}m ago`,
  },
  es: {
    refreshLabel: 'Actualizar tu posición',
    updating: 'actualizando',
    live: 'en vivo',
    notStarted: 'sin comenzar',
    secondsAgo: (s) => `hace ${s} s`,
    minutesAgo: (min) => `hace ${min} min`,
  },
})
