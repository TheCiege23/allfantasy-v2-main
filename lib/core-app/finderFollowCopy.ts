import { messagesFor } from '@/lib/i18n/messages'
import { finderFollowMessages } from './messages/finderFollow'

/**
 * The Finder's follow surfaces (2026-10-08): the "Alert me" button on the open card and the
 * "Following" board on the "My players" home. Pure, client-safe; English and Spanish.
 */

export type FollowCopy = {
  off: string
  on: string
  startLabel: (name: string) => string
  stopLabel: (name: string) => string
  followedNote: (name: string) => string
  limit: string
  failed: string
  // ── The "My players" home ──────────────────────────────────────────────
  homeTitle: string
  homeSub: string
  boardTitle: string
  boardEmpty: string
  freeIn: (league: string) => string
  freeMore: (n: number) => string
  more: (n: number) => string
  statusUnavailable: string
}

export function followCopy(language: string): FollowCopy {
  return messagesFor(finderFollowMessages, language)
}
