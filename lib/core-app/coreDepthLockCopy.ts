import { freeUntilLabel } from '@/components/launch/launchCopy'
import type { CoreDepth } from './coreDepthAccess'

/**
 * The /core depth paywall's words in the reader's language (2026-10-06): the lock card, its
 * "Free until" note (components/core-app/CoreDepthLock.tsx), and the subjects the callers hand it.
 *
 * ⚠ WORDS ONLY. Which viewer is locked, which depth, which plan and which upgrade link are decided by
 * coreDepthAccess.ts and the server loaders, and nothing here reads them. The plan names stay as the
 * pricing page prints them in Spanish too ("AF Pro", "AF Commissioner"), and so does the product name
 * "Competitive Edge" (launchCopy.ts PRO_DEPTH_ES, the help topics).
 *
 * The English is the component's English BYTE FOR BYTE — including the "is"/"are" guess on the
 * subject's last letter — so English mode is unchanged (__tests__/core-depth-lock-spanish.test.tsx).
 *
 * Spanish avoids agreeing with the subject: a subject arrives already in Spanish from its caller, and
 * its gender and number are not known here, so the head is "{subject}: parte de AF Pro" rather than a
 * sentence whose verb would have to guess. The "Free until" day comes from the launch countdown's own
 * `freeUntilLabel`, so the lock and the banner name the day the same way.
 *
 * PURE, client- and server-safe (CommissionerHub is a server component).
 */

export type CoreDepthLockLang = 'en' | 'es'

/** Anything that is not Spanish reads English — the same rule every /core copy module uses. */
export function lockLang(language: string | null | undefined): CoreDepthLockLang {
  return language === 'es' ? 'es' : 'en'
}

export type CoreDepthLockCopy = {
  /** Web and an iOS build that sells: "Player deep dives are part of AF Pro". */
  head: (subject: string, planName: string) => string
  /** An iOS build that sells nothing (App Store 3.1.3): no plan, no invitation. */
  headAlt: (subject: string) => string
  body: string
  bodyAlt: string
  cta: (planName: string) => string
  /** "Free until Oct 15 — then AF Pro". */
  freeUntil: (startsAtIso: string, planName: string) => string
}

const EN: CoreDepthLockCopy = {
  head: (subject, plan) => `${subject} ${subject.endsWith('s') ? 'are' : 'is'} part of ${plan}`,
  headAlt: (subject) => `${subject} ${subject.endsWith('s') ? 'are' : 'is'} not included with your account`,
  body: 'Your leagues, scores and the basics stay free. Upgrade to see the rest.',
  bodyAlt: 'Your leagues, scores and the basics are all here.',
  cta: (plan) => `See ${plan}`,
  freeUntil: (startsAt, plan) => `${freeUntilLabel(startsAt, 'en')} — then ${plan}`,
}

const ES: CoreDepthLockCopy = {
  head: (subject, plan) => `${subject}: parte de ${plan}`,
  headAlt: (subject) => `${subject}: no disponible con tu cuenta`,
  body: 'Tus ligas, los marcadores y lo básico siguen siendo gratis. Mejora tu plan para ver el resto.',
  bodyAlt: 'Tus ligas, los marcadores y lo básico están todos aquí.',
  cta: (plan) => `Ver ${plan}`,
  freeUntil: (startsAt, plan) => `${freeUntilLabel(startsAt, 'es')} — luego, ${plan}`,
}

export function coreDepthLockCopy(language: string | null | undefined): CoreDepthLockCopy {
  return lockLang(language) === 'es' ? ES : EN
}

/**
 * The depth's own subject, used when a caller names none (`CORE_DEPTH[depth].label`). Keyed by depth,
 * so a relabel in coreDepthAccess.ts cannot silently fall back to English: the test reads every depth.
 */
const DEPTH_LABEL_ES: Record<CoreDepth, string> = {
  player_depth: 'Análisis a fondo de jugadores',
  trade_depth: 'Desglose completo de cambios',
  commissioner_depth: 'Análisis para comisionados',
  competitive_edge: 'Competitive Edge',
}

export function depthLabelText(depth: CoreDepth, english: string, language: string | null | undefined): string {
  // An unknown depth (a malformed access object) keeps its English label rather than printing nothing.
  return lockLang(language) === 'es' ? DEPTH_LABEL_ES[depth] ?? english : english
}

/**
 * The fixed subjects the /core callers name, in Spanish. A caller passes its English through
 * `lockSubjectText`, so the lock's head is one language whole. An unknown subject stays English — and
 * __tests__/core-depth-lock-spanish.test.tsx reads every `what=` in the callers, so a new one fails
 * there rather than shipping half Spanish.
 */
const SUBJECT_ES: Record<string, string> = {
  // Player Finder (components/core-app/screens/PlayerFinder.tsx and player-finder/)
  'Side-by-side compare': 'Comparación lado a lado',
  'Recommended moves': 'Movimientos recomendados',
  'The verdict, bench swaps and trade windows': 'Veredicto, cambios de banca y ventanas de intercambio',
  'Suggested FAAB bids': 'Pujas FAAB sugeridas',
  'Buy-low and sell-high calls': 'Avisos de comprar barato y vender alto',
  // The player card (components/core-app/player-card/PlayerCardSheet.tsx)
  'Trades in this league': 'Intercambios en esta liga',
  'Trade history and similar players': 'Historial de intercambios y jugadores similares',
  // Trade Center (components/core-app/screens/TradeCenter.tsx)
  'Who to trade with': 'Con quién intercambiar',
  'The full trade breakdown': 'Desglose completo de cambios',
  'The trade finder': 'Buscador de intercambios',
  // Competitive Edge (Draft HQ, Trade Center) — the product name stays
  'Competitive Edge': 'Competitive Edge',
}

/** Every subject `lockSubjectText` translates — exported so a test can read each caller against it. */
export const LOCK_SUBJECT_KEYS: readonly string[] = Object.keys(SUBJECT_ES)

export function lockSubjectText(english: string, language: string | null | undefined): string {
  if (lockLang(language) !== 'es') return english
  return SUBJECT_ES[english] ?? english
}

/** "Trading for Dalton Kincaid" — Player Finder's trade-visual lock, which names the player. */
export function tradingForSubject(playerName: string, language: string | null | undefined): string {
  return lockLang(language) === 'es' ? `Intercambiar por ${playerName}` : `Trading for ${playerName}`
}
