/**
 * The device notification tag for a push.
 *
 * A push that carries a tag REPLACES any earlier notification with the same tag on
 * the device. The default — one tag per category and league — is right for most
 * alerts, where the newest state is all that matters. It is wrong for a caller that
 * sends one alert per EVENT: live plays all fall in `matchup_results`, so a second
 * touchdown silently replaced the first on the phone before anyone read it. Such a
 * caller names its own tag in `meta.pushTag`.
 */
export function pushTagFor(category: string, meta: Record<string, unknown> | null | undefined): string {
  const own = meta?.pushTag
  if (typeof own === 'string' && own.trim()) return own
  return `notif-${category}-${meta?.leagueId ?? 'global'}`
}
