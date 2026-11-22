import { projectedLetterFor, signedGapPct, type GradeLetter } from '@/lib/trade-intel/gradeScale'

/**
 * A grade for every team in a 3- or 4-team trade (2026-11-14).
 *
 * WHAT IT IS: each team's league value received against its league value sent, through the SAME
 * gap (`signedGapPct`) and the SAME letter bands (`projectedLetterFor`) as the two-team grade and the
 * completed-trade cards. So a team that gets 25% more than it gives reads A here exactly as it would
 * in a two-team deal.
 *
 * WHAT IT IS NOT: the two-team analyzer also weighs roster fit, the room's needs and Chimmy's read.
 * None of those exist for three sides yet, so this says "value only" wherever it is shown.
 *
 * 🛑 NOTHING IS GUESSED. A team whose deal touches an unpriced asset is not graded — a missing price
 * is not a worthless asset. A team that only gives, or only gets, is not graded either: there is no
 * gap to measure. Each says why.
 *
 * PURE and client-safe: it runs in the Trade Center on the values the rosters route already sent.
 */

export type MultiAsset = {
  /** Stable within one deal: `player:<id>` or `pick:<id or label>`. */
  key: string
  kind: 'player' | 'pick'
  /** Roster that sends it. */
  from: string
  /** Roster that receives it. */
  to: string
  label: string
  position?: string | null
  /** League value; null is "not priced", never 0. */
  value: number | null
  playerId?: string | null
  pickId?: string | null
}

export type TeamGrade =
  | {
      rosterId: string
      graded: true
      gets: number
      gives: number
      percentDiff: number
      letter: GradeLetter
    }
  | {
      rosterId: string
      graded: false
      why: 'gets_nothing' | 'sends_nothing' | 'unpriced'
      /** Unpriced assets this team sends or receives (for `unpriced`). */
      unpriced: number
    }

export type MultiVerdict =
  | { kind: 'incomplete' }
  | { kind: 'fair' }
  /** Every team sharing the best gap — two teams can come out equally ahead of a third. */
  | { kind: 'ahead'; rosterIds: string[] }

export const MIN_MULTI_TEAMS = 3
export const MAX_MULTI_TEAMS = 4

/** Only assets that move between two different teams in the deal count. */
export function validMoves(teamIds: readonly string[], assets: readonly MultiAsset[]): MultiAsset[] {
  const inDeal = new Set(teamIds)
  return assets.filter((a) => a.from !== a.to && inDeal.has(a.from) && inDeal.has(a.to))
}

export function gradeMultiTeam(
  teamIds: readonly string[],
  assets: readonly MultiAsset[],
): { teams: TeamGrade[]; verdict: MultiVerdict } {
  const moves = validMoves(teamIds, assets)
  const teams: TeamGrade[] = teamIds.map((rosterId) => {
    const sent = moves.filter((a) => a.from === rosterId)
    const got = moves.filter((a) => a.to === rosterId)
    const unpriced = [...sent, ...got].filter((a) => a.value == null || !Number.isFinite(a.value)).length
    if (got.length === 0) return { rosterId, graded: false, why: 'gets_nothing', unpriced }
    if (sent.length === 0) return { rosterId, graded: false, why: 'sends_nothing', unpriced }
    if (unpriced > 0) return { rosterId, graded: false, why: 'unpriced', unpriced }
    const gets = got.reduce((s, a) => s + (a.value as number), 0)
    const gives = sent.reduce((s, a) => s + (a.value as number), 0)
    const percentDiff = signedGapPct(gives, gets)
    const letter = projectedLetterFor({ percentDiff, hasSignal: gets > 0 && gives > 0 })
    if (!letter) return { rosterId, graded: false, why: 'unpriced', unpriced: 0 }
    return { rosterId, graded: true, gets, gives, percentDiff, letter }
  })

  const graded = teams.filter((t): t is Extract<TeamGrade, { graded: true }> => t.graded)
  if (teamIds.length < MIN_MULTI_TEAMS || graded.length !== teams.length) return { teams, verdict: { kind: 'incomplete' } }
  /* Who comes out ahead reads off the letters, like the two-team verdict: all C is a fair trade. */
  if (graded.every((t) => t.letter === 'C')) return { teams, verdict: { kind: 'fair' } }
  const top = Math.max(...graded.map((t) => t.percentDiff))
  return { teams, verdict: { kind: 'ahead', rosterIds: graded.filter((t) => t.percentDiff === top).map((t) => t.rosterId) } }
}
