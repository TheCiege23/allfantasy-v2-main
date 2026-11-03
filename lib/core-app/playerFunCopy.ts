import type { ExposureTier, Form } from './playerFun'
import { messagesFor } from '@/lib/i18n/messages'
import { playerFunMessages, type PlayerFunMessages } from './messages/playerFun'

/**
 * Words for the Finder's fun layer (playerFun.ts, weeklyMvp.ts) and the trending "add him" prompt
 * (2026-10-08). Pure, client-safe; English and Spanish.
 */

export type PlayerFunCopy = {
  exposure: (pct: number, tier: ExposureTier) => string
  exposureTitle: (leagues: number, of: number, pct: number) => string
  form: (call: Form['call']) => string | null
  formTitle: (recent: number, season: number) => string
  flipsTitle: string
  flipsSub: string
  flipIn: (league: string) => string
  flipStarting: string
  flipBench: string
  flipPickA: (name: string) => string
  flipAgree: string
  flipDisagree: string
  flipLean: (name: string, margin: string) => string
  flipEven: string
  flipSetLineup: (platform: string) => string
  flipAgain: string
  mvpKicker: (week: number) => string
  mvpPoints: (pts: string, leagues: number) => string
  mvpBeat: (name: string, by: string) => string
  mvpShare: string
  mvpShared: string
  mvpCopied: string
  mvpShareText: (week: number, name: string, pts: string, leagues: number) => string
  trendFree: (n: number) => string
  trendFreeLabel: (name: string, n: number) => string
}

const built = new WeakMap<PlayerFunMessages, PlayerFunCopy>()

export function playerFunCopy(language: string): PlayerFunCopy {
  const m = messagesFor(playerFunMessages, language)
  let out = built.get(m)
  if (!out) built.set(m, (out = { ...m, form: (c) => m.form(c) || null }))
  return out
}
