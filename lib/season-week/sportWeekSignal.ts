/**
 * Which sports can be asked "what week is it" from the schedule feed, and the
 * pure resolver that answers it.
 *
 * 🛑 THE ALLOWLIST BELOW IS A MEASUREMENT, NOT A POLICY. `SportsGame.week` is a
 * nullable Int written by several providers, and for the daily sports it is
 * filled with values that are not weeks at all. Measured against production
 * (`icy-field-51189449`, 2026-09-07), grouping `SportsGame` by sport/season:
 *
 *   NFL    2026 regular   weeks 1-18   288 games   seasonType populated   ✅
 *   NCAAF  2026 regular   weeks 1-15   4139 games  seasonType populated   ✅
 *   SOCCER 2026           weeks 1-38   408 games   (matchweeks)           ✅
 *   NBA    2026           weeks 0-0    53 games                           ❌
 *   NBA    2025           weeks 0-500  1386 games                         ❌
 *   NHL    2026           weeks 1-500  1414 games                         ❌
 *   NCAAB  2025 + 2026    week 0 only  4256 games                         ❌
 *   MLB    2025           weeks 1-500  2915 games                         ❌
 *   MLB    2026           weeks 1-26   5333 games  (plausible, but 2025
 *                                       is not, so the column is not
 *                                       dependable for this sport)        ❌
 *
 * The excluded sports are the ones whose lineups lock daily rather than at
 * kickoff (`lib/sportConfig/configs/*.ts` -> `lineupLockType: 'daily'`), so a
 * "week" there is a calendar construct the league owns, not something the game
 * feed can report. Answering them needs a season-start anchor, and the table
 * built for that (`season_calendars`) holds ZERO ROWS in production — so there
 * is nothing to anchor to yet and this module declines rather than inventing
 * one. That is the open half of the work, recorded rather than guessed at.
 */

import { normalizeLiveGameStatus } from '@/lib/live-scoring/cadence'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'
import { pickFreshestSourceRows } from '@/lib/sports-live-scores-service'
import type {
  ScheduleRow,
  ScheduleSeasonType,
  SportWeekResolution,
  SportWeekSlate,
  SportWeekState,
} from './types'

/** Sports whose schedule feed carries a week we can read. See the header. */
const WEEK_SIGNAL_SPORTS = new Set(['NFL', 'NCAAF', 'SOCCER'])

/**
 * No real sport week exceeds this. A feed writing 500 (NBA, NHL and MLB all do)
 * is writing something other than a week, and the backstop catches that even if
 * the allowlist above is later widened by hand.
 */
export const MAX_PLAUSIBLE_SPORT_WEEK = 60

/*
 * ⚠ THERE IS DELIBERATELY NO "AT LEAST N DISTINCT WEEKS" CHECK, AND ONE WAS
 * REMOVED HERE. It read well — "a season filed under a single week is a default,
 * not a numbering" — and it was pure false-refusal: every garbage case it was
 * written for is a week 0 or a week 500, which the range check above already
 * rejects on its own. What it added instead was a refusal for the legitimate
 * case of a window that happens to contain one week, which is exactly what an
 * opening week looks like. Caught by its own test fixture; kept out on purpose.
 */

/**
 * Map a league's sport to the vocabulary `SportsGame.sport` actually uses.
 *
 * ⚠ `RedraftSeason.sport` DISAGREES WITH ITSELF ACROSS THE TWO WRITERS.
 * `finalizeDraftToRedraftSeason` stores `leagueSportToConfigSport(...)`, which
 * maps NCAAF -> **NCAAFB** (a `lib/sportConfig` key); the import materializer
 * stores the raw `NCAAF`. `SportsGame` only ever holds `NCAAF`, so a natively
 * drafted college league would join against nothing at all without this.
 */
export function toScheduleSportKey(sport: string): string {
  const upper = String(sport ?? '').trim().toUpperCase()
  if (upper === 'NCAAFB' || upper === 'CFB' || upper === 'COLLEGE_FOOTBALL') return 'NCAAF'
  if (upper === 'NCAABB') return 'NCAAB'
  if (upper === 'FOOTBALL') return 'SOCCER'
  return upper
}

/** Whether the schedule feed can be asked for this sport's week at all. */
export function sportHasWeekSignal(sport: string): boolean {
  return WEEK_SIGNAL_SPORTS.has(toScheduleSportKey(sport))
}

function isLiveStatus(raw: string | null): boolean {
  const status = normalizeLiveGameStatus(raw)
  return status === 'in_progress' || status === 'halftime' || status === 'overtime'
}

function isFinalStatus(raw: string | null): boolean {
  return normalizeLiveGameStatus(raw) === 'final'
}

/**
 * Group dated rows into per-week slates, deduplicating sources WITHIN each week.
 *
 * ⚠ THE DEDUP IS PER WEEK ON PURPOSE, AND RUNNING IT ACROSS THE SEASON LOSES
 * WEEKS. `pickFreshestSourceRows` returns ONE source's rows — never a blend —
 * because this table keeps a row per source per fixture. Source coverage here is
 * uneven: measured 2026-09-07, NFL 2026 week 1 carries 32 rows from 2 sources
 * (16 real fixtures, doubled) while weeks 2 and 3 carry 16 from 1. Picking a
 * single source for the whole season would have dropped every week the winning
 * source happens not to cover.
 */
function buildSlates(rows: readonly ScheduleRow[], now: Date): SportWeekSlate[] {
  const byWeek = new Map<string, ScheduleRow[]>()

  for (const row of rows) {
    if (row.week == null || !Number.isFinite(row.week)) continue
    if (row.startTime == null) continue
    const seasonType = normalizeSeasonType(row.seasonType)
    // A row with no season type cannot be filed: preseason week 1 and regular
    // week 1 are the same key without it. Treat the absence as "regular" only
    // when nothing in the set disagrees — handled by the caller's query, which
    // already scopes to one season type.
    const key = `${seasonType ?? 'regular'}:${row.week}`
    const bucket = byWeek.get(key)
    if (bucket) bucket.push(row)
    else byWeek.set(key, [row])
  }

  const slates: SportWeekSlate[] = []
  for (const [key, bucket] of byWeek) {
    const deduped = pickFreshestSourceRows(bucket, now.getTime())
    if (deduped.length === 0) continue

    const times = deduped
      .map((r) => r.startTime)
      .filter((d): d is Date => d instanceof Date)
      .map((d) => d.getTime())
    if (times.length === 0) continue

    const liveCount = deduped.filter((r) => isLiveStatus(r.status)).length
    const finalCount = deduped.filter((r) => isFinalStatus(r.status)).length

    slates.push({
      week: Number(key.split(':')[1]),
      seasonType: (key.split(':')[0] as ScheduleSeasonType) ?? 'regular',
      gameCount: deduped.length,
      firstKickoffAt: new Date(Math.min(...times)),
      lastKickoffAt: new Date(Math.max(...times)),
      liveCount,
      finalCount,
      allFinal: finalCount === deduped.length,
    })
  }

  return slates.sort((a, b) => a.week - b.week)
}

function stateFor(slate: SportWeekSlate, now: Date): SportWeekState {
  if (slate.liveCount > 0) return 'live'
  if (now.getTime() < slate.firstKickoffAt.getTime()) return 'upcoming'
  // ⚠ `allFinal` ALONE IS NOT ENOUGH, AND THE FAILURE IS SILENT. A feed that has
  // not yet ingested the late slate reports the games it does hold as final and
  // nothing else — so every row is final while the Sunday night game has not
  // kicked off. Requiring the last kickoff to have passed makes a partially
  // ingested week read as `between` (unknown), which is what it is.
  if (slate.allFinal && now.getTime() >= slate.lastKickoffAt.getTime()) return 'played'
  // Kickoff has passed and something is still not final: a postponement, or a
  // feed that has not caught up. Deliberately NOT 'played' — the caller must be
  // able to tell "the week is over" from "the week looks over".
  return 'between'
}

/**
 * Which sport week is current, decided from the schedule and nothing else.
 *
 * The order of preference, and why:
 *  1. A week with a game IN PLAY is the current week, full stop — no calendar
 *     reading beats a game that is on television right now.
 *  2. Otherwise the LATEST week whose first kickoff has passed. That keeps the
 *     answer on the week just played through the Monday-to-Thursday gap, rather
 *     than jumping to the next week the moment the last whistle blows. Callers
 *     that want "has this week finished" read `state`/`allFinal`, which is a
 *     different question and stays separable.
 *  3. If no kickoff has passed, the season has not started: report the first
 *     week as `upcoming` rather than declining, because "not started" is a real
 *     answer and a roller needs to distinguish it from "cannot tell".
 */
export function resolveSportWeekFromSchedule(
  rows: readonly ScheduleRow[],
  now: Date,
): SportWeekResolution {
  if (rows.length === 0) return { ok: false, reason: 'NO_SCHEDULE_ROWS' }

  const slates = buildSlates(rows, now)
  if (slates.length === 0) return { ok: false, reason: 'NO_DATED_ROWS' }

  // The backstop the allowlist cannot provide: even an allowlisted sport gets
  // rejected if the feed's week numbering is not week numbering.
  const weeks = slates.map((s) => s.week)
  if (weeks.some((w) => w < 1 || w > MAX_PLAUSIBLE_SPORT_WEEK)) {
    return { ok: false, reason: 'IMPLAUSIBLE_WEEKS' }
  }

  const nowMs = now.getTime()

  const live = slates.filter((s) => s.liveCount > 0)
  const started = slates.filter((s) => s.firstKickoffAt.getTime() <= nowMs)

  const current =
    // Latest live week, so a Thursday game does not lose to a Sunday one.
    (live.length > 0 ? live[live.length - 1] : null) ??
    (started.length > 0 ? started[started.length - 1] : null) ??
    slates[0]

  const index = slates.findIndex((s) => s.week === current.week)
  const next = index >= 0 && index + 1 < slates.length ? slates[index + 1].week : null

  return {
    ok: true,
    sportWeek: current.week,
    seasonType: current.seasonType,
    state: stateFor(current, now),
    slate: current,
    nextSportWeek: next,
    source: 'schedule',
  }
}
