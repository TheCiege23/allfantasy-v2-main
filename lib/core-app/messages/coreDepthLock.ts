import type { CoreDepthLockCopy } from '../coreDepthLockCopy'
import { freeUntilLabel } from '@/components/launch/launchCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core depth paywall's words (lib/core-app/coreDepthLockCopy.ts): the lock card and its
 * "Free until" note (components/core-app/CoreDepthLock.tsx), and Player Finder's trade-visual subject.
 * Every string is the one the module produced before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. The Spanish subject tables keyed by depth and by the callers' English
 * stay in coreDepthLockCopy.ts: they translate a caller's English, they are not en/es pairs.
 */
export const coreDepthLockMessages = defineMessages<CoreDepthLockCopy>({
  en: {
    head: (subject, plan) => `${subject} ${subject.endsWith('s') ? 'are' : 'is'} part of ${plan}`,
    headAlt: (subject) => `${subject} ${subject.endsWith('s') ? 'are' : 'is'} not included with your account`,
    body: 'Your leagues, scores and the basics stay free. Upgrade to see the rest.',
    bodyAlt: 'Your leagues, scores and the basics are all here.',
    cta: (plan) => `See ${plan}`,
    freeUntil: (startsAt, plan) => `${freeUntilLabel(startsAt, 'en')} — then ${plan}`,
  },
  es: {
    head: (subject, plan) => `${subject}: parte de ${plan}`,
    headAlt: (subject) => `${subject}: no disponible con tu cuenta`,
    body: 'Tus ligas, los marcadores y lo básico siguen siendo gratis. Mejora tu plan para ver el resto.',
    bodyAlt: 'Tus ligas, los marcadores y lo básico están todos aquí.',
    cta: (plan) => `Ver ${plan}`,
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
