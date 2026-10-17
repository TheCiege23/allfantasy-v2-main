import { createHash } from 'node:crypto'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { CLASS_MODEL_VERSION, type RatingGame } from '@/lib/class-rating/engine'

/**
 * Turning `dw_matchup_facts` rows into rating games — pure, so every rule is tested.
 *
 * Each rule below is binding under ADR F2.10a and was measured, not assumed:
 *
 *   1. Unplayed fixtures (0–0, no winner) are dropped — F2.10 policy 3.
 *   2. A slot that resolves to no person, or to the same person on both sides, is dropped
 *      (73 such games on production, 2026-10-01: a departed manager's fallback slot).
 *   3. One platform league imported by N users is N AF `League` rows with the same games.
 *      One AF row per `(platform, platformLeagueId)` is kept — the one with the most rows —
 *      then identical games are dropped by content as a second layer.
 *   4. Only COMPLETED weeks are rated. See `isCompleteWeek`.
 */

/** A matchup fact joined to its league and both teams' platform identities. */
export type FactRow = {
  leagueId: string
  platform: string
  platformLeagueId: string
  season: number
  week: number
  /** `LeagueTeam.platformUserId` of each side; null when the slot did not resolve. */
  userA: string | null
  userB: string | null
  /** `LeagueTeam.claimedByUserId` of each side — the AF account, when one claimed it. */
  claimA: string | null
  claimB: string | null
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
}

/** What the writer needs about each AF league to decide which of its weeks are finished. */
export type LeagueMeta = {
  leagueId: string
  /** `League.season` — the season the league is on now. */
  season: number | null
  settings: unknown
}

export const subjectKeyOf = (platform: string, platformUserId: string) => `${platform}:${platformUserId}`

/**
 * Is (league, season, week) a finished week?
 *
 * 🛑 THE SHARED FRONTIER RULE (`currentWeek.ts`) IS WRONG FOR THIS, AND IN THE DANGEROUS
 * DIRECTION. It calls a week current while it still has an UNSCORED row, so from the first
 * Thursday kickoff the in-progress week has points on every row and reads as done. The Sleeper
 * sync re-runs the live season every four hours and sets `winnerTeamId` to whoever is ahead at
 * fetch time — a rating fed that would move on partial scores, every Thursday to Monday.
 *
 * So, in the season the league is on now: rate weeks strictly BEFORE the league's stated
 * current week (Sleeper's `current_week`; 317 of 318 scored 2026 leagues carry it, measured
 * 2026-10-01). With no stated week, hold back the newest scored week. Every earlier season is
 * finished. Both fallbacks err toward rating LATER, never earlier — which also leaves room for
 * the midweek stat corrections.
 *
 * Known lag: a league whose stated week never advances past its final week holds that week back
 * until the league rolls into its next season.
 */
export function makeCompleteWeekTest(rows: FactRow[], leagues: Map<string, LeagueMeta>) {
  const newestSeason = new Map<string, number>()
  const newestScored = new Map<string, number>()
  for (const r of rows) {
    newestSeason.set(r.leagueId, Math.max(newestSeason.get(r.leagueId) ?? -Infinity, r.season))
  }
  for (const r of rows) {
    if (r.season !== newestSeason.get(r.leagueId)) continue
    if (r.scoreA > 0 || r.scoreB > 0) newestScored.set(r.leagueId, Math.max(newestScored.get(r.leagueId) ?? 0, r.week))
  }
  return (r: Pick<FactRow, 'leagueId' | 'season' | 'week'>): boolean => {
    const newest = newestSeason.get(r.leagueId)
    if (newest == null || r.season < newest) return true
    const meta = leagues.get(r.leagueId)
    // The league has rolled into a later season than any fact on file: everything here is done.
    if (meta?.season != null && meta.season > r.season) return true
    const stated = meta ? leagueWeekFromSettings(meta.settings) : null
    if (stated != null) return r.week < stated
    return r.week < (newestScored.get(r.leagueId) ?? 0)
  }
}

export type RatingInputs = {
  games: RatingGame[]
  /** Subject key → the AF account that claimed a team held by that person. */
  claimedBy: Map<string, string>
  /** sha256 over the model version and the sorted games — unchanged input, unchanged ratings. */
  inputHash: string
  counts: {
    rows: number
    unplayed: number
    unresolved: number
    selfGames: number
    duplicateLeagueRows: number
    duplicateContent: number
    incompleteWeek: number
    kept: number
  }
}

export function buildRatingInputs(rows: FactRow[], leagues: Map<string, LeagueMeta>): RatingInputs {
  const counts = {
    rows: rows.length,
    unplayed: 0,
    unresolved: 0,
    selfGames: 0,
    duplicateLeagueRows: 0,
    duplicateContent: 0,
    incompleteWeek: 0,
    kept: 0,
  }

  // Rule 3a — the AF row kept per platform league: most rows, then the smallest id (stable).
  const perAf = new Map<string, number>()
  for (const r of rows) perAf.set(r.leagueId, (perAf.get(r.leagueId) ?? 0) + 1)
  const keep = new Map<string, string>()
  for (const r of rows) {
    const k = `${r.platform}|${r.platformLeagueId}`
    const cur = keep.get(k)
    if (
      cur == null ||
      perAf.get(r.leagueId)! > perAf.get(cur)! ||
      (perAf.get(r.leagueId) === perAf.get(cur) && r.leagueId < cur)
    )
      keep.set(k, r.leagueId)
  }

  const complete = makeCompleteWeekTest(rows, leagues)
  const seen = new Set<string>()
  const games: RatingGame[] = []
  const claims = new Map<string, Map<string, number>>()
  const noteClaim = (subject: string, userId: string | null) => {
    if (!userId) return
    const m = claims.get(subject) ?? new Map<string, number>()
    m.set(userId, (m.get(userId) ?? 0) + 1)
    claims.set(subject, m)
  }

  for (const r of rows) {
    if (r.scoreA === 0 && r.scoreB === 0 && r.winnerTeamId == null) {
      counts.unplayed++
      continue
    }
    if (!r.userA || !r.userB) {
      counts.unresolved++
      continue
    }
    if (r.userA === r.userB) {
      counts.selfGames++
      continue
    }
    if (keep.get(`${r.platform}|${r.platformLeagueId}`) !== r.leagueId) {
      counts.duplicateLeagueRows++
      continue
    }
    if (!complete(r)) {
      counts.incompleteWeek++
      continue
    }
    const a = subjectKeyOf(r.platform, r.userA)
    const b = subjectKeyOf(r.platform, r.userB)
    const [p1, p2] = a < b ? [a, b] : [b, a]
    const content = `${r.season}|${r.week}|${p1}|${p2}|${Math.round((r.scoreA + r.scoreB) * 10)}`
    if (seen.has(content)) {
      counts.duplicateContent++
      continue
    }
    seen.add(content)
    noteClaim(a, r.claimA)
    noteClaim(b, r.claimB)
    games.push({ leagueId: r.leagueId, season: r.season, week: r.week, a, b, scoreA: r.scoreA, scoreB: r.scoreB })
  }
  counts.kept = games.length

  // The claiming account: the one seen on most of this person's games, then the smallest id.
  const claimedBy = new Map<string, string>()
  for (const [subject, m] of claims) {
    const [best] = [...m.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    claimedBy.set(subject, best[0])
  }

  const hash = createHash('sha256')
  hash.update(CLASS_MODEL_VERSION)
  const ordered = games
    .map((gm) => `${gm.season}|${gm.week}|${gm.leagueId}|${gm.a}|${gm.b}|${gm.scoreA}|${gm.scoreB}`)
    .sort()
  for (const line of ordered) hash.update(`\n${line}`)
  // Claims are part of the output, so a newly claimed team must trigger a write too.
  for (const [s, u] of [...claimedBy.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) hash.update(`\nc|${s}|${u}`)

  return { games, claimedBy, inputHash: hash.digest('hex'), counts }
}
