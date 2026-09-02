/**
 * T2 server-side snapshot capture. Enriches the proposal's assets with value sources available at
 * proposal time (projection from asset metadata, ADP from AdpDataRecord), builds team profiles, then
 * persists an immutable RedraftTradeValueSnapshot. Deterministic; no external/AI calls.
 */

import { prisma } from '@/lib/prisma'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from './snapshot'
import { buildTeamProfile } from './teamProfile'
import type { TeamProfile, TradeValueContext, TradeValueSnapshot } from './types'
import { scoringContextFromWorld } from '@/lib/decision-os/trade/scoringContextFromWorld'
import { resolveTradeEnrichment } from '@/lib/decision-os/trade/enrichmentPort'

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
  /**
   * The league, so the real scarcity context can be read.
   *
   * ⚠ OPTIONAL ON PURPOSE. Omit it and every value is byte-identical to before — which is the
   * honest degrade, because the alternative (guessing 12 teams and standard scoring) is what put
   * superflex and 32-team leagues on the wrong market in the first place.
   */
  leagueId?: string | null
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

  const seasonRosterCount = await prisma.redraftRoster.count({ where: { seasonId: input.seasonId } })
  const leagueSize = seasonRosterCount || 12

  /*
   * The league's REAL shape — team count, starting slots, PPR, TE premium.
   *
   * 🛑 THIS PATH USED TO PRICE EVERY LEAGUE AS STANDARD 1-QB REDRAFT, and the route made it worse
   * by hardcoding `scoring: season.sport === 'NCAAF' ? 'standard' : 'ppr'`. Superflex, 2QB, TE
   * premium and league size all reach the engine from here now.
   *
   * `seasonRosterCount` is the truthful team count when it is non-zero; the `|| 12` fallback above
   * is kept for `leagueSize` (existing behaviour) but deliberately NOT used for the shape, because
   * `buildLeagueShape` refusing is better than a 12-team guess for a 4- or 32-team league.
   */
  let scoring = null as ReturnType<typeof scoringContextFromWorld>
  if (input.leagueId) {
    const league = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { starters: true, settings: true, rosterSize: true, irSlots: true, taxiSlots: true },
    })
    if (league) {
      const starterSlots = Array.isArray(league.starters)
        ? (league.starters as unknown[]).filter((x): x is string => typeof x === 'string')
        : null
      scoring = scoringContextFromWorld({
        teams: seasonRosterCount,
        starterSlots,
        rosterSize: league.rosterSize,
        irSlots: league.irSlots,
        taxiSlots: league.taxiSlots,
        scoringSettings: league.settings,
      })
    }
  }

  /*
   * ── PHASE 2 · ONE ENRICHMENT SOURCE, NOT TWO ────────────────────────────────────────────────
   *
   * 🛑 THIS WRITE PATH USED TO HARDCODE THREE OF ITS FIVE VALUE SOURCES TO `null`:
   *
   *     rankingValue:     null   "deferred"
   *     fantasyCalcValue: null   "live external API excluded from the write path"
   *     idpValue:         null   "this write path carries no league scoring or slots"
   *
   * Every stated reason is now obsolete. `getFantasyCalcValuesDbFirst` is DB-backed, so nothing
   * here reaches a live API; and the league's slots ARE available — the shape resolution directly
   * below reads them. Meanwhile `resolveTradeEnrichment` already assembles exactly these sources
   * for the Decision OS path, which is live in production.
   *
   * ⚠ SO THE FIX IS TO SHARE THE RESOLVER, NOT TO RE-IMPLEMENT IT HERE. Two implementations of
   * "what is this player worth" is the defect that produced the split brain in the first place:
   * the trade UI showed an enriched memo while the PERSISTED snapshot — the one Chimmy reads —
   * carried projection and ADP alone. Duplicating the logic would have preserved that split
   * behind two code paths that agree today and drift tomorrow.
   *
   * ⚠ IT ALSO INHERITS THE AF PROJECTION WIRING FOR FREE, including the Sleeper -> registry
   * crosswalk. Measured on production: redraft rosters are Sleeper-keyed and match
   * `AFProjectionSnapshot` on ZERO of 2,315 rows directly, but 77% through the registry.
   */
  const enrichmentResult = playerIds.length
    ? await resolveTradeEnrichment({
        sport: input.sport,
        playerIds,
        season: input.currentSeason ?? null,
        week: null,
        /*
         * ⚠ BOTH OF THESE GATE A SOURCE, AND OMITTING EITHER SILENTLY RETURNS NULL FOR IT. The
         * resolver refuses to price against a chart it was not told to use — a 1QB redraft roster
         * valued on the superflex dynasty board produces numbers that all look plausible and are
         * all wrong — so an absent format means no market value at all, not a defaulted one.
         *
         * This is redraft by construction (it is the redraft capture path), and the QB format
         * comes from the shape resolved above rather than from a label: `superflexSlots > 0` is
         * read off the league's real `roster_positions`, which cannot be misspelled the way a
         * scoring string can.
         */
        valueFormat: {
          format: 'REDRAFT',
          qbFormat: (scoring?.shape?.superflexSlots ?? 0) > 0 ? 'SUPERFLEX' : 'ONE_QB',
        },
        /*
         * IDP is priced from the league's OWN starting slots, so it is supplied only when those
         * are actually known. `buildLeagueShape` refused if they were not, and a defender valued
         * against another league's requirements is worse than one honestly left unpriced.
         */
        idpLeague:
          input.leagueId && scoring?.shape
            ? {
                leagueId: input.leagueId,
                starterSlots: [...scoring.shape.starterSlots],
                numTeams: scoring.shape.teams,
                isDynasty: false,
              }
            : null,
      }).catch(() => null)
    : null
  const enrich = enrichmentResult?.enrichment ?? {}

  /*
   * ADP still has a local fallback. The resolver reads the same `adp_data` table, but this path
   * previously worked without it and a resolver failure must not silently remove a source that
   * used to be present.
   */
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
        /*
         * Resolver first, client metadata second. The resolver reads `AFProjectionSnapshot` (the
         * engine's own numbers, already rest-of-season) and falls back to the provider table;
         * `md.restOfSeasonProjection` is whatever the CLIENT supplied, which is weaker but is what
         * this path used before and must not be lost when the resolver has nothing.
         */
        projectionValue:
          (a.playerId ? enrich.projectionByPlayerId?.[a.playerId] ?? null : null) ??
          num(md.restOfSeasonProjection) ??
          num(md.weeklyProjection),
        /*
         * ⚠ STILL NULL, AND NOW DELIBERATELY SO RATHER THAN "DEFERRED". Nothing in this codebase
         * produces a ranking on the 0-10000 convention this field would need, and
         * `computeConfidence` does not read it. A field that no producer fills and no consumer
         * reads is not pending work — it is a contract line that has never been true. Left in
         * place because removing it is a breaking change to `AssetValueSources`, and flagged here
         * so the next reader does not go looking for the producer.
         */
        rankingValue: null,
        adpValue:
          (a.playerId ? enrich.adpByPlayerId?.[a.playerId] ?? null : null) ??
          (a.playerId ? adpByPlayer.get(a.playerId) ?? null : null),
        fantasyCalcValue: a.playerId ? enrich.marketValueByPlayerId?.[a.playerId] ?? null : null,
        idpValue: a.playerId ? enrich.idpValueByPlayerId?.[a.playerId] ?? null : null,
      },
    }
  })

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
    scoring,
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
