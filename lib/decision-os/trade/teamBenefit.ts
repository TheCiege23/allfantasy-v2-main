/**
 * TEAM BENEFIT — the design's value engine (`docs/TRADE_EVALUATOR_DESIGN.md`, "Value engine",
 * build-order step 3). PURE: players, rosters and a horizon in; per-side package value, forced drops,
 * multi-week lineup impact, a fairness label and the design's 60/40 letter out. The loader that reads
 * the data is `./teamBenefitContext.ts`.
 *
 * 🛑 SHADOW ONLY (Guap, 2026-09-27). Nothing here changes the letter a manager is shown — that stays
 * the one grade (`./tradeGrade.ts`). This rides on the receipt beside it, and the receipt records
 * whether the two letters agree, so the switch can be decided on measured disagreement, not a guess.
 *
 * 🛑 ONE PER-GAME RATE FOR EVERY REMAINING WEEK — AN APPROXIMATION, AND SAID SO ON EVERY RESULT.
 * No future-week projections exist anywhere in the data (the daily import writes the current week
 * only). Each remaining week reuses this week's league-scored per-game projection, then varies it
 * by what IS known per week: the bye (from the schedule), the injury availability curve, and the
 * 1.5× playoff weighting. `horizon.approximation` carries that sentence onto the receipt.
 *
 * Deliberate choices, each flagged where it bites:
 *   - Replacement level is the best projected FREE AGENT at the position in THIS league (design),
 *     not a starters-times-teams baseline.
 *   - Picks and FAAB are outside this model (NFL redraft first). A deal that carries them gets its
 *     lineup numbers but no design letter — named in `notes`, never priced at a placeholder.
 *   - `LINEUP_WEIGHTING_SCALE` turns a lineup change in percent into the package gap's units. The
 *     design fixes the 60/40 weights but not this scale; it is UNCALIBRATED, and the model version
 *     says so, until the shadow comparison gives it a measured value.
 */
import { computeOptimalLineup, type LineupSlotSpec, type OptimizerPlayerInput } from '@/lib/lineup-optimizer/optimalLineup'
import { projectedLetterFor, type GradeLetter } from '@/lib/trade-intel/gradeScale'

export const TEAM_BENEFIT_MODEL = 'team-benefit-v1-uncalibrated'

/** Design starting weights (to be tuned by replaying completed trades). */
export const VORP_WEIGHT = 0.7
export const MARKET_WEIGHT = 0.3
export const DEPTH_DISCOUNT = 0.85
export const PLAYOFF_MULTIPLIER = 1.5
export const LINEUP_GRADE_WEIGHT = 0.6
export const PACKAGE_GRADE_WEIGHT = 0.4
/** A 1% change in weekly starting points counts as a 5-point package gap. UNCALIBRATED — see header. */
export const LINEUP_WEIGHTING_SCALE = 5
/** NFL minimum stay on injured reserve: the earliest week a player on IR can return. */
export const IR_MINIMUM_WEEKS = 4

export const FLAT_RATE_APPROXIMATION =
  'Every remaining week uses this week’s league-scored per-game projection, adjusted per week for byes, injury availability and 1.5× playoff weeks. Future-week projections are not available.'

export type BenefitPlayer = {
  playerId: string
  name: string
  position: string
  team: string | null
  /** League-scored projected points for one game this week. Null: not projected. */
  perGame: number | null
  injuryStatus: string | null
  byeWeek: number | null
  /** Market value (FantasyCalc, this league's format). Null: the market does not list him. */
  marketValue: number | null
}

export type BenefitHorizon = {
  currentWeek: number
  finalWeek: number
  /** First fantasy-playoff week, when the league states one. */
  playoffStartWeek: number | null
}

export type BenefitSideInput = {
  teamId: string
  /** Active roster before the trade (reserve and taxi excluded). */
  activeIds: readonly string[]
  /** Players this side sends. */
  givesPlayerIds: readonly string[]
  /** Picks / FAAB this side sends — outside the model, named in notes. */
  givesOther: readonly string[]
}

export type TeamBenefitInput = {
  horizon: BenefitHorizon
  seats: readonly LineupSlotSpec[]
  /** Active roster capacity (starters + bench). Null: unknown — no forced drops are assumed. */
  rosterCapacity: number | null
  players: ReadonlyMap<string, BenefitPlayer>
  /** Every rostered player in the league — the normalization pool with the free agents. */
  leaguePlayerIds: readonly string[]
  freeAgentIds: readonly string[]
  /** [perspective side, other side]. */
  sides: readonly [BenefitSideInput, BenefitSideInput]
}

export type BenefitAssetLine = {
  playerId: string
  name: string
  position: string
  value: number
  vorp: number
  rosPoints: number
  marketValue: number | null
  injuryStatus: string | null
  byeInPlayoffs: boolean
}

export type BenefitSide = {
  teamId: string
  receives: BenefitAssetLine[]
  /** Blended package value received, net of forced drops. */
  packageReceived: number
  forcedDrops: { playerId: string; name: string; value: number }[]
  /** Average change in optimal starting points per remaining week. */
  lineupDeltaPerWeek: number
  lineupBeforePerWeek: number
  /** The design's 60/40 letter for this side. Null when the model cannot grade the deal. */
  grade: GradeLetter | null
}

export type FairnessLabel = 'fair' | 'leans' | 'lopsided' | 'heavily_lopsided'

export type TeamBenefit = {
  model: string
  horizon: BenefitHorizon & { weeks: number[]; playoffWeeks: number[]; approximation: string }
  sides: [BenefitSide, BenefitSide]
  /** Signed from the perspective side, in percent of the larger package. */
  gapPct: number
  fairnessLabel: FairnessLabel
  notes: string[]
}

export type TeamBenefitResult = { ok: true; benefit: TeamBenefit } | { ok: false; reason: string; missingAssets: string[] }

// ── Availability ─────────────────────────────────────────────────────────────

/** The design's injury table. `offset` 0 is this week. Unknown or healthy statuses are available. */
export function availability(status: string | null | undefined, offset: number): number {
  const s = String(status ?? '').trim().toLowerCase()
  if (!s || ['active', 'healthy', 'act'].includes(s)) return 1
  if (s === 'q' || s === 'questionable') return offset === 0 ? 0.75 : 1
  if (s === 'd' || s === 'doubtful') return offset === 0 ? 0.25 : 1
  if (['ir', 'pup', 'nfi', 'injured reserve'].includes(s)) return offset < IR_MINIMUM_WEEKS ? 0 : 1
  if (['o', 'out', 'sus', 'suspended', 'inactive', 'na', 'cov'].includes(s)) return offset === 0 ? 0 : offset === 1 ? 0.9 : 1
  return 1
}

// ── Horizon ─────────────────────────────────────────────────────────────────

export function horizonWeeks(h: BenefitHorizon): { weeks: number[]; playoffWeeks: number[] } {
  const weeks: number[] = []
  for (let w = h.currentWeek; w <= h.finalWeek; w++) weeks.push(w)
  const playoffWeeks = h.playoffStartWeek != null ? weeks.filter((w) => w >= h.playoffStartWeek!) : []
  return { weeks, playoffWeeks }
}

/** One player's projected points in one week: rate × availability × (not on bye). Null when unprojected. */
export function weekPoints(p: BenefitPlayer, week: number, currentWeek: number): number | null {
  if (p.perGame == null) return null
  if (p.byeWeek != null && p.byeWeek === week) return 0
  return p.perGame * availability(p.injuryStatus, week - currentWeek)
}

/** Rest-of-season points: Σ weekPoints × (1.5 in playoff weeks). */
export function rosPoints(p: BenefitPlayer, h: BenefitHorizon): number | null {
  if (p.perGame == null) return null
  const { weeks, playoffWeeks } = horizonWeeks(h)
  const playoff = new Set(playoffWeeks)
  let total = 0
  for (const w of weeks) total += (weekPoints(p, w, h.currentWeek) ?? 0) * (playoff.has(w) ? PLAYOFF_MULTIPLIER : 1)
  return total
}

// ── Value ───────────────────────────────────────────────────────────────────

const norm = (pos: string) => pos.trim().toUpperCase()

/** Best free-agent ROS points at each position — the design's replacement level. */
export function replacementLevels(players: ReadonlyMap<string, BenefitPlayer>, freeAgentIds: readonly string[], h: BenefitHorizon): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of freeAgentIds) {
    const p = players.get(id)
    if (!p) continue
    const ros = rosPoints(p, h)
    if (ros == null) continue
    const pos = norm(p.position)
    if (ros > (out.get(pos) ?? -Infinity)) out.set(pos, ros)
  }
  return out
}

type Valued = { vorp: number; ros: number; vorpNorm: number; marketNorm: number; value: number }

/** VORP, both normalizations (0–100 within the league's pool), and the 0.7 / 0.3 blend, for every priced player. */
export function valuePlayers(input: Pick<TeamBenefitInput, 'players' | 'leaguePlayerIds' | 'freeAgentIds' | 'horizon'>): { byId: Map<string, Valued>; replacement: Map<string, number> } {
  const replacement = replacementLevels(input.players, input.freeAgentIds, input.horizon)
  const pool = [...new Set([...input.leaguePlayerIds, ...input.freeAgentIds])]
  const raw = new Map<string, { vorp: number; ros: number; market: number }>()
  for (const id of pool) {
    const p = input.players.get(id)
    if (!p) continue
    const ros = rosPoints(p, input.horizon)
    if (ros == null) continue
    const vorp = Math.max(0, ros - (replacement.get(norm(p.position)) ?? 0))
    raw.set(id, { vorp, ros, market: p.marketValue ?? 0 })
  }
  const maxVorp = Math.max(0, ...[...raw.values()].map((r) => r.vorp))
  const maxMarket = Math.max(0, ...[...raw.values()].map((r) => r.market))
  const byId = new Map<string, Valued>()
  for (const [id, r] of raw) {
    const vorpNorm = maxVorp > 0 ? (r.vorp / maxVorp) * 100 : 0
    const marketNorm = maxMarket > 0 ? (r.market / maxMarket) * 100 : 0
    byId.set(id, { vorp: r.vorp, ros: r.ros, vorpNorm, marketNorm, value: VORP_WEIGHT * vorpNorm + MARKET_WEIGHT * marketNorm })
  }
  return { byId, replacement }
}

/** Package value of a set of incoming players: best first; the 0.85 depth discount compounds on the VORP part only. */
export function packageValue(ids: readonly string[], byId: ReadonlyMap<string, Valued>): number {
  const vals = ids.map((id) => byId.get(id)).filter((v): v is Valued => !!v).sort((a, b) => b.value - a.value)
  return vals.reduce((sum, v, i) => sum + VORP_WEIGHT * v.vorpNorm * Math.pow(DEPTH_DISCOUNT, i) + MARKET_WEIGHT * v.marketNorm, 0)
}

// ── Lineups ─────────────────────────────────────────────────────────────────

function lineupTotal(ids: readonly string[], seats: readonly LineupSlotSpec[], players: ReadonlyMap<string, BenefitPlayer>, week: number, currentWeek: number): number {
  const candidates: OptimizerPlayerInput[] = []
  for (const id of ids) {
    const p = players.get(id)
    if (!p) continue
    const pts = weekPoints(p, week, currentWeek)
    if (pts == null) continue // unprojected players cannot start in a projection
    candidates.push({ playerId: id, positions: [norm(p.position)], points: pts, playerName: p.name })
  }
  return computeOptimalLineup({ players: candidates, slots: [...seats] }).total
}

/** Average change in optimal starting points per remaining week, and the "before" average. */
export function lineupImpact(
  before: readonly string[],
  after: readonly string[],
  seats: readonly LineupSlotSpec[],
  players: ReadonlyMap<string, BenefitPlayer>,
  h: BenefitHorizon,
): { deltaPerWeek: number; beforePerWeek: number } {
  const { weeks } = horizonWeeks(h)
  if (weeks.length === 0) return { deltaPerWeek: 0, beforePerWeek: 0 }
  let b = 0
  let a = 0
  for (const w of weeks) {
    b += lineupTotal(before, seats, players, w, h.currentWeek)
    a += lineupTotal(after, seats, players, w, h.currentWeek)
  }
  return { deltaPerWeek: (a - b) / weeks.length, beforePerWeek: b / weeks.length }
}

// ── Fairness and the design letter ──────────────────────────────────────────

export function fairnessLabel(gapPct: number): FairnessLabel {
  const g = Math.abs(gapPct)
  if (g < 10) return 'fair'
  if (g < 25) return 'leans'
  if (g <= 40) return 'lopsided'
  return 'heavily_lopsided'
}

/** The design's per-side letter: lineup impact 60%, package 40%, on the one grade's bands. */
export function designLetter(args: { lineupDeltaPerWeek: number; lineupBeforePerWeek: number; packageGapPct: number }): GradeLetter | null {
  const lineupPct = args.lineupBeforePerWeek > 0 ? (args.lineupDeltaPerWeek / args.lineupBeforePerWeek) * 100 : 0
  const lineupScore = Math.max(-100, Math.min(100, lineupPct * LINEUP_WEIGHTING_SCALE))
  const score = LINEUP_GRADE_WEIGHT * lineupScore + PACKAGE_GRADE_WEIGHT * args.packageGapPct
  return projectedLetterFor({ percentDiff: score, hasSignal: true })
}

const r1 = (n: number) => Math.round(n * 10) / 10

// ── The whole computation ────────────────────────────────────────────────────

export function computeTeamBenefit(input: TeamBenefitInput): TeamBenefitResult {
  const [me, them] = input.sides
  const traded = [...me.givesPlayerIds, ...them.givesPlayerIds]
  const unprojected = traded.filter((id) => input.players.get(id)?.perGame == null)
  if (unprojected.length) {
    return {
      ok: false,
      reason: 'A traded player has no projection this week, so the team-benefit model cannot price the deal.',
      missingAssets: unprojected.map((id) => input.players.get(id)?.name ?? `player ${id}`),
    }
  }
  const { weeks, playoffWeeks } = horizonWeeks(input.horizon)
  if (weeks.length === 0) return { ok: false, reason: 'No regular-season or playoff weeks remain.', missingAssets: [] }

  const notes: string[] = []
  const { byId, replacement } = valuePlayers(input)
  for (const id of traded) {
    const p = input.players.get(id)!
    if (!replacement.has(norm(p.position))) notes.push(`No free agent at ${norm(p.position)} has a projection, so ${norm(p.position)} replacement level is taken as zero.`)
    if (p.marketValue == null) notes.push(`${p.name} has no market value on file; his blend uses value over replacement alone.`)
  }
  const nonPlayer = [...me.givesOther, ...them.givesOther]
  if (nonPlayer.length) notes.push(`${nonPlayer.join(', ')} ${nonPlayer.length === 1 ? 'is' : 'are'} outside the team-benefit model (picks and FAAB), so no design letter is given.`)

  /*
   * ⚠ A CAPACITY SMALLER THAN A ROSTER THAT ALREADY EXISTS IS A BAD READING, NOT A FULL ROSTER. If the
   * league's slots were stored without their bench, every trade would "force" a drop that the league
   * never asks for. Distrust it rather than invent drops.
   */
  const capacity =
    input.rosterCapacity != null && (me.activeIds.length > input.rosterCapacity || them.activeIds.length > input.rosterCapacity)
      ? null
      : input.rosterCapacity
  if (input.rosterCapacity != null && capacity == null) notes.push('The recorded roster size is smaller than a current roster, so it is not trusted and no forced drops are assumed.')

  const playoff = new Set(playoffWeeks)
  const side = (self: BenefitSideInput, other: BenefitSideInput): BenefitSide & { gross: number } => {
    const receivesIds = [...other.givesPlayerIds]
    const after = [...self.activeIds.filter((id) => !self.givesPlayerIds.includes(id)), ...receivesIds]
    const overflow = capacity != null ? Math.max(0, after.length - capacity) : 0
    // Drop the lowest-valued players on the post-trade roster; unpriced ones first (they carry no value).
    const dropIds = overflow
      ? [...after].sort((a, b) => (byId.get(a)?.value ?? -1) - (byId.get(b)?.value ?? -1)).slice(0, overflow)
      : []
    const forcedDrops = dropIds.map((id) => ({ playerId: id, name: input.players.get(id)?.name ?? id, value: r1(byId.get(id)?.value ?? 0) }))
    const gross = packageValue(receivesIds, byId)
    const net = gross - forcedDrops.reduce((s, d) => s + d.value, 0)
    const finalAfter = after.filter((id) => !dropIds.includes(id))
    const lineup = lineupImpact(self.activeIds, finalAfter, input.seats, input.players, input.horizon)
    return {
      teamId: self.teamId,
      gross,
      receives: receivesIds.map((id) => {
        const p = input.players.get(id)!
        const v = byId.get(id)
        return {
          playerId: id,
          name: p.name,
          position: norm(p.position),
          value: r1(v?.value ?? 0),
          vorp: r1(v?.vorp ?? 0),
          rosPoints: r1(v?.ros ?? 0),
          marketValue: p.marketValue,
          injuryStatus: p.injuryStatus,
          byeInPlayoffs: p.byeWeek != null && playoff.has(p.byeWeek),
        }
      }),
      packageReceived: r1(net),
      forcedDrops,
      lineupDeltaPerWeek: r1(lineup.deltaPerWeek),
      lineupBeforePerWeek: r1(lineup.beforePerWeek),
      grade: null,
    }
  }

  const a = side(me, them)
  const b = side(them, me)
  const larger = Math.max(Math.abs(a.packageReceived), Math.abs(b.packageReceived), 1)
  const gapPct = Math.round(((a.packageReceived - b.packageReceived) / larger) * 100)
  if (input.rosterCapacity == null) notes.push('Roster capacity is unknown, so no forced drops are assumed.')

  const gradeable = nonPlayer.length === 0
  const finish = (s: typeof a, gap: number): BenefitSide => {
    const { gross: _gross, ...rest } = s
    return {
      ...rest,
      grade: gradeable ? designLetter({ lineupDeltaPerWeek: s.lineupDeltaPerWeek, lineupBeforePerWeek: s.lineupBeforePerWeek, packageGapPct: gap }) : null,
    }
  }

  return {
    ok: true,
    benefit: {
      model: TEAM_BENEFIT_MODEL,
      horizon: { ...input.horizon, weeks, playoffWeeks, approximation: FLAT_RATE_APPROXIMATION },
      sides: [finish(a, gapPct), finish(b, -gapPct)],
      gapPct,
      fairnessLabel: fairnessLabel(gapPct),
      notes: [...new Set(notes)],
    },
  }
}
