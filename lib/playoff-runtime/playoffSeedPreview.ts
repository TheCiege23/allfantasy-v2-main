import { prisma } from '@/lib/prisma'
import { currentNflRedraftPlayoffSeeds } from './canonicalNflRedraftPlayoffRuntime'
import { resolveNflRedraftPlayoffRuntime, type PlayoffRuntimeDeps } from './resolveNflRedraftPlayoffRuntime'

export type NativePlayoffSeedPreviewRow = {
  /** The generic `Roster.id` the standings rows are keyed on, or the season roster id when no link exists. */
  rosterId: string
  redraftRosterId: string
  seed: number
  displayName: string
  qualifiedBy: 'division' | 'wildcard' | 'standings' | null
}

export type NativePlayoffSeedPreview = {
  /** True once a bracket is generated: these are the seeds it was built with. Else "if the season ended today". */
  locked: boolean
  seeds: NativePlayoffSeedPreviewRow[]
}

/**
 * The playoff seeds of a native season, from the playoff runtime itself — the function that builds the
 * bracket (`buildNflRedraftPlayoffRuntimeState` → `seedTeams`), divisions, the divisions playoff rule and
 * the commissioner's tiebreaker order included.
 *
 * 🛑 THE PREVIEW USED TO RANK ON ITS OWN. `/scoring/playoff-seeds` (server/services/playoffEngine.ts)
 * took `FantasyStanding.rank` in order, or put division winners first only through the promotion-tier
 * `LeagueTeam.divisionId`, which native divisions (`settings.division_config`) never set. With divisions
 * on, a 4-seed division winner showed as a 6 in the preview and then entered the bracket as a 2. Reading
 * the runtime's seeds means the preview and the bracket are one computation and cannot disagree.
 *
 * Null when the league has no native season for `season`, or the runtime does not cover it — the caller
 * falls back to its stored seeds. Seeds are re-keyed onto the generic `Roster.id` (`redraftRosterId`
 * link, else `platformUserId === ownerId`, as lib/league/divisions/loadLeagueDivisions.ts links them),
 * which is the id `/scoring/standings` rows carry. Read-only.
 */
export async function loadNativePlayoffSeedPreview(
  leagueId: string,
  season: number,
  deps: Partial<PlayoffRuntimeDeps> = {},
): Promise<NativePlayoffSeedPreview | null> {
  const seasonRow = await prisma.redraftSeason.findFirst({
    where: { leagueId, season },
    orderBy: { createdAt: 'desc' },
    select: { id: true, rosters: { select: { id: true, ownerId: true } } },
  })
  if (!seasonRow) return null
  const resolved = await resolveNflRedraftPlayoffRuntime({ seasonId: seasonRow.id }, deps)
  if (!resolved.ok) return null

  const generic = (await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, redraftRosterId: true },
  })) as Array<{ id: string; platformUserId: string | null; redraftRosterId: string | null }>
  const ownerOf = new Map(seasonRow.rosters.map((r) => [r.id, r.ownerId]))
  const genericIdFor = (redraftRosterId: string) =>
    generic.find((g) => g.redraftRosterId === redraftRosterId)?.id ??
    generic.find((g) => g.platformUserId != null && g.platformUserId === ownerOf.get(redraftRosterId))?.id ??
    redraftRosterId

  const current = currentNflRedraftPlayoffSeeds(resolved.state)
  return {
    locked: current.locked,
    seeds: current.seeds.map((s) => ({
      rosterId: genericIdFor(s.rosterId),
      redraftRosterId: s.rosterId,
      seed: s.seed,
      displayName: s.displayName,
      qualifiedBy: s.qualifiedBy,
    })),
  }
}
