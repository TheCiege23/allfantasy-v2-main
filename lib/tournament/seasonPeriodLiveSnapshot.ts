import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { classifyRiSeasonType } from '@/lib/sports-data/riSeasonType'
import type { CalendarGame } from './seasonCalendarCoverage'
import { seasonContractHash } from './seasonCalendarVerification'
import { classifyRiLiveStartState } from './seasonActualStartEvidence'
import type { SeasonRules } from './seasonRules'
import { auditSeasonPeriodPlayerBoxes } from './seasonPeriodBoxAudit'

type Assignment = { gameId: string; startsAt: string; period: number | null }
type Feed = { rows: unknown[]; error?: string | null; notModified?: boolean; unsupported?: boolean }
type FetchDay = (day: string) => Promise<Feed>
const MAX_DAYS = 10

export type SeasonPeriodLiveSnapshot = {
  period: number; observedAt: string; expectedGames: number; fetchedGames: number; finalGames: number
  missingGameIds: string[]; futureGameIds: string[]; unknownGameIds: string[]
  snapshotDigest: string; allGameRowsFinal: boolean
  boxAudit: ReturnType<typeof auditSeasonPeriodPlayerBoxes>
  exactStartVerified: false; playerCoverageVerified: false; scoringCertified: false; launchReady: false
}

/** Fetch all elapsed Eastern game days in one published period; raw rows stay server-side. */
export async function collectSeasonPeriodLiveSnapshot(input: {
  period: number; sport: 'NBA' | 'NFL'; rules: SeasonRules; assignments: Assignment[]; currentSchedule: CalendarGame[]; observedAt: Date; fetchDay: FetchDay
}): Promise<{ report: SeasonPeriodLiveSnapshot; rawGames: Map<string, Record<string, unknown>> }> {
  const { period, assignments, currentSchedule, observedAt, fetchDay } = input
  if (!Number.isInteger(period) || period < 1 || !Number.isFinite(observedAt.getTime())) throw new Error('A valid period and server observation time are required.')
  const selected = assignments.filter(item => item.period === period)
  if (!selected.length || selected.length > 250 || new Set(selected.map(item => item.gameId)).size !== selected.length) throw new Error('The published scoring period has no unique bounded game set.')
  const schedule = new Map<string, CalendarGame[]>()
  for (const game of currentSchedule) schedule.set(game.gameId, [...(schedule.get(game.gameId) ?? []), game])
  const byDay = new Map<string, string[]>(), futureGameIds: string[] = []
  const today = easternCalendarDay(observedAt)
  if (!today) throw new Error('The server Eastern game day is unavailable.')
  for (const item of selected) {
    const matches = schedule.get(item.gameId) ?? []
    if (matches.length !== 1 || matches[0]!.seasonType !== 'regular' || matches[0]!.replacedBy ||
      matches[0]!.startTime !== item.startsAt || /^(cancell?ed|postponed|delayed|replaced)$/i.test(matches[0]!.status ?? '')) {
      throw new Error(`Game ${item.gameId} changed from the published regular-season schedule. Review drift before refreshing scores.`)
    }
    const day = easternCalendarDay(new Date(item.startsAt))
    if (!day) throw new Error('A published game day is invalid.')
    // A game scheduled later today is still pending. The daily slate may already
    // exist, but its absence must not be presented as a missing completed game.
    if (Date.parse(item.startsAt) > observedAt.getTime() || day.getTime() > today.getTime()) { futureGameIds.push(item.gameId); continue }
    const date = day.toISOString().slice(0, 10)
    byDay.set(date, [...(byDay.get(date) ?? []), item.gameId])
  }
  if (byDay.size > MAX_DAYS) throw new Error('This period exceeds the interactive feed-check limit; use a batched worker.')
  const rawGames = new Map<string, Record<string, unknown>>(), missingGameIds: string[] = [], unknownGameIds: string[] = []
  const digests: Array<{ gameId: string; state: string; rawDigest: string }> = []
  let finalGames = 0
  for (const [day, ids] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    const feed = await fetchDay(day)
    if (feed.error || feed.notModified || feed.unsupported || !Array.isArray(feed.rows)) throw new Error(`A fresh provider slate is unavailable for ${day}; no empty game results were inferred.`)
    for (const gameId of ids) {
      const matches = feed.rows.filter(row => row && typeof row === 'object' && String((row as Record<string, unknown>).game_ID ?? '') === gameId)
      if (matches.length > 1) throw new Error(`The provider returned duplicate live rows for game ${gameId}.`)
      if (!matches.length) { missingGameIds.push(gameId); continue }
      const raw = matches[0] as Record<string, unknown>
      if (classifyRiSeasonType(raw.season_type) !== 'regular') throw new Error(`Game ${gameId} lacks verified regular-season classification in the live feed.`)
      const state = classifyRiLiveStartState(raw.status ?? raw.game_status)
      if (state === 'unknown' || state === 'postponed' || state === 'canceled') unknownGameIds.push(gameId)
      if (state === 'final') finalGames++
      rawGames.set(gameId, raw)
      digests.push({ gameId, state, rawDigest: seasonContractHash(raw) })
    }
  }
  const report: SeasonPeriodLiveSnapshot = {
    period, observedAt: observedAt.toISOString(), expectedGames: selected.length, fetchedGames: rawGames.size, finalGames,
    missingGameIds: missingGameIds.sort(), futureGameIds: futureGameIds.sort(), unknownGameIds: unknownGameIds.sort(),
    snapshotDigest: seasonContractHash({ games: digests.sort((a, b) => a.gameId.localeCompare(b.gameId)), missingGameIds: missingGameIds.sort(), futureGameIds: futureGameIds.sort() }),
    allGameRowsFinal: rawGames.size === selected.length && finalGames === selected.length && !unknownGameIds.length,
    boxAudit: auditSeasonPeriodPlayerBoxes({ sport: input.sport, rules: input.rules, rawGames }),
    exactStartVerified: false, playerCoverageVerified: false, scoringCertified: false, launchReady: false,
  }
  return { report, rawGames }
}
