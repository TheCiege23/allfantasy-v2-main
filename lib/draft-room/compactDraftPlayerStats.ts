import {
  formatDraftStatDisplay, getDraftStatColumnsForSport, getStatValueForDraftPlayer,
  type DraftStatPlayerSource,
} from './draftSportStatColumns'

/** The same stored values as the research table; never invent missing stats. */
export function compactDraftPlayerStats(player: DraftStatPlayerSource, sport: string, position: string): string {
  return getDraftStatColumnsForSport(sport, { position })
    .flatMap(column => {
      const value = getStatValueForDraftPlayer(player, column)
      return value == null || !Number.isFinite(value) ? [] : [`${column.label} ${formatDraftStatDisplay(value, column)}`]
    })
    .slice(0, 3)
    .join(' · ')
}
