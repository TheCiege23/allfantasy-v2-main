/**
 * T9 — Official AllFantasy market value layer. Deterministic, conservative, reversible. Computes an
 * AllFantasy-OWNED market value from internal trade signals and stores it SEPARATELY. NEVER writes
 * provider/projection/ADP/snapshot data, NEVER feeds its own output back as input (no circularity),
 * NO AI/LLM, NO external calls. Stricter gates than the T6 preview.
 */

import { prisma } from '@/lib/prisma'

export const CALCULATION_VERSION = 't9.1'
export const SOURCE_VERSION = 'internal-trade-signals'
export const OFFICIAL_MIN_SAMPLE = 5
export const OFFICIAL_MIN_CONFIDENCE = 60
export const OFFICIAL_MAX_ADJUSTMENT = 12
const RECENT_WINDOW_DAYS = 30

export type OfficialDirection = 'rising' | 'falling' | 'stable' | 'insufficient'

export interface OfficialObservation {
  proposalId: string
  terminal: 'accepted' | 'rejected' | 'vetoed' | 'canceled' | 'expired' | 'pending'
  observedValue: number | null
  /** Stable key for the trading manager-pair (sorted roster ids) — caps same-pair manipulation. */
  managerKey?: string | null
  createdAt: string | Date
}

export interface OfficialMarketValue {
  sport: string
  leagueConcept: string
  playerId: string
  playerName: string | null
  position: string | null
  baseValue: number | null
  marketValue: number | null
  adjustmentPercent: number
  adjustmentPoints: number
  confidence: number
  sampleSize: number
  acceptedTradeCount: number
  rejectedSignalCount: number
  vetoedSignalCount: number
  blockSignalCount: number
  interestSignalCount: number
  recentSignalCount: number
  direction: OfficialDirection
  published: boolean
  reasons: string[]
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}
function median(nums: number[]): number | null {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/** Pure deterministic core. Dedupes by proposalId; caps same-manager-pair influence; strict gates. */
export function computeOfficialMarketValue(input: {
  sport: string
  leagueConcept: string
  playerId: string
  playerName?: string | null
  position?: string | null
  observations: OfficialObservation[]
  blockSignalCount?: number
  interestSignalCount?: number
}): OfficialMarketValue {
  const base = {
    sport: input.sport,
    leagueConcept: input.leagueConcept,
    playerId: input.playerId,
    playerName: input.playerName ?? null,
    position: input.position ?? null,
    blockSignalCount: input.blockSignalCount ?? 0,
    interestSignalCount: input.interestSignalCount ?? 0,
  }

  // Dedupe by proposalId (one observation per proposal).
  const byProposal = new Map<string, OfficialObservation>()
  for (const o of input.observations) if (!byProposal.has(o.proposalId)) byProposal.set(o.proposalId, o)
  const obs = [...byProposal.values()]

  const withValue = obs.filter((o) => typeof o.observedValue === 'number')
  const sampleSize = obs.length
  const baseValue = median(withValue.map((o) => o.observedValue as number))

  const accepted = obs.filter((o) => o.terminal === 'accepted')
  const rejected = obs.filter((o) => o.terminal === 'rejected' || o.terminal === 'canceled' || o.terminal === 'expired')
  const vetoed = obs.filter((o) => o.terminal === 'vetoed')
  const cutoff = Date.now() - RECENT_WINDOW_DAYS * 86400000
  const recentSignalCount = obs.filter((o) => new Date(o.createdAt).getTime() >= cutoff).length

  // Anti-manipulation: a single manager-pair contributes at most once to the positive signal.
  const acceptedManagerPairs = new Set(accepted.map((o) => o.managerKey ?? o.proposalId))
  const effectiveAccepted = acceptedManagerPairs.size

  const counts = {
    acceptedTradeCount: accepted.length,
    rejectedSignalCount: rejected.length,
    vetoedSignalCount: vetoed.length,
    recentSignalCount,
  }

  const unpublished = (reason: string): OfficialMarketValue => ({
    ...base,
    ...counts,
    baseValue,
    marketValue: baseValue,
    adjustmentPercent: 0,
    adjustmentPoints: 0,
    confidence: 0,
    sampleSize,
    direction: 'insufficient',
    published: false,
    reasons: [reason],
  })

  if (sampleSize < OFFICIAL_MIN_SAMPLE || baseValue == null) {
    return unpublished('Not enough verified AllFantasy market history to publish an official market value yet')
  }

  // Confidence: diversity + sample, with heavy veto drag (drag confidence more than price).
  const confidence = clamp(
    Math.round(
      40 + 7 * effectiveAccepted + Math.min(sampleSize, 20) - 15 * vetoed.length - 5 * rejected.length,
    ),
    0,
    100,
  )
  if (confidence < OFFICIAL_MIN_CONFIDENCE) {
    return { ...unpublished('Confidence below the official publish threshold'), confidence, direction: 'insufficient' }
  }

  const tierCap = sampleSize < 15 ? 3 : sampleSize < 50 ? 7 : OFFICIAL_MAX_ADJUSTMENT
  // Strong: deduped accepted pairs. Medium: block. Weak: interest. Negative: veto >> rejection.
  const rawSignal =
    effectiveAccepted + 0.5 * base.blockSignalCount + 0.3 * base.interestSignalCount - 1.5 * vetoed.length - 0.5 * rejected.length

  let adjustmentPercent = clamp(
    clamp(rawSignal * 1.0 * (confidence / 100), -tierCap, tierCap),
    -OFFICIAL_MAX_ADJUSTMENT,
    OFFICIAL_MAX_ADJUSTMENT,
  )
  adjustmentPercent = Math.round(adjustmentPercent * 10) / 10

  const marketValue = Math.round(baseValue * (1 + adjustmentPercent / 100))
  const adjustmentPoints = marketValue - baseValue
  const direction: OfficialDirection = adjustmentPercent > 0.5 ? 'rising' : adjustmentPercent < -0.5 ? 'falling' : 'stable'

  const reasons: string[] = [`${effectiveAccepted} distinct completed-trade signal${effectiveAccepted === 1 ? '' : 's'} (sample ${sampleSize})`]
  if (base.blockSignalCount) reasons.push('On the trade block in-market')
  if (vetoed.length || rejected.length) reasons.push('Vetoes/rejections reduced confidence')
  if (tierCap < OFFICIAL_MAX_ADJUSTMENT) reasons.push(`Sample-tier cap ±${tierCap}%`)

  return {
    ...base,
    ...counts,
    baseValue,
    marketValue,
    adjustmentPercent,
    adjustmentPoints,
    confidence,
    sampleSize,
    direction,
    published: true,
    reasons,
  }
}

// ─── DB layer: gather signals → compute → upsert + audit (writes ONLY AF tables) ────────────────

type ProposalRow = {
  id: string
  status: string
  proposerRosterId: string
  receiverRosterId: string
  createdAt: Date
  assets: { assetType: string; playerId: string | null; playerName: string | null; metadata: unknown }[]
  valueSnapshot: { payload: unknown } | null
}

function mapTerminal(status: string): OfficialObservation['terminal'] {
  if (status === 'accepted' || status === 'processed') return 'accepted'
  if (status === 'rejected') return 'rejected'
  if (status === 'vetoed') return 'vetoed'
  if (status === 'cancelled' || status === 'canceled') return 'canceled'
  if (status === 'expired') return 'expired'
  return 'pending'
}

/** Gather per-player observations across all redraft leagues of a sport (concept = redraft). */
export async function gatherOfficialObservations(sport: string): Promise<{
  byPlayer: Map<string, { name: string | null; position: string | null; observations: OfficialObservation[] }>
  blockCounts: Map<string, number>
  interestCounts: Map<string, number>
}> {
  const seasons = await prisma.redraftSeason.findMany({ where: { sport }, select: { id: true } })
  const seasonIds = seasons.map((s) => s.id)
  const byPlayer = new Map<string, { name: string | null; position: string | null; observations: OfficialObservation[] }>()
  const blockCounts = new Map<string, number>()
  const interestCounts = new Map<string, number>()
  if (!seasonIds.length) return { byPlayer, blockCounts, interestCounts }

  const proposals = (await prisma.redraftTradeProposal.findMany({
    where: { seasonId: { in: seasonIds } },
    select: {
      id: true, status: true, proposerRosterId: true, receiverRosterId: true, createdAt: true,
      assets: { select: { assetType: true, playerId: true, playerName: true, metadata: true } },
      valueSnapshot: { select: { payload: true } },
    },
    take: 5000,
  })) as unknown as ProposalRow[]

  for (const p of proposals) {
    const terminal = mapTerminal(p.status)
    const managerKey = [p.proposerRosterId, p.receiverRosterId].sort().join('|')
    const snapAssets = ((p.valueSnapshot?.payload ?? null) as { sides?: { assets?: { playerId?: string | null; position?: string | null; internalValue?: number | null }[] }[] } | null)?.sides?.flatMap((s) => s.assets ?? []) ?? []
    const snapByPlayer = new Map<string, { position?: string | null; internalValue?: number | null }>()
    for (const a of snapAssets) if (a.playerId) snapByPlayer.set(a.playerId, a)

    for (const a of p.assets) {
      if (a.assetType !== 'player' || !a.playerId) continue
      const snap = snapByPlayer.get(a.playerId)
      let entry = byPlayer.get(a.playerId)
      if (!entry) {
        entry = { name: a.playerName ?? null, position: snap?.position ?? null, observations: [] }
        byPlayer.set(a.playerId, entry)
      }
      entry.observations.push({
        proposalId: p.id,
        terminal,
        observedValue: typeof snap?.internalValue === 'number' ? snap.internalValue : null,
        managerKey,
        createdAt: p.createdAt,
      })
    }
  }

  const blocks = await prisma.redraftTradeBlockItem.groupBy({ by: ['playerId'], where: { status: 'active' }, _count: { _all: true } }).catch(() => [])
  for (const b of blocks as { playerId: string; _count: { _all: number } }[]) blockCounts.set(b.playerId, b._count._all)
  const interests = await prisma.redraftTradeInterest.groupBy({ by: ['playerId'], where: { status: 'active', playerId: { not: null } }, _count: { _all: true } }).catch(() => [])
  for (const i of interests as { playerId: string | null; _count: { _all: number } }[]) if (i.playerId) interestCounts.set(i.playerId, i._count._all)

  return { byPlayer, blockCounts, interestCounts }
}

export interface RecalcResult {
  sport: string
  evaluated: number
  published: number
  changed: number
  dryRun: boolean
}

/** Recompute official values for a sport. Writes ONLY the AF tables + audit, and only when !dryRun. */
export async function recalculateOfficialMarketValues(sport: string, opts: { dryRun?: boolean } = {}): Promise<RecalcResult> {
  const dryRun = opts.dryRun !== false // default dry-run
  const leagueConcept = 'redraft'
  const { byPlayer, blockCounts, interestCounts } = await gatherOfficialObservations(sport)
  let evaluated = 0
  let published = 0
  let changed = 0

  for (const [playerId, entry] of byPlayer) {
    evaluated += 1
    const value = computeOfficialMarketValue({
      sport, leagueConcept, playerId, playerName: entry.name, position: entry.position,
      observations: entry.observations,
      blockSignalCount: blockCounts.get(playerId) ?? 0,
      interestSignalCount: interestCounts.get(playerId) ?? 0,
    })
    if (value.published) published += 1
    if (dryRun) continue

    const existing = await prisma.allFantasyMarketPlayerValue.findUnique({
      where: { sport_leagueConcept_playerId: { sport, leagueConcept, playerId } },
      select: { id: true, marketValue: true, adjustmentPercent: true },
    })
    const generatedAt = new Date()
    const row = await prisma.allFantasyMarketPlayerValue.upsert({
      where: { sport_leagueConcept_playerId: { sport, leagueConcept, playerId } },
      create: {
        sport, leagueConcept, playerId, playerName: value.playerName, position: value.position,
        baseValue: value.baseValue ?? 0, marketValue: value.marketValue ?? 0, adjustmentPercent: value.adjustmentPercent,
        adjustmentPoints: value.adjustmentPoints, confidence: value.confidence, sampleSize: value.sampleSize,
        acceptedTradeCount: value.acceptedTradeCount, rejectedSignalCount: value.rejectedSignalCount,
        vetoedSignalCount: value.vetoedSignalCount, blockSignalCount: value.blockSignalCount,
        interestSignalCount: value.interestSignalCount, recentSignalCount: value.recentSignalCount,
        direction: value.direction, published: value.published, sourceVersion: SOURCE_VERSION,
        calculationVersion: CALCULATION_VERSION, reasons: value.reasons as unknown as object, generatedAt,
      },
      update: {
        playerName: value.playerName, position: value.position, baseValue: value.baseValue ?? 0,
        marketValue: value.marketValue ?? 0, adjustmentPercent: value.adjustmentPercent, adjustmentPoints: value.adjustmentPoints,
        confidence: value.confidence, sampleSize: value.sampleSize, acceptedTradeCount: value.acceptedTradeCount,
        rejectedSignalCount: value.rejectedSignalCount, vetoedSignalCount: value.vetoedSignalCount,
        blockSignalCount: value.blockSignalCount, interestSignalCount: value.interestSignalCount,
        recentSignalCount: value.recentSignalCount, direction: value.direction, published: value.published,
        sourceVersion: SOURCE_VERSION, calculationVersion: CALCULATION_VERSION, reasons: value.reasons as unknown as object, generatedAt,
      },
    })
    if (!existing || existing.marketValue !== row.marketValue || existing.adjustmentPercent !== row.adjustmentPercent) {
      changed += 1
      await prisma.allFantasyMarketValueAudit.create({
        data: {
          marketValueId: row.id, sport, leagueConcept, playerId,
          previousValue: existing?.marketValue ?? null, newValue: row.marketValue,
          previousAdjustmentPercent: existing?.adjustmentPercent ?? null, newAdjustmentPercent: row.adjustmentPercent,
          confidence: row.confidence, sampleSize: row.sampleSize, reasonSummary: value.reasons as unknown as object,
          calculationVersion: CALCULATION_VERSION, generatedAt,
        },
      })
    }
  }

  return { sport, evaluated, published, changed, dryRun }
}

// ─── Read-only resolver (never computes/mutates) ────────────────────────────────────────────────

export async function resolveAllFantasyMarketValue(playerId: string, ctx: { sport: string; leagueConcept?: string }) {
  const leagueConcept = ctx.leagueConcept ?? 'redraft'
  const row = await prisma.allFantasyMarketPlayerValue.findUnique({
    where: { sport_leagueConcept_playerId: { sport: ctx.sport, leagueConcept, playerId } },
  })
  if (!row || !row.published) {
    return { playerId, allFantasyMarketValue: null as number | null, published: false, source: 'allfantasy_market' as const, generatedAt: row?.generatedAt ?? null }
  }
  return {
    playerId,
    baseValue: row.baseValue,
    allFantasyMarketValue: row.marketValue,
    adjustmentPercent: row.adjustmentPercent,
    confidence: row.confidence,
    sampleSize: row.sampleSize,
    direction: row.direction,
    reasons: (row.reasons as unknown as string[]) ?? [],
    published: true,
    source: 'allfantasy_market' as const,
    generatedAt: row.generatedAt,
  }
}
