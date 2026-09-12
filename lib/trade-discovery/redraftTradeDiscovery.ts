/**
 * T7 — Trade Discovery + Package Finder (deterministic, pure). Operates on already-assembled roster
 * data; suggests partners and packages only. NO AI, NO auto-trading, NO value mutation, NO external
 * calls. See docs/trade-discovery-package-finder-t7.md.
 */

import { STARTER_NEEDS } from '@/lib/trade-value/teamProfile'
import { FAAB_VALUE_PER_DOLLAR, normalizedFaabValue } from '@/lib/trade-value/faabValue'
import type { TeamStance } from '@/lib/trade-value/types'

/**
 * The largest value gap this module will try to close with FAAB, expressed in DOLLARS.
 *
 * 🛑 WAS THE LITERAL `540`, WHICH IS $30 AT 18/DOLLAR — a fourth place the conversion rate was
 * baked in, and the one where it was least visible. Deriving it keeps the cap meaning "thirty
 * dollars" rather than "five hundred and forty points", so it cannot drift away from the
 * converter the way the literal silently would.
 */
const FAAB_MAX_GAP_DOLLARS = 30
const FAAB_MAX_GAP_VALUE = FAAB_MAX_GAP_DOLLARS * FAAB_VALUE_PER_DOLLAR

export const DISCOVERY_WARNINGS = [
  'LOW_DATA_CONFIDENCE',
  'VALUE_GAP_HIGH',
  'POSITION_DEPTH_RISK',
  'SAME_POSITION_SWAP',
  'DRAFT_PICK_REFERENCE_ONLY',
  'FAAB_UNSUPPORTED_OR_LIMITED',
  'TRADE_BLOCK_UNAVAILABLE',
  'NCAAF_LIMITED_DATA',
  // T8 — native trade block + interest signals.
  'TRADE_BLOCK_MATCH',
  'INTEREST_MATCH',
  'PRIVATE_INTEREST_USED',
  'BLOCK_ITEM_EXPIRED',
] as const
export type DiscoveryWarning = (typeof DISCOVERY_WARNINGS)[number]

export interface DiscoveryPlayer {
  playerId: string
  playerName: string
  position: string
  value: number | null
  isLocked: boolean
  byeWeek?: number | null
}

export interface DiscoveryRoster {
  rosterId: string
  teamName: string
  managerDisplayName?: string | null
  stance: TeamStance
  weakPositions: string[]
  strongPositions: string[]
  players: DiscoveryPlayer[]
  faabBalance?: number | null
  recentTradeCount?: number
  /** T8: playerIds this roster has actively listed on the native trade block. */
  blockPlayerIds?: string[]
}

/** T8: the requesting manager's own interest signals (private allowed) used to bias their discovery. */
export interface DiscoveryInterest {
  playerIds: string[]
  positions: string[]
  hasPrivate?: boolean
}

export interface PartnerMatch {
  rosterId: string
  teamName: string
  managerDisplayName: string | null
  partnerNeeds: string[]
  partnerSurpluses: string[]
  myNeeds: string[]
  mySurpluses: string[]
  matchScore: number
  matchReasons: string[]
  warningFlags: DiscoveryWarning[]
}

export type FairnessBand = 'balanced' | 'slight edge you' | 'slight edge partner' | 'lopsided' | 'low confidence'

export interface PackageAsset {
  kind: 'player' | 'faab'
  playerId?: string
  playerName?: string
  position?: string
  faabAmount?: number
  value: number | null
}

export interface TradePackage {
  packageId: string
  giveAssets: PackageAsset[]
  receiveAssets: PackageAsset[]
  myTotalValue: number
  partnerTotalValue: number
  valueDelta: number
  fairnessBand: FairnessBand
  confidence: number
  reasons: string[]
  warningFlags: DiscoveryWarning[]
  canStartProposal: boolean
}

const CORE = ['QB', 'RB', 'WR', 'TE'] as const

function norm(pos: string): string {
  const p = pos.toUpperCase()
  return p === 'DEF' ? 'DST' : p
}

/** Needs (below starter need) and surpluses (>= need + 2) by core position. */
export function needsSurplus(players: DiscoveryPlayer[]): { needs: string[]; surpluses: string[] } {
  const counts: Record<string, number> = {}
  for (const p of players) counts[norm(p.position)] = (counts[norm(p.position)] ?? 0) + 1
  const needs: string[] = []
  const surpluses: string[] = []
  for (const pos of CORE) {
    const need = STARTER_NEEDS[pos] ?? 1
    const have = counts[pos] ?? 0
    if (have < need) needs.push(pos)
    else if (have >= need + 1) surpluses.push(pos) // one+ beyond starters = tradeable depth
  }
  return { needs, surpluses }
}

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b)
  return a.filter((x) => set.has(x))
}

export function findPartners(input: {
  myRoster: DiscoveryRoster
  otherRosters: DiscoveryRoster[]
  sport: string
  myInterest?: DiscoveryInterest
  hasNativeBlock?: boolean
}): PartnerMatch[] {
  const isNcaaf = input.sport === 'NCAAF'
  const my = needsSurplus(input.myRoster.players)
  const interestPlayerIds = new Set(input.myInterest?.playerIds ?? [])

  return input.otherRosters
    .filter((r) => r.rosterId !== input.myRoster.rosterId)
    .map((partner): PartnerMatch => {
      const theirs = needsSurplus(partner.players)
      const iCanGive = overlap(my.surpluses, theirs.needs) // my surplus → their need
      const iCanGet = overlap(partner.strongPositions.length ? partner.strongPositions : theirs.surpluses, my.needs)

      const reasons: string[] = []
      let score = 0
      if (iCanGive.length) {
        score += 30
        reasons.push(`You have surplus ${iCanGive.join('/')} they need`)
      }
      if (iCanGet.length) {
        score += 30
        reasons.push(`They have ${iCanGet.join('/')} you need`)
      }
      if (
        (input.myRoster.stance === 'contender' && partner.stance === 'rebuilder') ||
        (input.myRoster.stance === 'rebuilder' && partner.stance === 'contender')
      ) {
        score += 20
        reasons.push('Complementary team directions (contender ↔ rebuilder)')
      } else if (input.myRoster.stance === 'middle' || partner.stance === 'middle') {
        score += 5
      }
      if ((partner.recentTradeCount ?? 0) > 0) {
        score += 10
        reasons.push('Recently active in trades')
      }
      score += Math.min(10, (iCanGive.length + iCanGet.length) * 2)

      const warningFlags: DiscoveryWarning[] = []

      // T8: native trade-block match — partner is actively shopping a player at one of my needs.
      const partnerBlock = new Set(partner.blockPlayerIds ?? [])
      const blockMatch = partner.players.some(
        (p) => partnerBlock.has(p.playerId) && my.needs.includes(norm(p.position)),
      )
      if (blockMatch) {
        score += 20
        reasons.push('Player is on the trade block that fits your need')
        warningFlags.push('TRADE_BLOCK_MATCH')
      }
      // T8: I marked interest in a player this partner owns.
      const interestMatch = partner.players.some((p) => interestPlayerIds.has(p.playerId))
      if (interestMatch) {
        score += 15
        reasons.push('You marked interest in a player on this team')
        warningFlags.push('INTEREST_MATCH')
        if (input.myInterest?.hasPrivate) warningFlags.push('PRIVATE_INTEREST_USED')
      }

      if (isNcaaf) {
        warningFlags.push('NCAAF_LIMITED_DATA')
        score = Math.round(score * 0.8)
      }
      if (input.myRoster.players.some((p) => p.value == null) || partner.players.some((p) => p.value == null)) {
        warningFlags.push('LOW_DATA_CONFIDENCE')
      }
      // Only warn that the block is unavailable when no native block data exists at all.
      if (!input.hasNativeBlock) warningFlags.push('TRADE_BLOCK_UNAVAILABLE')

      return {
        rosterId: partner.rosterId,
        teamName: partner.teamName,
        managerDisplayName: partner.managerDisplayName ?? null,
        partnerNeeds: theirs.needs,
        partnerSurpluses: theirs.surpluses,
        myNeeds: my.needs,
        mySurpluses: my.surpluses,
        matchScore: Math.max(0, Math.min(100, score)),
        matchReasons: reasons.length ? reasons : ['Limited overlap — exploratory match'],
        warningFlags,
      }
    })
    .sort((a, b) => b.matchScore - a.matchScore)
}

function fairnessFor(valueDelta: number, scale: number, lowConfidence: boolean): FairnessBand {
  if (lowConfidence) return 'low confidence'
  const pct = scale > 0 ? Math.abs(valueDelta) / scale : 0
  if (pct <= 0.08) return 'balanced'
  if (pct >= 0.35) return 'lopsided'
  return valueDelta > 0 ? 'slight edge you' : 'slight edge partner'
}

function asset(p: DiscoveryPlayer): PackageAsset {
  return { kind: 'player', playerId: p.playerId, playerName: p.playerName, position: p.position, value: p.value }
}
const val = (p: DiscoveryPlayer) => p.value ?? 0

export function findPackages(input: {
  myRoster: DiscoveryRoster
  partnerRoster: DiscoveryRoster
  sport: string
  faabSupported: boolean
  draftPickTrading: boolean
  targetPlayerId?: string | null
  outgoingPlayerId?: string | null
  max?: number
}): TradePackage[] {
  const isNcaaf = input.sport === 'NCAAF'
  const my = needsSurplus(input.myRoster.players)
  const theirs = needsSurplus(input.partnerRoster.players)

  // Tradeable: non-locked players. Prefer my surplus positions to give; partner players at my needs to get.
  const myGivable = input.myRoster.players.filter(
    (p) => !p.isLocked && (input.outgoingPlayerId ? p.playerId === input.outgoingPlayerId : my.surpluses.includes(norm(p.position))),
  )
  const theirGettable = input.partnerRoster.players.filter(
    (p) => !p.isLocked && (input.targetPlayerId ? p.playerId === input.targetPlayerId : my.needs.includes(norm(p.position)) || theirs.surpluses.includes(norm(p.position))),
  )

  const packages: TradePackage[] = []
  const max = input.max ?? 5
  const anyMissingValue = (...ps: DiscoveryPlayer[]) => ps.some((p) => p.value == null)

  const mkPackage = (gives: DiscoveryPlayer[], receives: DiscoveryPlayer[], faab: number, idx: number): TradePackage => {
    const giveAssets: PackageAsset[] = gives.map(asset)
    /*
     * 🛑 WAS `faab * 18`, TWICE — the canonical engine's old per-dollar constant, copied.
     * These values are summed with `val(p)` and compared against the partner's total, so FAAB
     * is on the same 0–10000 asset scale here as everywhere else, and a private copy of the
     * rate is how the app ended up with four of them disagreeing by up to 28x.
     *
     * ⚠ NO BUDGET IS PASSED, AND THAT IS ACCURATE RATHER THAN LAZY. `DiscoveryRoster` carries
     * `faabBalance` — what is LEFT — and `normalizedFaabValue` wants the league's FULL season
     * budget, which this module is never given. Omitting it applies `FAAB_DEFAULT_BUDGET`,
     * which reproduces `faab * 18` exactly, so this swap changes no number today. When the
     * caller can supply a real budget it is one argument away, and every other surface
     * improves with it at the same moment.
     */
    if (faab > 0) giveAssets.push({ kind: 'faab', faabAmount: faab, value: normalizedFaabValue(faab) })
    const receiveAssets = receives.map(asset)
    const myTotalValue = gives.reduce((s, p) => s + val(p), 0) + normalizedFaabValue(faab)
    const partnerTotalValue = receives.reduce((s, p) => s + val(p), 0)
    const valueDelta = partnerTotalValue - myTotalValue // positive = I receive more value
    const lowConfidence = anyMissingValue(...gives, ...receives)
    const scale = Math.max(myTotalValue, partnerTotalValue, 1)
    const fairnessBand = fairnessFor(valueDelta, scale, lowConfidence)

    const warningFlags: DiscoveryWarning[] = []
    if (isNcaaf) warningFlags.push('NCAAF_LIMITED_DATA')
    if (lowConfidence) warningFlags.push('LOW_DATA_CONFIDENCE')
    if (fairnessBand === 'lopsided') warningFlags.push('VALUE_GAP_HIGH')
    if (gives.length >= 2 && receives.length <= 1) warningFlags.push('POSITION_DEPTH_RISK')
    if (gives.length === 1 && receives.length === 1 && norm(gives[0]!.position) === norm(receives[0]!.position)) warningFlags.push('SAME_POSITION_SWAP')
    if (faab > 0 && !input.faabSupported) warningFlags.push('FAAB_UNSUPPORTED_OR_LIMITED')

    const partnerBlock = new Set(input.partnerRoster.blockPlayerIds ?? [])
    if (receives.some((r) => partnerBlock.has(r.playerId))) warningFlags.push('TRADE_BLOCK_MATCH')

    const reasons: string[] = []
    if (receives.some((r) => partnerBlock.has(r.playerId))) reasons.push('Target player is on the trade block')
    if (fairnessBand === 'balanced') reasons.push('Values are close — fair starting point')
    else if (fairnessBand === 'slight edge you') reasons.push('Slight value edge to you')
    else if (fairnessBand === 'slight edge partner') reasons.push('Slight value edge to your partner')
    else if (fairnessBand === 'lopsided') reasons.push('Large value gap — likely needs sweetener')
    if (receives.some((p) => my.needs.includes(norm(p.position)))) reasons.push('Fills one of your roster needs')

    const canStartProposal =
      gives.length > 0 && receives.length > 0 && !lowConfidence && fairnessBand !== 'lopsided' &&
      (faab === 0 || input.faabSupported)

    return {
      packageId: `pkg-${idx}`,
      giveAssets,
      receiveAssets,
      myTotalValue: Math.round(myTotalValue),
      partnerTotalValue: Math.round(partnerTotalValue),
      valueDelta: Math.round(valueDelta),
      fairnessBand,
      confidence: lowConfidence ? 40 : isNcaaf ? 65 : 85,
      reasons,
      warningFlags,
      canStartProposal,
    }
  }

  // 1-for-1: closest value match per receive target.
  let idx = 0
  for (const receive of theirGettable) {
    const sortedGives = [...myGivable].sort((a, b) => Math.abs(val(a) - val(receive)) - Math.abs(val(b) - val(receive)))
    const give = sortedGives[0]
    if (!give) continue
    packages.push(mkPackage([give], [receive], 0, idx++))

    // player + FAAB sweetener when I'm slightly short and FAAB is supported.
    const gap = val(receive) - val(give)
    /*
     * The INVERSE conversion — a value gap turned back into dollars — and it has to use the
     * same rate as the forward one above or the two disagree about what a dollar is worth.
     * That is why the rate is imported rather than written here: `540` and `18` were separate
     * literals that only happened to agree.
     */
    const gapInDollars = Math.ceil(gap / FAAB_VALUE_PER_DOLLAR)
    if (input.faabSupported && gap > 0 && gap <= FAAB_MAX_GAP_VALUE && (input.myRoster.faabBalance ?? 0) >= gapInDollars) {
      packages.push(mkPackage([give], [receive], Math.min(gapInDollars, Math.floor(input.myRoster.faabBalance ?? 0)), idx++))
    }

    // 2-for-1: two cheaper gives for a higher-value receive.
    if (sortedGives.length >= 2 && val(receive) > val(give)) {
      const second = sortedGives.find((g) => g.playerId !== give.playerId)
      if (second) packages.push(mkPackage([give, second], [receive], 0, idx++))
    }
    if (packages.length >= max + 3) break
  }

  // Rank: prefer balanced/startable, then confidence, then smaller gap.
  const bandRank: Record<FairnessBand, number> = { balanced: 0, 'slight edge you': 1, 'slight edge partner': 2, lopsided: 4, 'low confidence': 3 }
  return packages
    .sort((a, b) => bandRank[a.fairnessBand] - bandRank[b.fairnessBand] || b.confidence - a.confidence || Math.abs(a.valueDelta) - Math.abs(b.valueDelta))
    .slice(0, max)
}
