import type { CoreDepthLockCopy } from '../coreDepthLockCopy'
import { freeUntilLabel } from '@/components/launch/launchCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core depth paywall's words (lib/core-app/coreDepthLockCopy.ts): the lock card and its
 * "Free until" note (components/core-app/CoreDepthLock.tsx), and Player Finder's trade-visual subject.
 * The Spanish subject tables keyed by depth and by the callers' English stay in coreDepthLockCopy.ts.
 */
export const coreDepthLockMessages = defineMessages<CoreDepthLockCopy>({
  en: {
    head: (subject, plan) => `${subject} ${subject.endsWith('s') ? 'are' : 'is'} part of ${plan}`,
    headAlt: (subject) => `${subject} ${subject.endsWith('s') ? 'are' : 'is'} not included with your account`,
    body: 'Your leagues, scores and the basics stay free. Upgrade to see the rest.',
    bodyAlt: 'Your leagues, scores and the basics are all here.',
    cta: (plan) => `Unlock with ${plan}`,
    tradeBreakdownBenefit: 'See how this trade changes your roster and what you could counter with.',
    afProjectionsBenefit: "AllFantasy's own projection for every player — the provider line adjusted for form, minutes, rest, opponent and the rest, each one measured on games already played.",
    afProjectionsBoardBenefit: "AllFantasy's own number for every player — the provider line adjusted for form, minutes, rest, opponent and the rest — plus rest of season. The baseline stays free.",
    afAdpLockedTitle: 'AF ADP — where players actually go in real drafts — is part of AF Pro, AF Commissioner and AF Supreme.',
    tradeReviewWithTokens: 'Review this trade with tokens',
    fullTradeReview: 'Get a full trade review',
    tradeDraftStorageError: 'This browser could not save the trade in this tab.',
    freeUntil: (startsAt, plan) => `${freeUntilLabel(startsAt, 'en')} — then ${plan}`,
  },
  es: {
    head: (subject, plan) => `${subject}: parte de ${plan}`,
    headAlt: (subject) => `${subject}: no disponible con tu cuenta`,
    body: 'Tus ligas, los marcadores y lo básico siguen siendo gratis. Mejora tu plan para ver el resto.',
    bodyAlt: 'Tus ligas, los marcadores y lo básico están todos aquí.',
    cta: (plan) => `Desbloquear con ${plan}`,
    tradeBreakdownBenefit: 'Consulta el impacto en tu plantilla y las posibles contraofertas.',
    afProjectionsBenefit: 'La proyección propia de AllFantasy para cada jugador: la línea del proveedor ajustada por forma, minutos, descanso, rival y más, cada ajuste medido en partidos ya jugados.',
    afProjectionsBoardBenefit: 'El número propio de AllFantasy para cada jugador —la línea del proveedor ajustada por forma, minutos, descanso, rival y más— y el resto de la temporada. La base sigue siendo gratis.',
    afAdpLockedTitle: 'El ADP de AF —dónde se eligen de verdad los jugadores en drafts reales— es parte de AF Pro, AF Commissioner y AF Supreme.',
    tradeReviewWithTokens: 'Revisar este cambio con tokens',
    fullTradeReview: 'Obtener un análisis completo',
    tradeDraftStorageError: 'No se pudo guardar el cambio en esta pestaña.',
    freeUntil: (startsAt, plan) => `${freeUntilLabel(startsAt, 'es')} — luego, ${plan}`,
  },
})

/** `tradingForSubject` — "Trading for Dalton Kincaid". */
export const coreDepthLockSubjectMessages = defineMessages({
  en: {
    tradingFor: (playerName: string) => `Trading for ${playerName}`,
  },
  es: {
    tradingFor: (playerName) => `Intercambiar por ${playerName}`,
  },
})
