import "server-only"
import { ESPN_SITE_API_BASE } from "@/lib/providers/espnUrls"
import { logAdminAudit } from "@/lib/admin-audit"
import { readBracketEventMaps } from "./bracketEventMaps"
import { publishSeasonBracketFinal, readSeasonBracketGame } from "./publishSeasonBracketFinal"
import { readSingleGameSchedule, type SingleGameSport } from "./singleGameSchedule"
import { verifyBracketEvent } from "./verifyBracketEvent"

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "")
}
async function fetchMappedEvent(sport: SingleGameSport, scheduledAt: string, eventId: string): Promise<unknown> {
  const path = sport === "ncaaf" ? "football/college-football" : "basketball/nba"
  const baseDate = new Date(scheduledAt)
  for (const offset of [0, -1, 1]) {
    const date = new Date(baseDate.getTime() + offset * 24 * 60 * 60 * 1000)
    const url = `${ESPN_SITE_API_BASE}/${path}/scoreboard?dates=${dateKey(date)}&limit=400`
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`ESPN scoreboard returned ${response.status}`)
    const payload = await response.json() as { events?: Array<{ id?: string }> }
    if (!Array.isArray(payload.events)) throw new Error("ESPN scoreboard has no events list")
    if (payload.events.some((event) => String(event.id ?? "") === eventId)) return payload
  }
  return { events: [] }
}

export type BracketSyncRow = { seriesNumber: number; eventId: string | null; outcome: string; updatedPools?: number }
export async function syncSeasonBracketResults(input: {
  sport: SingleGameSport; season: number; apply: boolean
}): Promise<{ sport: SingleGameSport; season: number; applied: boolean; rows: BracketSyncRow[] }> {
  const [schedule, mapping] = await Promise.all([
    readSingleGameSchedule(input.sport, input.season),
    readBracketEventMaps(input.sport, input.season),
  ])
  if (!schedule || !mapping) return { sport: input.sport, season: input.season, applied: false, rows: [] }
  const eventIds = new Map(mapping.games.map((game) => [game.seriesNumber, game.eventId]))
  const rows: BracketSyncRow[] = []
  for (const scheduled of schedule.games) {
    if (Date.parse(scheduled.startsAt) > Date.now()) continue
    const eventId = eventIds.get(scheduled.seriesNumber)
    if (!eventId) {
      rows.push({ seriesNumber: scheduled.seriesNumber, eventId: null, outcome: "no-event-id" })
      continue
    }
    const matchup = await readSeasonBracketGame({
      sport: input.sport, season: input.season, seriesNumber: scheduled.seriesNumber,
    })
    if (!matchup.ok) {
      rows.push({ seriesNumber: scheduled.seriesNumber, eventId, outcome: matchup.error })
      continue
    }
    try {
      const payload = await fetchMappedEvent(input.sport, scheduled.startsAt, eventId)
      const checked = verifyBracketEvent({
        payload, sport: input.sport, season: input.season, eventId,
        scheduledAt: scheduled.startsAt, homeTeam: matchup.home, awayTeam: matchup.away,
      })
      if (!checked.ok) {
        rows.push({ seriesNumber: scheduled.seriesNumber, eventId, outcome: checked.reason })
        continue
      }
      if (!input.apply) {
        rows.push({ seriesNumber: scheduled.seriesNumber, eventId, outcome: "verified-dry-run" })
        continue
      }
      const published = await publishSeasonBracketFinal({
        sport: input.sport, season: input.season, seriesNumber: scheduled.seriesNumber,
        homeScore: checked.final.homeScore, awayScore: checked.final.awayScore,
        expectedHome: matchup.home, expectedAway: matchup.away,
      })
      if (!published.ok) {
        rows.push({ seriesNumber: scheduled.seriesNumber, eventId, outcome: published.error })
        continue
      }
      if (published.updatedPools > 0) await logAdminAudit({
        adminUserId: "bracket-result-sync:espn", action: "season_bracket_result.auto_publish",
        targetType: "bracket_season_game",
        targetId: `${input.sport}:${input.season}:${scheduled.seriesNumber}`,
        details: {
          provider: "espn", eventId, homeTeam: matchup.home, awayTeam: matchup.away,
          homeScore: checked.final.homeScore, awayScore: checked.final.awayScore,
          updatedPools: published.updatedPools, totalPools: published.totalPools,
        },
      })
      rows.push({ seriesNumber: scheduled.seriesNumber, eventId,
        outcome: published.updatedPools ? "published" : "already-final", updatedPools: published.updatedPools })
    } catch (error) {
      rows.push({ seriesNumber: scheduled.seriesNumber, eventId,
        outcome: error instanceof Error ? error.message.slice(0, 120) : "provider-error" })
    }
  }
  return { sport: input.sport, season: input.season, applied: input.apply, rows }
}
