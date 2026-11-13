import { bestLineup, type ScenarioModel, type ScenarioPlayer } from './outlookScenario'
import { describeScoringDifferences } from './scoringNotes'

/**
 * War Room phase 3 — the league's format brief: what THIS league's rules reward, and where it is won.
 *
 * A settings page lists rules. A strategist says what they mean for the roster, and the strongest
 * version of that is not a rule of thumb ("superflex makes QBs valuable") but a measurement of this
 * league: across every team's best lineup, how far the average starter at each position sits above
 * the best player nobody rosters. A big gap is a position where a good starter is hard to replace —
 * where the league is won. That gap, and where your own starters sit against the league, are the
 * centre of the brief.
 *
 * ⚠ EVERY NUMBER IS READ OFF THE LEAGUE'S OWN DATA. Starters and free agents are Season Outlook's
 * roster model (`ScenarioModel`, DB-backed, league-scored on one projection week); the scoring lines
 * are `describeScoringDifferences`, which reads only the league's own `scoring_settings` and says
 * nothing about a key the league did not record. Nothing comes from a format label.
 *
 * ⚠ YOUR TEAM AGAINST THE LEAGUE, NEVER AGAINST A NAMED RIVAL. The comparison is to the league
 * average at each position — Scout's contract (facts, not labels) is unaffected.
 *
 * Pure and client-safe.
 */

export type ScarcityRow = {
  position: string
  /** Starters counted at this position across the league's best lineups. */
  starters: number
  /** Average projection-week points of those starters. */
  avgStarter: number
  /** The best unrostered player at this position, or null when the scanned pool has none. */
  bestFreeAgent: { name: string; points: number } | null
  /** avgStarter − bestFreeAgent. Null without a free agent to measure against. */
  gap: number | null
  /** Your own starters' average here, or null when you start nobody at this position. */
  you: number | null
  /** you − avgStarter: your edge (+) or hole (−) at this position. */
  youVsLeague: number | null
}

export type FormatBrief = {
  /** The lineup the league starts, slot by slot, in the league's own order, counted. */
  lineup: Array<{ slot: string; count: number }>
  /** True when a slot can start a quarterback beside the QB slot — superflex / 2QB. */
  twoQb: boolean
  /** Rules that differ from standard PPR, in the shared plain-language wording. */
  scoringNotes: string[]
  /** Most scarce first. Empty when the rosters could not be priced. */
  scarcity: ScarcityRow[]
  calendar: {
    playoffTeams: number | null
    byeTeams: number | null
    playoffStartWeek: number | null
    tradeDeadlineWeek: number | null
    weeksRemaining: number | null
  }
  basisWeek: { season: string; week: number } | null
  /** Why the scarcity section is empty, in the roster model's own words, when it is. */
  scarcityRefusal: string | null
}

/** Positions with fewer starters than this per team are not compared — too few to average honestly. */
const MIN_STARTERS_PER_TEAM = 0.5

const round1 = (n: number) => Math.round(n * 10) / 10

/** Slots that can hold a quarterback but are not the QB slot itself. */
const TWO_QB_SLOTS = new Set(['SUPER_FLEX', 'SUPERFLEX', 'SF', 'OP', 'QB2'])

function countSlots(slots: readonly string[]): Array<{ slot: string; count: number }> {
  const out: Array<{ slot: string; count: number }> = []
  for (const raw of slots) {
    const slot = raw.toUpperCase()
    if (slot === 'BN' || slot === 'BENCH' || slot === 'IR' || slot === 'TAXI') continue
    const row = out.find((r) => r.slot === slot)
    if (row) row.count += 1
    else out.push({ slot, count: 1 })
  }
  return out
}

/**
 * Measured scarcity: every team's best lineup on the projection week, its starters grouped by
 * position, against the best free agent at that position.
 */
export function measureScarcity(model: ScenarioModel): ScarcityRow[] {
  if (model.refusal || model.slots.length === 0 || model.teams.length === 0) return []
  const byPos = new Map<string, number[]>()
  const mine = new Map<string, number[]>()
  for (const team of model.teams) {
    const lineup = bestLineup(team.players, model.slots)
    if (lineup.unknown.length > 0) continue
    const byId = new Map(team.players.map((p) => [p.id, p]))
    for (const id of lineup.starterIds) {
      const p = byId.get(id)
      if (!p?.position || p.points == null) continue
      const pos = p.position.toUpperCase()
      byPos.set(pos, [...(byPos.get(pos) ?? []), p.points])
      if (team.rosterId === model.youRosterId) mine.set(pos, [...(mine.get(pos) ?? []), p.points])
    }
  }
  const bestFa = new Map<string, ScenarioPlayer>()
  for (const fa of model.freeAgents) {
    if (!fa.position || fa.points == null) continue
    const pos = fa.position.toUpperCase()
    const cur = bestFa.get(pos)
    if (!cur || (fa.points as number) > (cur.points as number)) bestFa.set(pos, fa)
  }
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const rows: ScarcityRow[] = []
  for (const [position, pts] of byPos) {
    if (pts.length < model.teams.length * MIN_STARTERS_PER_TEAM) continue
    const avgStarter = avg(pts)
    const fa = bestFa.get(position) ?? null
    const myPts = mine.get(position) ?? null
    const you = myPts && myPts.length > 0 ? avg(myPts) : null
    rows.push({
      position,
      starters: pts.length,
      avgStarter: round1(avgStarter),
      bestFreeAgent: fa ? { name: fa.name, points: round1(fa.points as number) } : null,
      gap: fa ? round1(avgStarter - (fa.points as number)) : null,
      you: you == null ? null : round1(you),
      youVsLeague: you == null ? null : round1(you - avgStarter),
    })
  }
  // Most scarce first; a position we cannot measure (no free agent scanned) goes last rather than vanishing.
  return rows.sort((a, b) => (b.gap ?? Number.NEGATIVE_INFINITY) - (a.gap ?? Number.NEGATIVE_INFINITY) || a.position.localeCompare(b.position))
}

export function buildFormatBrief(args: {
  model: ScenarioModel | null
  /** `extractScoringSettings(league.settings)`. */
  scoringSettings: Record<string, unknown> | null
  playoffTeams: number | null
  byeTeams: number | null
  playoffStartWeek: number | null
  tradeDeadlineWeek: number | null
  weeksRemaining: number | null
}): FormatBrief {
  const slots = args.model?.slots ?? []
  const lineup = countSlots(slots)
  return {
    lineup,
    twoQb: lineup.some((r) => TWO_QB_SLOTS.has(r.slot)) || (lineup.find((r) => r.slot === 'QB')?.count ?? 0) >= 2,
    scoringNotes: describeScoringDifferences(args.scoringSettings),
    scarcity: args.model ? measureScarcity(args.model) : [],
    calendar: {
      playoffTeams: args.playoffTeams,
      byeTeams: args.byeTeams,
      playoffStartWeek: args.playoffStartWeek,
      tradeDeadlineWeek: args.tradeDeadlineWeek,
      weeksRemaining: args.weeksRemaining,
    },
    basisWeek: args.model?.basisWeek ?? null,
    scarcityRefusal: args.model ? args.model.refusal : 'Rosters could not be read for this league.',
  }
}
