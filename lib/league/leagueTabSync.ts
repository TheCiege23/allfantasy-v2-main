/**
 * Pure helpers for the league tab <-> `?view=` URL sync.
 *
 * Root cause of the Draft/League flicker: the LeagueShell holds `activeTab` in state AND mirrors it
 * to `?view=` in the URL, while a second effect reads `?view=` back into `activeTab`. That is a
 * two-way binding. When a landing effect changes `activeTab` out-of-band, `activeTab` and `?view=`
 * briefly hold each other's values; the two effects then swap them on every render forever
 * (Draft -> League -> Draft -> ...), with a `router.replace` each tick.
 *
 * The fix makes `activeTab` the single source of truth and the URL a one-way mirror: the shell
 * records the `?view=` value it itself wrote, and the URL->tab effect ignores that echo. External
 * navigations / deep-links / back-forward carry a different value and are still honored.
 *
 * Extracted as pure functions so the anti-flicker behavior is unit-testable without rendering the
 * ~2,600-line LeagueShell (matching the repo's `lib/matchup-center/tabTransition` pattern).
 */

/**
 * Should an incoming `?view=` key drive a tab change?
 * - `true`  → it is an external navigation / deep-link (apply it).
 * - `false` → it is the shell's own echo of what it just wrote (ignoring it breaks the oscillation),
 *   or there is no incoming view.
 */
export function shouldApplyIncomingView(
  incomingKey: string | null | undefined,
  lastSyncedView: string | null,
): boolean {
  const key = incomingKey?.trim().toLowerCase() ?? ''
  if (!key) return false
  return key !== lastSyncedView
}
