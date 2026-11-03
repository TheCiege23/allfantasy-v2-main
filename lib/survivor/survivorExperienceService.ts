import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SurvivorExperience } from './survivorGovernanceSettings'
import { resolveCastawayExperience, type CastawayExperience } from './survivorExperience'

type ExperienceDb = Pick<Prisma.TransactionClient, 'redraftSeason' | 'redraftRoster' | 'league'> & Partial<Pick<Prisma.TransactionClient, 'survivorPlayer'>>

export interface ExperienceLookupOptions {
  /**
   * The commissioner's opt-in (`experienceCrossLeague`, off by default): also count a Survivor season
   * the castaway played in ANY other league on AllFantasy, from our own SurvivorPlayer rows.
   */
  crossLeague?: boolean
}

/** Survivor phases that mean a season has been played out. */
const FINISHED_PHASES = ['complete', 'completed', 'finale', 'season_complete'] as const

/**
 * Castaways who owned a team in an EARLIER season of this same league. A renewal keeps the league's
 * id (LeagueRenewal), so earlier `RedraftSeason` rows of this league are its lineage. A league in its
 * first season has none, and everyone reads as a rookie unless the commissioner flags them.
 */
export async function loadReturningCastaways(leagueId: string, userIds: readonly string[], db: ExperienceDb = prisma): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const [league, seasons] = await Promise.all([
    db.league.findUnique({ where: { id: leagueId }, select: { season: true } }),
    db.redraftSeason.findMany({ where: { leagueId }, select: { id: true, season: true } }),
  ])
  const current = league?.season ?? Math.max(0, ...seasons.map((s) => s.season))
  const priorSeasonIds = seasons.filter((s) => s.season < current).map((s) => s.id)
  if (priorSeasonIds.length === 0) return new Set()
  const owners = await db.redraftRoster.findMany({ where: { leagueId, seasonId: { in: priorSeasonIds }, ownerId: { in: [...userIds] } }, select: { ownerId: true } })
  return new Set(owners.map((o) => o.ownerId))
}

/**
 * Castaways who played a PREVIOUS Survivor season in ANOTHER league on AllFantasy: a SurvivorPlayer row
 * in a different Survivor league whose season is earlier than this league's, or whose Survivor game has
 * finished. Our own rows only — no provider, no other platform.
 *
 * ⚠ PRIVACY: returns user ids only. Which leagues they played in never leaves this function, so no
 * caller can show it. Null-safe: a client without `survivorPlayer` (a narrow transaction) finds nobody.
 */
export async function loadPlatformSurvivorVeterans(leagueId: string, userIds: readonly string[], db: ExperienceDb = prisma): Promise<Set<string>> {
  if (userIds.length === 0 || !db.survivorPlayer) return new Set()
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  const season = league?.season ?? null
  const rows = await db.survivorPlayer.findMany({
    where: {
      userId: { in: [...userIds] },
      leagueId: { not: leagueId },
      league: {
        survivorMode: true,
        OR: [
          ...(season != null ? [{ season: { lt: season } }] : []),
          { survivorGameState: { phase: { in: [...FINISHED_PHASES] } } },
        ],
      },
    },
    select: { userId: true },
  })
  return new Set(rows.map((r) => r.userId))
}

export async function loadCastawayExperience(
  leagueId: string,
  userIds: readonly string[],
  overrides: Readonly<Record<string, SurvivorExperience>>,
  db: ExperienceDb = prisma,
  options: ExperienceLookupOptions = {},
): Promise<Record<string, CastawayExperience>> {
  const [returning, platform] = await Promise.all([
    loadReturningCastaways(leagueId, userIds, db).catch(() => new Set<string>()),
    options.crossLeague ? loadPlatformSurvivorVeterans(leagueId, userIds, db).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ])
  return resolveCastawayExperience(userIds, overrides, returning, platform)
}

/** userId → rookie/veteran, the shape the tribe assignment engine's split takes. */
export async function loadCastawayExperienceFlags(
  leagueId: string,
  userIds: readonly string[],
  overrides: Readonly<Record<string, SurvivorExperience>>,
  db: ExperienceDb = prisma,
  options: ExperienceLookupOptions = {},
): Promise<Record<string, SurvivorExperience>> {
  const resolved = await loadCastawayExperience(leagueId, userIds, overrides, db, options)
  return Object.fromEntries(Object.entries(resolved).map(([userId, e]) => [userId, e.experience]))
}
