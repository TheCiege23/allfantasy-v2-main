import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import type { TradeEvaluationReceipt } from './evaluateTrade'
import type { TradeReview } from './tradeReview'

/**
 * THE PACKET — the only thing the AI explanation layer is allowed to see (design, "AI explanation
 * layer", build-order step 4). PURE: a saved receipt in, a plain JSON object out.
 *
 * 🛑 BUILT FROM THE RECEIPT AND NOTHING ELSE. The model explains a grade the engine already gave; it
 * never sees raw rosters, projections or a second price for any asset, so it has nothing to re-grade
 * with. Every number it may write is a number in here (`allowedNumbers`), and every reason must cite a
 * path in here (`resolvePacketPath`) — that is what `./validateVerdict.ts` checks.
 *
 * Team A is always the receipt's graded side, the one that sends `give`; Team B is the other side.
 *
 * ⚠ THE FIXED FIELDS ARE DECIDED HERE, IN CODE, NOT BY THE MODEL. `fixed.grades`, `fixed.verdict` and
 * `fixed.confidence` are computed from the receipt and handed to the model to copy; the validator
 * rejects any answer that changes them. A model that "argues" a different verdict has written prose
 * that argues it too, so that answer is thrown away whole rather than patched.
 *
 * ⚠ THE SHADOW MODEL'S JUDGEMENTS ARE LEFT OUT ON PURPOSE. `teamBenefit` (Phase 3) is shadowed and
 * uncalibrated; its gap, fairness label and 60/40 letter can disagree with the grade a manager sees.
 * Only its FACTS come through — forced drops, injuries, playoff byes, rest-of-season points and the
 * weekly lineup change — which no grade can contradict.
 */

export type TradeVerdictKind = 'accept' | 'decline' | 'counter' | 'fair_either_way'
export type VerdictConfidence = 'high' | 'medium' | 'low'

export type PacketAsset = {
  name: string
  kind: 'player' | 'pick' | 'faab'
  leagueValue: number | null
  marketValue: number | null
  adjustments: string[]
}

export type PacketLineup = {
  week: number | null
  startingPointsBefore: number | null
  startingPointsAfter: number | null
  startingPointsDelta: number | null
  blockedReason: string | null
  depthChanges: Array<{ position: string; rosteredBefore: number; rosteredAfter: number }>
}

export type PacketBenefitSide = {
  lineupBeforePerWeek: number
  lineupDeltaPerWeek: number
  forcedDrops: Array<{ name: string; value: number }>
  receives: Array<{ name: string; position: string; rosPoints: number; injuryStatus: string | null; byeInPlayoffs: boolean }>
}

export type ExplanationPacket = {
  receiptId: string | null
  teams: { teamA: string; teamB: string }
  /** What the league values are priced under, in a manager's words. Null when no league was read. */
  basis: string | null
  graded: boolean
  withheldReason: string | null
  /** Decided in code. The model copies these; the validator rejects any change. */
  fixed: {
    grades: { teamA: GradeLetter; teamB: GradeLetter } | null
    verdict: TradeVerdictKind | null
    confidence: VerdictConfidence
  }
  grade: {
    label: string
    /** Signed from Team A: + means Team A receives more league value. */
    percentDiff: number
    /** The unsigned gap the letter bands are drawn on. */
    gapPct: number
    recommendation: string
  } | null
  values: {
    teamASends: number
    teamAReceives: number
    teamASendsMarket: number
    teamAReceivesMarket: number
  } | null
  assets: { teamASends: PacketAsset[]; teamAReceives: PacketAsset[] }
  counts: { teamASends: number; teamAReceives: number }
  unpriceable: string[]
  lineup: { teamA: PacketLineup | null; teamB: PacketLineup | null }
  seasonOutlook: {
    currentWeek: number
    finalWeek: number
    playoffStartWeek: number | null
    weeksRemaining: number
    approximation: string
    teamA: PacketBenefitSide
    teamB: PacketBenefitSide
  } | null
  /** Risks found in code. The model must name at least one risk; these are what exist to name. */
  riskCandidates: string[]
  /** Counters are allowed only at a gap of COUNTER_MIN_GAP_PCT or more, with these names only. */
  counter: { allowed: boolean; assetNames: string[] }
  stale: { rostersStale: boolean; rostersSyncedAt: string | null } | null
  /**
   * Commissioner review mode (design step 6), when this explanation is for a commissioner. The flags and
   * the recommendation are FIXED here, computed in code (`./tradeReview.ts`); the model copies them and
   * writes only `noteToLeague`. Null for a manager's explanation.
   */
  commissioner: {
    recommendation: TradeReview['recommendation']
    flags: TradeReview['flags']
    /** Checks that could not be run, and why — so the note never implies a clean bill it does not have. */
    notComputed: Array<{ code: string; reason: string }>
  } | null
}

/** Design rule 5: suggest a counter only when the gap is 10% or more. The same band as a C. */
export const COUNTER_MIN_GAP_PCT = 10

/**
 * The verdict a letter means, from Team A's side. The letter bands (`gradeScale.ts`) are ±10 / ±25,
 * so this is a restatement of the grade, never a second judgement: A/B receive clearly more, C is
 * inside the even band, D gives up a real margin (worth countering), F gives up a large one.
 */
export function verdictForLetter(letter: GradeLetter): TradeVerdictKind {
  if (letter === 'A' || letter === 'B') return 'accept'
  if (letter === 'C') return 'fair_either_way'
  if (letter === 'D') return 'counter'
  return 'decline'
}

const LOW_COVERAGE_PCT = 80

function lineupOf(receipt: TradeEvaluationReceipt, rosterId: string | undefined): PacketLineup | null {
  if (!rosterId || !receipt.canonical) return null
  const p = receipt.canonical.participants.find((x) => x.rosterId === rosterId)
  const ri = p?.rosterImpact
  if (!ri) return null
  return {
    week: ri.week,
    startingPointsBefore: ri.startingPointsBefore,
    startingPointsAfter: ri.startingPointsAfter,
    startingPointsDelta: ri.startingPointsDelta,
    blockedReason: ri.blockedReason,
    depthChanges: ri.depth
      .filter((row) => row.rosteredDelta !== 0)
      .map((row) => ({ position: row.position, rosteredBefore: row.rosteredBefore, rosteredAfter: row.rosteredAfter })),
  }
}

function benefitSide(side: NonNullable<TradeEvaluationReceipt['teamBenefit']>['sides'][number]): PacketBenefitSide {
  return {
    lineupBeforePerWeek: side.lineupBeforePerWeek,
    lineupDeltaPerWeek: side.lineupDeltaPerWeek,
    forcedDrops: side.forcedDrops.map((d) => ({ name: d.name, value: d.value })),
    receives: side.receives.map((r) => ({
      name: r.name,
      position: r.position,
      rosPoints: r.rosPoints,
      injuryStatus: r.injuryStatus,
      byeInPlayoffs: r.byeInPlayoffs,
    })),
  }
}

const HEALTHY = new Set(['', 'active', 'healthy', 'act'])

function riskCandidatesOf(packet: Omit<ExplanationPacket, 'riskCandidates' | 'fixed'>): string[] {
  const out: string[] = []
  const o = packet.seasonOutlook
  if (o) {
    for (const [team, side] of [['Team A', o.teamA], ['Team B', o.teamB]] as const) {
      for (const r of side.receives) {
        const status = (r.injuryStatus ?? '').trim()
        if (!HEALTHY.has(status.toLowerCase())) out.push(`injury: ${team} receives ${r.name}, listed ${status}`)
        if (r.byeInPlayoffs) out.push(`playoff bye: ${r.name} (to ${team}) has a bye in the fantasy playoffs`)
      }
      for (const d of side.forcedDrops) out.push(`forced drop: ${team} must drop ${d.name} to make room`)
    }
  }
  for (const [team, lineup] of [['Team A', packet.lineup.teamA], ['Team B', packet.lineup.teamB]] as const) {
    for (const row of lineup?.depthChanges ?? []) {
      if (row.rosteredAfter < row.rosteredBefore && row.rosteredAfter <= 1) {
        out.push(`thin depth: ${team} is left with ${row.rosteredAfter} rostered at ${row.position}`)
      }
    }
  }
  for (const name of packet.unpriceable) out.push(`unpriced asset: ${name} could not be valued`)
  if (packet.stale?.rostersStale) out.push('stale rosters: the rosters were last synced before this evaluation and may have changed')
  if (out.length === 0) {
    // Rule 4 always wants a risk; when the data shows none, the honest one is that values move.
    out.push('market movement: no injury, playoff bye, forced drop or thin position was found; the grade rests on current league values, which move week to week')
  }
  return out
}

function confidenceOf(receipt: TradeEvaluationReceipt, packet: Omit<ExplanationPacket, 'fixed'>): VerdictConfidence {
  if (!receipt.grade.graded) return 'low'
  if (packet.unpriceable.length > 0) return 'low'
  const participants = receipt.canonical?.participants ?? []
  if (participants.some((p) => p.coverageStatus !== 'complete' || p.coveragePct < LOW_COVERAGE_PCT)) return 'low'
  if (packet.stale?.rostersStale) return 'medium'
  // An injured or playoff-bye player in the deal is a real uncertainty the letter does not price.
  if (packet.riskCandidates.some((r) => r.startsWith('injury:') || r.startsWith('playoff bye:'))) return 'medium'
  // Without any lineup evidence the grade rests on value alone.
  if (!packet.lineup.teamA && !packet.seasonOutlook) return 'medium'
  return 'high'
}

export type BuildPacketOptions = {
  /** Display names for the two sides, e.g. the managers. Defaults to "Team A" / "Team B". */
  teamNames?: { teamA?: string | null; teamB?: string | null }
  /** Other players on each roster, by name, for counter suggestions. Trade assets are always allowed. */
  rosterNames?: { teamA?: readonly string[]; teamB?: readonly string[] }
  /** Set for a commissioner's explanation: the code-computed review the model explains. */
  commissionerReview?: TradeReview | null
}

export function buildExplanationPacket(receipt: TradeEvaluationReceipt, opts: BuildPacketOptions = {}): ExplanationPacket {
  const g = receipt.grade
  const asset = (a: TradeEvaluationReceipt['assets'][number]): PacketAsset => ({
    name: a.name,
    kind: a.kind,
    leagueValue: a.leagueValue,
    marketValue: a.marketValue,
    adjustments: [...a.adjustments],
  })
  const sends = receipt.assets.filter((a) => a.side === 'give').map(asset)
  const receives = receipt.assets.filter((a) => a.side === 'get').map(asset)

  const canonical = receipt.canonical
  const tb = receipt.teamBenefit
  const base: Omit<ExplanationPacket, 'riskCandidates' | 'fixed'> = {
    receiptId: receipt.receiptId,
    teams: {
      teamA: opts.teamNames?.teamA?.trim() || 'Team A',
      teamB: opts.teamNames?.teamB?.trim() || 'Team B',
    },
    basis: g.basis,
    graded: g.graded,
    withheldReason: g.graded ? null : g.reason,
    grade: g.graded
      ? { label: g.label, percentDiff: g.percentDiff, gapPct: Math.abs(g.percentDiff), recommendation: g.recommendation }
      : null,
    values: g.graded
      ? { teamASends: g.giveValue, teamAReceives: g.getValue, teamASendsMarket: g.giveMarket, teamAReceivesMarket: g.getMarket }
      : null,
    assets: { teamASends: sends, teamAReceives: receives },
    counts: { teamASends: sends.length, teamAReceives: receives.length },
    unpriceable: [...receipt.unpriceable],
    lineup: {
      teamA: lineupOf(receipt, canonical?.proposerRosterId),
      teamB: lineupOf(receipt, canonical?.receiverRosterId),
    },
    seasonOutlook: tb
      ? {
          currentWeek: tb.horizon.currentWeek,
          finalWeek: tb.horizon.finalWeek,
          playoffStartWeek: tb.horizon.playoffStartWeek,
          weeksRemaining: tb.horizon.weeks.length,
          approximation: tb.horizon.approximation,
          teamA: benefitSide(tb.sides[0]),
          teamB: benefitSide(tb.sides[1]),
        }
      : null,
    counter: {
      allowed: g.graded && Math.abs(g.percentDiff) >= COUNTER_MIN_GAP_PCT,
      assetNames: [
        ...new Set(
          [...sends, ...receives]
            .map((a) => a.name)
            .concat(opts.rosterNames?.teamA ?? [], opts.rosterNames?.teamB ?? [])
            .map((n) => n.trim())
            .filter(Boolean),
        ),
      ],
    },
    stale: receipt.stored ? { rostersStale: receipt.stored.rostersStale, rostersSyncedAt: receipt.stored.rostersSyncedAt } : null,
    commissioner: opts.commissionerReview
      ? {
          recommendation: opts.commissionerReview.recommendation,
          flags: opts.commissionerReview.flags.map((f) => ({ ...f })),
          notComputed: opts.commissionerReview.checks
            .filter((c) => c.status === 'not_computed')
            .map((c) => ({ code: c.code, reason: c.explanation })),
        }
      : null,
  }
  const withRisks = { ...base, riskCandidates: riskCandidatesOf(base) }
  return {
    ...withRisks,
    fixed: {
      grades: g.graded ? { teamA: g.letter, teamB: g.partnerLetter } : null,
      verdict: g.graded ? verdictForLetter(g.letter) : null,
      confidence: confidenceOf(receipt, withRisks),
    },
  }
}

// ─── Reading the packet back ─────────────────────────────────────────────────

/**
 * Resolve a dot/bracket path (`values.teamAReceives`, `assets.teamASends[0].leagueValue`) against the
 * packet. `undefined` means the path does not exist — which is what an invented citation looks like.
 */
export function resolvePacketPath(packet: ExplanationPacket, path: string): unknown {
  if (typeof path !== 'string' || !path.trim()) return undefined
  const parts = path.trim().replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = packet
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const NUMBER_IN_TEXT = /\d[\d,]*(?:\.\d+)?/g

/** Every number in a string, as written (commas removed). Used on packet strings and on model text. */
export function numbersInText(text: string): Array<{ value: number; decimals: number; raw: string }> {
  const out: Array<{ value: number; decimals: number; raw: string }> = []
  for (const m of text.matchAll(NUMBER_IN_TEXT)) {
    const raw = m[0].replace(/,/g, '')
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    const dot = raw.indexOf('.')
    out.push({ value, decimals: dot === -1 ? 0 : raw.length - dot - 1, raw: m[0] })
  }
  return out
}

/**
 * Every number the model may write: each numeric field in the packet (unsigned — "down 4 points" and
 * "-4" state one fact), plus every number printed inside a packet string (a pick's year and round, a
 * week in a note). Receipt ids are skipped: they are identifiers, not facts to quote.
 */
export function allowedNumbers(packet: ExplanationPacket): number[] {
  const out: number[] = []
  const walk = (v: unknown, key: string | null) => {
    if (key === 'receiptId') return
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out.push(Math.abs(v))
    } else if (typeof v === 'string') {
      for (const n of numbersInText(v)) out.push(n.value)
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, null)
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k)
    }
  }
  walk(packet, null)
  return out
}
