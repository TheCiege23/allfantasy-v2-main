/**
 * Deterministic draft recommendation: best available, best fit, reach/value/scarcity/bye.
 * Uses only provided player pool and draft state; no invented players or stats.
 */

import { draftPoolRowMatchesEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getAuctionMaxBid } from '@/lib/mock-draft/draft-engine'
import {
  byeWindowVerdict,
  describeOpenSlotsAhead,
  describeRuns,
  describeWindow,
  detectPositionRuns,
  openStarterSlotsAhead,
  runUrgency,
  type ByeStatus,
  type ScoringWindow,
} from './draftContextSignals'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

const FOOTBALL_POSITION_TARGETS: Record<string, { starter: number; ideal: number }> = {
  QB: { starter: 1, ideal: 2 }, RB: { starter: 2, ideal: 5 }, WR: { starter: 2, ideal: 5 },
  TE: { starter: 1, ideal: 2 }, K: { starter: 1, ideal: 1 }, DEF: { starter: 1, ideal: 1 },
  // Phase 32: real IDP fixed-slot counts, reusing the exact real counts
  // lib/multi-sport/RosterTemplateService.ts's NFL_IDP_EXTRA_SLOTS already
  // uses for default IDP roster generation (DE:2, DT:1, LB:2, CB:2) --
  // reused, not invented. Only activates when a real IDP league's
  // rosterSlots actually contain these positions (see buildPositionTargets);
  // otherwise these entries are simply never referenced.
  DE: { starter: 2, ideal: 3 }, DT: { starter: 1, ideal: 2 }, LB: { starter: 2, ideal: 3 }, CB: { starter: 2, ideal: 3 },
}

// Phase 32: DL/DB/IDP_FLEX added -- the real IDP flex slot names
// lib/multi-sport/RosterTemplateService.ts's own FLEX_SLOT_NAMES set (and
// NFL_IDP_FLEX_SLOTS) already recognizes (DL: DE+DT, DB: CB+S, IDP_FLEX: any
// IDP position). This engine's copy of the set was missing them.
// 2026-11-14: WRRB_FLEX and REC_FLEX added. Imported Sleeper templates emit both
// (lib/league/importedLineupTemplate.ts), and without them here each became a fake position with its
// own target while RB/WR (or WR/TE) got no flex credit — so a league with two RB/WR flex spots was
// scored as if it had a position nobody can draft.
const FLEX_SLOT_NAMES = new Set(['FLEX', 'SUPER_FLEX', 'OP', 'UTIL', 'BENCH', 'BN', 'IR', 'G', 'F', 'DL', 'DB', 'IDP_FLEX', 'WRRB_FLEX', 'REC_FLEX'])

export interface RecommendationPlayer {
  name: string
  position: string
  team?: string | null
  adp?: number | null
  byeWeek?: number | null
  /** Real player age, when resolved (Phase 29: powers Dynasty-league scoring). */
  age?: number | null
  /**
   * Real season-long projected fantasy points, when the caller's pool carries
   * projections (the live draft room pool does — draftSportStatColumns
   * 'proj_pts'). Optional and honest: when absent, VORP falls back to the
   * ADP-gap tier signal and never invents a projection.
   */
  projectedPoints?: number | null
}

export interface RecommendationInput {
  available: RecommendationPlayer[]
  teamRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null }>
  rosterSlots?: string[]
  round: number
  pick: number
  totalTeams: number
  sport: string
  isDynasty?: boolean
  isSF?: boolean
  /**
   * Real 2QB flag (Phase 31), mutually exclusive with isSF — a league where
   * both starting slots are dedicated QB-only slots, as opposed to Superflex
   * where the second slot is a flex that MAY be a QB. Defaults to false
   * (no boost), preserving exact pre-Phase-31 scoring for every existing
   * caller that doesn't pass this field.
   */
  is2QB?: boolean
  /**
   * Real TE Premium points-per-reception value (Phase 31), from real league
   * settings (settings.te_premium / settings.tePremium). Null/omitted means
   * no real TE Premium scoring is configured — the honest state for every
   * league in .env.test at the time this was implemented — and applies zero
   * boost, preserving exact pre-Phase-31 TE scoring otherwise.
   */
  tePremiumValue?: number | null
  /**
   * Real league scoring format (Phase 29). Defaults to 'standard' behavior
   * (no boost) when omitted, preserving exact pre-Phase-29 scoring for every
   * existing caller that doesn't pass this field.
   */
  scoringFormat?: 'standard' | 'half_ppr' | 'ppr'
  /**
   * Real auction budget context for the target roster (Phase 30). Omitted entirely for
   * snake/linear drafts, preserving exact pre-Phase-30 scoring for every existing caller.
   */
  auctionContext?: { remainingBudget: number; rosterSlotsRemaining: number }
  mode?: 'needs' | 'bpa'
  /**
   * VORP (Value Over Replacement) rollout mode (AF_TRADE_UNIFICATION follow-on:
   * Draft VORP slice).
   *   'off'     — VORP fields are null/zero; identical to the pre-VORP engine.
   *   'observe' — VORP fields are computed and exposed on every ranking row but
   *               NEVER included in totalScore (shadow-style observability).
   *   'active'  — vorpScore joins totalScore at positions still needed (the default
   *               since 2026-11-14). tierDropoffScore is always 0: the tier cliff is
   *               evidence text only, after it failed the simulation check.
   * When omitted, resolved from env DRAFT_VORP_MODE ('off'|'observe'|'active'),
   * defaulting to 'active'.
   */
  vorpMode?: 'off' | 'observe' | 'active'
  /** When set, need weights ignore positions outside this starter-eligible set (same as draft pool). */
  draftEligiblePositions?: ReadonlySet<string>
  /** Optional AI-adjusted ADP by player key (e.g. "name|position|team") */
  aiAdpByKey?: Record<string, number>
  /** Optional bye weeks by player key (NFL) */
  byeByKey?: Record<string, number>
  /**
   * The NFL weeks this draft's rosters score (2026-11-14). An in-season or tournament-stage draft
   * scores only part of the season, so a bye inside the window costs real points and one already
   * played costs none. Omitted = a full-season draft: byes are not scored.
   */
  scoringWindow?: ScoringWindow | null
  /** Positions of this draft's most recent picks, oldest first — feeds position-run detection. */
  recentPickPositions?: string[]
  /**
   * Each team picking before the target's next turn, as the positions it has drafted so far in
   * THIS draft. Used only as a count of open starting slots ahead — never to label a manager.
   */
  teamsAheadPositions?: string[][]
}

export interface RecommendationResult {
  recommendation: {
    player: RecommendationPlayer
    reason: string
    confidence: number
    needScore: number
    adpEdge: number
    /**
     * Whether `adpEdge` was measured against a REAL market ADP.
     *
     * Exposed because callers outside this module were asserting market behaviour from
     * `adpEdge` with no way to know. `getAdp` falls back to the AI board and then to a
     * synthetic `overall + 20`, and against that prior `adpEdge` pins to exactly -20 at every
     * pick — so an unpriced player reads as a 20-pick reach forever. Any consumer phrasing
     * `adpEdge` as what the market does must check this first.
     */
    adpIsReal: boolean
  } | null
  alternatives: Array<{ player: RecommendationPlayer; reason: string; confidence: number }>
  reachWarning: string | null
  valueWarning: string | null
  scarcityInsight: string | null
  stackInsight: string | null
  correlationInsight: string | null
  formatInsight: string | null
  byeNote: string | null
  /** The scoring window and how the top choice's bye sits in it; null for a full-season draft. */
  scoringWindowInsight?: string | null
  /** A position run in the most recent picks, when one is on. */
  runInsight?: string | null
  /** Open starting slots among the teams picking before your next turn. */
  teamsAheadInsight?: string | null
  explanation: string
  evidence: string[]
  caveats: string[]
  uncertainty: string | null
}

/**
 * 🛑 REAL ADP ALWAYS WINS. `aiAdpByKey` IS A FALLBACK, NOT AN OVERRIDE.
 *
 * This used to return `aiAdpByKey[key]` in PREFERENCE to the player's real `adp`, so an
 * AllFantasy-computed board silently replaced the market board for every player it covered —
 * and `hasRealAdp` below then reported the substitute as real, letting the engine speak it as
 * market knowledge. That board is computed from AllFantasy's own completed drafts: at the time
 * this was written the largest publishable segment was NINE drafts. Nine in-house drafts do
 * not outrank the market, whatever their internal sample gates say.
 *
 * Order is now: the real ADP, then the AI/blended value for players the market has not priced,
 * then the synthetic prior. That keeps the AI board doing the one job it is good at — covering
 * players with no market ADP at all, which is exactly the rookie gap it exists for.
 *
 * ⚠ CONSEQUENCE FOR THE BLEND, RECORDED DELIBERATELY. `lib/live-draft-brain/orchestrator.ts`
 * merges `blendedAdpByKey` into this same parameter, and that blend is
 * `external 0.55 + site 0.35 + context 0.10` (lib/live-draft-brain/combined-ai-adp.ts). Since
 * the live-brain path already sets `p.adp` to the EXTERNAL adp, the blend now applies only
 * where the market has no price. That is the rule working as intended, not a side effect: a
 * composite that is 35% in-house ADP is not "real ADP", so it must not displace one either.
 */
function getAdp(p: RecommendationPlayer, overall: number, aiAdpByKey?: Record<string, number>, key?: string): number {
  const real = p.adp != null && Number.isFinite(Number(p.adp)) ? Number(p.adp) : null
  if (real != null) return real
  if (key && aiAdpByKey && aiAdpByKey[key] != null) return aiAdpByKey[key]
  return overall + 20
}

/**
 * HONESTY PASS: `getAdp` falls back to `overall + 20` for players with no real
 * ADP. That synthetic value is fine as an internal ordering prior, but it must
 * never be SPOKEN as market knowledge — the engine was emitting
 * "typically drafted later (ADP ~87), this is a reach at pick 67" off a number
 * it invented. This reports whether a row's ADP is real.
 */
/**
 * 🛑 ONLY A REAL MARKET ADP MAY BE SPOKEN. The AI board is for ORDERING, never for claims.
 *
 * This used to return true when `aiAdpByKey` supplied the value, on the reasoning that an
 * AI-derived number is OBSERVED rather than invented and so is not the thing the honesty pass
 * was written to catch. That reasoning was rejected: what these strings assert is what THE
 * MARKET does — "typically drafted later", "usually goes before pick N", "Market edge: +6
 * picks vs ADP" — and an AllFantasy board built from nine in-house drafts is not the market,
 * however genuinely it was observed. Saying so put a private measurement in the market's mouth.
 *
 * So the AI board joins the synthetic `overall + 20` prior on the unspeakable side of the line.
 * {@link getAdp} still returns it and the scores still use it; it simply stops being narrated.
 * The consequence is deliberate: a player the market has not priced now gets NO reach warning,
 * NO value warning and NO market-edge figure, which is the honest output for a player the
 * market has not priced.
 *
 * ⚠ The `aiAdpByKey`/`key` parameters are gone rather than ignored, so a future caller cannot
 * pass them and quietly assume they still count.
 */
function hasRealAdp(p: RecommendationPlayer): boolean {
  return p.adp != null && Number.isFinite(Number(p.adp))
}

function defaultTargetsForSport(sport: string): Record<string, { starter: number; ideal: number }> {
  switch (normalizeToSupportedSport(sport)) {
    case 'NBA':
    case 'NCAAB':
      return {
        PG: { starter: 1, ideal: 2 },
        SG: { starter: 1, ideal: 2 },
        SF: { starter: 1, ideal: 2 },
        PF: { starter: 1, ideal: 2 },
        C: { starter: 1, ideal: 2 },
      }
    case 'MLB':
      return {
        C: { starter: 1, ideal: 1 },
        '1B': { starter: 1, ideal: 2 },
        '2B': { starter: 1, ideal: 2 },
        '3B': { starter: 1, ideal: 2 },
        SS: { starter: 1, ideal: 2 },
        OF: { starter: 3, ideal: 5 },
        P: { starter: 3, ideal: 6 },
      }
    case 'NHL':
      return {
        C: { starter: 2, ideal: 3 },
        LW: { starter: 2, ideal: 3 },
        RW: { starter: 2, ideal: 3 },
        D: { starter: 2, ideal: 4 },
        G: { starter: 1, ideal: 2 },
      }
    case 'SOCCER':
      return {
        GKP: { starter: 1, ideal: 1 },
        DEF: { starter: 3, ideal: 5 },
        MID: { starter: 3, ideal: 5 },
        FWD: { starter: 2, ideal: 4 },
      }
    default:
      return FOOTBALL_POSITION_TARGETS
  }
}

/** Exported so a caller keying on the engine's `computeNeeds` output uses the same position names. */
export function normalizeDraftSlot(slot: string, sport: string): string {
  return normalizeSlot(slot, sport)
}

function normalizeSlot(slot: string, sport: string): string {
  const normalized = String(slot || '').toUpperCase().trim()
  const normalizedSport = normalizeToSupportedSport(sport)
  if (!normalized) return ''
  if (normalized === 'SUPERFLEX') return 'SUPER_FLEX'
  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && (normalized === 'DST' || normalized === 'D/ST')) return 'DEF'
  if (normalizedSport === 'MLB' && ['SP', 'RP'].includes(normalized)) return 'P'
  if (normalizedSport === 'MLB' && ['LF', 'CF', 'RF'].includes(normalized)) return 'OF'
  if (normalizedSport === 'SOCCER' && normalized === 'GK') return 'GKP'
  if (normalizedSport === 'SOCCER' && (normalized === 'ST' || normalized === 'FW')) return 'FWD'
  if (normalizedSport === 'SOCCER' && normalized === 'MF') return 'MID'
  if (normalizedSport === 'SOCCER' && normalized === 'DF') return 'DEF'
  return normalized
}

function resolveFormatInsight(input: {
  sport: string
  isDynasty: boolean
  isSF: boolean
  is2QB?: boolean
  tePremiumValue?: number | null
  rosterSlots: string[]
  recommendationPosition: string
}): string | null {
  const normalizedSport = normalizeToSupportedSport(input.sport)
  const recommendationPosition = normalizeSlot(input.recommendationPosition, normalizedSport)
  const normalizedSlots = input.rosterSlots.map((s) => normalizeSlot(s, normalizedSport))
  const notes: string[] = []
  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && input.isSF && recommendationPosition === 'QB') {
    notes.push('Superflex increases QB urgency at this stage')
  }
  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && input.is2QB && recommendationPosition === 'QB') {
    notes.push('2QB format requires two startable quarterbacks')
  }
  if (normalizedSport === 'NFL' && input.tePremiumValue && recommendationPosition === 'TE') {
    notes.push('TE Premium scoring adds real extra value to this position')
  }
  if (normalizedSlots.includes('FLEX') && ['RB', 'WR', 'TE'].includes(recommendationPosition)) {
    notes.push('FLEX lineup structure supports this position')
  }
  if ((normalizedSport === 'NBA' || normalizedSport === 'NCAAB') && normalizedSlots.includes('UTIL')) {
    notes.push('UTIL slot keeps this pick flexible for rotations')
  }
  if (input.isDynasty) {
    notes.push('Dynasty context favors multi-year value over one-week variance')
  }
  return notes.length > 0 ? `${notes.slice(0, 2).join('. ')}.` : null
}

function resolveCorrelationInsights(input: {
  sport: string
  recommendation: RecommendationPlayer
  teamRoster: Array<{ position: string; team?: string | null }>
}): { stackInsight: string | null; correlationInsight: string | null } {
  const normalizedSport = normalizeToSupportedSport(input.sport)
  const recommendedTeam = String(input.recommendation.team || '').toUpperCase()
  if (!recommendedTeam) return { stackInsight: null, correlationInsight: null }

  const sameTeamRoster = input.teamRoster.filter((p) => String(p.team || '').toUpperCase() === recommendedTeam)
  const sameTeamCount = sameTeamRoster.length
  const recommendationPos = normalizeSlot(input.recommendation.position, normalizedSport)

  let stackInsight: string | null = null
  if (normalizedSport === 'NFL' || normalizedSport === 'NCAAF') {
    const hasTeamQb = sameTeamRoster.some((p) => normalizeSlot(p.position, normalizedSport) === 'QB')
    const hasTeamPassCatcher = sameTeamRoster.some((p) => ['WR', 'TE', 'RB'].includes(normalizeSlot(p.position, normalizedSport)))
    if (recommendationPos === 'QB' && hasTeamPassCatcher) {
      stackInsight = `Stack path: ${input.recommendation.name} pairs with your existing ${recommendedTeam} skill position player(s).`
    } else if (['WR', 'TE', 'RB'].includes(recommendationPos) && hasTeamQb) {
      stackInsight = `Stack path: ${input.recommendation.name} correlates with your ${recommendedTeam} QB.`
    }
  }

  let correlationInsight: string | null = null
  if (sameTeamCount >= 2) {
    correlationInsight = `Correlation watch: you already roster ${sameTeamCount} players from ${recommendedTeam}; balance upside with diversification.`
  } else if (sameTeamCount === 1 && ['NFL', 'NCAAF', 'NHL', 'SOCCER'].includes(normalizedSport)) {
    correlationInsight = `${input.recommendation.name} creates mild same-team correlation with your current build.`
  }

  return { stackInsight, correlationInsight }
}

function buildPositionTargets(
  rosterSlots: string[],
  available: RecommendationPlayer[],
  sport: string,
): Record<string, { starter: number; ideal: number }> {
  const defaults = defaultTargetsForSport(sport)
  const targets: Record<string, { starter: number; ideal: number }> = {}

  for (const rawSlot of rosterSlots || []) {
    const slot = normalizeSlot(rawSlot, sport)
    if (!slot || FLEX_SLOT_NAMES.has(slot)) continue
    const existing = targets[slot] || { starter: 0, ideal: 0 }
    existing.starter += 1
    existing.ideal = Math.max(existing.starter + 1, defaults[slot]?.ideal ?? existing.ideal ?? 0)
    targets[slot] = existing
  }

  if (Object.keys(targets).length === 0) {
    for (const [position, config] of Object.entries(defaults)) {
      targets[position] = { ...config }
    }
  }

  if (Object.keys(targets).length === 0) {
    for (const player of available) {
      const position = normalizeSlot(player.position, sport)
      if (!position || FLEX_SLOT_NAMES.has(position) || targets[position]) continue
      targets[position] = { starter: 1, ideal: 2 }
    }
  }

  return targets
}

/**
 * Per-position need, 0–100, where HIGH MEANS BIG NEED: an unfilled starter slot scores 88+, a
 * position below its ideal depth scores 42+, and a filled position scores 10.
 *
 * ⚠ EXPORTED FOR DRAFT HQ, AND THE DIRECTION IS A TRAP. Any surface that renders this as a
 * "positional strength" bar has to INVERT it first — showing the raw value with a
 * low-is-bad/high-is-good colour ramp paints a manager's biggest hole green. Draft HQ converts to
 * `100 - need` and labels the result "solved" for exactly this reason.
 *
 * Exported rather than copied: `computeDraftPlayerRankings` returns these needs too, but bails
 * with null on an empty player pool, and a planning screen should not have to load and score a
 * full draft pool just to know it is thin at RB.
 */
export function computeNeeds(
  roster: { position: string }[],
  rosterSlots: string[],
  isSF: boolean,
  available: RecommendationPlayer[],
  sport: string,
  is2QB: boolean = false,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of roster) {
    const pos = normalizeSlot(p.position, sport)
    counts[pos] = (counts[pos] || 0) + 1
  }

  const targetsByPosition = buildPositionTargets(rosterSlots, available, sport)
  const needs: Record<string, number> = {}
  for (const [pos, targets] of Object.entries(targetsByPosition)) {
    const count = counts[pos] || 0
    if (count < targets.starter) needs[pos] = clamp(88 + (targets.starter - count) * 10, 0, 100)
    else if (count < targets.ideal) needs[pos] = clamp(42 + (targets.ideal - count) * 12, 0, 100)
    else needs[pos] = 10
  }

  if (sport.toUpperCase() === 'NFL' && isSF) {
    needs.QB = clamp((needs.QB || 50) + 18, 0, 100)
  }
  // Phase 31: 2QB is a strictly mandatory dual-QB requirement (both starting
  // slots are QB-only, unlike Superflex where the second slot can go to a
  // non-QB) — a real fantasy-football mechanic, not an invented number.
  // Slightly larger than the Superflex boost to reflect that every roster
  // MUST start 2 QBs here, not just may.
  if (sport.toUpperCase() === 'NFL' && is2QB) {
    needs.QB = clamp((needs.QB || 50) + 24, 0, 100)
  }

  for (const s of rosterSlots || []) {
    const slot = normalizeSlot(s, sport)
    if (slot === 'FLEX') {
      for (const pos of ['RB', 'WR', 'TE']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
    if (slot === 'WRRB_FLEX') {
      for (const pos of ['RB', 'WR']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
    if (slot === 'REC_FLEX') {
      for (const pos of ['WR', 'TE']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
    if (slot === 'G') {
      for (const pos of ['PG', 'SG']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
    if (slot === 'F') {
      for (const pos of ['SF', 'PF']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
    if ((slot === 'SUPER_FLEX' || slot === 'OP') && needs.QB != null) {
      needs.QB = clamp((needs.QB || 50) + 12, 0, 100)
    }
    // Phase 32: real IDP flex-slot eligibility, mirroring
    // lib/multi-sport/RosterTemplateService.ts's NFL_IDP_FLEX_SLOTS exactly
    // (DL: DE+DT, DB: CB+S, IDP_FLEX: any IDP position) -- reused, not
    // invented. Only fires for positions that already have a need entry
    // (i.e. a real IDP league's rosterSlots already surfaced them via
    // buildPositionTargets), same guard pattern as FLEX/G/F/SUPER_FLEX above.
    if (slot === 'DL') {
      for (const pos of ['DE', 'DT']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
    if (slot === 'DB') {
      for (const pos of ['CB', 'S']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
    if (slot === 'IDP_FLEX') {
      for (const pos of ['DE', 'DT', 'LB', 'CB', 'S']) {
        if (needs[pos] != null) needs[pos] = clamp((needs[pos] || 20) + 8, 0, 100)
      }
    }
  }
  return needs
}

// Phase 29: real, position-level scoring-format sensitivity, extending the
// existing formatBoost mechanism (which already handled SF-QB and TE-roster-
// relevance). Reception-point formats (PPR/half-PPR) systematically increase
// pass-catching positions' real fantasy value relative to standard scoring --
// a well-established, real fantasy-football principle, not an invented
// system. Scoped honestly: this is POSITION-LEVEL sensitivity, not per-player
// receiving-role differentiation (e.g. distinguishing a pass-catching RB from
// a between-the-tackles RB) -- that would require real per-player reception/
// target-share data, which is not currently threaded through this engine's
// RecommendationPlayer input type. Disclosed as a real, deliberate scope
// boundary (see FANTASY_OS_DRAFT_SCORING_FORMAT_VALIDATION.md), not a gap
// silently left unaddressed.
const PPR_POSITION_BOOST: Record<string, number> = { WR: 3, TE: 3, RB: 1.5 }

function scoringFormatBoost(position: string, scoringFormat: 'standard' | 'half_ppr' | 'ppr'): number {
  if (scoringFormat === 'standard') return 0
  const fullBoost = PPR_POSITION_BOOST[position] ?? 0
  return scoringFormat === 'half_ppr' ? fullBoost / 2 : fullBoost
}

// Phase 29: real Dynasty scoring, replacing the prior cosmetic-explanation-
// only handling. Uses real player age (already resolved by the shared player
// pool resolver -- SportsPlayer.age, ~70% real coverage measured this phase)
// as the long-term-value signal: younger players carry real multi-year
// upside, older players carry real decline risk. Only applied when
// isDynasty is true -- redraft leagues are completely unaffected (age has no
// scoring role in a single-season format), preserving exact backward
// compatibility for every caller not in a Dynasty league.
function dynastyAgeAdjustment(age: number | null | undefined, isDynasty: boolean): number {
  if (!isDynasty || age == null || !Number.isFinite(age)) return 0
  if (age <= 23) return 8
  if (age <= 27) return 3
  if (age === 28) return 0
  return clamp(-(age - 28) * 2, -16, 0)
}

// Phase 30: real auction budget affordability, reusing the exact existing
// getAuctionMaxBid() formula (lib/mock-draft/draft-engine.ts, already the real
// live formula AuctionEngine.ts's own bid validation uses) rather than a
// reinvented one. No new valuation system: uses only real inputs (real
// remaining budget, real roster slots remaining, real ADP as the engine's
// existing relative-value signal) -- no invented per-player dollar values.
// A team with a low real max-legal-bid cannot realistically compete for a
// premium/elite-ADP player (top-24 overall, a common real industry-standard
// tier cutoff); a cheaper, later-ADP player is unaffected either way.
function auctionAffordabilityAdjustment(
  adp: number,
  auctionContext: { remainingBudget: number; rosterSlotsRemaining: number } | undefined
): number {
  if (!auctionContext || auctionContext.rosterSlotsRemaining <= 0) return 0
  const maxAffordable = getAuctionMaxBid({
    budget: auctionContext.remainingBudget,
    rosterSlotsRemaining: auctionContext.rosterSlotsRemaining,
  })
  if (adp <= 24 && maxAffordable < 20) return -10
  if (adp <= 60 && maxAffordable < 10) return -6
  return 0
}

// Phase 31: real TE Premium scoring, replacing the prior roster-slot
// approximation (which fired +4 for ANY TE whenever a TE roster slot
// existed — true for nearly every real NFL league regardless of its actual
// scoring rules, making it a cosmetic always-on boost, not a genuine
// scoring-format signal). Reads the same settings.te_premium/tePremium
// field lib/agents/anthropic-pipeline.ts's buildLeagueScoringSettings()
// already uses for AI chat context — reused, not invented. Disclosed
// honestly: a direct .env.test query found 0/65 real leagues populate this
// field (see FANTASY_OS_TE_PREMIUM_AUDIT_PHASE31.md), so this is
// implemented and tested but not yet real-world exercised — the same
// category of gap as Phase 30's Keeper/Auction validation.
function tePremiumAdjustment(position: string, tePremiumValue: number | null | undefined): number {
  if (position !== 'TE' || !tePremiumValue || tePremiumValue <= 0) return 0
  return clamp(tePremiumValue * 8, 0, 20)
}

export type DraftPlayerRankingRow = {
  player: RecommendationPlayer
  totalScore: number
  needScore: number
  adpEdge: number
  adp: number
  /** False when `adp` is the synthetic `overall + 20` prior, not a real market value. */
  adpIsReal: boolean
  confidence: number
  /** Real projected points from the caller's pool, when present. */
  projectedPoints: number | null
  /**
   * Projection of the best same-position player expected to still be available
   * at this manager's next turn (replacement level). Null when the position
   * lacks real projection coverage.
   */
  replacementProjection: number | null
  /** projectedPoints − replacementProjection. The core VORP quantity. */
  vorp: number | null
  /** Scaled VORP contribution. 0 unless vorpMode==='active' AND a projection signal exists. */
  vorpScore: number
  /** ADP gap to the next same-position available player (tier-cliff signal). */
  tierDropoff: number | null
  /** Scaled tier-cliff contribution. 0 unless vorpMode==='active' AND the fallback signal applies. */
  tierDropoffScore: number
  /** Which value signal produced vorp/tier fields for this row. */
  valueSignal: 'projection' | 'adp_gap' | 'none'
  /** The player's bye week, when known. */
  byeWeek: number | null
  /** Where the bye sits against the scoring window ('unknown' with no window or no bye). */
  byeStatus: ByeStatus
  /** Score added for the window (negative inside it), the run and the teams ahead. */
  contextScore: number
}

export type VorpMode = 'off' | 'observe' | 'active'

function resolveVorpMode(explicit: VorpMode | undefined, env: NodeJS.ProcessEnv = process.env): VorpMode {
  if (explicit === 'off' || explicit === 'observe' || explicit === 'active') return explicit
  const raw = String(env['DRAFT_VORP_MODE'] ?? '').trim().toLowerCase()
  if (raw === 'off' || raw === 'observe' || raw === 'active') return raw
  /*
   * DEFAULT 'active' since 2026-11-14 (was 'observe'). Only the PROJECTION half scores — the tier
   * cliff is evidence text (see the note in the ranking loop) — and only at positions still needed.
   * Measured with scripts/simulate-draft-vorp-modes.ts --synthetic-projections: reaches of more than
   * two rounds 8 → 7 (12 teams) and 8 → 6 (16 teams), starter quality unchanged, every lineup complete.
   * A sanity check, not proof of better picks — real outcomes need the backtest. Roll back with
   * DRAFT_VORP_MODE=observe.
   */
  return 'active'
}

/**
 * Per-position VORP context computed once per ranking pass (Draft VORP slice).
 *
 * Replacement level is defined against the manager's NEXT turn: among the
 * same-position players still available, how many are likely gone within one
 * full snake/linear cycle (~totalTeams picks, the average gap between turns)?
 * The best-projected player AFTER those is the replacement — drafting anyone
 * is only worth their edge over what would have been available anyway. This is
 * Value Over Next Available, the standard draft-room formulation of VORP, and
 * it uses ONLY real inputs already in the pool (projections + ADP); nothing is
 * invented. Positions with fewer than 3 real projections fall back to the
 * ADP-gap tier-cliff signal.
 */
function buildVorpContext(
  available: RecommendationPlayer[],
  normalizedSport: string,
  overall: number,
  totalTeams: number,
): {
  replacementByPos: Record<string, number | null>
  nextAdpGapFor: (pos: string, adp: number) => number | null
  typicalAdpGapFor: (pos: string) => number | null
} {
  const byPos: Record<string, RecommendationPlayer[]> = {}
  for (const p of available) {
    const pos = normalizeSlot(p.position, normalizedSport)
    if (!pos) continue
    ;(byPos[pos] ??= []).push(p)
  }

  const picksUntilNextTurn = Math.max(1, totalTeams)
  const replacementByPos: Record<string, number | null> = {}
  const adpSortedByPos: Record<string, number[]> = {}

  for (const [pos, players] of Object.entries(byPos)) {
    const withProj = players
      .filter((p) => typeof p.projectedPoints === 'number' && Number.isFinite(p.projectedPoints))
      .sort((a, b) => (b.projectedPoints as number) - (a.projectedPoints as number))

    if (withProj.length >= 3) {
      const likelyGone = players.filter((p) => {
        const adp = p.adp != null ? Number(p.adp) : null
        return adp != null && Number.isFinite(adp) && adp <= overall + picksUntilNextTurn
      }).length
      const idx = Math.min(likelyGone, withProj.length - 1)
      replacementByPos[pos] = withProj[idx]?.projectedPoints ?? null
    } else {
      replacementByPos[pos] = null
    }

    adpSortedByPos[pos] = players
      .map((p) => (p.adp != null ? Number(p.adp) : NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
  }

  const nextAdpGapFor = (pos: string, adp: number): number | null => {
    const list = adpSortedByPos[pos]
    if (!list || list.length < 2 || !Number.isFinite(adp)) return null
    for (const candidate of list) {
      if (candidate > adp) return candidate - adp
    }
    return null
  }

  /*
   * The position's ordinary spacing between consecutive ADPs near the top of what is left (median of
   * up to 12 gaps). A "cliff" means a gap unusual FOR THAT POSITION: kickers and tight ends are always
   * spread out, so a raw gap rewarded them constantly — measured 2026-11-14 in
   * scripts/simulate-draft-vorp-modes.ts, where it took reaches from 8 to 12 and gave teams second kickers.
   */
  const typicalAdpGapFor = (pos: string): number | null => {
    const list = adpSortedByPos[pos]
    if (!list || list.length < 3) return null
    const gaps: number[] = []
    for (let i = 1; i < list.length && gaps.length < 12; i++) gaps.push(list[i]! - list[i - 1]!)
    gaps.sort((a, b) => a - b)
    const mid = Math.floor(gaps.length / 2)
    return gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2
  }

  return { replacementByPos, nextAdpGapFor, typicalAdpGapFor }
}

/**
 * Deterministic ranked pool for Live Draft Brain and other consumers.
 * Same ranking rules as {@link computeDraftRecommendation} (BPA vs needs, ADP edge, format boosts).
 */
export function computeDraftPlayerRankings(input: RecommendationInput): {
  normalizedSport: string
  overall: number
  needs: Record<string, number>
  scored: DraftPlayerRankingRow[]
  caveats: string[]
  playerKey: (p: RecommendationPlayer) => string
  withAdpCount: number
  runs: ReturnType<typeof detectPositionRuns>
  openAhead: ReturnType<typeof openStarterSlotsAhead>
  teamsAheadCount: number
} | null {
  const {
    available,
    teamRoster,
    rosterSlots = [],
    round,
    pick,
    totalTeams,
    sport,
    isSF = false,
    is2QB = false,
    isDynasty = false,
    scoringFormat = 'standard',
    tePremiumValue = null,
    auctionContext,
    mode = 'needs',
    aiAdpByKey,
    draftEligiblePositions,
    vorpMode: vorpModeInput,
  } = input
  if (available.length === 0) return null
  const vorpMode = resolveVorpMode(vorpModeInput)

  const caveats: string[] = []
  if (available.length < 10) caveats.push('Player pool is small; recommendation may be limited.')

  const normalizedSport = normalizeToSupportedSport(sport)
  const needs = computeNeeds(teamRoster, rosterSlots, isSF, available, normalizedSport, is2QB)
  const overall = (round - 1) * totalTeams + pick
  const playerKey = (p: RecommendationPlayer) =>
    `${(p.name || '').toLowerCase()}|${(p.position || '').toLowerCase()}|${(p.team || '').toLowerCase()}`

  const withAdpCount = available.filter((p) => {
    const key = playerKey(p)
    return p.adp != null || (aiAdpByKey != null && aiAdpByKey[key] != null)
  }).length
  if (withAdpCount < Math.max(6, Math.ceil(Math.min(available.length, 30) * 0.4))) {
    caveats.push('Limited ADP coverage in this pool; confidence is reduced.')
  }

  const draftEligibleAsSet =
    draftEligiblePositions && draftEligiblePositions.size > 0
      ? draftEligiblePositions instanceof Set
        ? draftEligiblePositions
        : new Set(draftEligiblePositions)
      : null

  const pool = available.slice(0, 80)
  const vorpContext = vorpMode === 'off' ? null : buildVorpContext(pool, normalizedSport, overall, totalTeams)

  // Draft-context signals (2026-11-14) — see draftContextSignals.ts.
  const scoringWindow = input.scoringWindow ?? null
  const runs = detectPositionRuns(input.recentPickPositions ?? [], totalTeams)
  const openAhead = openStarterSlotsAhead({ teamsAhead: input.teamsAheadPositions ?? [], rosterSlots })
  const teamsAheadCount = (input.teamsAheadPositions ?? []).length

  const scored: DraftPlayerRankingRow[] = pool.map((p) => {
    const pos = normalizeSlot(p.position, normalizedSport)
    let needScore = needs[pos] ?? 20
    if (draftEligibleAsSet && !draftPoolRowMatchesEligiblePositions(p.position, draftEligibleAsSet, normalizedSport)) {
      needScore = 8
    }
    const key = playerKey(p)
    const adp = getAdp(p, overall, aiAdpByKey, key)
    const adpIsReal = hasRealAdp(p)
    const adpEdge = clamp((overall - adp) * 1.4, -20, 25)
    let formatBoost = 0
    if (normalizedSport === 'NFL' && isSF && pos === 'QB') formatBoost += 14
    if (normalizedSport === 'NFL' && is2QB && pos === 'QB') formatBoost += 20
    if (normalizedSport === 'NFL') formatBoost += scoringFormatBoost(pos, scoringFormat)
    if (normalizedSport === 'NFL') formatBoost += tePremiumAdjustment(pos, tePremiumValue)
    const dynastyBoost = dynastyAgeAdjustment(p.age, isDynasty)
    const auctionAdjustment = auctionAffordabilityAdjustment(adp, auctionContext)
    const modeAdjustment = mode === 'bpa' ? 0 : needScore * 0.55

    // Draft VORP slice: replacement value + tier cliff. Computed whenever
    // vorpMode !== 'off' (observability); only the projection VORP joins totalScore,
    // and only in 'active' mode (the default since 2026-11-14).
    const projectedPoints =
      typeof p.projectedPoints === 'number' && Number.isFinite(p.projectedPoints) ? p.projectedPoints : null
    let replacementProjection: number | null = null
    let vorp: number | null = null
    let vorpScore = 0
    let tierDropoff: number | null = null
    let tierDropoffScore = 0
    let valueSignal: DraftPlayerRankingRow['valueSignal'] = 'none'
    if (vorpContext) {
      replacementProjection = vorpContext.replacementByPos[pos] ?? null
      // Replacement value only counts where a starter is still needed (need >= 40): an edge at a
      // position already filled is bench value, not a reason to reach (2026-11-14).
      const neededHere = needScore >= 40
      if (projectedPoints != null && replacementProjection != null) {
        vorp = projectedPoints - replacementProjection
        valueSignal = 'projection'
        if (vorpMode === 'active') vorpScore = neededHere ? clamp(vorp * 0.3, -8, 30) : clamp(vorp * 0.3, -8, 0)
      } else {
        tierDropoff = vorpContext.nextAdpGapFor(pos, adp)
        if (tierDropoff != null) {
          valueSignal = 'adp_gap'
          /*
           * 🛑 THE TIER CLIFF NO LONGER SCORES — IT IS EVIDENCE TEXT ONLY (2026-11-14, measured).
           * scripts/simulate-draft-vorp-modes.ts, real ADP, every team on the engine:
           *   raw gap (the original)         reaches >2 rounds 8 → 12 (12 tm), 8 → 17 (16 tm); 2nd kickers
           *   gap ÷ position spacing, need   8 → 14, and one 16-team roster left incomplete
           *   stricter (ratio−3)×2, cap 5    reaches 8 → 7, but starters worse (459.7 → 466.7)
           * No version beat leaving it out, so it stays out. `tierDropoff` is still computed and the
           * "Tier cliff" evidence line still prints; `tierDropoffScore` is always 0.
           */
          void neededHere
        }
      }
    }

    const rawBye = p.byeWeek ?? input.byeByKey?.[key] ?? null
    const byeWeek = rawBye != null && Number.isFinite(Number(rawBye)) ? Number(rawBye) : null
    const bye = byeWindowVerdict(byeWeek, scoringWindow)
    const run = mode === 'bpa' ? 0 : runUrgency(pos, runs, needScore)
    // When most of the teams picking before you still need this position too, it will not wait.
    const ahead = openAhead.find((f) => f.position === pos)
    const aheadScore =
      mode !== 'bpa' && ahead && teamsAheadCount > 0 && needScore >= 40 && ahead.teams / teamsAheadCount >= 0.5 ? 4 : 0
    const contextScore = bye.score + run + aheadScore

    const totalScore =
      modeAdjustment + adpEdge * 0.9 + formatBoost + dynastyBoost + auctionAdjustment + vorpScore + tierDropoffScore + contextScore
    const confidence = clamp(Math.round(55 + totalScore * 0.6), 40, 92)
    return {
      player: p,
      totalScore,
      needScore,
      adpEdge,
      adp,
      adpIsReal,
      confidence,
      projectedPoints,
      replacementProjection,
      vorp,
      vorpScore,
      tierDropoff,
      tierDropoffScore,
      valueSignal,
      byeWeek,
      byeStatus: bye.status,
      contextScore,
    }
  })

  scored.sort((a, b) => b.totalScore - a.totalScore)

  if (scoringWindow) {
    const unknownByes = scored.slice(0, 30).filter((r) => r.byeStatus === 'unknown').length
    if (unknownByes > 0) caveats.push(`Bye week unknown for ${unknownByes} of the top 30 players; they are not penalised for the scoring window.`)
  }

  return {
    normalizedSport,
    overall,
    needs,
    scored,
    caveats,
    playerKey,
    withAdpCount,
    runs,
    openAhead,
    teamsAheadCount,
  }
}

export function computeDraftRecommendation(input: RecommendationInput): RecommendationResult {
  const {
    available,
    teamRoster,
    rosterSlots = [],
    round,
    pick,
    totalTeams,
    isDynasty = false,
    isSF = false,
    is2QB = false,
    tePremiumValue = null,
    byeByKey,
  } = input
  const caveats: string[] = []
  if (available.length === 0) {
    return {
      recommendation: null,
      alternatives: [],
      reachWarning: null,
      valueWarning: null,
      scarcityInsight: null,
      stackInsight: null,
      correlationInsight: null,
      formatInsight: null,
      byeNote: null,
      scoringWindowInsight: null,
      runInsight: null,
      teamsAheadInsight: null,
      explanation: 'No available players in pool.',
      evidence: [],
      caveats: ['No players available.'],
      uncertainty: 'High uncertainty: no available players in the deterministic pool.',
    }
  }

  const rankings = computeDraftPlayerRankings(input)
  if (!rankings) {
    return {
      recommendation: null,
      alternatives: [],
      reachWarning: null,
      valueWarning: null,
      scarcityInsight: null,
      stackInsight: null,
      correlationInsight: null,
      formatInsight: null,
      byeNote: null,
      scoringWindowInsight: null,
      runInsight: null,
      teamsAheadInsight: null,
      explanation: 'No available players in pool.',
      evidence: [],
      caveats: ['No players available.'],
      uncertainty: 'High uncertainty: no available players in the deterministic pool.',
    }
  }

  const { normalizedSport, overall, needs, scored, caveats: rankingCaveats, playerKey, withAdpCount, runs, openAhead, teamsAheadCount } = rankings
  for (const c of rankingCaveats) {
    if (!caveats.includes(c)) caveats.push(c)
  }

  const best = scored[0]
  if (!best) {
    return {
      recommendation: null,
      alternatives: [],
      reachWarning: null,
      valueWarning: null,
      scarcityInsight: null,
      stackInsight: null,
      correlationInsight: null,
      formatInsight: null,
      byeNote: null,
      scoringWindowInsight: null,
      runInsight: null,
      teamsAheadInsight: null,
      explanation: 'Could not rank available players.',
      evidence: [],
      caveats,
      uncertainty: 'High uncertainty: deterministic ranking failed for this board state.',
    }
  }

  // Honesty pass: reach/value claims assert what the MARKET does. Only say
  // them when the ADP behind them is real — never off the synthetic prior.
  let reachWarning: string | null = null
  let valueWarning: string | null = null
  if (best.adpIsReal) {
    if (best.adp > overall + 4) reachWarning = `${best.player.name} is typically drafted later (ADP ~${Math.round(best.adp)}). This is a reach at pick ${overall}.`
    else if (best.adp < overall - 4) valueWarning = `Strong value: ${best.player.name} usually goes before pick ${overall} (ADP ~${Math.round(best.adp)}).`
  }

  const pos = String(best.player.position || '').toUpperCase()
  const samePosCount = available.filter((a) => String(a.position || '').toUpperCase() === pos).length
  let scarcityInsight: string | null = null
  const scarcityThreshold = Math.max(3, Math.ceil(totalTeams * 0.35))
  if (samePosCount <= scarcityThreshold && (best.needScore ?? 0) > 45) {
    scarcityInsight = `Positional scarcity: only ${samePosCount} ${pos} options remain in your visible pool.`
  }

  const { stackInsight, correlationInsight } = resolveCorrelationInsights({
    sport: normalizedSport,
    recommendation: best.player,
    teamRoster,
  })
  const formatInsight = resolveFormatInsight({
    sport: normalizedSport,
    isDynasty,
    isSF,
    is2QB,
    tePremiumValue,
    rosterSlots,
    recommendationPosition: pos,
  })

  let byeNote: string | null = null
  if (normalizedSport === 'NFL' || normalizedSport === 'NCAAF') {
    const bye = best.player.byeWeek ?? (byeByKey ? byeByKey[playerKey(best.player)] : null)
    if (bye != null) {
      const sameByeCount = teamRoster.filter((p) => p.byeWeek != null && Number(p.byeWeek) === Number(bye)).length
      byeNote = sameByeCount >= 2
        ? `Bye week ${bye}; you already have ${sameByeCount} players on that bye, so add coverage depth.`
        : `Bye week ${bye}; plan coverage if needed.`
    }
  }

  // Draft-context insights (2026-11-14): said once, about THIS draft, from facts the caller supplied.
  const scoringWindow = input.scoringWindow ?? null
  let scoringWindowInsight: string | null = null
  if (scoringWindow) {
    const skipped = scored.slice(0, 30).filter((r) => r.byeStatus === 'in_window')
    const topBye =
      best.byeStatus === 'played'
        ? `${best.player.name}'s bye (week ${best.byeWeek}) is already played`
        : best.byeStatus === 'after_window'
          ? `${best.player.name}'s bye (week ${best.byeWeek}) falls after the window`
          : best.byeStatus === 'in_window'
            ? `${best.player.name}'s bye (week ${best.byeWeek}) is INSIDE the window — every alternative was worse even after that cost`
            : `${best.player.name}'s bye week is unknown`
    const moved = skipped.length
      ? ` ${skipped.length} of the top 30 have a bye inside the window and were moved down (${skipped
          .slice(0, 3)
          .map((r) => `${r.player.name}, wk ${r.byeWeek}`)
          .join('; ')}${skipped.length > 3 ? '; …' : ''}).`
      : ''
    scoringWindowInsight = `Scoring window: ${describeWindow(scoringWindow)}. ${topBye}.${moved}`
  }
  const runInsight = describeRuns(runs)
  const teamsAheadInsight = describeOpenSlotsAhead(openAhead, teamsAheadCount)

  const reasonParts: string[] = []
  if ((needs[pos] ?? 0) >= 70) reasonParts.push(`fills critical ${pos} need`)
  else if ((needs[pos] ?? 0) >= 40) reasonParts.push(`improves ${pos} depth`)
  if (best.adpEdge > 5 && best.adpIsReal) reasonParts.push('good value vs ADP')
  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && isSF && pos === 'QB') reasonParts.push('Superflex QB premium')
  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && is2QB && pos === 'QB') reasonParts.push('2QB format premium')
  if (scoringWindow && best.byeStatus === 'played') reasonParts.push('bye already played')
  if (scoringWindow && best.byeStatus === 'after_window') reasonParts.push('no bye during the scoring window')
  if (runs.some((r) => r.position === pos) && (needs[pos] ?? 0) >= 40) reasonParts.push(`${pos} run in progress`)
  const reason = reasonParts.length ? reasonParts.join('; ') : 'Best fit for roster and draft position'

  const alternatives = scored.slice(1, 4).map((item, idx) => ({
    player: item.player,
    reason: idx === 0 ? 'Strong alternative if primary is taken' : 'Fallback option',
    confidence: item.confidence,
  }))

  const explanation = `Recommend ${best.player.name} (${pos}): ${reason}.${formatInsight ? ` ${formatInsight}` : ''}${reachWarning ? ` ${reachWarning}` : ''}${valueWarning ? ` ${valueWarning}` : ''}`.trim()
  const adpDelta = Number((overall - best.adp).toFixed(1))
  const evidence = [
    `Context: Round ${round}, Pick ${pick} (overall ${overall}).`,
    `Need score (${pos}): ${Math.round(best.needScore)}/100.`,
    // Honesty pass: never present a synthetic ADP as a "market edge".
    best.adpIsReal
      ? `Market edge: ${adpDelta >= 0 ? '+' : ''}${adpDelta} picks vs ADP.`
      // "no MARKET ADP", not "no ADP data": an AI-priced player has a number, and the engine
      // is ordering by it. What it lacks is a market price, which is the claim being withheld.
      : `Market edge: unavailable — no market ADP for ${best.player.name}.`,
    `Position supply in pool: ${samePosCount} ${pos} candidates.`,
  ]
  if (best.vorp != null) {
    const v = Number(best.vorp.toFixed(1))
    evidence.push(
      `Replacement value: ${v >= 0 ? '+' : ''}${v} projected pts vs the best ${pos} likely available at your next pick.`,
    )
  } else if (best.tierDropoff != null && best.tierDropoff > 4 && best.adpIsReal) {
    /*
     * `&& best.adpIsReal` added: this was the ONE ADP evidence line without the guard its
     * sibling at "Market edge" already had. `tierDropoff` measures from the anchor `getAdp`
     * returned — which may be the AI board or the synthetic prior — to a list of REAL ADPs, so
     * the "picks later by ADP" figure was a gap between two different things. It also sits in
     * the `else` branch taken when no projection exists, i.e. precisely the thin-data case
     * where the anchor is least likely to be real.
     */
    evidence.push(
      `Tier cliff: next available ${pos} goes ~${Math.round(best.tierDropoff)} picks later by ADP.`,
    )
  }
  if (scoringWindowInsight) evidence.push(scoringWindowInsight)
  if (runInsight) evidence.push(runInsight)
  if (teamsAheadInsight) evidence.push(teamsAheadInsight)
  if (stackInsight) evidence.push(`Stack signal: ${stackInsight}`)
  if (formatInsight) evidence.push(`Format signal: ${formatInsight}`)
  const uncertainty =
    caveats.length > 0
      ? `Uncertainty: ${caveats[0]}`
      : withAdpCount < 12
        ? 'Uncertainty: moderate due to limited market samples.'
        : null

  return {
    recommendation: {
      player: best.player,
      reason,
      confidence: best.confidence,
      needScore: best.needScore,
      adpEdge: best.adpEdge,
      adpIsReal: best.adpIsReal,
    },
    alternatives,
    reachWarning,
    valueWarning,
    scarcityInsight,
    stackInsight,
    correlationInsight,
    formatInsight,
    byeNote,
    scoringWindowInsight,
    runInsight,
    teamsAheadInsight,
    explanation,
    evidence,
    caveats,
    uncertainty,
  }
}
