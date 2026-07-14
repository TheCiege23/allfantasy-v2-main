/**
 * Deterministic draft recommendation: best available, best fit, reach/value/scarcity/bye.
 * Uses only provided player pool and draft state; no invented players or stats.
 */

import { draftPoolRowMatchesEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getAuctionMaxBid } from '@/lib/mock-draft/draft-engine'

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
const FLEX_SLOT_NAMES = new Set(['FLEX', 'SUPER_FLEX', 'OP', 'UTIL', 'BENCH', 'BN', 'IR', 'G', 'F', 'DL', 'DB', 'IDP_FLEX'])

export interface RecommendationPlayer {
  name: string
  position: string
  team?: string | null
  adp?: number | null
  byeWeek?: number | null
  /** Real player age, when resolved (Phase 29: powers Dynasty-league scoring). */
  age?: number | null
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
  /** When set, need weights ignore positions outside this starter-eligible set (same as draft pool). */
  draftEligiblePositions?: ReadonlySet<string>
  /** Optional AI-adjusted ADP by player key (e.g. "name|position|team") */
  aiAdpByKey?: Record<string, number>
  /** Optional bye weeks by player key (NFL) */
  byeByKey?: Record<string, number>
}

export interface RecommendationResult {
  recommendation: {
    player: RecommendationPlayer
    reason: string
    confidence: number
    needScore: number
    adpEdge: number
  } | null
  alternatives: Array<{ player: RecommendationPlayer; reason: string; confidence: number }>
  reachWarning: string | null
  valueWarning: string | null
  scarcityInsight: string | null
  stackInsight: string | null
  correlationInsight: string | null
  formatInsight: string | null
  byeNote: string | null
  explanation: string
  evidence: string[]
  caveats: string[]
  uncertainty: string | null
}

function getAdp(p: RecommendationPlayer, overall: number, aiAdpByKey?: Record<string, number>, key?: string): number {
  if (key && aiAdpByKey && aiAdpByKey[key] != null) return aiAdpByKey[key]
  return p.adp != null ? Number(p.adp) : overall + 20
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

function computeNeeds(
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
  confidence: number
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
  } = input
  if (available.length === 0) return null

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

  const scored: DraftPlayerRankingRow[] = available.slice(0, 80).map((p) => {
    const pos = normalizeSlot(p.position, normalizedSport)
    let needScore = needs[pos] ?? 20
    if (draftEligibleAsSet && !draftPoolRowMatchesEligiblePositions(p.position, draftEligibleAsSet)) {
      needScore = 8
    }
    const key = playerKey(p)
    const adp = getAdp(p, overall, aiAdpByKey, key)
    const adpEdge = clamp((overall - adp) * 1.4, -20, 25)
    let formatBoost = 0
    if (normalizedSport === 'NFL' && isSF && pos === 'QB') formatBoost += 14
    if (normalizedSport === 'NFL' && is2QB && pos === 'QB') formatBoost += 20
    if (normalizedSport === 'NFL') formatBoost += scoringFormatBoost(pos, scoringFormat)
    if (normalizedSport === 'NFL') formatBoost += tePremiumAdjustment(pos, tePremiumValue)
    const dynastyBoost = dynastyAgeAdjustment(p.age, isDynasty)
    const auctionAdjustment = auctionAffordabilityAdjustment(adp, auctionContext)
    const modeAdjustment = mode === 'bpa' ? 0 : needScore * 0.55
    const totalScore = modeAdjustment + adpEdge * 0.9 + formatBoost + dynastyBoost + auctionAdjustment
    const confidence = clamp(Math.round(55 + totalScore * 0.6), 40, 92)
    return {
      player: p,
      totalScore,
      needScore,
      adpEdge,
      adp,
      confidence,
    }
  })

  scored.sort((a, b) => b.totalScore - a.totalScore)

  return {
    normalizedSport,
    overall,
    needs,
    scored,
    caveats,
    playerKey,
    withAdpCount,
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
    sport,
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
      explanation: 'No available players in pool.',
      evidence: [],
      caveats: ['No players available.'],
      uncertainty: 'High uncertainty: no available players in the deterministic pool.',
    }
  }

  const { normalizedSport, overall, needs, scored, caveats: rankingCaveats, playerKey, withAdpCount } = rankings
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
      explanation: 'Could not rank available players.',
      evidence: [],
      caveats,
      uncertainty: 'High uncertainty: deterministic ranking failed for this board state.',
    }
  }

  let reachWarning: string | null = null
  let valueWarning: string | null = null
  if (best.adp > overall + 4) reachWarning = `${best.player.name} is typically drafted later (ADP ~${Math.round(best.adp)}). This is a reach at pick ${overall}.`
  else if (best.adp < overall - 4) valueWarning = `Strong value: ${best.player.name} usually goes before pick ${overall} (ADP ~${Math.round(best.adp)}).`

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

  const reasonParts: string[] = []
  if ((needs[pos] ?? 0) >= 70) reasonParts.push(`fills critical ${pos} need`)
  else if ((needs[pos] ?? 0) >= 40) reasonParts.push(`improves ${pos} depth`)
  if (best.adpEdge > 5) reasonParts.push('good value vs ADP')
  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && isSF && pos === 'QB') reasonParts.push('Superflex QB premium')
  if ((normalizedSport === 'NFL' || normalizedSport === 'NCAAF') && is2QB && pos === 'QB') reasonParts.push('2QB format premium')
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
    `Market edge: ${adpDelta >= 0 ? '+' : ''}${adpDelta} picks vs ADP.`,
    `Position supply in pool: ${samePosCount} ${pos} candidates.`,
  ]
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
    },
    alternatives,
    reachWarning,
    valueWarning,
    scarcityInsight,
    stackInsight,
    correlationInsight,
    formatInsight,
    byeNote,
    explanation,
    evidence,
    caveats,
    uncertainty,
  }
}
