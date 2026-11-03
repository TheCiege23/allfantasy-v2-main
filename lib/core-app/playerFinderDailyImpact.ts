import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadDailySportOutlook, type OutlookPlayerInput } from '@/lib/projections/dailySportOutlook'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { resolveClaimTarget } from '@/lib/shared-services/league-hub/replacementOptions'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'
import { identityForFinderPlayer, rosterIdForFinderPlayer } from './playerFinderIdentityBridge'
import { normalizePosition } from './positionNormalization'
import { slotForStarterIndex, startingSlots } from './slotEligibility'
import type { LeagueImpact, ReplacementOption } from './playerImpact'
import type { LeagueSlot, RecommendedMove } from './playerFinder'

const DAILY_SPORTS = new Set(['NBA', 'NHL', 'MLB'])
type Subject = { sport: string; source: string; externalId: string; sleeperId: string | null; name: string; position: string | null; team: string | null; status?: string | null }
type Athlete = { name: string; position: string | null; team: string | null; status: string | null }
type Identity = { id: string; canonicalName: string; position: string | null; rollingInsightsId: string | null; sleeperNbaId: string | null; fantraxId: string | null }

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.map((id) => String(id ?? '').trim()).filter(Boolean) : []
}

function rosterIds(data: unknown): string[] {
  const row = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  return [...new Set([...ids(row.players), ...ids(row.starters), ...ids(row.reserve), ...ids(row.taxi)])]
}

function positions(value: string | null): string[] {
  return String(value ?? '').toUpperCase().split(/[\s/,]+/).filter(Boolean)
}

function mayFill(sport: string, slot: string, position: string | null): boolean {
  const config = getRedraftSportConfig(sport)
  const allowed = config.flexPositions[slot] ?? [slot]
  return positions(position).some((part) => allowed.includes(part))
}

function unavailable(status: string | null): boolean {
  return /^(out|doubtful|suspended|ir|injured reserve)/i.test(String(status ?? '').trim())
}

function rosterKey(platform: string, identity: Identity): string | null {
  if (isNativePlatform(platform)) return identity.rollingInsightsId
  if (platform === 'fantrax') return identity.fantraxId
  if (platform === 'sleeper') return identity.sleeperNbaId
  return null
}

/** Score only verified NBA/NHL/MLB roster identities against this league's daily outlook. */
export async function getFinderDailyImpact(
  subject: Subject,
  slots: readonly LeagueSlot[],
  userId: string,
  includeMoves: boolean,
): Promise<{ impact: LeagueImpact[]; moves: RecommendedMove[] }> {
  if (!DAILY_SPORTS.has(subject.sport)) return { impact: [], moves: [] }
  const held = slots.filter((slot) => slot.isYours).slice(0, 4)
  if (!held.length) return { impact: [], moves: [] }

  const leagueIds = held.map((slot) => slot.leagueId)
  const [leagues, teams, rosters, subjectIdentity] = await Promise.all([
    prisma.league.findMany({ where: { id: { in: leagueIds } },
      select: { id: true, sport: true, platform: true, platformLeagueId: true, season: true, settings: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId: { in: leagueIds }, claimedByUserId: userId },
      select: { leagueId: true, platformUserId: true, externalId: true } }),
    prisma.roster.findMany({ where: { leagueId: { in: leagueIds } },
      select: { leagueId: true, platformUserId: true, playerData: true } }),
    identityForFinderPlayer(subject),
  ])
  const impact: LeagueImpact[] = []
  const moves: RecommendedMove[] = []

  for (const slot of held) {
    const league = leagues.find((item) => item.id === slot.leagueId)
    if (!league || String(league.sport).toUpperCase() !== subject.sport) continue
    const platform = String(league.platform ?? 'manual').toLowerCase()
    const subjectId = rosterIdForFinderPlayer(subject, platform, subjectIdentity)
    if (!subjectId) continue
    const claimed = teams.filter((team) => team.leagueId === league.id)
    const mine = rosters.find((roster) => roster.leagueId === league.id &&
      claimed.some((team) => [team.platformUserId, team.externalId, userId].includes(roster.platformUserId)))
    if (!mine) continue
    const data = (mine.playerData ?? {}) as Record<string, unknown>
    const starters = ids(data.starters)
    const ownIds = rosterIds(data)
    if (!ownIds.includes(subjectId)) continue
    const allIds = new Set(rosters.filter((roster) => roster.leagueId === league.id)
      .flatMap((roster) => rosterIds(roster.playerData)))

    // A provider id is accepted only when exactly one identity row owns it.
    const identityRows = await prisma.playerIdentityMap.findMany({
      where: { sport: subject.sport, OR: [
        { rollingInsightsId: { in: ownIds } }, { fantraxId: { in: ownIds } },
        ...(subject.sport === 'NBA' ? [{ sleeperNbaId: { in: ownIds } }] : []),
      ] },
      select: { id: true, canonicalName: true, position: true, rollingInsightsId: true, sleeperNbaId: true, fantraxId: true },
    })
    const identityByRosterId = new Map<string, Identity | null>()
    for (const identity of identityRows) {
      const key = rosterKey(platform, identity)
      if (key && ownIds.includes(key)) identityByRosterId.set(key, identityByRosterId.has(key) ? null : identity)
    }
    const riIds = identityRows.flatMap((identity) => identity.rollingInsightsId ? [identity.rollingInsightsId] : [])
    const athleteRows = await prisma.sportsPlayer.findMany({
      where: { sport: subject.sport, OR: [
        { source: 'rolling_insights', externalId: { in: [...new Set([...ownIds, ...riIds])] } },
        { source: 'thesportsdb', externalId: { in: ownIds } },
        ...(subject.sport === 'NBA' ? [{ source: 'sleeper', sleeperId: { in: ownIds } }] : []),
      ] },
      select: { name: true, position: true, team: true, status: true, source: true, externalId: true, sleeperId: true },
    })
    const athleteById = new Map<string, Athlete>()
    for (const id of ownIds) {
      const identity = identityByRosterId.get(id)
      const athlete = athleteRows.find((row) => (platform === 'sleeper'
        ? row.source === 'sleeper' && row.sleeperId === id
        : platform === 'fantrax'
          ? row.source === 'rolling_insights' && row.externalId === identity?.rollingInsightsId
          : row.externalId === id && (row.source === 'rolling_insights' || row.source === 'thesportsdb')))
      if (athlete) {
        athleteById.set(id, athlete)
        if (identity && (!playerNamesAgree(identity.canonicalName, athlete.name) ||
          (identity.position && athlete.position && normalizePosition(identity.position) !== normalizePosition(athlete.position)))) {
          identityByRosterId.set(id, null)
        }
      }
    }
    athleteById.set(subjectId, { name: subject.name, position: subject.position, team: subject.team,
      status: subject.status ?? athleteById.get(subjectId)?.status ?? null })

    // A TSDB native roster cannot be fully crosswalked to RI ids. In that case
    // we cannot prove a candidate is unrostered, so do not offer a claim.
    const canCheckPool = ![...allIds].some((id) => id.startsWith('tsdb_'))
    const seasonRow = includeMoves && canCheckPool ? await prisma.aFProjectionSnapshot.findFirst({
      where: { sport: subject.sport, week: null }, orderBy: { season: 'desc' }, select: { season: true },
    }) : null
    const topRows = includeMoves && seasonRow && subject.position ? await prisma.aFProjectionSnapshot.findMany({
      where: { sport: subject.sport, week: null, season: seasonRow.season, position: subject.position },
      orderBy: { afProjection: 'desc' }, take: 100, select: { playerId: true },
    }) : []
    const poolIdentities = topRows.length ? await prisma.playerIdentityMap.findMany({
      where: { sport: subject.sport, id: { in: topRows.map((item) => item.playerId) } },
      select: { id: true, canonicalName: true, position: true, rollingInsightsId: true, sleeperNbaId: true, fantraxId: true },
    }) : []
    const poolRows = poolIdentities.length ? await prisma.sportsPlayer.findMany({
      where: { sport: subject.sport, source: 'rolling_insights',
        externalId: { in: poolIdentities.flatMap((identity) => identity.rollingInsightsId ? [identity.rollingInsightsId] : []) } },
      select: { name: true, position: true, team: true, status: true, externalId: true },
    }) : []
    const poolKeyCounts = new Map<string, number>()
    for (const identity of poolIdentities) {
      const id = rosterKey(platform, identity)
      if (id) poolKeyCounts.set(id, (poolKeyCounts.get(id) ?? 0) + 1)
    }
    const pool = poolIdentities.flatMap((identity) => {
      const id = rosterKey(platform, identity)
      const athlete = poolRows.find((row) => row.externalId === identity.rollingInsightsId)
      return id && poolKeyCounts.get(id) === 1 && athlete && !allIds.has(id) && athlete.team &&
        playerNamesAgree(identity.canonicalName, athlete.name) &&
        (!identity.position || !athlete.position || normalizePosition(identity.position) === normalizePosition(athlete.position)) &&
        !unavailable(athlete.status)
        ? [{ id, identity, athlete }] : []
    })

    const outlookPlayers: OutlookPlayerInput[] = [
      ...ownIds.map((id) => {
        const identity = identityByRosterId.get(id)
        return { key: `roster:${id}`, lookupId: identity === null ? null : identity?.id ??
          (isNativePlatform(platform) && /^\d+$/.test(id) ? id : null), team: athleteById.get(id)?.team ?? null,
          injuryStatus: athleteById.get(id)?.status ?? null }
      }),
      ...pool.map(({ id, identity, athlete }) => ({ key: `pool:${id}`, lookupId: identity.id,
        team: athlete.team, injuryStatus: athlete.status })),
    ]
    const outlook = await loadDailySportOutlook(prisma, {
      league: { sport: subject.sport, season: league.season, settings: league.settings },
      players: outlookPlayers,
    }).catch(() => null)
    const subjectPoints = outlook?.byKey.get(`roster:${subjectId}`)?.projectedPoints ?? null
    const starterIndex = starters.indexOf(subjectId)
    const lineupSlots = startingSlots(league.settings)
    const exactSlot = starterIndex >= 0 ? slotForStarterIndex(lineupSlots, starters.length, starterIndex) : null
    const startOver: LeagueImpact['startOver'] = starterIndex >= 0 || subjectPoints == null ||
      unavailable(athleteById.get(subjectId)?.status ?? null) ? null
      : starters.reduce<LeagueImpact['startOver']>((weakest, id, index) => {
          const athlete = athleteById.get(id)
          const seat = slotForStarterIndex(lineupSlots, starters.length, index)
          const points = outlook?.byKey.get(`roster:${id}`)?.projectedPoints ?? null
          if (!athlete || !seat || !mayFill(subject.sport, seat, subject.position) || points == null) return weakest
          return weakest && weakest.afPoints <= points ? weakest : {
            playerId: id, name: athlete.name, position: athlete.position, team: athlete.team,
            slot: seat, afPoints: points, delta: Math.round((subjectPoints - points) * 100) / 100,
          }
        }, null)
    const benchIds = ownIds.filter((id) => id !== subjectId && !starters.includes(id))
    const replacements: ReplacementOption[] = exactSlot ? benchIds.flatMap((id) => {
      const athlete = athleteById.get(id)
      const points = outlook?.byKey.get(`roster:${id}`)?.projectedPoints ?? null
      if (!athlete || !mayFill(subject.sport, exactSlot, athlete.position) || points == null || unavailable(athlete.status)) return []
      return [{ playerId: id, name: athlete.name, position: athlete.position, team: athlete.team,
        afPoints: points, delta: subjectPoints == null ? null : Math.round((points - subjectPoints) * 100) / 100,
        injuryStatus: athlete.status, from: ids(data.reserve).includes(id) ? 'IR' : ids(data.taxi).includes(id) ? 'TAXI' : 'BENCH' }]
    }) : []
    replacements.sort((a, b) => (b.afPoints ?? -Infinity) - (a.afPoints ?? -Infinity))
    impact.push({ leagueId: league.id, leagueName: slot.leagueName, platform,
      platformLeagueId: league.platformLeagueId, season: league.season, teamExternalId: slot.teamExternalId,
      slot: slot.slot, exactSlot, slotConfirmed: Boolean(exactSlot) || starterIndex < 0,
      isStarting: starterIndex >= 0,
      afPoints: subjectPoints == null
        ? { available: false, reason: outlook?.reason === 'category_league'
          ? 'category leagues have no points projection' : 'no league-scored period outlook is available for this player' }
        : { available: true, data: { points: subjectPoints, matchedKeys: null, scoredKeys: null } },
      replacements: replacements.length
        ? { available: true, data: replacements.slice(0, 5) }
        : { available: false, reason: exactSlot ? 'no eligible, period-priced bench replacement is available' : 'the exact lineup slot is unavailable' },
      startOver,
    })

    if (includeMoves && subjectPoints != null) {
      const freeAgents = pool.flatMap(({ id, athlete }) => {
        if (!exactSlot || !mayFill(subject.sport, exactSlot, athlete.position)) return []
        const points = outlook?.byKey.get(`pool:${id}`)?.projectedPoints ?? null
        return points == null ? [] : [{ playerId: id, name: athlete.name, position: athlete.position,
          team: athlete.team, projectedPoints: points, delta: Math.round((points - subjectPoints) * 100) / 100 }]
      }).sort((a, b) => b.projectedPoints - a.projectedPoints).slice(0, 3)
      if (freeAgents.length) moves.push({ leagueId: league.id, leagueName: slot.leagueName, platform,
        projectionWeek: outlook?.period?.week ?? null, affectedProjection: subjectPoints,
        freeAgents, claimTarget: resolveClaimTarget({ id: league.id, platform, platformLeagueId: league.platformLeagueId }),
        scoringBasis: 'league', periodLabel: outlook?.period?.kind === 'day' ? 'today' :
          outlook?.period?.week != null ? `week ${outlook.period.week}` : null })
    }
  }
  impact.sort((a, b) => Number(b.isStarting) - Number(a.isStarting))
  return { impact, moves }
}
