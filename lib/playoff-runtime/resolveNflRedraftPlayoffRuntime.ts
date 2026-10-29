import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  buildPlayoffRuntimeEvent,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffMatchupInput,
  type NflRedraftPlayoffRulesInput,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
  type NflRedraftRegularSeasonMatchupInput,
} from './canonicalNflRedraftPlayoffRuntime'
import { runsStandardWeeklySeason } from '@/lib/season-week/standardSeasonScope'
import { CONSOLATION_ROUND_OFFSET } from './playoffRoundWeeks'
import { loadSeasonRosterDivisions, type SeasonRosterDivisions } from '@/lib/league/divisions/loadLeagueDivisions'
import { divisionRecords } from '@/lib/league/divisions/leagueDivisions'

export type NflRedraftPlayoffRuntimeResolved =
  | {
      ok: true
      state: NflRedraftPlayoffRuntimeState
      /** The results `state` was seeded with; re-seeding must pass them again or lose head-to-head. */
      regularSeasonMatchups: NflRedraftRegularSeasonMatchupInput[]
      season: { id: string; leagueId: string; sport: string; season: number; currentWeek: number; status: string }
    }
  | { ok: false; reason: 'season_not_found' | 'league_not_found' | 'not_nfl_redraft' }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function eventTitle(event: CanonicalLeagueRuntimeEvent): string {
  switch (event.type) {
    case 'playoffs.qualification.calculated':
      return 'Playoff qualification calculated'
    case 'playoffs.seeds.updated':
      return 'Playoff seeds generated'
    case 'playoffs.bracket.generated':
      return 'Playoff bracket generated'
    case 'playoffs.bracket.locked':
      return 'Playoff bracket locked'
    case 'playoffs.round.opened':
      return 'Playoff round opened'
    case 'playoffs.matchup.created':
      return 'Playoff matchup created'
    case 'playoffs.advancement':
      return 'Playoff advancement processed'
    case 'playoffs.team.advanced':
      return 'Playoff team advanced'
    case 'playoffs.team.eliminated':
      return 'Playoff team eliminated'
    case 'playoffs.reseeded':
      return 'Playoff bracket reseeded'
    case 'playoffs.consolation.generated':
      return 'Consolation bracket generated'
    case 'playoffs.championship.matchup.created':
      return 'Championship matchup created'
    case 'playoffs.champion.crowned':
      return 'Champion crowned'
    case 'playoffs.final_standings.recorded':
      return 'Final standings recorded'
    case 'season.completed':
      return 'Season completed'
    case 'commissioner.playoff_override':
      return 'Commissioner playoff override'
    default:
      return event.type.replace(/\./g, ' ')
  }
}

async function recordLeagueEvents(events: CanonicalLeagueRuntimeEvent[]) {
  if (!events.length) return
  try {
    await prisma.leagueEvent.createMany({
      data: events.map((event) => ({
        leagueId: event.leagueId,
        eventType: event.type,
        title: eventTitle(event),
        description: null,
        payload: event.payload as Prisma.InputJsonObject,
        visibility: 'league',
        createdAt: new Date(event.occurredAtIso),
      })),
    })
  } catch {
    // Playoff actions should not fail if local schemas lack feed rows.
  }
}

async function recordPlayoffAudit(input: {
  actorUserId: string
  action: string
  seasonId: string
  details: Record<string, unknown>
}) {
  try {
    await (prisma as any).adminAuditLog?.create({
      data: {
        adminUserId: input.actorUserId,
        action: input.action,
        targetType: 'redraft_season',
        targetId: input.seasonId,
        details: input.details,
      },
    })
  } catch {
    // Best effort for local/test runtimes.
  }
}

async function resolveSeason(input: { seasonId?: string | null; leagueId?: string | null }) {
  return prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
    include: {
      rosters: {
        orderBy: [{ playoffSeed: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }, { pointsAgainst: 'asc' }],
      },
      playoffBracket: true,
      playoffRounds: {
        orderBy: { roundNumber: 'asc' },
        include: {
          matchups: {
            orderBy: { matchupNumber: 'asc' },
          },
        },
      },
    },
  })
}

type PlayoffSeasonForRuntime = NonNullable<Awaited<ReturnType<typeof resolveSeason>>>

function fallbackRulesForSeason(season: PlayoffSeasonForRuntime): NflRedraftPlayoffRulesInput {
  const playoffStartWeek = Math.max(2, Math.floor(numberOrNull((season as { playoffStartWeek?: unknown }).playoffStartWeek) ?? 15))
  return {
    general: {
      season: numberOrNull((season as { season?: unknown }).season) ?? new Date().getFullYear(),
      sport: String((season as { sport?: unknown }).sport ?? 'NFL'),
      teamCount: Array.isArray(season.rosters) ? season.rosters.length : null,
    },
    playoffs: {
      teamCount: Math.min(6, Math.max(2, Array.isArray(season.rosters) ? season.rosters.length : 6)),
      startWeek: playoffStartWeek,
      firstRoundByes: null,
      consolationBracketEnabled: false,
      toiletBowlEnabled: false,
      thirdPlaceGameEnabled: false,
      seedingRules: 'standings',
      tiebreakerRules: ['win_pct', 'wins', 'points_for', 'points_against'],
      byeRules: 'top_seed_byes',
      reseedBehavior: null,
      standingsTiebreakers: ['win_pct', 'wins', 'points_for', 'points_against'],
    },
    schedule: {
      regularSeasonLength: playoffStartWeek - 1,
      playoffTransitionPoint: playoffStartWeek,
    },
  }
}

function toTeamInput(row: {
  id: string
  ownerId: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
  isEliminated: boolean
}): NflRedraftPlayoffTeamInput {
  return {
    rosterId: row.id,
    displayName: row.teamName ?? row.ownerName,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    playoffSeed: row.playoffSeed,
    isEliminated: row.isEliminated,
  }
}

function toMatchupInput(round: {
  id: string
  roundNumber: number
  roundName: string | null
  status: string
  matchups: Array<{
    id: string
    matchupNumber: number
    homeRosterId: string | null
    awayRosterId: string | null
    homeSeed: number | null
    awaySeed: number | null
    homeScore: number | null
    awayScore: number | null
    winnerRosterId: string | null
    nextMatchupId: string | null
    status: string
    metadata: unknown
  }>
}): NflRedraftPlayoffMatchupInput[] {
  return round.matchups.map((matchup) => ({
    matchupId: matchup.id,
    roundId: round.id,
    roundNumber:
      asRecord(matchup.metadata).bracketType === 'consolation' && round.roundNumber >= 100
        ? round.roundNumber - 100
        : round.roundNumber,
    roundName: round.roundName,
    matchupNumber: matchup.matchupNumber,
    bracketType: asRecord(matchup.metadata).bracketType as string | undefined,
    homeRosterId: matchup.homeRosterId,
    awayRosterId: matchup.awayRosterId,
    homeSeed: matchup.homeSeed,
    awaySeed: matchup.awaySeed,
    homeScore: matchup.homeScore,
    awayScore: matchup.awayScore,
    winnerRosterId: matchup.winnerRosterId,
    nextMatchupId: matchup.nextMatchupId,
    status: matchup.status,
    metadata: { ...asRecord(matchup.metadata), roundStatus: round.status },
  }))
}

/**
 * Injectable fact loaders, matching `DraftRuntimeDeps` on the draft resolver.
 *
 * 🛑 READ ENTRY POINT ONLY. `generateNflRedraftPlayoffRuntimeBracket`,
 * `advanceNflRedraftPlayoffRuntimeRound`, `finalizeNflRedraftPlayoffRuntimeSeason` and
 * `overrideNflRedraftPlayoffMatchup` all PERSIST rows derived from the ruleset, and none of them
 * gets this seam. A stale ruleset on a read is visible and short-lived; on a bracket generation it
 * is written into the database and nothing afterwards says which settings produced it.
 *
 * ⚠ NOTE THE `?? fallbackRulesForSeason(season)` BELOW. This resolver already tolerates a null
 * ruleset, so an injected loader returning null degrades exactly as the live one does — which is
 * why the feed's "null rather than throw" contract composes here without a special case.
 */
export interface PlayoffRuntimeDeps {
  loadRules: (leagueId: string) => Promise<Awaited<ReturnType<typeof resolveCanonicalLeagueRules>>>
  /** Regular-season results, read only for the `head_to_head` seeding tiebreaker. */
  loadRegularSeasonMatchups: (seasonId: string) => Promise<NflRedraftRegularSeasonMatchupInput[]>
  /** The commissioner's divisions (`League.settings.division_config`); null = no divisions. */
  loadDivisions: (leagueId: string, rosters: ReadonlyArray<{ id: string; ownerId: string }>) => Promise<SeasonRosterDivisions | null>
}

/**
 * ⚠ A failed read degrades to "no head-to-head data", which makes that tiebreaker fall through to
 * the next key (points for). It never blocks seeding: a seeding page that 500s because of a
 * tiebreaker is worse than a tie broken one key later.
 */
async function loadRegularSeasonMatchupsFromDb(seasonId: string): Promise<NflRedraftRegularSeasonMatchupInput[]> {
  try {
    const rows = await prisma.redraftMatchup.findMany({
      where: { seasonId, type: 'regular', isMedianMatchup: false },
      select: {
        week: true,
        type: true,
        homeRosterId: true,
        awayRosterId: true,
        homeScore: true,
        awayScore: true,
        status: true,
        isMedianMatchup: true,
      },
    })
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

const defaultPlayoffRuntimeDeps: PlayoffRuntimeDeps = {
  loadRules: (leagueId) => resolveCanonicalLeagueRules(leagueId),
  loadRegularSeasonMatchups: loadRegularSeasonMatchupsFromDb,
  loadDivisions: loadSeasonRosterDivisions,
}

const COUNTED_STATUSES = new Set(['final', 'completed', 'complete'])

/**
 * Each roster's division and division record, onto the team rows the runtime seeds from. Division
 * records come from the same regular-season rows head-to-head counts.
 */
export function applyDivisionsToTeams(
  teams: NflRedraftPlayoffTeamInput[],
  divisions: SeasonRosterDivisions | null,
  regularSeasonMatchups: NflRedraftRegularSeasonMatchupInput[],
): NflRedraftPlayoffTeamInput[] {
  if (!divisions || divisions.byRoster.size === 0) return teams
  const divisionOf = (rosterId: string) => divisions.byRoster.get(rosterId)?.key ?? null
  const records = divisionRecords(
    regularSeasonMatchups.filter(
      (m) => !m.isMedianMatchup && (m.type == null || String(m.type).toLowerCase() === 'regular') && COUNTED_STATUSES.has(String(m.status ?? '').toLowerCase()),
    ),
    divisionOf,
  )
  return teams.map((team) => {
    const division = divisions.byRoster.get(team.rosterId)
    if (!division) return team
    const record = records.get(team.rosterId) ?? { wins: 0, losses: 0, ties: 0 }
    return {
      ...team,
      divisionId: division.key,
      divisionName: division.name,
      divisionWins: record.wins,
      divisionLosses: record.losses,
      divisionTies: record.ties,
    }
  })
}

/** The rules, carrying the divisions rule when the league has divisions. */
function rulesWithDivisions(rules: NflRedraftPlayoffRulesInput, divisions: SeasonRosterDivisions | null): NflRedraftPlayoffRulesInput {
  if (!divisions || divisions.byRoster.size === 0) return rules
  return { ...rules, playoffs: { ...rules.playoffs, divisionPlayoffRule: divisions.playoffRule } }
}

export async function resolveNflRedraftPlayoffRuntime(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  preloadedSeason?: PlayoffSeasonForRuntime | null
  /** Generation only: read the settings as they are now, not as the existing bracket was built. */
  ignoreStoredBracketSettings?: boolean
}, deps: Partial<PlayoffRuntimeDeps> = {}): Promise<NflRedraftPlayoffRuntimeResolved> {
  const season = input.preloadedSeason ?? (await resolveSeason(input))
  if (!season) return { ok: false, reason: 'season_not_found' }

  const loadRules = deps.loadRules ?? defaultPlayoffRuntimeDeps.loadRules
  const rules = (await loadRules(season.leagueId)) ?? fallbackRulesForSeason(season)
  const general = rules.general ?? {}
  const sport = String(general.sport ?? season.sport ?? 'NFL').toUpperCase()
  const format = 'format' in general ? String((general as { format?: unknown }).format ?? 'redraft') : 'redraft'
  // Same coverage as the schedule runtime: a season the roller can advance must be able to
  // reach its bracket and champion.
  if (!runsStandardWeeklySeason(sport, format)) {
    return { ok: false, reason: 'not_nfl_redraft' }
  }

  const week = Math.max(1, Math.floor(numberOrNull(input.week) ?? season.currentWeek ?? season.playoffStartWeek ?? 1))
  const matchups = (season.playoffRounds ?? []).flatMap(toMatchupInput)
  const loadRegularSeasonMatchups = deps.loadRegularSeasonMatchups ?? defaultPlayoffRuntimeDeps.loadRegularSeasonMatchups
  const regularSeasonMatchups = await loadRegularSeasonMatchups(season.id)
  const loadDivisions = deps.loadDivisions ?? defaultPlayoffRuntimeDeps.loadDivisions
  const divisions = await loadDivisions(season.leagueId, season.rosters.map((r) => ({ id: r.id, ownerId: r.ownerId })))
  const built = buildNflRedraftPlayoffRuntimeState({
    leagueId: season.leagueId,
    seasonId: season.id,
    season: season.season,
    week,
    rules: rulesWithDivisions(rules, divisions),
    teams: applyDivisionsToTeams(season.rosters.map(toTeamInput), divisions, regularSeasonMatchups),
    matchups,
    regularSeasonMatchups,
    bracketStatus: season.playoffBracket?.status ?? null,
    bracketId: season.playoffBracket?.id ?? null,
  })
  // A generated bracket keeps the reseed choice it was generated with: flipping the setting
  // mid-playoffs must not re-pair half a bracket one way and half the other.
  const storedReseed = asRecord(season.playoffBracket?.structure).reseedAfterEachRound
  const state =
    !input.ignoreStoredBracketSettings &&
    built.bracket.generated &&
    typeof storedReseed === 'boolean' &&
    storedReseed !== built.settings.reseedAfterEachRound
      ? { ...built, settings: { ...built.settings, reseedAfterEachRound: storedReseed || built.settings.byePlan != null } }
      : built

  return {
    ok: true,
    state,
    regularSeasonMatchups,
    season: {
      id: season.id,
      leagueId: season.leagueId,
      sport: season.sport,
      season: season.season,
      currentWeek: season.currentWeek,
      status: season.status,
    },
  }
}

export function rulesWithPlayoffTeamOverride(
  state: NflRedraftPlayoffRuntimeState,
  playoffTeams: number,
): NflRedraftPlayoffRulesInput {
  return {
    general: {
      season: state.season,
      sport: 'NFL',
      teamCount: state.teams.length,
    },
    playoffs: {
      teamCount: playoffTeams,
      startWeek: state.settings.playoffStartWeek,
      firstRoundByes: state.settings.firstRoundByes,
      totalRounds: state.settings.roundCount,
      consolationBracketEnabled: state.settings.consolationEnabled,
      toiletBowlEnabled: state.settings.toiletBowlEnabled,
      thirdPlaceGameEnabled: state.settings.thirdPlaceGameEnabled,
      // Carry an explicit points-only choice through; 'standings' here would re-seed it by record.
      seedingRules: state.settings.pointsOnlySeeding
        ? 'points_only'
        : state.settings.divisionWinnersEnabled
          ? 'division_winners_then_standings'
          : 'standings',
      divisionPlayoffRule: state.settings.divisionWinnersEnabled
        ? state.settings.divisionWinnersTopSeeds
          ? 'top_seeds'
          : 'guaranteed'
        : 'none',
      tiebreakerRules: state.settings.tiebreakers,
      byeRules: state.settings.firstRoundByes > 0 ? 'top_seed_byes' : null,
      reseedBehavior: state.settings.reseedAfterEachRound ? 'reseed_after_each_round' : null,
      standingsTiebreakers: state.settings.tiebreakers,
      byePlan: state.settings.byePlan,
      // Without this the override would re-run the legacy head-to-head-before-points reorder on it.
      customTiebreakers: state.settings.customTiebreakers ?? null,
      seriesLengths: state.settings.seriesLengths ?? null,
    },
    schedule: {
      regularSeasonLength: state.settings.regularSeasonEndWeek,
      playoffTransitionPoint: state.settings.playoffStartWeek,
    },
  }
}

export async function generateNflRedraftPlayoffRuntimeBracket(input: {
  seasonId: string
  playoffTeams?: number | null
  regenerate?: boolean
  actorUserId?: string | null
  lockBracket?: boolean
  preloadedSeason?: PlayoffSeasonForRuntime | null
}) {
  const resolved = await resolveNflRedraftPlayoffRuntime({
    seasonId: input.seasonId,
    preloadedSeason: input.preloadedSeason,
    ignoreStoredBracketSettings: true,
  })
  if (!resolved.ok) throw new Error(resolved.reason)
  const state =
    input.playoffTeams != null
      ? buildNflRedraftPlayoffRuntimeState({
          leagueId: resolved.state.leagueId,
          seasonId: resolved.state.seasonId,
          season: resolved.state.season,
          week: resolved.state.week,
          rules: rulesWithPlayoffTeamOverride(resolved.state, input.playoffTeams),
          teams: resolved.state.teams,
          regularSeasonMatchups: resolved.regularSeasonMatchups,
        })
      : resolved.state
  const generated = generateNflRedraftPlayoffBracket({
    state,
    actorUserId: input.actorUserId,
    lockBracket: input.lockBracket,
  })

  const structure = {
    playoffTeams: state.settings.playoffTeamCount,
    bracketSize: state.settings.bracketSize,
    byes: state.settings.firstRoundByes,
    rounds: state.settings.roundCount,
    reseedAfterEachRound: state.settings.reseedAfterEachRound,
    byePlan: state.settings.byePlan,
    consolationEnabled: state.settings.consolationEnabled,
    lowerBracket: generated.bracket.lowerBracket,
    thirdPlaceGame: generated.bracket.thirdPlaceMatchup != null,
    generatedAt: new Date().toISOString(),
  }
  const written = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (input.regenerate !== false) {
      await tx.redraftPlayoffMatchup.deleteMany({ where: { seasonId: state.seasonId } })
      await tx.redraftPlayoffRound.deleteMany({ where: { seasonId: state.seasonId } })
      await tx.redraftPlayoffSeed.deleteMany({ where: { seasonId: state.seasonId } })
    }

    const bracket = await tx.redraftPlayoffBracket.upsert({
      where: { seasonId: state.seasonId },
      update: {
        status: generated.bracket.status === 'locked' ? 'locked' : 'active',
        structure,
      },
      create: {
        seasonId: state.seasonId,
        status: generated.bracket.status === 'locked' ? 'locked' : 'active',
        structure,
      },
    })

    await tx.redraftPlayoffSeed.createMany({
      data: state.seeds.map((seed) => ({
        id: crypto.randomUUID(),
        seasonId: state.seasonId,
        rosterId: seed.rosterId,
        seed: seed.seed,
        qualifiedBy: seed.qualifiedBy,
        pointsFor: seed.pointsFor,
      })),
    })

    const seedByRosterId = new Map(state.seeds.map((seed) => [seed.rosterId, seed.seed]))
    for (const team of state.teams) {
      await (tx as Prisma.TransactionClient & { redraftRoster?: Prisma.TransactionClient['redraftRoster'] }).redraftRoster?.update({
        where: { id: team.rosterId },
        data: {
          playoffSeed: seedByRosterId.get(team.rosterId) ?? null,
          isEliminated: !seedByRosterId.has(team.rosterId),
        },
      })
    }

    const roundIdByRuntimeId = new Map<string, string>()
    for (const round of [...generated.bracket.rounds, ...generated.bracket.consolationRounds]) {
      const id = crypto.randomUUID()
      roundIdByRuntimeId.set(round.roundId, id)
      await tx.redraftPlayoffRound.create({
        data: {
          id,
          seasonId: state.seasonId,
          bracketId: bracket.id,
          roundNumber: round.bracketType === 'consolation' ? CONSOLATION_ROUND_OFFSET + round.roundNumber : round.roundNumber,
          roundName: round.roundName,
          status: round.status,
        },
      })
    }

    // The third-place game is a matchup of the championship round's row, played in the final's weeks.
    const thirdPlace = generated.bracket.thirdPlaceMatchup
    const finalRound = generated.bracket.rounds[generated.bracket.rounds.length - 1]
    const roundsToWrite = [
      ...generated.bracket.rounds.map((round) =>
        round === finalRound && thirdPlace ? { ...round, matchups: [...round.matchups, thirdPlace] } : round,
      ),
      ...generated.bracket.consolationRounds,
    ]
    const matchupIdByRuntimeId = new Map<string, string>()
    for (const round of roundsToWrite) {
      for (const matchup of round.matchups) {
        matchupIdByRuntimeId.set(matchup.matchupId, crypto.randomUUID())
      }
    }

    for (const round of roundsToWrite) {
      const roundId = roundIdByRuntimeId.get(round.roundId)
      if (!roundId) continue
      for (const matchup of round.matchups) {
        await tx.redraftPlayoffMatchup.create({
          data: {
            id: matchupIdByRuntimeId.get(matchup.matchupId) ?? crypto.randomUUID(),
            seasonId: state.seasonId,
            roundId,
            matchupNumber: matchup.matchupNumber,
            homeRosterId: matchup.homeRosterId,
            awayRosterId: matchup.awayRosterId,
            homeSeed: matchup.homeSeed,
            awaySeed: matchup.awaySeed,
            winnerRosterId: matchup.winnerRosterId,
            status: matchup.status,
            // The matchup's own type: the third-place game sits in a championship round.
            metadata: { ...matchup.metadata, bracketType: matchup.bracketType },
          },
        })
      }
    }

    for (const round of [...generated.bracket.rounds, ...generated.bracket.consolationRounds]) {
      for (const matchup of round.matchups) {
        if (!matchup.nextMatchupId) continue
        const id = matchupIdByRuntimeId.get(matchup.matchupId)
        const nextId = matchupIdByRuntimeId.get(matchup.nextMatchupId)
        if (!id || !nextId) continue
        await tx.redraftPlayoffMatchup.update({
          where: { id },
          data: { nextMatchupId: nextId },
        })
      }
    }

    await (tx as Prisma.TransactionClient & { redraftSeason?: Prisma.TransactionClient['redraftSeason'] }).redraftSeason?.update({
      where: { id: state.seasonId },
      data: { status: 'playoffs', currentWeek: Math.max(state.week, state.settings.playoffStartWeek) },
    })
    await (tx as Prisma.TransactionClient & { league?: Prisma.TransactionClient['league'] }).league?.update({
      where: { id: state.leagueId },
      data: { lifecycleState: 'playoffs' },
    }).catch(() => null)

    return tx.redraftPlayoffRound.findMany({
      where: { seasonId: state.seasonId },
      include: { matchups: { orderBy: { matchupNumber: 'asc' } } },
      orderBy: { roundNumber: 'asc' },
    })
  })

  await recordLeagueEvents(generated.events)
  await recordPlayoffAudit({
    actorUserId: input.actorUserId ?? 'system',
    action: 'redraft_playoff_bracket_generated',
    seasonId: state.seasonId,
    details: { playoffTeams: state.settings.playoffTeamCount, bracketSize: state.settings.bracketSize },
  })
  const refreshed = await resolveNflRedraftPlayoffRuntime({ seasonId: state.seasonId, week: state.week })
  return {
    state: refreshed.ok ? refreshed.state : state,
    bracket: refreshed.ok ? refreshed.state.bracket : generated.bracket,
    rounds: written,
    events: generated.events,
    summary: {
      playoffTeams: state.settings.playoffTeamCount,
      bracketSize: state.settings.bracketSize,
      byes: state.settings.firstRoundByes,
      rounds: state.settings.roundCount,
    },
  }
}

export async function advanceNflRedraftPlayoffRuntimeRound(input: {
  seasonId: string
  week?: number | null
  actorUserId?: string | null
}) {
  const resolved = await resolveNflRedraftPlayoffRuntime({ seasonId: input.seasonId, week: input.week })
  if (!resolved.ok) throw new Error(resolved.reason)
  const result = advanceNflRedraftPlayoffRound({ state: resolved.state, actorUserId: input.actorUserId })
  if (!result.ok) return result

  const allRounds = [...result.state.bracket.rounds, ...result.state.bracket.consolationRounds]
  const allMatchups = [
    ...allRounds.flatMap((round) => round.matchups),
    ...(result.state.bracket.thirdPlaceMatchup ? [result.state.bracket.thirdPlaceMatchup] : []),
  ]
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const matchup of allMatchups) {
      await tx.redraftPlayoffMatchup.update({
        where: { id: matchup.matchupId },
        data: {
          homeRosterId: matchup.homeRosterId,
          awayRosterId: matchup.awayRosterId,
          homeSeed: matchup.homeSeed,
          awaySeed: matchup.awaySeed,
          winnerRosterId: matchup.winnerRosterId,
          status: matchup.status,
          metadata: matchup.metadata as Prisma.InputJsonObject,
        },
      }).catch(() => null)
    }
    for (const round of allRounds) {
      await tx.redraftPlayoffRound.update({
        where: { id: round.roundId },
        data: { status: round.status },
      }).catch(() => null)
    }
    for (const rosterId of result.eliminatedRosterIds) {
      await tx.redraftRoster.update({ where: { id: rosterId }, data: { isEliminated: true } }).catch(() => null)
    }
  })

  await recordLeagueEvents(result.events)
  return result
}

export async function finalizeNflRedraftPlayoffRuntimeSeason(input: {
  seasonId: string
  actorUserId: string
}) {
  const resolved = await resolveNflRedraftPlayoffRuntime({ seasonId: input.seasonId })
  if (!resolved.ok) throw new Error(resolved.reason)
  if (resolved.season.status === 'complete') {
    return {
      ok: true as const,
      state: resolved.state,
      championRosterId: resolved.state.bracket.championRosterId,
      runnerUpRosterId: resolved.state.bracket.runnerUpRosterId,
      finalStandings: resolved.state.bracket.finalStandings,
      events: [],
      alreadyFinalized: true as const,
    }
  }
  const result = finalizeNflRedraftPlayoffChampion({ state: resolved.state, actorUserId: input.actorUserId })
  if (!result.ok) return result

  const champion = resolved.state.teams.find((team) => team.rosterId === result.championRosterId)
  const championStanding = result.finalStandings.find((row) => row.rosterId === result.championRosterId)
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.leagueChampionship.upsert({
      where: { leagueId_season: { leagueId: resolved.state.leagueId, season: resolved.state.season } },
      create: {
        leagueId: resolved.state.leagueId,
        season: resolved.state.season,
        championUserId: champion?.ownerId ?? result.championRosterId,
        teamName: champion?.displayName ?? null,
        pointsFor: champion?.pointsFor ?? null,
        playoffRecord: championStanding ? `${championStanding.playoffWins}-${championStanding.playoffLosses}` : null,
        recordedBy: input.actorUserId,
      },
      update: {
        championUserId: champion?.ownerId ?? result.championRosterId,
        teamName: champion?.displayName ?? null,
        pointsFor: champion?.pointsFor ?? null,
        playoffRecord: championStanding ? `${championStanding.playoffWins}-${championStanding.playoffLosses}` : null,
        recordedBy: input.actorUserId,
      },
    })
    await tx.redraftSeason.update({
      where: { id: resolved.state.seasonId },
      data: { status: 'complete' },
    })
    const currentBracket = await tx.redraftPlayoffBracket.findUnique({
      where: { seasonId: resolved.state.seasonId },
      select: { structure: true },
    })
    await tx.redraftPlayoffBracket.update({
      where: { seasonId: resolved.state.seasonId },
      data: {
        status: 'complete',
        structure: {
          ...asRecord(currentBracket?.structure),
          finalStandings: result.finalStandings as unknown as Prisma.InputJsonValue,
          championRosterId: result.championRosterId,
          runnerUpRosterId: result.runnerUpRosterId,
          thirdPlaceRosterId: result.state.bracket.thirdPlaceRosterId,
          lowerBracket: result.state.bracket.lowerBracket,
          lowerBracketResultRosterId: result.state.bracket.lowerBracketResultRosterId,
        },
      },
    }).catch(() => null)
    await tx.league.update({
      where: { id: resolved.state.leagueId },
      data: { lifecycleState: 'completed' },
    }).catch(() => null)
    await tx.redraftRoster.update({
      where: { id: result.championRosterId },
      data: { isEliminated: false },
    }).catch(() => null)
  })

  await recordLeagueEvents(result.events)
  await recordPlayoffAudit({
    actorUserId: input.actorUserId,
    action: 'redraft_playoff_champion_finalized',
    seasonId: resolved.state.seasonId,
    details: { championRosterId: result.championRosterId, runnerUpRosterId: result.runnerUpRosterId },
  })
  return result
}

export async function overrideNflRedraftPlayoffMatchup(input: {
  seasonId: string
  matchupId: string
  winnerRosterId: string
  actorUserId: string
  reason?: string | null
}) {
  const resolved = await resolveNflRedraftPlayoffRuntime({ seasonId: input.seasonId })
  if (!resolved.ok) throw new Error(resolved.reason)
  const bracket = resolved.state.bracket
  const matchup = [
    ...bracket.rounds.flatMap((round) => round.matchups),
    ...(bracket.thirdPlaceMatchup ? [bracket.thirdPlaceMatchup] : []),
    ...bracket.consolationRounds.flatMap((round) => round.matchups),
  ].find((row) => row.matchupId === input.matchupId)
  if (!matchup) throw new Error('matchup_not_found')
  const validRosterIds = [matchup.homeRosterId, matchup.awayRosterId].filter((id): id is string => Boolean(id))
  if (!validRosterIds.includes(input.winnerRosterId)) throw new Error('winner_not_in_matchup')
  const loserRosterId = validRosterIds.find((id) => id !== input.winnerRosterId) ?? null
  await prisma.redraftPlayoffMatchup.update({
    where: { id: input.matchupId },
    data: {
      winnerRosterId: input.winnerRosterId,
      status: matchup.status === 'bye' ? 'bye' : 'final',
      metadata: { ...matchup.metadata, commissionerOverride: true, overrideReason: input.reason ?? null },
    },
  })
  const event = buildPlayoffRuntimeEvent({
    leagueId: resolved.state.leagueId,
    type: 'commissioner.playoff_override',
    actorUserId: input.actorUserId,
    payload: {
      seasonId: input.seasonId,
      matchupId: input.matchupId,
      winnerRosterId: input.winnerRosterId,
      loserRosterId,
      reason: input.reason ?? null,
    },
  })
  await recordLeagueEvents([event])
  await recordPlayoffAudit({
    actorUserId: input.actorUserId,
    action: 'redraft_playoff_commissioner_override',
    seasonId: input.seasonId,
    details: { matchupId: input.matchupId, winnerRosterId: input.winnerRosterId, reason: input.reason ?? null },
  })
  return { ok: true as const, event }
}
