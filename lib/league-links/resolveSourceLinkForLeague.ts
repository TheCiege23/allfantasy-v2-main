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
 * Fantrax only: `League.platformLeagueId` is AllFantasy's own `FantraxLeague.id` (a uuid), and
 * Fantrax's real league id lives on that snapshot row as `sourceLeagueId`. Maps each snapshot id to
 * the real one so the resolver can build the league page; a CSV-era row has none and maps to null,
 * which the resolver turns into the homepage. DB read only, and never throws — a failed read means
 * the homepage, exactly as before.
 */
export async function fantraxSourceLeagueIds(
  rows: Array<{ platform: string | null | undefined; platformLeagueId: string | null | undefined }>,
): Promise<Map<string, string | null>> {
  const ids = Array.from(
    new Set(
      rows
        .filter((r) => String(r.platform ?? '').trim().toLowerCase() === 'fantrax')
        .map((r) => String(r.platformLeagueId ?? '').trim())
        .filter(Boolean),
    ),
  )
  const out = new Map<string, string | null>()
  if (!ids.length) return out
  try {
    const snapshots = await prisma.fantraxLeague.findMany({
      where: { id: { in: ids } },
      select: { id: true, sourceLeagueId: true },
    })
    for (const s of snapshots) out.set(s.id, s.sourceLeagueId ?? null)
  } catch {
    /* Unreadable → no mapping → the homepage, which is what every Fantrax link was before. */
  }
  return out
}

/** The id the resolver should build from: Fantrax's own league id for a Fantrax row, else as stored. */
export function linkableSourceLeagueId(
  league: { platform: string | null | undefined; platformLeagueId: string | null | undefined },
  fantraxIds: Map<string, string | null>,
): string | null {
  const stored = league.platformLeagueId ?? null
  if (String(league.platform ?? '').trim().toLowerCase() !== 'fantrax' || !stored) return stored
  return fantraxIds.has(stored) ? fantraxIds.get(stored) ?? null : stored
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
  const fantraxIds = await fantraxSourceLeagueIds([league])
  return resolveSourceLink({
    platform: league.platform,
    sourceLeagueId: linkableSourceLeagueId(league, fantraxIds),
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
  const fantraxIds = await fantraxSourceLeagueIds(leagues)
  for (const l of leagues) {
    const link = resolveSourceLink({
      platform: l.platform,
      sourceLeagueId: linkableSourceLeagueId(l, fantraxIds),
      leagueName: l.name,
      season: l.season,
      action,
    })
    if (link) out.set(l.id, link)
  }
  return out
}
