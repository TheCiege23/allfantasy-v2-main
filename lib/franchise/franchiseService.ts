/**
 * The franchise link, backed by the database.
 *
 * `lib/franchise/franchiseLink.ts` holds the rules — what makes a view complete,
 * how legs settle, why the two halves are never one number. This resolves those
 * rules against real rows.
 *
 * ⚠ THE TWO SIDES ARE IN DIFFERENT TABLES AND THERE IS NO FOREIGN KEY. The pro
 * half lives in `leagues`, the college half in `FantraxLeague`, so a member row
 * can point at a league that has been deleted. Every read here checks presence
 * and reports absence rather than throwing or, worse, rendering an empty roster
 * as an empty team.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  buildFranchiseView,
  settleCrossPlatformTrade,
  type FranchiseMember,
  type FranchiseRole,
  type FranchiseView,
  type Settlement,
  type TradeLeg,
} from './franchiseLink'
import { findRosterForTeam, rosterPlayerIds } from '@/lib/leagues/rosterForTeam'

/** One side's roster, however that platform stores it. */
export type FranchiseSideRoster = {
  role: FranchiseRole
  platform: string
  leagueName: string | null
  teamLabel: string | null
  /** Player names where the platform gives them, ids where it does not. */
  players: Array<{ id: string; name: string | null; position: string | null; status: string | null }>
  /**
   * ⚠ Null when the roster could not be read at all — NOT an empty array, which
   * would render as a manager who owns nobody.
   */
  unavailableReason: string | null
}

export type FranchiseDetail = {
  view: FranchiseView
  sides: FranchiseSideRoster[]
  /** Total across both halves, for the "one team" headline. */
  totalPlayers: number
}

/**
 * Resolve a franchise and both its rosters.
 *
 * ⚠ ROSTER READS ARE PER-PLATFORM AND SHARE NOTHING. Sleeper stores a roster as
 * a `playerData.players` array of platform ids on `rosters`; Fantrax was
 * imported as a resolved array on `FantraxLeague.roster`. There is no common
 * shape and pretending otherwise is how one side silently renders empty.
 */
export async function loadFranchiseDetail(linkId: string): Promise<FranchiseDetail | null> {
  const link = await prisma.franchiseLink.findUnique({
    where: { id: linkId },
    include: { members: true },
  })
  if (!link) return null

  const members: FranchiseMember[] = []
  const sides: FranchiseSideRoster[] = []

  for (const m of link.members) {
    const role = m.role as FranchiseRole

    if (m.platform === 'fantrax') {
      const league = await prisma.fantraxLeague.findUnique({
        where: { id: m.leagueId },
        select: { leagueName: true, userTeam: true, roster: true },
      })
      members.push({
        role,
        platform: m.platform,
        leagueId: m.leagueId,
        teamExternalId: m.teamExternalId,
        leaguePresent: league != null,
      })
      const raw = Array.isArray(league?.roster) ? (league?.roster as unknown[]) : null
      sides.push({
        role,
        platform: m.platform,
        leagueName: league?.leagueName ?? null,
        teamLabel: league?.userTeam ?? m.teamExternalId,
        players: (raw ?? []).map((p) => {
          const r = p as Record<string, unknown>
          return {
            id: String(r.fantraxId ?? ''),
            name: (r.name as string) ?? null,
            position: (r.position as string) ?? null,
            status: (r.status as string) ?? null,
          }
        }),
        unavailableReason:
          league == null
            ? 'the linked Fantrax league no longer exists'
            : raw == null
              ? 'this Fantrax snapshot holds no roster — re-run the import'
              : null,
      })
      continue
    }

    /* Pro side: leagues + league_teams + rosters, keyed on platformUserId. */
    const league = await prisma.league.findUnique({
      where: { id: m.leagueId },
      select: { name: true },
    })
    members.push({
      role,
      platform: m.platform,
      leagueId: m.leagueId,
      teamExternalId: m.teamExternalId,
      leaguePresent: league != null,
    })

    const team = m.teamExternalId
      ? await prisma.leagueTeam.findFirst({
          where: { leagueId: m.leagueId, externalId: m.teamExternalId },
          select: { teamName: true, ownerName: true, platformUserId: true },
        })
      : null

    /* Contract-aware lookup: Roster.platformUserId holds the AF user id for a
       LINKED manager, so joining it to LeagueTeam.platformUserId misses exactly
       the managers who have accounts. See rosterLookup.ts. */
    const roster = team?.platformUserId
      ? await findRosterForTeam(m.leagueId, team.platformUserId)
      : null

    const ids = roster ? rosterPlayerIds(roster.playerData) : null

    sides.push({
      role,
      platform: m.platform,
      leagueName: league?.name ?? null,
      teamLabel: team?.teamName ?? team?.ownerName ?? m.teamExternalId,
      /*
       * ⚠ NAMES ARE NOT RESOLVED HERE. Sleeper stores platform ids and joining
       * them to Player is a separate id-space problem; returning the ids with a
       * null name is honest, where inventing names is not.
       */
      players: (ids ?? []).map((id) => ({
        id: String(id),
        name: null,
        position: null,
        status: null,
      })),
      unavailableReason:
        league == null
          ? 'the linked league no longer exists'
          : team == null
            ? 'we have not matched you to a team in this league'
            : ids == null
              ? 'this league has no stored roster yet — run a sync'
              : null,
    })
  }

  const view = buildFranchiseView({ linkId: link.id, name: link.name, members })
  return {
    view,
    sides,
    totalPlayers: sides.reduce((a, s) => a + s.players.length, 0),
  }
}

/** Every franchise a user owns. */
export async function listFranchises(ownerUserId: string): Promise<FranchiseView[]> {
  const links = await prisma.franchiseLink.findMany({
    where: { ownerUserId },
    include: { members: true },
    orderBy: { createdAt: 'asc' },
  })

  return Promise.all(
    links.map(async (link) => {
      const members: FranchiseMember[] = []
      for (const m of link.members) {
        const present =
          m.platform === 'fantrax'
            ? (await prisma.fantraxLeague.count({ where: { id: m.leagueId } })) > 0
            : (await prisma.league.count({ where: { id: m.leagueId } })) > 0
        members.push({
          role: m.role as FranchiseRole,
          platform: m.platform,
          leagueId: m.leagueId,
          teamExternalId: m.teamExternalId,
          leaguePresent: present,
        })
      }
      return buildFranchiseView({ linkId: link.id, name: link.name, members })
    }),
  )
}

export type RecordedTrade = {
  tradeId: string
  settlement: Settlement
}

/**
 * Record a deal that spans both platforms.
 *
 * ⚠ RECORDING IS NOT EXECUTING. Sleeper's API is read-only and Fantrax is an
 * import, so this writes down what was agreed and then watches for it. Both
 * halves still have to be carried out by hand on their own platform.
 */
export async function recordCrossPlatformTrade(args: {
  linkId: string
  summary?: string | null
  legs: Array<{ role: FranchiseRole; platform: string; sends: string[]; receives: string[] }>
}): Promise<RecordedTrade> {
  const trade = await prisma.crossPlatformTrade.create({
    data: {
      linkId: args.linkId,
      summary: args.summary ?? null,
      status: 'pending',
      legs: {
        create: args.legs.map((l) => ({
          platform: l.platform,
          role: l.role,
          sends: l.sends,
          receives: l.receives,
          status: 'pending',
          basis: 'recorded as agreed; not yet seen on the platform',
        })),
      },
    },
    include: { legs: true },
  })

  const settlement = settleCrossPlatformTrade(toLegs(trade.legs))
  return { tradeId: trade.id, settlement }
}

/**
 * Recompute a trade's status from its legs and persist it.
 *
 * ⚠ `partial` IS THE ONE THAT MATTERS. It means one side went through and the
 * other did not, so the franchises are unbalanced — and neither platform can see
 * it, because each only ever saw a complete trade of its own.
 */
export async function refreshTradeSettlement(tradeId: string): Promise<Settlement | null> {
  const trade = await prisma.crossPlatformTrade.findUnique({
    where: { id: tradeId },
    include: { legs: true },
  })
  if (!trade) return null

  const settlement = settleCrossPlatformTrade(toLegs(trade.legs))

  await prisma.crossPlatformTrade.update({
    where: { id: tradeId },
    data: {
      status: settlement.status,
      settledAt: settlement.status === 'settled' ? new Date() : null,
    },
  })

  return settlement
}

/** Mark one platform's half as seen, or as checked and absent. */
export async function markLegObserved(args: {
  tradeId: string
  role: FranchiseRole
  status: 'observed' | 'contradicted'
  basis: string
}): Promise<Settlement | null> {
  await prisma.crossPlatformTradeLeg.updateMany({
    where: { tradeId: args.tradeId, role: args.role },
    data: {
      status: args.status,
      observedAt: new Date(),
      basis: args.basis,
    },
  })
  return refreshTradeSettlement(args.tradeId)
}

function toLegs(
  rows: Array<{ role: string; platform: string; sends: unknown; receives: unknown; status: string; observedAt: Date | null; basis: string | null }>,
): TradeLeg[] {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
  return rows.map((r) => ({
    role: r.role as FranchiseRole,
    platform: r.platform,
    sends: list(r.sends),
    receives: list(r.receives),
    status: r.status as TradeLeg['status'],
    observedAt: r.observedAt,
    basis: r.basis,
  }))
}
