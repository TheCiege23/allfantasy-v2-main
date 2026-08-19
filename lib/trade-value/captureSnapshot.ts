/**
 * T2 server-side snapshot capture. Enriches the proposal's assets with value sources available at
 * proposal time (projection from asset metadata, ADP from AdpDataRecord), builds team profiles, then
 * persists an immutable RedraftTradeValueSnapshot. Deterministic; no external/AI calls.
 */

import { prisma } from '@/lib/prisma'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from './snapshot'
import { buildTeamProfile } from './teamProfile'
import type { TeamProfile, TradeValueContext, TradeValueSnapshot } from './types'

type RawAsset = {
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerId?: string | null
  playerName?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  metadata?: Record<string, unknown> | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function profileFor(rosterId: string, seasonId: string, leagueSize: number): Promise<TeamProfile | undefined> {
  const roster = await prisma.redraftRoster.findUnique({
    where: { id: rosterId },
    select: {
      id: true, wins: true, losses: true, ties: true, pointsFor: true, playoffSeed: true,
      players: { where: { droppedAt: null }, select: { position: true } },
    },
  })
  if (!roster) return undefined
  return buildTeamProfile({
    rosterId: roster.id,
    wins: roster.wins,
    losses: roster.losses,
    ties: roster.ties,
    pointsFor: roster.pointsFor,
    playoffSeed: roster.playoffSeed,
    leagueSize,
    positions: roster.players.map((p) => p.position),
  })
}

export async function captureRedraftTradeValueSnapshot(input: {
  proposalId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  sport: string
  scoring: string
  rosterFormat: string
  currentSeason: number | null
  assets: RawAsset[]
}): Promise<TradeValueSnapshot> {
  const playerIds = input.assets
    .filter((a) => a.assetType === 'player' && a.playerId)
    .map((a) => a.playerId as string)

  const adpByPlayer = new Map<string, number>()
  if (playerIds.length) {
    const rows = await prisma.adpDataRecord.findMany({
      where: { playerId: { in: playerIds }, sport: input.sport },
      orderBy: { createdAt: 'desc' },
      select: { playerId: true, adp: true },
    })
    for (const r of rows) if (!adpByPlayer.has(r.playerId)) adpByPlayer.set(r.playerId, r.adp)
  }

  const enriched: EnrichedTradeAsset[] = input.assets.map((a) => {
    const md = (a.metadata ?? {}) as Record<string, unknown>
    const kind = a.assetType as EnrichedTradeAsset['kind']
    return {
      kind,
      fromRosterId: a.fromRosterId,
      toRosterId: a.toRosterId,
      playerId: a.playerId ?? null,
      playerName: a.playerName ?? null,
      position: typeof md.position === 'string' ? md.position : null,
      team: typeof md.team === 'string' ? md.team : null,
      pickSeason: a.pickSeason ?? null,
      pickRound: a.pickRound ?? null,
      pickLabel: typeof md.label === 'string' ? md.label : null,
      faabAmount: kind === 'faab' ? num(md.amount) : null,
      sources: {
        projectionValue: num(md.restOfSeasonProjection) ?? num(md.weeklyProjection),
        rankingValue: null, // deferred (see docs/trade-value-grader-audit.md)
        adpValue: a.playerId ? adpByPlayer.get(a.playerId) ?? null : null,
        fantasyCalcValue: null, // deferred — live external API excluded from the write path
      },
    }
  })

  const seasonRosterCount = await prisma.redraftRoster.count({ where: { seasonId: input.seasonId } })
  const leagueSize = seasonRosterCount || 12
  const [a, b] = await Promise.all([
    profileFor(input.proposerRosterId, input.seasonId, leagueSize),
    profileFor(input.receiverRosterId, input.seasonId, leagueSize),
  ])

  const context: TradeValueContext = {
    sport: input.sport,
    leagueType: 'redraft',
    scoring: input.scoring,
    rosterFormat: input.rosterFormat,
    capturedAt: new Date().toISOString(),
  }

  const snapshot = buildTradeValueSnapshot({
    proposerRosterId: input.proposerRosterId,
    receiverRosterId: input.receiverRosterId,
    assets: enriched,
    context,
    currentSeason: input.currentSeason,
    profiles: { a, b },
  })

  // Honesty pass: `grade`/`fairnessScore` can now be null when NOTHING on
  // either side resolved to a value (previously that scored a false "A+").
  // The denormalized scalar columns are non-nullable in Prisma, so an
  // ungradeable snapshot is written with an unmistakable sentinel and a
  // fairness of 0 — i.e. it lands in the "flag for review" direction rather
  // than the old silent-approval direction. `payload` remains the source of
  // truth and carries `insufficientData: true` plus null grade/fairness.
  // FOLLOW-UP: an additive migration making these two columns nullable would
  // remove the sentinel entirely (see AF_TRADE_UNIFICATION_BRIEF Slice 11).
  const ungradeable = snapshot.grade.insufficientData
  await prisma.redraftTradeValueSnapshot.create({
    data: {
      proposalId: input.proposalId,
      version: snapshot.version,
      payload: snapshot as unknown as object,
      grade: snapshot.grade.grade ?? 'NOT_GRADED',
      fairnessScore: snapshot.grade.fairnessScore ?? 0,
      confidenceScore: snapshot.grade.confidenceScore,
      valueDifference: snapshot.grade.valueDifference,
    },
  })
  if (ungradeable) {
    console.warn(
      `[trade-value] proposal ${input.proposalId} could not be graded — no asset resolved to a value.`,
    )
  }

  return snapshot
}
