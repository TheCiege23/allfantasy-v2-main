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
