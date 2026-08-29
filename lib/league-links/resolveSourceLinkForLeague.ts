/**
 * Server-side helper: resolve a source-platform deep link from an AllFantasy `League.id` alone, for
 * surfaces (Decision OS cards, agenda items, lineup/waiver recommendations) whose payloads carry only
 * the internal league id — not the source `platformLeagueId`.
 *
 * DB-first: reads the canonical League row (platform / platformLeagueId / name / season) and runs the
 * pure resolver. It NEVER calls a provider API, so it is safe on the server render path.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveSourceLink, type SourceActionType, type SourceLink } from './sourceLinkResolver'

export async function resolveSourceLinkForLeague(
  leagueId: string | null | undefined,
  action?: SourceActionType,
): Promise<SourceLink | null> {
  const id = (leagueId ?? '').trim()
  if (!id) return null
  const league = await prisma.league.findUnique({
    where: { id },
    select: { platform: true, platformLeagueId: true, name: true, season: true },
  })
  if (!league) return null
  return resolveSourceLink({
    platform: league.platform,
    sourceLeagueId: league.platformLeagueId,
    leagueName: league.name,
    season: league.season,
    action,
  })
}

/** Batch variant — one query for many league ids (e.g. a page of Decision OS recommendations). */
export async function resolveSourceLinksForLeagueIds(
  leagueIds: Array<string | null | undefined>,
  action?: SourceActionType,
): Promise<Map<string, SourceLink>> {
  const ids = Array.from(new Set(leagueIds.map((x) => (x ?? '').trim()).filter(Boolean)))
  const out = new Map<string, SourceLink>()
  if (!ids.length) return out
  const leagues = await prisma.league.findMany({
    where: { id: { in: ids } },
    select: { id: true, platform: true, platformLeagueId: true, name: true, season: true },
  })
  for (const l of leagues) {
    const link = resolveSourceLink({
      platform: l.platform,
      sourceLeagueId: l.platformLeagueId,
      leagueName: l.name,
      season: l.season,
      action,
    })
    if (link) out.set(l.id, link)
  }
  return out
}
