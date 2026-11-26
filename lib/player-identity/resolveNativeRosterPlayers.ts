import 'server-only'

/**
 * Resolve a NATIVE league's roster player ids (an AllFantasy league; `platform` is `manual`) to names,
 * positions and teams.
 *
 * 🛑 THE TRADE SCREEN NAMED NOBODY IN A NATIVE LEAGUE. `/api/leagues/[id]/trades/rosters` sent every
 * non-Sleeper platform to `resolveProviderRosterPlayers`, which only knows imported platforms' columns
 * (ESPN, Fantrax, …). For `manual` it found no column and returned nothing, so every player in every
 * native league's trade picker showed as a bare id ("114") with no position. Found 2026-11-26 in a
 * native NBA test league whose rosters hold Nikola Jokic as "114".
 *
 * The id space is the one `leagueIdSpaces` already defines for a native league
 * (./externalIdNamespace.ts): a bare number in NFL is a Sleeper id (native pools are seeded from
 * Sleeper); everything else — Rolling Insights numbers in NBA / NCAAB / NHL, `tsdb_…`, `name:…` — is
 * named by `SportsPlayer.externalId`. Measured on production 2026-11-26 across all native rosters:
 *
 *     NFL     121 ids   121 match as Sleeper ids  (70 of them ALSO match a different RI player)
 *     NBA     155 ids   155 match Rolling Insights
 *     NCAAB   648 ids   648 match Rolling Insights
 *     NHL      71 ids    54 Rolling Insights, 17 TheSportsDB (`tsdb_…`)
 *
 * ⚠ NEVER ASK BOTH SPACES FOR ONE ID. "1232" is Deni Avdija in Rolling Insights and Robert Covington
 * in Sleeper. Each id goes to the one space its sport says it is in.
 *
 * ⚠ AN ID WHOSE ROWS NAME DIFFERENT PEOPLE IS LEFT UNRESOLVED, the same rule as the provider and trade
 * resolvers: a wrong name on someone's roster is worse than the bare id.
 */
import { prisma } from '@/lib/prisma'
import { toImageUrl } from '@/lib/media/imageUrl'
import { leagueIdSpaces, nonSleeperExternalIdWhere } from './externalIdNamespace'
import { resolveSleeperRosterPlayers } from './resolveSleeperRosterPlayers'
import type { ResolvedProviderPlayer } from './resolveProviderRosterPlayers'

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export async function resolveNativeRosterPlayers(
  playerIds: readonly string[],
  sport: string,
): Promise<Map<string, ResolvedProviderPlayer>> {
  const out = new Map<string, ResolvedProviderPlayer>()
  const s = String(sport ?? 'NFL').trim().toUpperCase() || 'NFL'
  // 'manual' is a native platform: this is the split every native reader uses.
  const { sleeperIds, providerIds } = leagueIdSpaces(playerIds, s, 'manual')

  if (sleeperIds.length > 0) {
    const found = await resolveSleeperRosterPlayers(sleeperIds, s).catch(() => new Map())
    for (const [id, p] of found) {
      out.set(id, { name: p.name, position: p.position ?? null, team: p.team ?? null, imageUrl: p.imageUrl ?? null, sport: p.sport ?? s, sleeperId: p.sleeperId ?? id })
    }
  }

  if (providerIds.length > 0) {
    const rows = await prisma.sportsPlayer
      .findMany({
        where: nonSleeperExternalIdWhere(providerIds, s),
        select: { externalId: true, name: true, position: true, team: true, imageUrl: true, sleeperId: true, source: true },
        orderBy: { fetchedAt: 'desc' },
      })
      .catch(() => [] as Array<{ externalId: string; name: string; position: string | null; team: string | null; imageUrl: string | null; sleeperId: string | null; source: string | null }>)
    const byId = new Map<string, typeof rows>()
    for (const row of rows) {
      if (!row.externalId || !row.name?.trim()) continue
      byId.set(row.externalId, [...(byId.get(row.externalId) ?? []), row])
    }
    for (const [id, hits] of byId) {
      const first = hits[0]!
      if (!hits.every((h) => sameName(h.name, first.name))) continue
      const withPosition = hits.find((h) => h.position) ?? first
      out.set(id, {
        name: first.name.trim(),
        position: withPosition.position ?? null,
        team: hits.find((h) => h.team)?.team ?? null,
        imageUrl: toImageUrl(hits.find((h) => h.imageUrl)?.imageUrl ?? null),
        sport: s,
        sleeperId: hits.find((h) => h.sleeperId)?.sleeperId ?? null,
        rollingInsightsId: hits.some((h) => String(h.source ?? '').toLowerCase() === 'rolling_insights') ? id : null,
      })
    }
  }
  return out
}
