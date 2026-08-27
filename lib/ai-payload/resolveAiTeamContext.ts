import { findRosterForTeam } from '@/lib/leagues/rosterForTeam'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import type { AiRosterPlayerRef, AiTeamContextPayload } from '@/lib/ai-payload/types'

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x === 'string' && x.trim()) out.push(x.trim())
  }
  return out
}

/**
 * Parses Sleeper-style `playerData` JSON for starters / reserve / taxi.
 */
function bucketPlayerIds(playerData: unknown): {
  starters: string[]
  reserve: string[]
  taxi: string[]
  allIds: string[]
} {
  const allIds = getRosterPlayerIds(playerData)
  const pd = asRecord(playerData) ?? {}
  const starters = stringList(pd.starters)
  const reserve = stringList(pd.reserve ?? pd.reserve_list)
  const taxi = stringList(pd.taxi ?? pd.taxi_list)
  return { starters, reserve, taxi, allIds }
}

function benchIds(allIds: string[], starters: string[], reserve: string[], taxi: string[]): string[] {
  const used = new Set([...starters, ...reserve, ...taxi])
  return allIds.filter((id) => !used.has(id))
}

async function resolveNames(
  sport: SupportedSport,
  ids: string[],
): Promise<Map<string, { name: string | null; position: string | null; team: string | null; injury: string | null }>> {
  const uniq = [...new Set(ids)].filter(Boolean).slice(0, 80)
  const out = new Map<string, { name: string | null; position: string | null; team: string | null; injury: string | null }>()
  if (uniq.length === 0) return out

  const rows = await prisma.sportsPlayerRecord.findMany({
    where: {
      sport,
      id: { in: uniq },
    },
    select: {
      id: true,
      name: true,
      position: true,
      team: true,
      injuryStatus: true,
    },
  })

  for (const r of rows) {
    out.set(r.id, {
      name: r.name,
      position: r.position,
      team: r.team,
      injury: r.injuryStatus,
    })
  }

  const missing = uniq.filter((id) => !out.has(id))
  if (missing.length === 0) return out

  const alt = await prisma.sportsPlayer.findMany({
    where: {
      sport,
      OR: [{ externalId: { in: missing } }, { sleeperId: { in: missing } }],
    },
    select: { externalId: true, sleeperId: true, name: true, position: true, team: true, status: true },
    take: 120,
  })

  for (const r of alt) {
    const entry = {
      name: r.name,
      position: r.position,
      team: r.team,
      injury: r.status,
    }
    out.set(r.externalId, entry)
    if (r.sleeperId) out.set(r.sleeperId, entry)
  }

  return out
}

function toRefs(ids: string[], nameMap: Map<string, { name: string | null; position: string | null; team: string | null; injury: string | null }>): AiRosterPlayerRef[] {
  return ids.map((playerId) => {
    const m = nameMap.get(playerId)
    return {
      playerId,
      name: m?.name ?? null,
      position: m?.position ?? null,
      team: m?.team ?? null,
      injuryStatus: m?.injury ?? null,
    }
  })
}

/**
 * Real roster + record + standings slice for the user's team in a league.
 */
export async function resolveAiTeamContext(args: {
  userId: string
  leagueId: string
  sport: string
  season: number
  currentPeriod: number
  teamExternalId?: string | null
}): Promise<AiTeamContextPayload | null> {
  const sport = normalizeToSupportedSport(String(args.sport))

  let leagueTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId: args.leagueId, claimedByUserId: args.userId },
    select: {
      id: true,
      teamName: true,
      platformUserId: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      currentRank: true,
    },
  })

  if (args.teamExternalId?.trim()) {
    const lt = await prisma.leagueTeam.findFirst({
      where: { leagueId: args.leagueId, externalId: args.teamExternalId.trim() },
      select: {
        id: true,
        teamName: true,
        platformUserId: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        currentRank: true,
      },
    })
    if (lt) leagueTeam = lt
  }

  if (!leagueTeam) {
    return null
  }

  /*
   * ⚠ Contract-aware. The old OR keyed on LeagueTeam.platformUserId, which is
   * the RAW Sleeper id, while Roster.platformUserId holds the AF id for a LINKED
   * manager — so it resolved the signed-in user by luck (their AF id is the
   * second branch) and missed every OTHER manager with an account. See
   * lib/leagues/rosterForTeam.ts.
   */
  const byTeam = leagueTeam.platformUserId
    ? await findRosterForTeam(args.leagueId, leagueTeam.platformUserId)
    : null
  const roster = byTeam
    ? { playerData: byTeam.playerData as any, platformUserId: leagueTeam.platformUserId }
    : await prisma.roster.findFirst({
        where: { leagueId: args.leagueId, platformUserId: args.userId },
        select: { playerData: true, platformUserId: true },
      })

  if (!roster) {
    return {
      schemaVersion: 1,
      teamId: leagueTeam.id,
      teamName: leagueTeam.teamName,
      platformUserId: leagueTeam.platformUserId ?? args.userId,
      record: {
        wins: leagueTeam.wins,
        losses: leagueTeam.losses,
        ties: leagueTeam.ties,
      },
      standingRank: leagueTeam.currentRank ?? null,
      pointsFor: leagueTeam.pointsFor,
      rosterPlayerCount: 0,
      starters: [],
      bench: [],
      injuredReserve: [],
      taxi: [],
      opponentThisPeriod: null,
      dataGaps: ['No roster row synced for this team — player list unavailable.'],
    }
  }

  const { starters, reserve, taxi, allIds } = bucketPlayerIds(roster.playerData)
  const bench = benchIds(allIds, starters, reserve, taxi)
  const dataGaps: string[] = []
  if (allIds.length === 0) dataGaps.push('Roster playerData has no player IDs yet.')

  const nameMap = await resolveNames(sport, [...starters, ...bench, ...reserve, ...taxi])

  let opponentThisPeriod: AiTeamContextPayload['opponentThisPeriod'] = null
  try {
    const perf = await prisma.teamPerformance.findUnique({
      where: {
        teamId_season_week: {
          teamId: leagueTeam.id,
          season: args.season,
          week: args.currentPeriod,
        },
      },
      select: { opponent: true, week: true },
    })
    if (perf?.opponent) {
      opponentThisPeriod = { label: perf.opponent, week: perf.week ?? args.currentPeriod }
    }
  } catch {
    /* non-fatal */
  }

  return {
    schemaVersion: 1,
    teamId: leagueTeam.id,
    teamName: leagueTeam.teamName,
    platformUserId: roster.platformUserId,
    record: {
      wins: leagueTeam.wins,
      losses: leagueTeam.losses,
      ties: leagueTeam.ties,
    },
    standingRank: leagueTeam.currentRank ?? null,
    pointsFor: leagueTeam.pointsFor,
    rosterPlayerCount: allIds.length,
    starters: toRefs(starters, nameMap),
    bench: toRefs(bench, nameMap),
    injuredReserve: toRefs(reserve, nameMap),
    taxi: toRefs(taxi, nameMap),
    opponentThisPeriod,
    dataGaps,
  }
}
