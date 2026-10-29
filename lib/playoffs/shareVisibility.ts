import type { PlayoffPickView, PlayoffSeriesView } from "./types"

/** A shared entry reveals each pick only after that game's own lock. */
export function visiblePlayoffPicks(
  series: Array<Pick<PlayoffSeriesView, "id" | "startsAt" | "status">>,
  picks: PlayoffPickView[],
  now: number = Date.now(),
): PlayoffPickView[] {
  const revealed = new Set(series
    .filter((row) => row.status === "in_progress" || row.status === "final" ||
      (row.startsAt != null && Number.isFinite(Date.parse(String(row.startsAt))) &&
        Date.parse(String(row.startsAt)) <= now))
    .map((row) => row.id))
  return picks.filter((pick) => revealed.has(pick.seriesId))
}
