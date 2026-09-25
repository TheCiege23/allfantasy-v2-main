/**
 * A `?league=` id that is not in the viewer's list, resolved to the copy they DO have of the same
 * provider league.
 *
 * WHY: one Sleeper (or ESPN, Yahoo…) league is one `League` row per importer, and the viewer's
 * list keeps one of them. A link built from the other copy — an old tab, a notification, a Chimmy
 * answer, a teammate's share — used to be dropped by `/core` as "not your league" and land on
 * All leagues, silently. It is the same league the viewer plays, so send them to their copy of it.
 *
 * SAFE BY CONSTRUCTION: the answer is always a row from `played`, which is the viewer's own list —
 * the same authorization boundary `/core` already applies. A stranger's league id resolves to
 * nothing unless the viewer plays that very league.
 *
 * Only rows with a provider identity alias. AF-native leagues have no `platformLeagueId` and never
 * match anything.
 */
export type LeagueProviderIdentity = {
  platform: string | null | undefined
  platformLeagueId: string | null | undefined
}

export function findPlayedAlias(
  requested: LeagueProviderIdentity | null | undefined,
  played: ReadonlyArray<{ id?: unknown; platform?: unknown; platformLeagueId?: unknown }>,
): string | null {
  const platform = String(requested?.platform ?? '').trim().toLowerCase()
  const platformLeagueId = String(requested?.platformLeagueId ?? '').trim()
  if (!platform || !platformLeagueId) return null
  const hit = played.find(
    (l) =>
      String(l.platform ?? '').trim().toLowerCase() === platform &&
      String(l.platformLeagueId ?? '').trim() === platformLeagueId,
  )
  return hit && typeof hit.id === 'string' && hit.id ? hit.id : null
}
