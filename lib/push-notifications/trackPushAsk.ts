/**
 * The push-ask funnel events, one shape for every door that asks (2026-11-24):
 *
 *   push_ask_shown / push_ask_enabled / push_ask_dismissed, toolKey `push_ask`, meta.placement
 *
 * through /api/analytics/track (the server attaches the user). `placement` is what separates the doors
 * — `follow` and `finder_home` (Player Finder's PushAsk) and `signin_sheet` (SignInPushSheet, the
 * sheet every signed-in browser sees) — so one GROUP BY on meta->>'placement' compares them.
 *
 * ⚠ WHY THIS EXISTS. Until this date the sign-in sheet, which asks EVERY new account, sent nothing,
 * so `push_ask_shown` counted only Player Finder and read as "1 new user of 22 was ever asked".
 * Fire-and-forget; never throws.
 */
export type PushAskPlacementKey = 'follow' | 'finder_home' | 'signin_sheet'

export function trackPushAsk(
  event: 'push_ask_shown' | 'push_ask_enabled' | 'push_ask_dismissed',
  placement: PushAskPlacementKey,
  extra?: Record<string, string>,
): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return
  try {
    void fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        toolKey: 'push_ask',
        path: window.location?.pathname ?? null,
        meta: { placement, ...(extra ?? {}) },
      }),
    }).catch(() => {})
  } catch {
    // Analytics never breaks the ask.
  }
}
