import 'server-only'

/**
 * The teams a chopped (Guilly) league has already eliminated, keyed every way a commissioner surface
 * keys a team: by `Roster.id`, and by the team and owner names the name-keyed activity reads use.
 *
 * 🛑 WHY THIS EXISTS (2026-11-20). Every "inactive manager" check judges a team by whether its
 * manager has done anything lately. A chopped team's manager has nothing left to do — their roster
 * was released and they cannot set a lineup or make a move — so every eliminated team read as
 * INACTIVE, and a commissioner's chopped league reported half its field as abandoned. A commissioner
 * reported it from their own leagues. An eliminated team is out of the league, not neglecting it, so
 * every inactivity check leaves these teams out.
 *
 * Where an elimination is recorded:
 *   - A league AllFantasy runs (Guilly and Survivor Guilly) writes `GuillotineRosterState.choppedAt`
 *     on the chopped `Roster.id`; an undone chop clears it (./chopUndoService.ts).
 *   - An imported league is chopped by its provider and nothing records it here, so the chops are
 *     INFERRED from the weekly scores by `chopTimeline` — the same rule, and the same "current week",
 *     as the imported Guilly tab (./importedGuillyHealthLoad.ts), so the tab and the inactivity
 *     checks cannot disagree about who is out.
 *
 * ⚠ ONLY CHOPPED LEAGUES. `RedraftRoster.isEliminated` is deliberately NOT read: the playoff runtime
 * and Survivor set it too, and "knocked out of the playoffs" is a different claim with its own
 * surfaces (lib/eliminated-lineups).
 *
 * Degrades to "nobody eliminated" rather than throwing: a failed read must cost this filter, never
 * the commissioner's page — the same behaviour the inactivity checks had before it existed.
 */
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { chopTimeline, importedGuillyFormat, type ImportedGuillyRow } from './importedGuillyHealth'

export type EliminatedTeams = {
  /** `Roster.id` of every eliminated team. */
  rosterIds: ReadonlySet<string>
  /** Team names and owner names of those teams, trimmed — for the reads that key a team by name. */
  names: ReadonlySet<string>
}

export const NO_ELIMINATED_TEAMS: EliminatedTeams = { rosterIds: new Set(), names: new Set() }

type TeamRow = { externalId: string | null; platformUserId: string | null; teamName: string | null; ownerName: string | null }
type RosterRow = { id: string; platformUserId: string | null }

/**
 * Provider roster ids an imported Guilly league has chopped, from its weekly scores. The current week
 * is the latest week with any score, exactly as the imported Guilly tab reads it, so a chop lands
 * here when it lands there.
 */
export function importedChoppedProviderIds(rows: ReadonlyArray<ImportedGuillyRow>): string[] {
  const scoredWeeks = rows.filter((r) => r.pointsFor > 0).map((r) => r.week)
  if (scoredWeeks.length === 0) return []
  return [...chopTimeline(rows, Math.max(...scoredWeeks)).out.keys()]
}

/**
 * Resolves one league's chops to roster ids and names. Pure.
 *
 * A native chop is a `Roster.id`; its team is the `LeagueTeam` joined on the owner's platform user id,
 * or on `externalId` for an unclaimed team (the join managerHealth.ts uses). An imported chop is the
 * provider's roster id, which is `LeagueTeam.externalId`; its `Roster` is joined on the owner.
 */
export function resolveEliminatedTeams(input: {
  choppedRosterIds: readonly string[]
  importedProviderIds: readonly string[]
  teams: readonly TeamRow[]
  rosters: readonly RosterRow[]
}): EliminatedTeams {
  const rosterIds = new Set<string>()
  const names = new Set<string>()
  const addNames = (t: TeamRow | undefined) => {
    for (const n of [t?.teamName?.trim(), t?.ownerName?.trim()]) if (n) names.add(n)
  }

  const rosterById = new Map(input.rosters.map((r) => [r.id, r]))
  for (const id of input.choppedRosterIds) {
    rosterIds.add(id)
    const owner = rosterById.get(id)?.platformUserId ?? null
    addNames(input.teams.find((t) => (owner != null && t.platformUserId === owner) || t.externalId === id))
  }

  const provider = new Set(input.importedProviderIds)
  for (const team of input.teams) {
    if (team.externalId == null || !provider.has(String(team.externalId))) continue
    addNames(team)
    if (!team.platformUserId) continue
    for (const r of input.rosters) if (r.platformUserId === team.platformUserId) rosterIds.add(r.id)
  }

  return rosterIds.size === 0 && names.size === 0 ? NO_ELIMINATED_TEAMS : { rosterIds, names }
}

/** Eliminated teams for several leagues in a fixed number of reads. Leagues with none are absent. */
export async function readEliminatedTeamsByLeague(leagueIds: readonly string[]): Promise<Map<string, EliminatedTeams>> {
  const out = new Map<string, EliminatedTeams>()
  const ids = [...new Set(leagueIds.filter(Boolean))]
  if (ids.length === 0) return out
  try {
    const [leagues, chopped] = await Promise.all([
      prisma.league.findMany({
        where: { id: { in: ids } },
        select: { id: true, platform: true, platformLeagueId: true, season: true, leagueType: true, guillotineMode: true, settings: true },
      }),
      prisma.guillotineRosterState.findMany({
        where: { leagueId: { in: ids }, choppedAt: { not: null } },
        select: { leagueId: true, rosterId: true },
      }),
    ])

    const choppedByLeague = new Map<string, string[]>()
    for (const row of chopped) choppedByLeague.set(row.leagueId, [...(choppedByLeague.get(row.leagueId) ?? []), row.rosterId])

    // Imported Guilly leagues, by the provider league they mirror. Two of ours can mirror one.
    const imported = leagues.filter(
      (l) => !isNativePlatform(l.platform) && importedGuillyFormat(l) != null && l.platformLeagueId && l.season != null,
    )
    const providerKey = (leagueId: string, season: number) => `${leagueId}:${season}`
    const ourIdsByProvider = new Map<string, string[]>()
    for (const l of imported) {
      const key = providerKey(l.platformLeagueId!, l.season!)
      ourIdsByProvider.set(key, [...(ourIdsByProvider.get(key) ?? []), l.id])
    }
    const matchups = imported.length
      ? await prisma.weeklyMatchup.findMany({
          where: { OR: imported.map((l) => ({ leagueId: l.platformLeagueId!, seasonYear: l.season! })) },
          select: { leagueId: true, seasonYear: true, week: true, rosterId: true, pointsFor: true, matchupId: true },
        })
      : []
    const rowsByProvider = new Map<string, ImportedGuillyRow[]>()
    for (const m of matchups) {
      const key = providerKey(m.leagueId, m.seasonYear)
      rowsByProvider.set(key, [
        ...(rowsByProvider.get(key) ?? []),
        { week: m.week, rosterId: String(m.rosterId), pointsFor: m.pointsFor, matchupId: m.matchupId },
      ])
    }
    const importedByLeague = new Map<string, string[]>()
    for (const [key, rows] of rowsByProvider) {
      const providerIds = importedChoppedProviderIds(rows)
      if (providerIds.length === 0) continue
      for (const id of ourIdsByProvider.get(key) ?? []) importedByLeague.set(id, providerIds)
    }

    // Only the leagues that actually have a chop pay for the identity reads.
    const withChops = ids.filter((id) => choppedByLeague.has(id) || importedByLeague.has(id))
    if (withChops.length === 0) return out
    const [teams, rosters] = await Promise.all([
      prisma.leagueTeam.findMany({
        where: { leagueId: { in: withChops } },
        select: { leagueId: true, externalId: true, platformUserId: true, teamName: true, ownerName: true },
      }),
      prisma.roster.findMany({ where: { leagueId: { in: withChops } }, select: { id: true, leagueId: true, platformUserId: true } }),
    ])

    for (const leagueId of withChops) {
      const resolved = resolveEliminatedTeams({
        choppedRosterIds: choppedByLeague.get(leagueId) ?? [],
        importedProviderIds: importedByLeague.get(leagueId) ?? [],
        teams: teams.filter((t) => t.leagueId === leagueId),
        rosters: rosters.filter((r) => r.leagueId === leagueId),
      })
      if (resolved !== NO_ELIMINATED_TEAMS) out.set(leagueId, resolved)
    }
    return out
  } catch (error) {
    console.warn('[guillotine] eliminated-teams read failed; inactivity checks will include them', error)
    return out
  }
}

export async function readEliminatedTeams(leagueId: string): Promise<EliminatedTeams> {
  return (await readEliminatedTeamsByLeague([leagueId])).get(leagueId) ?? NO_ELIMINATED_TEAMS
}
