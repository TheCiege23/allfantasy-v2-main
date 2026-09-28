/**
 * Zombie infection engine: apply infection after result finalization (PROMPT 353).
 * Survivor loses to Whisperer or Zombie -> Survivor becomes Zombie.
 */

import { prisma } from '@/lib/prisma'
import { queueAnimation } from '@/lib/zombie/animationEngine'
import { getZombieLeagueConfig } from './ZombieLeagueConfig'
import { getRosterTeamMap } from './rosterTeamMap'
import { getAllStatuses, setZombie } from './ZombieOwnerStatusService'
import { appendZombieAudit } from './ZombieAuditLog'
import type { ZombieInfectionOutcome } from './types'

export interface InfectionInput {
  leagueId: string
  week: number
  season?: number
  zombieLeagueId?: string | null
}

/** A decided matchup, in the zombie engine's roster id space. */
type MatchupOutcome = { matchupId: string | null; winnerRosterId: string; loserRosterId: string }

/**
 * A native league's results, from its own season: final `RedraftMatchup` rows.
 *
 * 🛑 INFECTION USED TO READ ONLY `MatchupFact` (the import warehouse), WHICH NOTHING WRITES FOR A
 * LEAGUE CREATED IN THE APP — so a native zombie league could never infect anyone, while bashing
 * and mauling, which read `RedraftMatchup`, worked. Null when the league has no season for that
 * year (an imported league), so the warehouse path still serves those.
 */
export async function getNativeMatchupOutcomes(
  leagueId: string,
  week: number,
  season: number,
): Promise<MatchupOutcome[] | null> {
  const redraftSeason = await prisma.redraftSeason.findFirst({
    where: { leagueId, season },
    select: { id: true },
  })
  if (!redraftSeason) return null

  const [matchups, seasonRosters, rosters] = await Promise.all([
    prisma.redraftMatchup.findMany({
      where: { seasonId: redraftSeason.id, week },
      select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true },
    }),
    prisma.redraftRoster.findMany({ where: { seasonId: redraftSeason.id }, select: { id: true, ownerId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } }),
  ])
  // Season roster -> league roster: the stored link, else its manager, else `roster:<id>` (an open seat).
  const toRoster = (redraftRosterId: string): string | null => {
    const direct = rosters.find((r) => r.redraftRosterId === redraftRosterId)?.id
    if (direct) return direct
    const ownerId = seasonRosters.find((r) => r.id === redraftRosterId)?.ownerId
    if (!ownerId) return null
    if (ownerId.startsWith('roster:')) {
      const id = ownerId.slice('roster:'.length)
      return rosters.some((r) => r.id === id) ? id : null
    }
    return rosters.find((r) => r.platformUserId === ownerId)?.id ?? null
  }

  const out: MatchupOutcome[] = []
  for (const m of matchups) {
    if (!m.awayRosterId) continue // a bye
    const status = String(m.status ?? '').toLowerCase()
    if (status !== 'final' && status !== 'complete' && status !== 'completed') continue
    const home = Number(m.homeScore ?? 0)
    const away = Number(m.awayScore ?? 0)
    if (home === away) continue // a tie infects nobody
    const homeRoster = toRoster(m.homeRosterId)
    const awayRoster = toRoster(m.awayRosterId)
    if (!homeRoster || !awayRoster) continue
    out.push(
      home > away
        ? { matchupId: m.id, winnerRosterId: homeRoster, loserRosterId: awayRoster }
        : { matchupId: m.id, winnerRosterId: awayRoster, loserRosterId: homeRoster },
    )
  }
  return out
}

/** An imported league's results, from the warehouse (`MatchupFact`, team id space). */
async function getWarehouseMatchupOutcomes(leagueId: string, week: number, season: number | null): Promise<MatchupOutcome[]> {
  const facts = await prisma.matchupFact.findMany({
    where: { leagueId, weekOrPeriod: week, ...(season != null ? { season } : {}) },
    select: { matchupId: true, teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
  })
  const map = await getRosterTeamMap(leagueId)
  const out: MatchupOutcome[] = []
  for (const m of facts) {
    const winnerTeamId = m.winnerTeamId
    if (!winnerTeamId) continue // tie
    const loserTeamId = winnerTeamId === m.teamA ? m.teamB : m.teamA
    const winnerRosterId = map.teamIdToRosterId.get(winnerTeamId)
    const loserRosterId = map.teamIdToRosterId.get(loserTeamId)
    if (!winnerRosterId || !loserRosterId) continue
    out.push({ matchupId: m.matchupId ?? null, winnerRosterId, loserRosterId })
  }
  return out
}

/**
 * Compute who should be infected this week (deterministic).
 */
export async function computeInfections(input: InfectionInput): Promise<ZombieInfectionOutcome> {
  const config = await getZombieLeagueConfig(input.leagueId)
  if (!config) return { leagueId: input.leagueId, week: input.week, infected: [] }

  const { leagueId, week, season = null, zombieLeagueId } = input
  const statuses = await getAllStatuses(leagueId)
  const statusByRoster = new Map(statuses.map((s) => [s.rosterId, s.status]))
  const seasonYear = season ?? new Date().getFullYear()
  const matchups =
    (await getNativeMatchupOutcomes(leagueId, week, seasonYear)) ??
    (await getWarehouseMatchupOutcomes(leagueId, week, seasonYear))

  const infected: ZombieInfectionOutcome['infected'] = []

  const pendingSerum = await prisma.zombieTeamItem.findMany({
    where: {
      activationState: 'pending_activation',
      activatesAtWeek: week,
      team: { leagueId },
    },
    select: { team: { select: { rosterId: true } } },
  })
  const serumProtectedRosterIds = new Set(pendingSerum.map((i) => i.team.rosterId))

  for (const m of matchups) {
    const { winnerRosterId, loserRosterId } = m

    const loserStatus = statusByRoster.get(loserRosterId)
    if (loserStatus !== 'Survivor') continue

    if (serumProtectedRosterIds.has(loserRosterId)) continue

    const winnerStatus = statusByRoster.get(winnerRosterId)
    const infectByWhisperer = config.infectionLossToWhisperer && winnerStatus === 'Whisperer'
    const infectByZombie = config.infectionLossToZombie && winnerStatus === 'Zombie'
    if (!infectByWhisperer && !infectByZombie) continue

    infected.push({
      survivorRosterId: loserRosterId,
      infectedByRosterId: winnerRosterId,
      matchupId: m.matchupId ?? undefined,
    })
    statusByRoster.set(loserRosterId, 'Zombie')
  }

  return { leagueId, week, infected }
}

/**
 * Apply infections: update status, log, audit.
 */
export async function applyInfections(outcome: ZombieInfectionOutcome, zombieLeagueId?: string | null): Promise<void> {
  for (const inf of outcome.infected) {
    await setZombie(
      outcome.leagueId,
      inf.survivorRosterId,
      outcome.week,
      inf.infectedByRosterId,
      zombieLeagueId
    )
    await prisma.zombieInfectionLog.create({
      data: {
        leagueId: outcome.leagueId,
        zombieLeagueId: zombieLeagueId ?? null,
        week: outcome.week,
        survivorRosterId: inf.survivorRosterId,
        infectedByRosterId: inf.infectedByRosterId,
        matchupId: inf.matchupId ?? null,
      },
    })
    await appendZombieAudit({
      leagueId: outcome.leagueId,
      zombieLeagueId: zombieLeagueId ?? null,
      eventType: 'infection',
      metadata: {
        survivorRosterId: inf.survivorRosterId,
        infectedByRosterId: inf.infectedByRosterId,
        week: outcome.week,
        matchupId: inf.matchupId,
      },
    })

    const infectedRoster = await prisma.roster.findUnique({
      where: { id: inf.survivorRosterId },
      select: { platformUserId: true },
    })
    const primaryUid = infectedRoster?.platformUserId ?? 'unknown'
    await queueAnimation(outcome.leagueId, outcome.week, 'zombie_turn', primaryUid, {
      infectedByRosterId: inf.infectedByRosterId,
      survivorRosterId: inf.survivorRosterId,
    }).catch(() => {})
  }
}

/**
 * Run infection for a league/week (compute + apply).
 */
export async function runInfectionForWeek(input: InfectionInput): Promise<ZombieInfectionOutcome> {
  const outcome = await computeInfections(input)
  await applyInfections(outcome, input.zombieLeagueId)
  return outcome
}
