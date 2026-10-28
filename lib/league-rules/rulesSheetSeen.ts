/**
 * When the league rules sheet opens by itself: once per manager per league, the first time they
 * reach the league with nothing else on screen. After that it opens only from the Rules button.
 *
 * ⚠ IT WAITS ITS TURN. A new league already greets people — the post-create welcome for the
 * commissioner, a format intro (Guilly, Survivor, IDP…) for everyone — and a second modal on top
 * of one of those is the stacking `lib/league/post-create-welcome.ts` was written to end. So the
 * sheet opens only once the welcome is done and every format intro has been seen.
 *
 * Remembered in this browser (like the format intros), so a manager on a new device sees it once
 * more — which, for a sheet of rules, is harmless.
 */
export function rulesSheetSeenKey(leagueId: string, userId: string): string {
  return `af:league-rules-sheet-seen:${leagueId}:${userId}`
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function isRulesSheetSeen(leagueId: string, userId: string): boolean {
  try {
    return storage()?.getItem(rulesSheetSeenKey(leagueId, userId)) === '1'
  } catch {
    // Storage blocked: treat as seen, so a private window is not greeted on every visit.
    return true
  }
}

export function markRulesSheetSeen(leagueId: string, userId: string): void {
  try {
    storage()?.setItem(rulesSheetSeenKey(leagueId, userId), '1')
  } catch {
    // Nothing to remember it in; it may open once more on the next visit.
  }
}

export function shouldAutoOpenRulesSheet(input: {
  leagueId: string
  userId: string | null | undefined
  /** The post-create welcome is finished (or never started). */
  welcomeDone: boolean
  /** Every format intro this league has has already been seen. */
  introsSeen: boolean
  /** Embedded views (a widget, a share card) never pop a sheet. */
  embedded: boolean
  seen: boolean
}): boolean {
  if (!input.userId || !input.leagueId || input.embedded) return false
  return input.welcomeDone && input.introsSeen && !input.seen
}
