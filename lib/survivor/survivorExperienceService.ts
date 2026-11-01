import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SurvivorExperience } from './survivorGovernanceSettings'
import { resolveCastawayExperience, type CastawayExperience } from './survivorExperience'

type ExperienceDb = Pick<Prisma.TransactionClient, 'redraftSeason' | 'redraftRoster' | 'league'>

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

export async function loadCastawayExperience(
  leagueId: string,
  userIds: readonly string[],
  overrides: Readonly<Record<string, SurvivorExperience>>,
  db: ExperienceDb = prisma,
): Promise<Record<string, CastawayExperience>> {
  const returning = await loadReturningCastaways(leagueId, userIds, db).catch(() => new Set<string>())
  return resolveCastawayExperience(userIds, overrides, returning)
}

/** userId → rookie/veteran, the shape the tribe assignment engine's split takes. */
export async function loadCastawayExperienceFlags(
  leagueId: string,
  userIds: readonly string[],
  overrides: Readonly<Record<string, SurvivorExperience>>,
  db: ExperienceDb = prisma,
): Promise<Record<string, SurvivorExperience>> {
  const resolved = await loadCastawayExperience(leagueId, userIds, overrides, db)
  return Object.fromEntries(Object.entries(resolved).map(([userId, e]) => [userId, e.experience]))
}
