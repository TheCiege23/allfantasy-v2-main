import 'server-only'
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { attachToFranchise } from '@/lib/league-import/fantrax/importFantraxLeague'
import { collegeSportFor } from './format'

/**
 * Link the two halves of a college + pro franchise that were imported separately.
 *
 * WHY. A pair could only be created while importing a Fantrax league
 * (`importFantraxLeague` -> `attachToFranchise`). Two leagues already imported had no way to be
 * linked, and nothing in the app asked. Measured 2026-11-21: "Road To Glory NBA" and "Road To Glory
 * NCAA Basketball" (both Fantrax, both C2C, same owner) sit unpaired, so the combined roster page
 * cannot open for them.
 *
 * The user picks the other half; nothing here guesses a pair. `attachToFranchise` refuses a league
 * held by someone else's franchise and reuses the user's own link.
 */

const COLLEGE_SPORTS = new Set(['NCAAF', 'NCAAFB', 'NCAAB', 'NCAABB', 'CFB', 'CBB'])

export function isCollegeSport(sport: string | null | undefined): boolean {
  return COLLEGE_SPORTS.has(String(sport ?? '').trim().toUpperCase())
}

/** The pro sport a college sport pairs with. */
export function proSportForCollege(sport: string): string {
  const s = sport.trim().toUpperCase()
  return s === 'NCAAB' || s === 'NCAABB' || s === 'CBB' ? 'NBA' : 'NFL'
}

/** The sport the OTHER half must be. */
export function pairedSportFor(sport: string): string {
  return isCollegeSport(sport) ? proSportForCollege(sport) : collegeSportFor(sport)
}

/** The id `FranchiseLeagueMember.leagueId` holds: the snapshot id for Fantrax, the League id otherwise. */
export function memberKeyFor(league: { id: string; platform: string; platformLeagueId: string | null }): string {
  return league.platform.toLowerCase() === 'fantrax' && league.platformLeagueId ? league.platformLeagueId : league.id
}

export type LinkCandidate = { leagueId: string; name: string; platform: string; sport: string; season: number | null }

const ownedBy = (userId: string) => ({ OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] })

/** The viewer's leagues that could be the other half of this one: the paired sport, not already linked elsewhere. */
export async function findLinkCandidates(leagueId: string, userId: string): Promise<{ needRole: 'pro' | 'college'; candidates: LinkCandidate[] } | null> {
  const league = await prisma.league.findFirst({ where: { id: leagueId, ...ownedBy(userId) }, select: { id: true, sport: true } })
  if (!league) return null
  return findLinkCandidatesForSport(userId, String(league.sport ?? ''), leagueId)
}

/** The sports a college + pro franchise is built from. Anything else has no other half. */
const PAIRABLE_SPORTS = new Set(['NFL', 'NBA', 'NCAAF', 'NCAAB'])

/**
 * The same list for a league that does not exist yet: the import confirm screen asks for the other half
 * BEFORE the league is built, so all it has is the sport the preview read.
 */
export async function findLinkCandidatesForSport(
  userId: string,
  sportRaw: string,
  excludeLeagueId?: string,
): Promise<{ needRole: 'pro' | 'college'; candidates: LinkCandidate[] }> {
  const sport = sportRaw.trim().toUpperCase()
  const needRole = isCollegeSport(sport) ? 'pro' : 'college'
  if (!PAIRABLE_SPORTS.has(sport)) return { needRole, candidates: [] }
  const want = pairedSportFor(sport)
  const rows = await prisma.league.findMany({
    where: { ...(excludeLeagueId ? { id: { not: excludeLeagueId } } : {}), sport: want as LeagueSport, ...ownedBy(userId) },
    select: { id: true, name: true, platform: true, platformLeagueId: true, sport: true, season: true, leagueType: true },
    orderBy: { season: 'desc' },
    take: 50,
  })
  // Leave out a league that is already a half of a franchise: linking it here would take it from that one.
  const taken = await prisma.franchiseLeagueMember.findMany({
    where: { leagueId: { in: rows.map(memberKeyFor) } },
    select: { leagueId: true },
  })
  const takenKeys = new Set(taken.map((t) => t.leagueId))
  const candidates = rows
    .filter((r) => !takenKeys.has(memberKeyFor(r)))
    // C2C / Devy leagues first: the likely other half.
    .sort((a, b) => Number(!['c2c', 'devy'].includes(String(a.leagueType))) - Number(!['c2c', 'devy'].includes(String(b.leagueType))))
    .map((r) => ({ leagueId: r.id, name: r.name ?? 'League', platform: r.platform, sport: String(r.sport ?? want), season: r.season ?? null }))
  return { needRole, candidates }
}

export async function linkHalves(args: { leagueId: string; otherLeagueId: string; userId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (args.leagueId === args.otherLeagueId) return { ok: false, error: 'Pick a different league.' }
  const select = { id: true, name: true, platform: true, platformLeagueId: true, sport: true }
  const [a, b] = await Promise.all([
    prisma.league.findFirst({ where: { id: args.leagueId, ...ownedBy(args.userId) }, select }),
    prisma.league.findFirst({ where: { id: args.otherLeagueId, ...ownedBy(args.userId) }, select }),
  ])
  if (!a || !b) return { ok: false, error: 'Both leagues must be yours.' }
  const aCollege = isCollegeSport(a.sport)
  if (aCollege === isCollegeSport(b.sport)) return { ok: false, error: 'Link one pro league with one college league.' }
  const pro = aCollege ? b : a
  const college = aCollege ? a : b
  if (pairedSportFor(String(pro.sport ?? '')) !== String(college.sport ?? '').toUpperCase()) {
    return { ok: false, error: `A ${pro.sport} league pairs with a ${pairedSportFor(String(pro.sport ?? ''))} league.` }
  }

  const first = await attachToFranchise({
    ownerUserId: args.userId,
    franchiseName: pro.name ?? 'Franchise',
    role: 'pro',
    platform: pro.platform.toLowerCase(),
    leagueId: memberKeyFor(pro),
    teamExternalId: '',
  })
  if (!first.ok) return first
  const second = await attachToFranchise({
    ownerUserId: args.userId,
    franchiseName: pro.name ?? 'Franchise',
    linkId: first.linkId,
    role: 'college',
    platform: college.platform.toLowerCase(),
    leagueId: memberKeyFor(college),
    teamExternalId: '',
  })
  if (!second.ok) return second
  /*
   * The pair is the LEAGUE's when the person linking may decide that for it (the head commissioner, or
   * whoever imported both halves): every manager then sees one league with nothing to set up. Anyone
   * else's link stays their own view, as before. A failure here leaves their own link working.
   */
  const { recordLeaguePair } = await import('./leaguePair')
  await recordLeaguePair({ proLeagueId: pro.id, collegeLeagueId: college.id, linkedByUserId: args.userId }).catch(() => 'refused')
  return { ok: true }
}
