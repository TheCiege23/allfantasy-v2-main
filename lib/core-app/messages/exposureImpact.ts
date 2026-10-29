import { defineMessages } from '@/lib/i18n/messages'

/**
 * The "Portfolio & exposure" row and its "if he sits" breakdown
 * (components/core-app/screens/ExposureImpact.tsx). Every string is the one the row printed before
 * the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const exposureImpactMessages = defineMessages({
  en: {
    notInLineup: 'not in this week’s lineup — no effect',
    cantPrice: 'can’t price this matchup',
    of: 'of',
    hide: 'Hide',
    ifHeSits: 'If he sits',
    pricing: 'Pricing your matchups…',
    loadError: 'Couldn’t load his leagues right now. Try again in a moment.',
    noneHold: 'None of your rosters we could read hold him this week.',
    winChanceNote: 'Your win chance this week — now → if he scores 0 from here.',
    notPriced: (n: number) => `${n} more league${n === 1 ? '' : 's'} not priced here — open the Matchup screen for those.`,
  },
  es: {
    notInLineup: 'no está en la alineación de esta semana: no influye',
    cantPrice: 'no se puede calcular este enfrentamiento',
    of: 'de',
    hide: 'Ocultar',
    ifHeSits: 'Si no juega',
    pricing: 'Calculando tus enfrentamientos…',
    loadError: 'No pudimos cargar sus ligas ahora. Inténtalo de nuevo en un momento.',
    noneHold: 'Ninguna de las plantillas que pudimos leer lo tiene esta semana.',
    winChanceNote: 'Tu probabilidad de ganar esta semana: ahora → si no suma ni un punto más.',
    notPriced: (n) =>
      n === 1
        ? '1 liga más sin calcular aquí: ábrela en la pantalla de Enfrentamiento.'
        : `${n} ligas más sin calcular aquí: ábrelas en la pantalla de Enfrentamiento.`,
  },
})
