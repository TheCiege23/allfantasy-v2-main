import type { Prisma } from '@prisma/client'

import { assessTradeGradeReadiness } from '@/lib/decision-os/trade/tradeGradeReadiness'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import type { ProposalManagerStrategy } from '@/lib/league-trade-engine/proposalSuggestions'
import type { VerifiedProposalEvidence } from '@/lib/league-trade-engine/proposalEvidenceToken'
import {
  resolveTradeGradingPolicy,
  type TradeEvidence,
} from '@/lib/trade-intel/tradeGradingPolicy'

type SnapshotLeague = {
  id: string
  season?: number | null
  sport?: string | null
  leagueType?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean | null
  bestBallMode?: boolean | null
  guillotineMode?: boolean | null
  leagueSize?: number | null
  starters?: unknown
  settings?: unknown
  playoffTeams?: number | null
  playoffStartWeek?: number | null
  waiverBudget?: number | null
}

type SnapshotRoster = {
  id: string
  platformUserId: string
  playerData?: unknown
  faabRemaining?: number | null
}

export type TradeDecisionSnapshotPayload = {
  policyVersion: string
  format: string
  leagueContext: Record<string, unknown>
  rosterContext: Record<string, unknown>
  assetContext: Record<string, unknown>
  managerContext: Record<string, unknown>
  outcomeSimulation: Record<string, unknown> | null
  evidence: TradeEvidence
  readiness: ReturnType<typeof assessTradeGradeReadiness>
  completeness: 'complete' | 'partial'
}

function conceptFor(league: SnapshotLeague): string {
  const raw = `${league.leagueType ?? ''} ${league.leagueVariant ?? ''}`.trim().toLowerCase()
  if (raw.includes('salary') || raw.includes('contract')) return 'salary_cap'
  if (raw.includes('survivor') && (league.guillotineMode || raw.includes('guillotine'))) return 'survivor_guillotine'
  if (raw.includes('survivor')) return 'survivor'
  if (league.guillotineMode || raw.includes('guillotine')) return 'guillotine'
  if (raw.includes('zombie')) return 'zombie'
  if (raw.includes('tournament')) return 'tournament'
  if (raw.includes('king') && raw.includes('hill')) return 'king_of_the_hill'
  if (raw.includes('pirate')) return 'pirate'
  if (league.isDynasty || raw.includes('dynasty')) return 'dynasty'
  return 'redraft'
}

function verifiedSimulation(metadata: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const delta = metadata?.projectedOutcomeDelta
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return null
  return {
    metric: 'proposal_outcome_delta',
    deltaPct: delta,
    verified: false,
    source: 'proposal_client_roundtrip',
    note: 'Preserved for audit only; it does not unlock a contextual grade until server verification is attached.',
  }
}

function cloneJson<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value)) as T
}

/** Build one frozen, honest receipt. Missing inputs remain missing instead of being guessed later. */
export function buildTradeDecisionSnapshot(input: {
  league: SnapshotLeague
  rosters: SnapshotRoster[]
  assets: TradeAssetInput[]
  proposedByUserId: string
  managerStrategy: { active: ProposalManagerStrategy; confirmedAt: Date } | null
  tradeSettings: Record<string, unknown>
  metadata?: Record<string, unknown>
  verifiedProposalEvidence?: VerifiedProposalEvidence | null
}): TradeDecisionSnapshotPayload {
  const concept = conceptFor(input.league)
  const policy = resolveTradeGradingPolicy({
    concept,
    bestBall: Boolean(input.league.bestBallMode),
    tradesEnabled: input.tradeSettings.tradesAllowed === true
      ? true
      : input.tradeSettings.tradesAllowed === false ? false : null,
    survivorMode: concept === 'survivor' || concept === 'survivor_guillotine',
    guillotineMode: concept === 'guillotine' || concept === 'survivor_guillotine',
  })
  const verified = input.verifiedProposalEvidence ?? null
  const simulation = verified
    ? { ...cloneJson(verified.simulation), verified: true, source: 'signed_server_proposal_evidence', modelVersion: verified.modelVersion, capturedAt: verified.capturedAt }
    : verifiedSimulation(input.metadata)
  const valuesAvailable = Boolean(verified?.assets.length && verified.assets.every((asset) => asset.value != null))
  const playerEvidence = verified?.assets.filter((asset) => asset.itemType === 'player') ?? []
  const projectionsAvailable = Boolean(verified && playerEvidence.length > 0 && playerEvidence.every((asset) => asset.weeklyProjection != null))
  const evidence: TradeEvidence = {
    team_identity: input.rosters.length >= 2 ? 'available' : 'missing',
    user_strategy: input.managerStrategy ? 'available' : 'missing',
    league_rules: input.league.settings != null ? 'available' : 'missing',
    trade_rules: Object.keys(input.tradeSettings).length ? 'available' : 'missing',
    roster_before: input.rosters.every((roster) => roster.playerData != null) ? 'available' : 'missing',
    roster_after: input.rosters.length >= 2 && input.assets.length > 0 ? 'available' : 'missing',
    as_of_asset_values: valuesAvailable ? 'available' : 'missing',
    as_of_projections: verified && playerEvidence.length === 0
      ? 'not_applicable'
      : projectionsAvailable ? 'available' : 'missing',
    paired_outcome_simulation: verified?.simulation.available === true ? 'available' : 'missing',
    historical_timestamp: 'available',
  }
  const readiness = assessTradeGradeReadiness(policy, evidence)
  return {
    policyVersion: policy.version,
    format: policy.format,
    leagueContext: {
      leagueId: input.league.id,
      season: input.league.season ?? null,
      sport: input.league.sport ?? null,
      leagueType: input.league.leagueType ?? null,
      leagueVariant: input.league.leagueVariant ?? null,
      leagueSize: input.league.leagueSize ?? null,
      starters: cloneJson(input.league.starters ?? null),
      settings: cloneJson(input.league.settings ?? null),
      playoffTeams: input.league.playoffTeams ?? null,
      playoffStartWeek: input.league.playoffStartWeek ?? null,
      waiverBudget: input.league.waiverBudget ?? null,
    },
    rosterContext: {
      rosters: input.rosters.map((roster) => ({
        rosterId: roster.id,
        platformUserId: roster.platformUserId,
        playerData: cloneJson(roster.playerData ?? null),
        faabRemaining: roster.faabRemaining ?? null,
      })),
    },
    assetContext: {
      assets: cloneJson(input.assets),
      verifiedEvidence: verified ? cloneJson(verified.assets) : null,
      evidenceModelVersion: verified?.modelVersion ?? null,
      valueSource: verified?.valueSource ?? null,
      projectionSource: verified?.projectionSource ?? null,
      evidenceCapturedAt: verified?.capturedAt ?? null,
    },
    managerContext: input.managerStrategy
      ? { proposedByUserId: input.proposedByUserId, active: input.managerStrategy.active, confirmedAt: input.managerStrategy.confirmedAt.toISOString() }
      : { proposedByUserId: input.proposedByUserId, active: null, confirmedAt: null },
    outcomeSimulation: simulation,
    evidence,
    readiness,
    completeness: readiness.contextualGradeAllowed ? 'complete' : 'partial',
  }
}

export async function writeTradeDecisionSnapshot(
  tx: Prisma.TransactionClient,
  input: { tradeId: string; leagueId: string; proposedByUserId: string; snapshot: TradeDecisionSnapshotPayload },
) {
  return tx.tradeDecisionSnapshot.create({
    data: {
      tradeId: input.tradeId,
      leagueId: input.leagueId,
      proposedByUserId: input.proposedByUserId,
      policyVersion: input.snapshot.policyVersion,
      format: input.snapshot.format,
      leagueContext: input.snapshot.leagueContext as Prisma.InputJsonValue,
      rosterContext: input.snapshot.rosterContext as Prisma.InputJsonValue,
      assetContext: input.snapshot.assetContext as Prisma.InputJsonValue,
      managerContext: input.snapshot.managerContext as Prisma.InputJsonValue,
      outcomeSimulation: input.snapshot.outcomeSimulation as Prisma.InputJsonValue | undefined,
      evidence: input.snapshot.evidence as Prisma.InputJsonValue,
      readiness: input.snapshot.readiness as unknown as Prisma.InputJsonValue,
      completeness: input.snapshot.completeness,
    },
  })
}
