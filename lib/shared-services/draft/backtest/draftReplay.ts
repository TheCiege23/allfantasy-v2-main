import { computeDraftRecommendation, type RecommendationPlayer, type VorpMode } from '@/lib/draft-helper/RecommendationEngine'

/**
 * Draft backtest core (2026-11-14): replay real completed drafts pick by pick and score what the
 * ONE draft engine would have recommended — once per replacement-value mode — against what the
 * recommended players actually went on to score.
 *
 * PURE. The loader (not in this file) supplies the drafts, a market and an outcome table. Two rules
 * keep the result honest, and both are the caller's job to respect:
 *
 *   1. NO LOOK-AHEAD IN THE INPUTS. `market` must be what was knowable when the draft happened: ADP
 *      and projections captured before it (e.g. the 2026-03-08 preseason ADP in
 *      data/nfl-adp-multiplatform.csv), never today's — today's ADP and projections already price in
 *      the season, and would flatter whichever mode leans on them hardest.
 *   2. OUTCOMES ARE THE ONLY THING FROM AFTER THE DRAFT. `outcomePoints` is what each player scored
 *      over the window being judged.
 *
 * Each sampled pick is reconstructed exactly: the pool is the market minus every player taken
 * earlier in that draft, the roster is that team's earlier picks. Picks in round 1 are skipped (no
 * roster to reason about), as are players the market or the outcome table cannot place.
 */

export type ReplayPick = {
  overall: number
  round: number
  /** Whoever made the pick — a roster id or a Sleeper user id; only equality matters. */
  teamKey: string
  playerName: string
  position: string
}

export type ReplayDraft = {
  id: string
  totalTeams: number
  rosterSlots: string[]
  picks: ReplayPick[]
}

export type ReplayRow = {
  draftId: string
  overall: number
  round: number
  actual: { name: string; points: number | null }
  byMode: Partial<Record<VorpMode, { name: string; points: number | null }>>
}

export function replayKey(name: string, position: string): string {
  return `${String(name ?? '').trim().toLowerCase()}|${String(position ?? '').trim().toUpperCase()}`
}

export function replayDraft(args: {
  draft: ReplayDraft
  /** Pre-draft market: name, position, team, ADP and (optionally) pre-draft projections. */
  market: readonly RecommendationPlayer[]
  /** replayKey → points scored over the judged window. */
  outcomePoints: ReadonlyMap<string, number>
  modes: readonly VorpMode[]
  /** Rounds to sample; default every round from 2. */
  rounds?: readonly number[]
}): ReplayRow[] {
  const { draft, market, outcomePoints, modes } = args
  const picks = [...draft.picks].sort((a, b) => a.overall - b.overall)
  const rows: ReplayRow[] = []
  for (const pick of picks) {
    if (pick.round < 2) continue
    if (args.rounds && !args.rounds.includes(pick.round)) continue
    const taken = new Set(picks.filter((p) => p.overall < pick.overall).map((p) => replayKey(p.playerName, p.position)))
    const available = market.filter((p) => !taken.has(replayKey(p.name, p.position)))
    if (available.length === 0) continue
    const teamRoster = picks
      .filter((p) => p.overall < pick.overall && p.teamKey === pick.teamKey)
      .map((p) => ({ position: p.position }))
    const pickInRound = ((pick.overall - 1) % Math.max(1, draft.totalTeams)) + 1
    const pointsOf = (name: string, position: string) => outcomePoints.get(replayKey(name, position)) ?? null

    const byMode: ReplayRow['byMode'] = {}
    for (const mode of modes) {
      const rec = computeDraftRecommendation({
        available,
        teamRoster,
        rosterSlots: draft.rosterSlots,
        round: pick.round,
        pick: pickInRound,
        totalTeams: draft.totalTeams,
        sport: 'NFL',
        mode: 'needs',
        vorpMode: mode,
      }).recommendation
      if (rec) byMode[mode] = { name: rec.player.name, points: pointsOf(rec.player.name, rec.player.position) }
    }
    rows.push({
      draftId: draft.id,
      overall: pick.overall,
      round: pick.round,
      actual: { name: pick.playerName, points: pointsOf(pick.playerName, pick.position) },
      byMode,
    })
  }
  return rows
}

export type ModeComparison = {
  /** Picks where both modes recommended someone with a known outcome. */
  compared: number
  /** Of those, picks where the two modes recommended different players. */
  disagreed: number
  /** On disagreements: how often each mode's player outscored the other's. */
  aWins: number
  bWins: number
  ties: number
  /** Mean (a − b) points over disagreements. */
  meanDiff: number | null
  /** Two-sided sign-test p-value on wins vs losses (ties dropped). */
  signTestP: number | null
}

/** Two-sided exact binomial (p = 0.5) sign test. */
export function signTestP(wins: number, losses: number): number | null {
  const n = wins + losses
  if (n === 0) return null
  const k = Math.min(wins, losses)
  let logChoose = 0
  let tail = 0
  for (let i = 0; i <= k; i++) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i)
    tail += Math.exp(logChoose - n * Math.LN2)
  }
  return Math.min(1, 2 * tail)
}

export function compareModes(rows: readonly ReplayRow[], a: VorpMode, b: VorpMode): ModeComparison {
  let compared = 0
  let disagreed = 0
  let aWins = 0
  let bWins = 0
  let ties = 0
  let diffSum = 0
  for (const r of rows) {
    const ra = r.byMode[a]
    const rb = r.byMode[b]
    if (!ra || !rb || ra.points == null || rb.points == null) continue
    compared++
    if (ra.name === rb.name) continue
    disagreed++
    const d = ra.points - rb.points
    diffSum += d
    if (d > 0) aWins++
    else if (d < 0) bWins++
    else ties++
  }
  return {
    compared,
    disagreed,
    aWins,
    bWins,
    ties,
    meanDiff: disagreed ? Math.round((diffSum / disagreed) * 10) / 10 : null,
    signTestP: signTestP(aWins, bWins),
  }
}
