/**
 * Who may see a Survivor share moment, and when it may be served publicly. Pure on purpose: these
 * are the privacy rules from the handoff README, and the API tests drive them directly.
 *
 *  - The `out` card is opt-in for the eliminated manager. Nobody else is ever offered it.
 *  - Immunity, idol and exile cards are offered to their subject only.
 *  - The champion card is offered to the champion and to the whole league as a recap.
 *  - The week recap is offered to the whole league and posted in league chat. It names the manager
 *    voted out (product call, 2026-10-31); their own `out` card stays theirs alone to share.
 *  - Nothing is public until it is final AND someone allowed to share it has published it.
 *  - A league with `shareCardsEnabled = false` serves nothing, to anyone.
 */
import type { ShareMomentType } from './types'

export interface MomentAccessFacts {
  type: ShareMomentType
  subjectUserId: string
  final: boolean
  publishedAt: Date | string | null
}

export interface ViewerFacts {
  userId: string | null
  isLeagueMember: boolean
}

/** May this viewer see the moment in their share UI (and its private preview PNG)? */
export function isMomentOfferedTo(moment: MomentAccessFacts, viewer: ViewerFacts): boolean {
  if (!viewer.userId || !moment.final) return false
  if (moment.type === 'champ' || moment.type === 'recap') return viewer.isLeagueMember
  return viewer.userId === moment.subjectUserId
}

/** May this viewer publish (make public) the moment? Same set as who it is offered to. */
export function canPublishMoment(moment: MomentAccessFacts, viewer: ViewerFacts): boolean {
  return isMomentOfferedTo(moment, viewer)
}

/** May the moment page and its images be served to anyone, signed in or not? */
export function isMomentPublic(moment: MomentAccessFacts, shareCardsEnabled: boolean): boolean {
  return shareCardsEnabled && moment.final && moment.publishedAt != null
}

export type MomentImageAccess = 'public' | 'private' | 'not_found'

/**
 * The PNG route's decision. `public` is cacheable forever by anyone; `private` is the subject's
 * live preview before they share (never cached by a shared cache); anything else is a 404 so an
 * unpublished moment's existence is not disclosed.
 */
export function momentImageAccess(moment: MomentAccessFacts | null, shareCardsEnabled: boolean, viewer: ViewerFacts): MomentImageAccess {
  if (!moment || !shareCardsEnabled || !moment.final) return 'not_found'
  if (isMomentPublic(moment, shareCardsEnabled)) return 'public'
  return isMomentOfferedTo(moment, viewer) ? 'private' : 'not_found'
}

export const PUBLIC_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const PRIVATE_IMAGE_CACHE_CONTROL = 'private, no-store'
/** Served when the brand fonts could not be loaded: short-lived so a later request re-renders with them. */
export const FALLBACK_FONT_CACHE_CONTROL = 'public, max-age=300'
