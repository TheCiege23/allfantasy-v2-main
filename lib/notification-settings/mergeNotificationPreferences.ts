/**
 * Merge an incoming notificationPreferences payload over the stored JSON without
 * dropping keys the caller does not know about. The column co-locates settings
 * owned by other features (aiSettings, chimmyAlertPreferences, dashboardToggles,
 * world-cup prefs, accentColor, fantasyPreferences); each caller sends only the
 * slice it manages. Incoming top-level keys win; when both sides hold plain
 * objects they merge one level deep so a partial nested payload cannot erase
 * sibling sub-keys either.
 *
 * ⚠ THE ONE-LEVEL DEPTH IS LOAD-BEARING IN BOTH DIRECTIONS, and the second is easy
 * to miss. It protects sibling sub-keys — but it also means a caller CANNOT REMOVE a
 * nested key by omitting it: `leagues = { ...stored, ...incoming }` restores anything
 * the client deleted. Any UI that needs "no opinion" must SEND a neutral value rather
 * than drop the key. `LeagueNotificationOverridesCard` writes `{}` for exactly this
 * reason; a `delete` there saves cleanly and silently reverts on the next load.
 *
 * Lives in its own module rather than inside `app/api/user/profile/route.ts` so the
 * round-trip test can exercise the REAL merge. A test that reimplements it proves only
 * that two copies of the rule agree today — which is the bug, not the check.
 */
export function mergeNotificationPreferences(
  prev: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...prev }
  for (const [key, value] of Object.entries(incoming)) {
    const prevValue = merged[key]
    const bothPlainObjects =
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prevValue != null &&
      typeof prevValue === "object" &&
      !Array.isArray(prevValue)
    merged[key] = bothPlainObjects
      ? {
          ...(prevValue as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        }
      : value
  }
  return merged
}
