/**
 * NFL redraft leagues track the active week on `RedraftSeason.currentWeek`,
 * not `League.settings` (that field is only ever populated by other concepts
 * like zombie/survivor). Roster/Matchups/Standings views must default to the
 * real current week, not week 1, once a redraft season exists.
 *
 * Pre-draft leagues have no `RedraftSeason` row yet (it's created by
 * `syncCompletedDraftToRedraftSeason` after the draft finalizes), so this
 * falls back to the legacy settings-derived guess — never breaks pre-draft
 * or draft-room flows.
 */
export function resolveRedraftCurrentWeek(args: {
  redraftSeasonCurrentWeek: number | null | undefined
  legacySettingsWeek: number | null | undefined
}): number {
  if (typeof args.redraftSeasonCurrentWeek === 'number' && Number.isFinite(args.redraftSeasonCurrentWeek)) {
    return Math.max(1, args.redraftSeasonCurrentWeek)
  }
  if (typeof args.legacySettingsWeek === 'number' && Number.isFinite(args.legacySettingsWeek)) {
    return Math.max(1, args.legacySettingsWeek)
  }
  return 1
}
