/**
 * Decision OS — route-seam data loader for `manager.trade.evaluate` (Slice 3).
 *
 * The ONLY Decision-OS trade module that touches prisma. It lives at the route seam (NOT the decision
 * layer) and loads the World facts (League trade settings, season week, both rosters' FAAB/standings).
 * READ-ONLY. The authoritative deterministic snapshot (the evaluation memo) is PASSED IN by the route
 * (already read as `snapshotRow`) — this loader NEVER calls captureRedraftTradeValueSnapshot and never
 * recomputes the snapshot. Returns null when data is missing so the shadow skips. Injectable for tests.
 */
import { prisma } from '@/lib/prisma'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import type { TradeRosterFacts, TradeSettingsFacts, TradeWorldInput } from './world'

export interface TradeWorldFacts {
  sport: string
  leagueId: string
  seasonId: string
  currentWeek: number
  settings: TradeSettingsFacts
  proposer: TradeRosterFacts
  receiver: TradeRosterFacts
}

export interface TradeLoaderDeps {
  loadLeagueSettings: (leagueId: string) => Promise<{
    sport: string | null
    tradeReviewHours: number | null
    tradeDeadlineWeek: number | null
    draftPickTrading: boolean | null
  } | null>
  loadSeason: (seasonId: string, leagueId: string) => Promise<{ currentWeek: number | null; season: number | null } | null>
  loadRoster: (rosterId: string, seasonId: string, leagueId: string) => Promise<{
    id: string
    faabBalance: number | null
    wins: number | null
    losses: number | null
    ties: number | null
    pointsFor: number | null
    playoffSeed: number | null
  } | null>
}

export const defaultTradeLoaderDeps: TradeLoaderDeps = {
  loadLeagueSettings: async (leagueId) =>
    (await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true, tradeReviewHours: true, tradeDeadlineWeek: true, draftPickTrading: true },
    })) as unknown as Awaited<ReturnType<TradeLoaderDeps['loadLeagueSettings']>>,
  loadSeason: async (seasonId, leagueId) =>
    (await prisma.redraftSeason.findFirst({ where: { id: seasonId, leagueId }, select: { currentWeek: true, season: true } })),
  loadRoster: async (rosterId, seasonId, leagueId) =>
    (await prisma.redraftRoster.findFirst({
      where: { id: rosterId, seasonId, leagueId },
      select: { id: true, faabBalance: true, wins: true, losses: true, ties: true, pointsFor: true, playoffSeed: true },
    })) as unknown as Awaited<ReturnType<TradeLoaderDeps['loadRoster']>>,
}

/**
 * Load the World facts for a trade evaluation. Never throws — any miss returns null and the caller
 * (shadow) skips. READ-ONLY. Never touches the snapshot.
 */
export async function loadTradeWorldFacts(
  input: { leagueId: string; seasonId: string; proposerRosterId: string; receiverRosterId: string },
  deps: TradeLoaderDeps = defaultTradeLoaderDeps,
): Promise<TradeWorldFacts | null> {
  try {
    const [league, season, proposer, receiver] = await Promise.all([
      deps.loadLeagueSettings(input.leagueId),
      deps.loadSeason(input.seasonId, input.leagueId),
      deps.loadRoster(input.proposerRosterId, input.seasonId, input.leagueId),
      deps.loadRoster(input.receiverRosterId, input.seasonId, input.leagueId),
    ])
    if (!league || !season || !proposer || !receiver) return null
    const toFacts = (r: NonNullable<Awaited<ReturnType<TradeLoaderDeps['loadRoster']>>>): TradeRosterFacts => ({
      rosterId: r.id,
      faabBalance: r.faabBalance ?? null,
      wins: r.wins ?? null,
      losses: r.losses ?? null,
      ties: r.ties ?? null,
      pointsFor: r.pointsFor ?? null,
      playoffSeed: r.playoffSeed ?? null,
    })
    return {
      sport: String(league.sport ?? 'NFL'),
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      currentWeek: Math.max(1, Number(season.currentWeek ?? 1) || 1),
      settings: {
        reviewType: 'commissioner',
        tradeReviewHours: league.tradeReviewHours ?? null,
        tradeDeadlineWeek: league.tradeDeadlineWeek ?? null,
        draftPickTrading: Boolean(league.draftPickTrading),
      },
      proposer: toFacts(proposer),
      receiver: toFacts(receiver),
    }
  } catch {
    return null
  }
}

/** Shape loaded World facts into the World Resolution input (pure glue at the seam). */
export function worldInputFromFacts(facts: TradeWorldFacts, snapshotAvailable: boolean): TradeWorldInput {
  return {
    sport: facts.sport,
    leagueId: facts.leagueId,
    seasonId: facts.seasonId,
    currentWeek: facts.currentWeek,
    settings: facts.settings,
    proposer: facts.proposer,
    receiver: facts.receiver,
    snapshotAvailable,
  }
}

/** Best-effort parse of a persisted snapshot row's JSON payload into a TradeValueSnapshot. */
export function parseTradeSnapshot(payload: unknown): TradeValueSnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Partial<TradeValueSnapshot>
  if (!p.grade || !Array.isArray(p.sides) || p.sides.length < 2) return null
  return payload as TradeValueSnapshot
}

/**
 * E.5 — one freshest persisted ADP record per player id (provider-neutral market seam).
 *
 * READ-ONLY. Reads the SAME already-persisted `AdpDataRecord` table + key the redraft snapshot-capture
 * path reads (`lib/trade-value/captureSnapshot.ts`): keyed by `playerId` + `sport`, freshest by
 * `createdAt desc`. NEVER writes, warms a cache, or calls the live FFC endpoint (`lib/adp-data.ts`).
 * Rows are returned freshest-first so the caller keeps the first row per id. The `position` carried on
 * the record is provenance/fallback only — authoritative position comes from the SportsPlayer cache.
 */
export interface AdpRecordRow {
  playerId: string
  adp: number | null
  position: string | null
}

export async function loadAdpRecords(sport: string, playerIds: string[]): Promise<AdpRecordRow[]> {
  const clean = Array.from(new Set(playerIds.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 200)
  if (clean.length === 0) return []
  const rows = await prisma.adpDataRecord.findMany({
    where: { playerId: { in: clean }, sport },
    orderBy: { createdAt: 'desc' },
    select: { playerId: true, adp: true, position: true },
  })
  return rows.map((row: { playerId: string; adp: number | null; position: string | null }) => ({
    playerId: row.playerId,
    adp: row.adp ?? null,
    position: row.position ?? null,
  }))
}
