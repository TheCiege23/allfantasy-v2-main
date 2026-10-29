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

/**
 * Fantrax's own league id for each Fantrax `League.platformLeagueId` given, keyed by that column.
 *
 * ⚠ FOR A FANTRAX LEAGUE THE COLUMN IS A LOCAL UUID (`FantraxLeague.id`), NOT FANTRAX'S ID — and it
 * has to stay that way: the collectors and redraft presentation look the snapshot up by it. Fantrax's
 * id is `FantraxLeague.sourceLeagueId`, which imports only began recording later, so an older league
 * maps to nothing until it re-imports and the link stays on the homepage. One query for the batch;
 * a failed read is an empty map, never a thrown error on a render path.
 */
export async function fantraxSourceLeagueIds(platformLeagueIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const ids = Array.from(new Set(platformLeagueIds.map((x) => (x ?? '').trim()).filter(Boolean)))
  const out = new Map<string, string>()
  if (!ids.length) return out
  const rows = await prisma.fantraxLeague
    .findMany({ where: { id: { in: ids } }, select: { id: true, sourceLeagueId: true } })
    .catch(() => [] as Array<{ id: string; sourceLeagueId: string | null }>)
  for (const r of rows) if (r.sourceLeagueId) out.set(r.id, r.sourceLeagueId)
  return out
}

/** The id a source link should be built from: Fantrax's own for a Fantrax league, else the column. */
function linkLeagueId(platform: string | null, platformLeagueId: string | null, fantraxIds: Map<string, string>): string | null {
  if ((platform ?? '').toLowerCase() === 'fantrax' && platformLeagueId) return fantraxIds.get(platformLeagueId) ?? null
  return platformLeagueId
}

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
  const fantraxIds =
    league.platform?.toLowerCase() === 'fantrax' ? await fantraxSourceLeagueIds([league.platformLeagueId]) : new Map<string, string>()
  return resolveSourceLink({
    platform: league.platform,
    sourceLeagueId: linkLeagueId(league.platform, league.platformLeagueId, fantraxIds),
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
  const fantraxIds = await fantraxSourceLeagueIds(
    leagues.filter((l) => l.platform?.toLowerCase() === 'fantrax').map((l) => l.platformLeagueId),
  )
  for (const l of leagues) {
    const link = resolveSourceLink({
      platform: l.platform,
      sourceLeagueId: linkLeagueId(l.platform, l.platformLeagueId, fantraxIds),
      leagueName: l.name,
      season: l.season,
      action,
    })
    if (link) out.set(l.id, link)
  }
  return out
}
