/**
 * Managers who can SEE an imported league without holding a team in it.
 *
 * Owner's rule, 2026-11-21: everyone in a league sees the same copy of it. A league mate who imports a
 * league that is already here joins that copy: on their own team, on the team they co-own, or, when
 * the provider proves they are in the league but they have no team (chopped in a guillotine league,
 * voted out of a survivor league), as a viewer. Before this they got a second copy of the whole league.
 *
 * A viewer is a member for reading and league chat. The list grants no commissioner access and no
 * team: nothing that checks "does this user run a team" reads it. Recorded in
 * `League.settings[IMPORT_VIEWERS_KEY]`, beside the import's co-commissioner list.
 */
export const IMPORT_VIEWERS_KEY = 'importViewerIds'

export function importViewerIds(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return []
  const raw = (settings as Record<string, unknown>)[IMPORT_VIEWERS_KEY]
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

export function isImportViewer(settings: unknown, userId: string | null | undefined): boolean {
  return Boolean(userId) && importViewerIds(settings).includes(userId as string)
}
