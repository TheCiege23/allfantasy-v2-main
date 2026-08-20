/**
 * Standings 9a — streak and all-play, derived from real weekly results.
 *
 * Both columns the 9a handoff adds to the standings table are COMPUTED FROM `TeamWeekResult`
 * (per-week `totalPoints` / `opponentRosterId` / `winLoss`), never invented:
 *
 *   streak    the trailing run of identical outcomes, most recent week first → "W4", "L1"
 *   all-play  how the team would have fared against EVERY other team each week, summed over
 *             the season → "92-29". A schedule-luck measure: a team can be 7-4 head-to-head
 *             while its all-play record says it has been the second-best team all year.
 *
 * Pure and DB-free so the arithmetic is unit-testable without a database, matching the
 * normalizer/writer split used elsewhere in this repo.
 *
 * ⚠ Weeks with no recorded result are SKIPPED, not counted as losses. A team that has not
 * played (bye, unprocessed week, mid-season import) must not be punished by the absence of a
 * row — that would turn missing data into a visible negative signal.
 */

/** One roster's aggregated result for one week (the subset of `TeamWeekResult` used here). */
export interface WeekResultInput {
  week: number
  rosterId: string
  totalPoints: number
  /** 'W' | 'L' | 'T' in any casing, or the long forms. Null/absent when the week is unplayed. */
  winLoss?: string | null
}

export type Outcome = 'W' | 'L' | 'T'

export interface AllPlayRecord {
  wins: number
  losses: number
  ties: number
}

/** Normalize the stored `winLoss` string to a single-letter outcome, or null when unplayed. */
export function normalizeOutcome(raw: string | null | undefined): Outcome | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toUpperCase()
  if (!s) return null
  if (s.startsWith('W')) return 'W'
  if (s.startsWith('L')) return 'L'
  if (s.startsWith('T') || s.startsWith('D')) return 'T' // 'tie' / 'draw'
  return null
}

/**
 * Current streak per roster: the trailing run of identical outcomes.
 *
 * Weeks are ordered ascending and the run is measured from the LATEST played week backwards, so
 * an unplayed trailing week cannot silently reset a streak. Returns null for a roster with no
 * played weeks — the caller renders a dash rather than a fabricated "W0".
 */
export function computeStreaks(
  results: readonly WeekResultInput[],
): Map<string, { outcome: Outcome; length: number }> {
  const byRoster = new Map<string, WeekResultInput[]>()
  for (const r of results) {
    const list = byRoster.get(r.rosterId)
    if (list) list.push(r)
    else byRoster.set(r.rosterId, [r])
  }

  const out = new Map<string, { outcome: Outcome; length: number }>()
  for (const [rosterId, list] of byRoster) {
    const played = list
      .slice()
      .sort((a, b) => a.week - b.week)
      .map((r) => normalizeOutcome(r.winLoss))
      .filter((o): o is Outcome => o !== null)

    if (played.length === 0) continue
    const outcome = played[played.length - 1]
    let length = 0
    for (let i = played.length - 1; i >= 0 && played[i] === outcome; i -= 1) length += 1
    out.set(rosterId, { outcome, length })
  }
  return out
}

/**
 * All-play record per roster: each week, compare a team's score against every OTHER team that
 * played that week. Equal scores count as ties for both teams.
 *
 * A week with fewer than two played rosters contributes nothing — there is no opponent set to
 * compare against, and a single-team week is not evidence of anything.
 */
export function computeAllPlay(results: readonly WeekResultInput[]): Map<string, AllPlayRecord> {
  const byWeek = new Map<number, WeekResultInput[]>()
  for (const r of results) {
    // A roster with no recorded outcome has not played; excluding it keeps unplayed weeks from
    // counting as an automatic loss for everyone else in that week's comparison set.
    if (normalizeOutcome(r.winLoss) === null) continue
    if (!Number.isFinite(r.totalPoints)) continue
    const list = byWeek.get(r.week)
    if (list) list.push(r)
    else byWeek.set(r.week, [r])
  }

  const out = new Map<string, AllPlayRecord>()
  const bump = (rosterId: string, k: keyof AllPlayRecord) => {
    const rec = out.get(rosterId) ?? { wins: 0, losses: 0, ties: 0 }
    rec[k] += 1
    out.set(rosterId, rec)
  }

  for (const [, week] of byWeek) {
    if (week.length < 2) continue
    for (let i = 0; i < week.length; i += 1) {
      for (let j = i + 1; j < week.length; j += 1) {
        const a = week[i]
        const b = week[j]
        if (a.totalPoints > b.totalPoints) {
          bump(a.rosterId, 'wins')
          bump(b.rosterId, 'losses')
        } else if (a.totalPoints < b.totalPoints) {
          bump(a.rosterId, 'losses')
          bump(b.rosterId, 'wins')
        } else {
          bump(a.rosterId, 'ties')
          bump(b.rosterId, 'ties')
        }
      }
    }
  }
  return out
}

/** Display form for a streak — "W4" / "L1". Null in, dash out; never "W0". */
export function formatStreak(s: { outcome: Outcome; length: number } | undefined | null): string {
  if (!s || s.length <= 0) return '—'
  return `${s.outcome}${s.length}`
}

/** Display form for an all-play record — "92-29", ties appended only when non-zero. */
export function formatAllPlay(r: AllPlayRecord | undefined | null): string {
  if (!r) return '—'
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`
}
