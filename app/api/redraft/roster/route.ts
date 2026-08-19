import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import { buildAllFantasyProjection } from '@/lib/redraft/projectionEngine'
import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import {
  applyRedraftLineupMoves,
  validateRedraftLineup,
  type RedraftLineupPlayer,
  type RedraftLineupValidationResult,
} from '@/lib/redraft/lineupValidation'
import { hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import {
  getCanonicalNflPlayerByNameTeam,
  getCanonicalNflPlayerContext,
} from '@/lib/nfl-data-foundation'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { getTeamLogo } from '@/lib/players/getTeamLogo'
import { resolveRedraftRosterLookup } from '@/lib/redraft/redraftRosterIdentity'
import { recordRedraftRosterMoveHistory } from '@/lib/redraft/rosterMoveHistory'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'

export const dynamic = 'force-dynamic'

type RosterPlayerRow = RedraftLineupPlayer & {
  weeklyScore?: unknown
}

type PlayerWeeklyScoreRow = {
  playerId: string
  sport: string
  stats: Record<string, unknown>
  fantasyPts: number
  isFinalized: boolean
}

type SportsInjuryRow = {
  sport: string
  playerId: string | null
  playerName: string
  status: string | null
}

type RedraftRosterRouteRow = {
  id: string
  leagueId: string
  ownerId: string
  players: RosterPlayerRow[]
  season: {
    season: number
    sport: string
    currentWeek?: number | null
    totalWeeks?: number | null
  }
  [key: string]: unknown
}

function playerInjuryKey(player: { playerId?: string | null; playerName?: string | null; sport?: string | null }) {
  const sport = String(player.sport ?? '').toUpperCase()
  const playerId = String(player.playerId ?? '').trim()
  if (playerId) return `${sport}:id:${playerId}`
  return `${sport}:name:${String(player.playerName ?? '').trim().toLowerCase()}`
}

async function hydrateCurrentInjuryStatuses<T extends RosterPlayerRow>(
  players: T[],
  season: number,
  week: number,
): Promise<T[]> {
  if (players.length === 0) return players
  const playerIds = players.map((p) => p.playerId).filter(Boolean)
  const playerNames = players.map((p) => p.playerName).filter(Boolean)
  const sports = Array.from(new Set(players.map((p) => p.sport).filter(Boolean)))
  const rows = (await prisma.sportsInjury.findMany({
    where: {
      sport: { in: sports },
      expiresAt: { gte: new Date() },
      AND: [
        { OR: [{ playerId: { in: playerIds } }, { playerName: { in: playerNames } }] },
        ...(Number.isFinite(season) ? [{ OR: [{ season }, { season: null }] }] : []),
        ...(Number.isFinite(week) ? [{ OR: [{ week }, { week: null }] }] : []),
      ],
    },
    orderBy: [{ fetchedAt: 'desc' }],
    take: Math.max(50, players.length * 3),
  })) as SportsInjuryRow[]

  const statusByKey = new Map<string, string | null>()
  for (const row of rows) {
    const idKey = playerInjuryKey(row)
    if (!statusByKey.has(idKey)) statusByKey.set(idKey, row.status ?? null)
    const nameKey = `${String(row.sport ?? '').toUpperCase()}:name:${String(row.playerName ?? '').trim().toLowerCase()}`
    if (!statusByKey.has(nameKey)) statusByKey.set(nameKey, row.status ?? null)
  }

  return players.map((player) => {
    const status = statusByKey.get(playerInjuryKey(player))
    return status ? { ...player, injuryStatus: status } : player
  })
}

function buildLineupValidation(args: {
  sport: string
  week: number
  players: RedraftLineupPlayer[]
  previousPlayers?: RedraftLineupPlayer[]
  extraIssues?: Parameters<typeof validateRedraftLineup>[0]['extraIssues']
  rosterConfig?: Parameters<typeof validateRedraftLineup>[0]['rosterConfig']
}): RedraftLineupValidationResult {
  return validateRedraftLineup(args)
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!rosterId && !seasonId && !leagueId) {
    return NextResponse.json({ error: 'rosterId, seasonId, or leagueId required' }, { status: 400 })
  }
  const parsedWeek = parseOptionalRedraftPositiveInteger(req.nextUrl.searchParams?.get('week'), 'week')
  if (!parsedWeek.ok) {
    return NextResponse.json({ error: parsedWeek.error }, { status: 400 })
  }
  const week = parsedWeek.value ?? 1

  const lookup = await resolveRedraftRosterLookup({
    userId,
    requestedRosterId: rosterId,
    seasonId,
    leagueId,
  })
  if (!lookup.season || !lookup.roster) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(lookup.season.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const roster = (await prisma.redraftRoster.findFirst({
    where: { id: lookup.roster.id },
    include: { players: true, season: true },
  })) as RedraftRosterRouteRow | null
  if (!roster) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Derive lineup locks from the real game schedule (G1): each player is locked
  // once their game has kicked off, per the commissioner lock mode. Validation
  // downstream rejects moving a locked player.
  const leagueForLock = await prisma.league.findUnique({
    where: { id: roster.leagueId },
    select: { settings: true },
  })
  const lockHydrated = await hydrateRedraftLineupLocks(prisma, {
    sport: roster.season.sport,
    season: roster.season.season,
    week,
    rosterId: roster.id,
    leagueSettings: leagueForLock?.settings ?? null,
    players: roster.players,
  })
  roster.players = lockHydrated.players as RosterPlayerRow[]
  // G10: resolve the commissioner roster config so lineup validation honors the
  // league's configured slots (FLEX/SF/K/IDP/counts) + bench/IR/taxi limits.
  const rosterConfig = resolveRedraftRosterConfig(roster.season.sport, leagueForLock?.settings ?? null)

  const playerIds = roster.players.map((p) => p.playerId)
  const sports = Array.from(new Set(roster.players.map((p) => p.sport).filter(Boolean)))
  const seasonString = String(roster.season.season)
  let scores: PlayerWeeklyScoreRow[] = []
  let fantasyProjectionRows: FantasyProjectionRow[] = []
  let afProjectionRows: AfProjectionRow[] = []
  let seasonStatRows: SeasonStatsRow[] = []
  let adpRows: Array<{ playerKey: string | null; averageOverallPick: number }> = []
  if (playerIds.length) {
    ;[
      scores,
      fantasyProjectionRows,
      afProjectionRows,
      seasonStatRows,
      adpRows,
    ] = await Promise.all([
      prisma.playerWeeklyScore.findMany({
        where: {
          playerId: { in: playerIds },
          week,
          season: roster.season.season,
          sport: { in: sports },
        },
      }) as Promise<PlayerWeeklyScoreRow[]>,
      prisma.fantasyProjection
        .findMany({
          where: {
            playerId: { in: playerIds },
            week,
            season: seasonString,
            sport: { in: sports },
          },
          select: { playerId: true, sport: true, projectedPoints: true, fetchedAt: true },
        })
        .catch(() => []) as Promise<FantasyProjectionRow[]>,
      prisma.aFProjectionSnapshot
        .findMany({
          where: {
            playerId: { in: playerIds },
            week,
            season: roster.season.season,
            sport: { in: sports },
          },
          orderBy: { computedAt: 'desc' },
          select: { playerId: true, sport: true, afProjection: true, confidenceLevel: true, computedAt: true },
        })
        .catch(() => []) as Promise<AfProjectionRow[]>,
      prisma.playerSeasonStats
        .findMany({
          where: {
            playerId: { in: playerIds },
            season: seasonString,
            seasonType: 'regular',
            sport: { in: sports },
          },
          orderBy: [{ source: 'desc' }, { fetchedAt: 'desc' }],
          select: {
            playerId: true,
            sport: true,
            fantasyPointsPerGame: true,
            gamesPlayed: true,
            stats: true,
            fetchedAt: true,
            source: true,
          },
        })
        .catch(() => []) as Promise<SeasonStatsRow[]>,
      prisma.allFantasyAdpSnapshot
        .findMany({
          where: {
            sport: { in: sports },
            leagueType: 'redraft',
            season: seasonString,
          },
          select: { playerKey: true, averageOverallPick: true },
          orderBy: { averageOverallPick: 'asc' },
          take: 4000,
        })
        .catch(() => []) as Promise<Array<{ playerKey: string | null; averageOverallPick: number }>>,
    ])
  }
  const scoreByPlayer = new Map(scores.map((score) => [`${score.playerId}:${score.sport}`, score]))
  const projectionByPlayer = new Map(fantasyProjectionRows.map((row) => [`${row.playerId}:${row.sport}`, row]))
  const afProjectionByPlayer = new Map<string, AfProjectionRow>()
  for (const row of afProjectionRows) {
    const key = `${row.playerId}:${row.sport}`
    if (!afProjectionByPlayer.has(key)) afProjectionByPlayer.set(key, row)
  }
  const seasonStatsByPlayer = new Map<string, SeasonStatsRow>()
  for (const row of seasonStatRows) {
    const key = `${row.playerId}:${row.sport}`
    const existing = seasonStatsByPlayer.get(key)
    const rowIsRi = row.source === 'rolling_insights'
    const existingIsRi = existing?.source === 'rolling_insights'
    if (!existing || (rowIsRi && !existingIsRi) || (rowIsRi === existingIsRi && row.fetchedAt > existing.fetchedAt)) {
      seasonStatsByPlayer.set(key, row)
    }
  }
  const adpByPlayerKey = new Map<string, number>()
  for (const row of adpRows) {
    if (row.playerKey && !adpByPlayerKey.has(row.playerKey)) {
      adpByPlayerKey.set(row.playerKey, row.averageOverallPick)
    }
  }

  const scoredPlayers = await Promise.all(
    roster.players.map(async (player) => {
      const weeklyScore = scoreByPlayer.get(`${player.playerId}:${player.sport}`) ?? null
      const projectionKey = `${player.playerId}:${player.sport}`
      const providerProjection = projectionByPlayer.get(projectionKey)
      const afProjection = afProjectionByPlayer.get(projectionKey)
      const seasonStats = seasonStatsByPlayer.get(projectionKey)
      const adp = adpByPlayerKey.get(buildPlayerKey(player.playerName, player.position)) ?? null
      const projection = buildAllFantasyProjection({
        playerId: player.playerId,
        playerName: player.playerName,
        sport: player.sport,
        position: player.position,
        team: player.team,
        currentWeek: week,
        totalWeeks: roster.season.totalWeeks ?? 17,
        byeWeek: player.byeWeek,
        injuryStatus: player.injuryStatus,
        adp,
        providerWeeklyProjection: providerProjection?.projectedPoints ?? null,
        allFantasyWeeklyProjection: afProjection?.afProjection ?? null,
        allFantasyConfidenceLevel: afProjection?.confidenceLevel ?? null,
        rollingInsightsFantasyPointsPerGame: seasonStats?.fantasyPointsPerGame ?? null,
        rollingInsightsGamesPlayed: seasonStats?.gamesPlayed ?? null,
        rollingInsightsStats: seasonStats?.stats ?? null,
      })
      const canonical =
        String(player.sport).toUpperCase() === 'NFL'
          ? (await getCanonicalNflPlayerContext(player.playerId, {
              season: roster.season.season,
              week,
            }).catch(() => null)) ??
            (await getCanonicalNflPlayerByNameTeam(player.playerName, player.team, {
              position: player.position,
              season: roster.season.season,
              week,
            }).catch(() => null))
          : null
      const weeklyProjection = canonical?.projection?.projectedPoints ?? projection.weeklyProjection
      const restOfSeasonProjection = canonical?.projection?.restOfSeason ?? projection.restOfSeasonProjection
      const floorProjection = canonical?.projection?.floor ?? projection.floorProjection
      const ceilingProjection = canonical?.projection?.ceiling ?? projection.ceilingProjection
      const projectionConfidenceScore = canonical?.projection?.confidence ?? projection.confidenceScore
      const projectionConfidenceLevel = canonical?.projection?.confidenceLevel ?? projection.confidenceLevel
      const projectionSource = canonical?.projection?.projectionSource ?? projection.source
      const availabilityWarnings = [
        player.isLocked ? 'Player is locked for the current scoring period.' : null,
        canonical?.byeWeek === week || player.byeWeek === week ? 'Player is on bye this week.' : null,
        canonical?.injuryStatus ? `Injury status: ${canonical.injuryStatus}.` : null,
      ].filter(Boolean)
      const projectionFields = {
        weeklyProjection,
        restOfSeasonProjection,
        floorProjection,
        ceilingProjection,
        projectionConfidenceScore,
        projectionConfidenceLevel,
        projectionSource,
        startSitRecommendation: {
          recommendation:
            player.isLocked
              ? 'locked'
              : weeklyProjection == null
                ? 'needs-data'
                : weeklyProjection >= 10
                  ? 'start'
                  : 'bench',
          projectedPoints: weeklyProjection,
          confidence: projectionConfidenceScore,
          warnings: availabilityWarnings,
        },
        canonicalNfl: canonical
          ? {
              playerId: canonical.playerId,
              providerIds: canonical.providerIds,
              projection: canonical.projection,
              injuryStatus: canonical.injuryStatus,
              byeWeek: canonical.byeWeek,
              depthChartRole: canonical.depthChartRole,
              dataSources: canonical.dataSources,
              staleDataWarnings: canonical.staleDataWarnings,
            }
          : undefined,
      }
      if (!weeklyScore) return { ...player, weeklyScore: null, ...projectionFields }
      return {
        ...player,
        ...projectionFields,
        weeklyScore: {
          ...weeklyScore,
          fantasyPts: await calculateScoreFromSportConfig(
            roster.leagueId,
            player.playerId,
            week,
            weeklyScore.stats as Record<string, number>,
            player.position,
          ),
        },
      }
    }),
  )
  const players = await hydrateCurrentInjuryStatuses(scoredPlayers, roster.season.season, week)
  const unifiedRosterRows = await getNormalizedPlayerData({
    surface: 'roster',
    leagueId: lookup.season.leagueId,
    userId,
    playerIds: players.map((player) => player.playerId).filter(Boolean),
    limit: Math.max(players.length, 1),
  }).catch(() => [])
  const unifiedRoster = unifiedRosterRows.map(serializeUnifiedPlayerForApi)
  const unifiedById = new Map(unifiedRoster.map((row) => [row.id, row]))
  const hydratedPlayers = players.map((player) => {
    const unified = unifiedById.get(player.playerId)
    const canonical = unified?.nflRedraft ?? null
    const canonicalProjection = canonical?.currentProjection ?? null
    const teamLogoUrl = canonical?.media.teamLogo.url ?? unified?.teamLogoUrl ?? getTeamLogo(player.team, player.sport)
    const headshotUrl = canonical?.media.headshot.url ?? unified?.headshotUrl ?? null
    return {
      ...player,
      playerName: canonical?.displayName ?? player.playerName,
      position: canonical?.fantasyPosition ?? player.position,
      team: canonical?.teamAbbr ?? player.team,
      injuryStatus: canonical?.injury.designation ?? unified?.injuryStatus ?? player.injuryStatus,
      providerInjuryLabel: canonical?.injury.designation ?? unified?.injuryStatus ?? null,
      activeStatus: canonical?.activeStatus ?? null,
      weeklyProjection: canonicalProjection?.weeklyProjectedPoints ?? player.weeklyProjection,
      restOfSeasonProjection: canonicalProjection?.restOfSeasonProjectedPoints ?? player.restOfSeasonProjection,
      floorProjection: canonicalProjection?.floor ?? player.floorProjection,
      ceilingProjection: canonicalProjection?.ceiling ?? player.ceilingProjection,
      projectionSource: canonicalProjection?.source ?? player.projectionSource,
      adp: canonical?.adp ?? unified?.adp ?? null,
      rank: canonical?.rank ?? null,
      positionalRank: canonical?.positionalRank ?? null,
      playerDataLastUpdatedAt: canonical?.lastUpdatedAt ?? null,
      playerDataWarnings: canonical?.dataFreshness.staleWarnings ?? [],
      canonicalNflRedraft: canonical,
      headshotUrl,
      imageUrl: unified?.imageUrl ?? headshotUrl,
      teamLogoUrl,
    }
  })
  const lineupValidation = buildLineupValidation({
    sport: roster.season.sport,
    week,
    players: hydratedPlayers,
    rosterConfig,
  })

  return NextResponse.json({
    roster: {
      ...roster,
      players: hydratedPlayers,
      lineupValidation,
    },
    unifiedRoster,
    week,
    ...(process.env.NODE_ENV === 'development'
      ? {
          rosterLookup: {
            requestedRosterId: rosterId ?? null,
            resolvedBy: lookup.resolvedBy,
            repairedOwnerId: lookup.repairedOwnerId,
            ownerId: lookup.roster.ownerId,
            seasonId: lookup.season.id,
            leagueId: lookup.season.leagueId,
            ownerIdCandidates: lookup.ownerIdCandidates,
            requestedOwnerIdCandidates: lookup.requestedOwnerIdCandidates,
          },
        }
      : {}),
  })
}

type FantasyProjectionRow = {
  playerId: string
  sport: string
  projectedPoints: number
  fetchedAt: Date
}

type AfProjectionRow = {
  playerId: string
  sport: string
  afProjection: number
  confidenceLevel: string
  computedAt: Date
}

type SeasonStatsRow = {
  playerId: string
  sport: string
  fantasyPointsPerGame: number | null
  gamesPlayed: number | null
  stats: unknown
  fetchedAt: Date
  source: string
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { rosterId?: string; week?: number; moves?: { playerId: string; fromSlot?: string; toSlot: string }[] }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rosterId = body.rosterId?.trim()
  if (!rosterId || !body.moves?.length) {
    return NextResponse.json({ error: 'rosterId and moves required' }, { status: 400 })
  }

  const targetLookup = await resolveRedraftRosterLookup({
    userId,
    requestedRosterId: rosterId,
  })
  if (!targetLookup.season || !targetLookup.roster) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const viewerLookup = await resolveRedraftRosterLookup({
    userId,
    seasonId: targetLookup.season.id,
    leagueId: targetLookup.season.leagueId,
  })
  if (!viewerLookup.roster || viewerLookup.roster.id !== targetLookup.roster.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const roster = (await prisma.redraftRoster.findFirst({
    where: { id: targetLookup.roster.id },
    include: { players: true, season: true },
  })) as RedraftRosterRouteRow | null
  if (!roster) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const week = Math.max(1, Math.floor(Number(body.week ?? roster.season.currentWeek ?? 1) || 1))
  const injuryHydrated = await hydrateCurrentInjuryStatuses(roster.players, roster.season.season, week)
  // Enforce lineup locks (G1): stamp derived isLocked from the schedule BEFORE
  // applying moves, so a player whose game has kicked off cannot be moved.
  const leagueForLock = await prisma.league.findUnique({
    where: { id: roster.leagueId },
    select: { settings: true },
  })
  const { players: currentPlayers } = await hydrateRedraftLineupLocks(prisma, {
    sport: roster.season.sport,
    season: roster.season.season,
    week,
    rosterId: roster.id,
    leagueSettings: leagueForLock?.settings ?? null,
    players: injuryHydrated,
  })
  const rosterConfig = resolveRedraftRosterConfig(roster.season.sport, leagueForLock?.settings ?? null)
  const applied = applyRedraftLineupMoves(currentPlayers, body.moves)
  const lineupValidation = buildLineupValidation({
    sport: roster.season.sport,
    week,
    players: applied.players,
    previousPlayers: currentPlayers,
    extraIssues: applied.issues,
    rosterConfig,
  })

  if (!lineupValidation.ok) {
    return NextResponse.json(
      {
        error: 'Illegal lineup',
        validation: lineupValidation,
      },
      { status: 422 },
    )
  }

  await prisma.$transaction(
    body.moves.map((m) =>
      prisma.redraftRosterPlayer.updateMany({
        where: { rosterId: roster.id, playerId: m.playerId, droppedAt: null },
        data: { slotType: m.toSlot },
      }),
    ),
  )

  // Phase 2H: best-effort lineup-history write for Decision OS Phase 6 DNA
  // (docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md §2).
  // Deliberately NOT awaited-and-allowed-to-throw like the analogous Af-table
  // writer (lib/roster-lineup-engine/lineupService.ts) — a real lineup save
  // that already succeeded must never fail the response because history
  // logging failed.
  try {
    const slotMap = (players: { playerId: string; slotType: string }[]) =>
      Object.fromEntries(players.map((p) => [p.playerId, p.slotType]))
    await recordRedraftRosterMoveHistory({
      leagueId: roster.leagueId,
      rosterId: roster.id,
      seasonId: targetLookup.season.id,
      season: roster.season.season,
      week,
      actorUserId: userId,
      source: 'user',
      beforeSlotAssignments: slotMap(currentPlayers),
      afterSlotAssignments: slotMap(applied.players),
      metadata: { week, season: roster.season.season },
    })
  } catch {
    // Swallow — see comment above.
  }

  const updated = (await prisma.redraftRoster.findFirst({
    where: { id: roster.id },
    include: { players: true, season: true },
  })) as RedraftRosterRouteRow | null

  const updatedPlayers = updated
    ? await hydrateCurrentInjuryStatuses(updated.players, updated.season.season, week)
    : []
  const updatedValidation = updated
    ? buildLineupValidation({ sport: updated.season.sport, week, players: updatedPlayers, rosterConfig })
    : lineupValidation

  return NextResponse.json({
    roster: updated
      ? {
          ...updated,
          players: updatedPlayers,
          lineupValidation: updatedValidation,
        }
      : updated,
    validation: updatedValidation,
  })
}
