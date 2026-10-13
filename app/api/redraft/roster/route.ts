import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { applyInjuryStatuses } from '@/lib/redraft/rosterInjuryStatus'
import { assertLeagueMember } from '@/lib/league/league-access'
import { buildPlayerKey, normalizeStoredPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import { buildAllFantasyProjection } from '@/lib/redraft/projectionEngine'
import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import {
  applyRedraftLineupMoves,
  validateRedraftLineup,
  type RedraftLineupPlayer,
  type RedraftLineupValidationResult,
} from '@/lib/redraft/lineupValidation'
import { hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'
import { resolveCurrentLockTeams } from '@/lib/redraft/lineupLockCurrentTeam'
import { applyNbaSurvivorPickLineupLocks } from '@/lib/survivor/survivorNbaWeeklyScoring'
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
import { resolveEffectiveRedraftWeek } from '@/lib/season-week'
import { leagueIdentityColumns } from '@/lib/player-identity/externalIdNamespace'
import {
  crosswalkToRollingInsightsIds,
  type RiCrosswalkDb,
} from '@/lib/player-identity/rollingInsightsCrosswalk'
import { crosswalkToSleeperIds, sleeperLookupId, withTeamDefenseIds } from '@/lib/core-app/rosterIdCrosswalk'

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

  /*
   * 🛑 THE STORED SNAPSHOT IS CLEARED FIRST (2026-10-11). `RedraftRosterPlayer.injuryStatus` is written at
   * import/refresh time and is stale by construction, and `applyInjuryStatuses` leaves a player it finds no
   * live row for untouched — so last week's "Out" survived into the response, the lineup validation
   * (`starter_ineligible_injury`) and the projection. Only a live row may set a status now; none is null,
   * "no news".
   */
  return applyInjuryStatuses(
    players.map((p) => ({ ...p, injuryStatus: null })),
    rows,
  ) as T[]
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

/**
 * Each roster player's OWN Rolling Insights regular-season row, keyed `${rosterPlayerId}:${sport}`.
 *
 * 🛑 NEVER `playerSeasonStats.playerId IN <roster ids>` (fixed 2026-10-11). Those rows are keyed on the
 * PROVIDER's own number and an NFL roster holds Sleeper ids (ESPN / Fleaflicker rosters, their own ids):
 * the same digits are a different man. Measured on production: 251 rostered NFL ids joined a stranger's
 * 2026 RI row — Justin Jefferson (Sleeper 6794) read DaRon Bland's line (RI 6794), Saquon Barkley (4866)
 * Anthony Nelson's, Bijan Robinson (9509) Malachi Fields' — and that stranger's games fed the projection
 * confidence and, with no other projection, his PPG became the weekly projection.
 *
 * Every roster id is asked of the ONE identity column its league speaks (`leagueIdentityColumns`), its
 * `rollingInsightsId` reaches the stats table, and an id that does not map one-to-one gets nothing.
 *
 * `api_sports` rows are NOT read: `PlayerIdentityMap.apiSportsId` is empty for every NFL row (0 of the
 * table, 2026-10-11), so there is no crosswalk to reach them by — the 11 the old query attached were all
 * strangers. `thesportsdb` rows are not Rolling Insights and were mislabeled as such.
 */
async function loadOwnRollingInsightsSeasonStats(args: {
  players: Array<{ playerId: string; sport: string }>
  platform: string | null | undefined
  season: string
}): Promise<Map<string, SeasonStatsRow>> {
  const out = new Map<string, SeasonStatsRow>()
  const idsBySport = new Map<string, string[]>()
  for (const p of args.players) {
    const sport = String(p.sport ?? '').trim().toUpperCase()
    if (!sport || !p.playerId) continue
    idsBySport.set(sport, [...(idsBySport.get(sport) ?? []), p.playerId])
  }
  for (const [sport, ids] of idsBySport) {
    const lookups = leagueIdentityColumns(ids, sport, args.platform)
    if (lookups.length === 0) continue
    const { byId } = await crosswalkToRollingInsightsIds(prisma as unknown as RiCrosswalkDb, { sport, lookups })
    const rosterIdByRi = new Map<string, string>()
    for (const [rosterId, identity] of byId) rosterIdByRi.set(identity.rollingInsightsId, rosterId)
    if (rosterIdByRi.size === 0) continue
    const rows = (await prisma.playerSeasonStats.findMany({
      where: {
        sport,
        source: 'rolling_insights',
        season: args.season,
        seasonType: 'regular',
        playerId: { in: [...rosterIdByRi.keys()] },
      },
      orderBy: [{ fetchedAt: 'desc' }],
      select: {
        playerId: true,
        sport: true,
        fantasyPointsPerGame: true,
        gamesPlayed: true,
        stats: true,
        fetchedAt: true,
        source: true,
      },
    })) as SeasonStatsRow[]
    const byRosterId = new Map<string, SeasonStatsRow>()
    for (const row of rows) {
      if (row.source !== 'rolling_insights') continue
      const rosterId = rosterIdByRi.get(row.playerId)
      if (rosterId && !byRosterId.has(rosterId)) byRosterId.set(rosterId, { ...row, playerId: rosterId })
    }
    // Keyed with the roster row's own sport spelling — the same key the caller reads with.
    for (const p of args.players) {
      if (String(p.sport ?? '').trim().toUpperCase() !== sport) continue
      const row = byRosterId.get(p.playerId)
      if (row) out.set(`${p.playerId}:${p.sport}`, row)
    }
  }
  return out
}

/**
 * `fantasy_projections` holds TWO different projections under one Sleeper id: the provider's line
 * (`source: 'sleeper'`) and AllFantasy's own engine number mirrored in (`source: 'allfantasy'`, see
 * `writeAfProjectionSnapshots`). The read used to take whichever row came last and hand it to the engine
 * as the PROVIDER projection — so the AF engine's number went out labelled `provider_projection`.
 * Each row now goes to the input it actually is.
 */
function splitProjectionRows(rows: FantasyProjectionRow[]): {
  provider: Map<string, FantasyProjectionRow>
  afMirror: Map<string, FantasyProjectionRow>
} {
  const provider = new Map<string, FantasyProjectionRow>()
  const afMirror = new Map<string, FantasyProjectionRow>()
  for (const row of rows) {
    const key = `${row.playerId}:${row.sport}`
    const target = row.source === 'allfantasy' ? afMirror : provider
    const held = target.get(key)
    if (!held || row.fetchedAt > held.fetchedAt) target.set(key, row)
  }
  return { provider, afMirror }
}

function afMirrorConfidenceLevel(row: FantasyProjectionRow | undefined): string | null {
  const stats = row?.stats
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null
  const level = (stats as Record<string, unknown>).confidenceLevel
  return typeof level === 'string' && level.trim() ? level : null
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
    select: { settings: true, platform: true, survivorMode: true },
  })
  // No `?week=`: an imported season's stored week is never advanced — see resolveEffectiveRedraftWeek.
  const week = parsedWeek.value ?? (await resolveEffectiveRedraftWeek({ id: lookup.season.id, currentWeek: roster.season.currentWeek }, leagueForLock?.platform))
  const lockHydrated = await hydrateRedraftLineupLocks(prisma, {
    sport: roster.season.sport,
    season: roster.season.season,
    week,
    rosterId: roster.id,
    leagueSettings: leagueForLock?.settings ?? null,
    players: roster.players,
    // Lock on the club he plays for now — the display is corrected further down, the lock must be too.
    currentTeamByPlayerId: await resolveCurrentLockTeams(prisma, {
      sport: roster.season.sport,
      platform: leagueForLock?.platform ?? null,
      playerIds: roster.players.map((p) => p.playerId),
    }),
  })
  roster.players = leagueForLock?.survivorMode && roster.season.sport === 'NBA'
    ? await applyNbaSurvivorPickLineupLocks({ leagueId: roster.leagueId, redraftRosterId: roster.id, week, settings: leagueForLock.settings, players: lockHydrated.players as RosterPlayerRow[] })
    : lockHydrated.players as RosterPlayerRow[]
  // G10: resolve the commissioner roster config so lineup validation honors the
  // league's configured slots (FLEX/SF/K/IDP/counts) + bench/IR/taxi limits.
  const rosterConfig = resolveRedraftRosterConfig(roster.season.sport, leagueForLock?.settings ?? null)

  const playerIds = roster.players.map((p) => p.playerId)
  const sports = Array.from(new Set(roster.players.map((p) => p.sport).filter(Boolean)))
  /*
   * 🛑 AN IMPORTED ROSTER HOLDS ITS PLATFORM'S IDS, AND EVERY NFL TABLE BELOW IS KEYED ON SLEEPER'S.
   * Same digits, different man: measured on production, 65 ESPN/Fleaflicker entries (57 ids)
   * are also another player's Sleeper id — Fleaflicker 12892 (Christian McCaffrey) is Sleeper's Da'Quan
   * Felton, ESPN 12483 (Matthew Stafford) read Jack Bech's 4.4-pt projection, and the canonical context
   * (which treats any bare number as a Sleeper id) handed 48 of them a stranger's injury, bye and depth
   * chart. Each roster id is translated ONCE here (`sleeperLookupId`, as matchupProjections/myTeam do);
   * one that does not translate reads NOTHING by id. Results stay keyed on the roster's own id.
   *
   * NFL only: the other sports' rows here are written in the roster's own id space (the NCAAF score sync
   * writes `player_weekly_scores` under the Fantrax roster id, sport NCAAFB) and filtered by sport, so a
   * Sleeper translation there would only lose them.
   */
  const leaguePlatform = leagueForLock?.platform ?? null
  const translatesToSleeper = String(roster.season.sport ?? '').trim().toUpperCase() === 'NFL'
  // A team defence (ESPN -16012, Fleaflicker 2343) maps to Sleeper's team code from its row — the player
  // crosswalk has no row for one, so without this every imported D/ST read no score (teamDefenseCrosswalk.ts).
  const sleeperIdByRosterId = translatesToSleeper
    ? withTeamDefenseIds(
        leaguePlatform,
        await crosswalkToSleeperIds(String(leaguePlatform ?? ''), 'NFL', playerIds).catch(() => new Map<string, string>()),
        roster.players,
      )
    : new Map<string, string>()
  const lookupOf = (id: string): string | null =>
    translatesToSleeper ? sleeperLookupId(leaguePlatform, id, sleeperIdByRosterId) : id
  const lookupIds = [...new Set(playerIds.map(lookupOf).filter((x): x is string => x != null))]
  const seasonString = String(roster.season.season)
  let scores: PlayerWeeklyScoreRow[] = []
  let fantasyProjectionRows: FantasyProjectionRow[] = []
  let afProjectionRows: AfProjectionRow[] = []
  let seasonStatsByPlayer = new Map<string, SeasonStatsRow>()
  let adpRows: Array<{ playerKey: string | null; averageOverallPick: number }> = []
  if (playerIds.length) {
    ;[
      scores,
      fantasyProjectionRows,
      afProjectionRows,
      seasonStatsByPlayer,
      adpRows,
    ] = await Promise.all([
      prisma.playerWeeklyScore.findMany({
        where: {
          playerId: { in: lookupIds },
          week,
          season: roster.season.season,
          sport: { in: sports },
        },
      }) as Promise<PlayerWeeklyScoreRow[]>,
      prisma.fantasyProjection
        .findMany({
          where: {
            playerId: { in: lookupIds },
            week,
            season: seasonString,
            sport: { in: sports },
          },
          select: { playerId: true, sport: true, projectedPoints: true, fetchedAt: true, source: true, stats: true },
        })
        .catch(() => []) as Promise<FantasyProjectionRow[]>,
      prisma.aFProjectionSnapshot
        .findMany({
          where: {
            playerId: { in: lookupIds },
            week,
            season: roster.season.season,
            sport: { in: sports },
          },
          orderBy: { computedAt: 'desc' },
          select: { playerId: true, sport: true, afProjection: true, confidenceLevel: true, computedAt: true },
        })
        .catch(() => []) as Promise<AfProjectionRow[]>,
      loadOwnRollingInsightsSeasonStats({
        players: roster.players,
        platform: leagueForLock?.platform ?? null,
        season: seasonString,
      }).catch(() => new Map<string, SeasonStatsRow>()),
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
  const { provider: projectionByPlayer, afMirror: afMirrorByPlayer } = splitProjectionRows(fantasyProjectionRows)
  const afProjectionByPlayer = new Map<string, AfProjectionRow>()
  for (const row of afProjectionRows) {
    const key = `${row.playerId}:${row.sport}`
    if (!afProjectionByPlayer.has(key)) afProjectionByPlayer.set(key, row)
  }
  // Rows arrive ADP-ascending, so first-seen is the best ADP. Stored keys are re-keyed so a stored
  // `kenneth walker iii|rb` meets the roster's "Kenneth Walker" (see computeAllFantasyAdp.buildPlayerKey).
  const adpByPlayerKey = new Map<string, number>()
  for (const row of adpRows) {
    if (!row.playerKey) continue
    const key = normalizeStoredPlayerKey(row.playerKey)
    if (!adpByPlayerKey.has(key)) adpByPlayerKey.set(key, row.averageOverallPick)
  }

  // Live designations BEFORE projecting, so the projection is never priced on the stored snapshot.
  const liveRosterPlayers = await hydrateCurrentInjuryStatuses(roster.players, roster.season.season, week)
  const scoredPlayers = await Promise.all(
    liveRosterPlayers.map(async (player) => {
      const lookupId = lookupOf(player.playerId)
      // Read on the translated id; an id with none reads nothing (see `lookupOf` above).
      const lookupKey = lookupId ? `${lookupId}:${player.sport}` : null
      const weeklyScore = (lookupKey ? scoreByPlayer.get(lookupKey) : null) ?? null
      const providerProjection = lookupKey ? projectionByPlayer.get(lookupKey) : undefined
      const afProjection = lookupKey ? afProjectionByPlayer.get(lookupKey) : undefined
      const afMirror = lookupKey ? afMirrorByPlayer.get(lookupKey) : undefined
      // Already keyed on the roster id: `loadOwnRollingInsightsSeasonStats` does its own crosswalk.
      const seasonStats = seasonStatsByPlayer.get(`${player.playerId}:${player.sport}`)
      const adp = adpByPlayerKey.get(buildPlayerKey(player.playerName, player.position)) ?? null
      const canonical =
        String(player.sport).toUpperCase() === 'NFL'
          ? (lookupId
              ? await getCanonicalNflPlayerContext(lookupId, {
                  season: roster.season.season,
                  week,
                }).catch(() => null)
              : null) ??
            (await getCanonicalNflPlayerByNameTeam(player.playerName, player.team, {
              position: player.position,
              season: roster.season.season,
              week,
            }).catch(() => null))
          : null
      const projection = buildAllFantasyProjection({
        playerId: player.playerId,
        playerName: player.playerName,
        sport: player.sport,
        position: player.position,
        team: player.team,
        currentWeek: week,
        totalWeeks: roster.season.totalWeeks ?? 17,
        byeWeek: player.byeWeek,
        // NFL: the canonical designation (live feed by verified name, staleness applied); otherwise the
        // live row hydrated above. Never the stored roster snapshot.
        injuryStatus: canonical ? canonical.injuryStatus : player.injuryStatus,
        adp,
        providerWeeklyProjection: providerProjection?.projectedPoints ?? null,
        // The engine snapshot, else its Sleeper-keyed mirror row — the same AF number, never the provider's.
        allFantasyWeeklyProjection: afProjection?.afProjection ?? afMirror?.projectedPoints ?? null,
        allFantasyConfidenceLevel: afProjection ? afProjection.confidenceLevel : afMirrorConfidenceLevel(afMirror),
        rollingInsightsFantasyPointsPerGame: seasonStats?.fantasyPointsPerGame ?? null,
        rollingInsightsGamesPlayed: seasonStats?.gamesPlayed ?? null,
        rollingInsightsStats: seasonStats?.stats ?? null,
      })
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
          // The row is stored under the Sleeper id; the response speaks the roster's.
          playerId: player.playerId,
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
  const players = scoredPlayers
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
      /*
       * ⚠ NOT `unified?.injuryStatus`: that is the stored `sports_players` snapshot column, and it sat ABOVE
       * the live designation hydrated into `player.injuryStatus`. Dead today (its ids are `NFL:<id>`, so 0
       * of 153,414 roster entries can match), but the first id fix would have made the stale column win.
       */
      injuryStatus: canonical?.injury.designation ?? player.injuryStatus,
      providerInjuryLabel: canonical?.injury.designation ?? null,
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
  source?: string | null
  stats?: unknown
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
    select: { settings: true, platform: true, survivorMode: true },
  })
  const { players: hydratedPlayers } = await hydrateRedraftLineupLocks(prisma, {
    sport: roster.season.sport,
    season: roster.season.season,
    week,
    rosterId: roster.id,
    leagueSettings: leagueForLock?.settings ?? null,
    players: injuryHydrated,
    // The enforcing path: lock on his current club, not the team stored when he was added.
    currentTeamByPlayerId: await resolveCurrentLockTeams(prisma, {
      sport: roster.season.sport,
      platform: leagueForLock?.platform ?? null,
      playerIds: injuryHydrated.map((p) => p.playerId),
    }),
  })
  const currentPlayers = leagueForLock?.survivorMode && roster.season.sport === 'NBA'
    ? await applyNbaSurvivorPickLineupLocks({ leagueId: roster.leagueId, redraftRosterId: roster.id, week, settings: leagueForLock.settings, players: hydratedPlayers })
    : hydratedPlayers
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
