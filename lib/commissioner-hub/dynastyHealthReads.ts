import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { usesDynastyBackground } from '@/lib/league-media/dynastyBackground'
import { loadDynastyPickCapital } from '@/lib/dynasty-war-room/dynastyPickCapital'
import { taxiPlayerIds } from '@/lib/league/rosterLimit'
import {
  computePickBalance,
  computeTaxiOverLimit,
  type DynastyHealthSignals,
} from './dynastyHealthSignals'

/**
 * The reads behind ./dynastyHealthSignals.ts, for the dynasty leagues among a commissioner's leagues.
 *
 * ⚠ BOUNDED, FOR THE REASON commissionerHubHealth.ts RECORDS. Three reads per dynasty league, two
 * leagues at a time — never one promise per league. And only when the caller asks for it
 * (`dynastySignals: true`): the dashboards that load every league's health do not.
 *
 * Never throws. A league whose reads fail is simply absent from the map, and its snapshot is then
 * exactly what it was before this existed.
 */

/** Where a league's taxi slot count lives. Null when it cannot be read honestly. */
export function readTaxiLimit(league: { platform: string | null; taxiSlots: number | null; settings: unknown }): number | null {
  // A native league's column is AllFantasy's own setting. On an import it is the schema default.
  if (isNativePlatform(league.platform)) return typeof league.taxiSlots === 'number' ? league.taxiSlots : null
  const settings = league.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {}
  const raw = settings.taxi_slots
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

export async function loadDynastySignalsByLeague(
  leagueIds: readonly string[],
  userId: string,
): Promise<Map<string, DynastyHealthSignals>> {
  const out = new Map<string, DynastyHealthSignals>()
  if (leagueIds.length === 0) return out
  let leagues: Array<{
    id: string
    platform: string | null
    season: number | null
    settings: unknown
    taxiSlots: number | null
    isDynasty: boolean | null
    leagueType: string | null
    leagueVariant: string | null
    guillotineMode: boolean | null
  }>
  try {
    leagues = await prisma.league.findMany({
      where: { id: { in: [...leagueIds] } },
      select: {
        id: true,
        platform: true,
        season: true,
        settings: true,
        taxiSlots: true,
        isDynasty: true,
        leagueType: true,
        leagueVariant: true,
        guillotineMode: true,
      },
    })
  } catch {
    return out
  }
  const dynasty = (Array.isArray(leagues) ? leagues : []).filter((l) => usesDynastyBackground(l))

  const CONCURRENCY = 2
  for (let i = 0; i < dynasty.length; i += CONCURRENCY) {
    await Promise.all(
      dynasty.slice(i, i + CONCURRENCY).map(async (league) => {
        try {
          const [teams, rosters] = await Promise.all([
            prisma.leagueTeam.findMany({
              where: { leagueId: league.id },
              select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true },
            }),
            prisma.roster.findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true, playerData: true } }),
          ])
          const teamByUser = new Map(teams.filter((t) => t.platformUserId).map((t) => [t.platformUserId as string, t]))
          const named = rosters.flatMap((r) => {
            const team = teamByUser.get(r.platformUserId)
            // A roster with no team behind it is a leftover row, not a franchise (see commissionerHub.ts).
            if (!team) return []
            return [{
              rosterId: r.id,
              teamName: team.teamName?.trim() || team.ownerName?.trim() || null,
              isViewer: team.claimedByUserId === userId,
              // `lineup_sections.taxi` or the flat `taxi` array — the reader the roster limit uses.
              taxiCount: taxiPlayerIds(r.playerData).size,
            }]
          })

          const status = league.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>).status : null
          const capital = league.season != null
            ? await loadDynastyPickCapital({
                leagueId: league.id,
                platform: league.platform,
                leagueSeason: league.season,
                providerStatus: typeof status === 'string' ? status : null,
                rosters: rosters.map((r) => ({ id: r.id, platformUserId: r.platformUserId, playerData: r.playerData })),
                teams: teams.map((t) => ({
                  id: t.id,
                  externalId: String(t.externalId ?? ''),
                  platformUserId: t.platformUserId,
                  claimedByUserId: t.claimedByUserId,
                  teamName: t.teamName ?? null,
                })),
              }).catch(() => null)
            : null

          out.set(league.id, {
            picks: capital
              ? computePickBalance({
                  state: capital.state,
                  picksByRosterId: capital.picksByRosterId,
                  teams: named.map(({ rosterId, teamName, isViewer }) => ({ rosterId, teamName, isViewer })),
                })
              : { measured: false, reason: 'missing' },
            taxi: computeTaxiOverLimit({ limit: readTaxiLimit(league), rosters: named }),
          })
        } catch {
          // This league's dynasty signals are unknown; its snapshot is left as it was.
        }
      }),
    )
  }
  return out
}
