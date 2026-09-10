/**
 * DB-first reads for TRUE Max PF: historical rosters, positions, seats, and the freeze status.
 *
 * 🛑 THIS FILE FIXES AN ID-SPACE BUG SHIPPED IN THE PREVIOUS PHASE, AND THE BUG IS WORTH KEEPING
 * WRITTEN DOWN. `maxPfFreezeReads.ts` queried `prisma.weeklyMatchup.findMany({ where: { leagueId:
 * input.leagueId } })` with the AllFantasy `League.id`. **`WeeklyMatchup.leagueId` is the PLATFORM
 * (Sleeper) league id** — every existing reader passes `league.platformLeagueId`
 * (`lib/core-app/leagueStandings.ts`, `leagueSync.ts`, `matchup.ts`). The query therefore matched
 * ZERO rows, `resolveMaxPfFreezeStatus` reported `missing`, and the freeze would have been
 * permanently unavailable with nothing red anywhere.
 *
 * ⚠ IT FAILED IN THE SAFE DIRECTION — no number was fabricated — WHICH IS EXACTLY WHY IT COULD HAVE
 * SURVIVED. "The freeze is not ready yet" is a plausible thing for a league to report. It was found
 * by auditing the writer, not by any test.
 *
 * ## Three id spaces meet in this file, and none of them are interchangeable
 *
 *   `League.id`                             AllFantasy cuid          — what callers hold
 *   `League.platformLeagueId`               Sleeper league id        — what the weekly tables key on
 *   `LeagueTeam.externalId`                 Sleeper roster id, TEXT  — what a team is called there
 *   `LeaguePlayerWeeklyScore.rosterId`      Sleeper roster id, INT   — the same thing, different type
 *   `LeaguePlayerWeeklyScore.playerId`      Sleeper player id        — resolved via `SportsPlayer.sleeperId`
 *
 * ⚠ `rosterId` IS AN `Int` HERE AND `externalId` IS A `String`. Same concept, two column types, so
 * the join is `String(rosterId) === externalId` and it is done in one place. Getting it wrong makes
 * a team's roster look empty, and an empty roster scores ZERO — which in a REVERSE Max PF order is
 * the FIRST PICK. An id-space miss does not degrade this metric, it inverts it.
 *
 * ## What is genuinely reconstructible, and what is not
 *
 * ✅ HISTORICAL ROSTER MEMBERSHIP IS REAL. `ingestSleeperPlayerScores` iterates Sleeper's
 * `players_points`, which is the WHOLE roster for that matchup week — bench included — and stores
 * one row per (league, season, week, player) with `rosterId` and `isStarter`. So "who was on this
 * roster in week 6, and what did the bench score" is persisted fact, not inference. That is the
 * single thing that makes anti-tanking Max PF computable at all.
 *
 * 🛑 HISTORICAL LINEUP-SLOT CONFIGURATION IS NOT STORED. `getEffectiveLeagueRosterTemplate` resolves
 * the league's CURRENT seats; nothing versions them by week. For EFL that is harmless and is stated
 * rather than assumed — a dynasty ladder does not change its lineup mid-season, so the current
 * template is a truthful description of every regular-season week. For Survivor All-Stars it would
 * NOT be, because that format opens a WRT flex in week 7 and a SUPERFLEX in week 9. The engine takes
 * `slotsForWeek(week)` for exactly that reason; this reader returns the same seats for every week
 * and says so in `provenance.slotsAssumedStatic`.
 */

import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { composePlayerIdentities } from '@/lib/core-app/playerIdentityCompose'
import type { LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import {
  computeSeasonMaxPf,
  MAX_PF_COMPUTATION_VERSION,
  type WeeklyRosterPlayer,
  type WeeklyTeamRoster,
} from '@/lib/commissioner-os/efl/maxPfEngine'
import {
  computeRegularSeasonMaxPf,
  resolveMaxPfFreezeStatus,
  type ComputeMaxPfFreezeResult,
  type MaxPfFreezeStatus,
} from '@/lib/commissioner-os/efl/maxPfFreeze'
import { readStoredMaxPfFreeze } from '@/lib/commissioner-os/efl/freezeStore'

/**
 * Starting seats from the league's effective roster template.
 *
 * ⚠ ONLY ROWS WITH `starterCount > 0`. Bench, IR and taxi rows commonly declare "any rostered
 * position" as their allowed list, and counting them as seats would let Max PF start the entire
 * roster — a number that is not a lineup and is trivially maximal.
 */
export function starterSeatsFromTemplate(
  template: Awaited<ReturnType<typeof getEffectiveLeagueRosterTemplate>>,
): LineupSlotSpec[] {
  return template.template.slots
    .filter((s) => (s.starterCount ?? 0) > 0)
    .map((s) => ({
      slot: s.slotName,
      eligible: (s.allowedPositions ?? []).map((p) => String(p).trim().toUpperCase()),
      count: s.starterCount,
      slotOrder: s.slotOrder,
    }))
}

export type MaxPfDataProvenance = {
  /** `League.platformLeagueId` — the id the weekly tables actually key on. */
  platformLeagueId: string | null
  scoringSource: string
  lineupEligibilitySource: string
  rosterMembershipSource: string
  computationVersion: string
  /**
   * True when one seat configuration was applied to every week because the repo cannot reconstruct
   * per-week configuration. Always true today.
   */
  slotsAssumedStatic: boolean
  /** `LeaguePlayerWeeklyScore.rosterId` values that matched no `LeagueTeam.externalId`. */
  unmatchedRosterIds: string[]
  /** Sleeper player ids with no `SportsPlayer` row, so no position and therefore no seat. */
  unresolvedPlayerIds: string[]
  weeksWithNoData: number[]
  /** True when the league is IDP and the template carries defensive seats. */
  idpEnabled: boolean
}

export type ReadMaxPfFreezeResult = MaxPfFreezeStatus & {
  provenance: MaxPfDataProvenance
}

export type ReadMaxPfInput = {
  /** AllFantasy `League.id`. Translated to `platformLeagueId` inside. */
  leagueId: string
  season: number
  /** REGULAR_SEASON_COMPLETE for this league, as a week number. Never defaulted to 14 here. */
  regularSeasonFinalWeek: number
}

/**
 * Compute the season's TRUE Max PF and report the freeze status.
 *
 * Returns `frozen`/`corrected` when a durable snapshot exists, `ready` when it is computable but
 * nothing is stored, and `missing` when it is not computable.
 */
export async function readMaxPfFreezeStatus(input: ReadMaxPfInput): Promise<ReadMaxPfFreezeResult> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, platformLeagueId: true },
  })

  const emptyProvenance: MaxPfDataProvenance = {
    platformLeagueId: league?.platformLeagueId ?? null,
    scoringSource: 'LeaguePlayerWeeklyScore.points (as the source platform scored it)',
    lineupEligibilitySource: 'getEffectiveLeagueRosterTemplate (current configuration)',
    rosterMembershipSource: 'LeaguePlayerWeeklyScore.rosterId per week',
    computationVersion: MAX_PF_COMPUTATION_VERSION,
    slotsAssumedStatic: true,
    unmatchedRosterIds: [],
    unresolvedPlayerIds: [],
    weeksWithNoData: [],
    idpEnabled: false,
  }

  if (!league?.platformLeagueId) {
    return {
      ...resolveMaxPfFreezeStatus({ stored: null, computed: null }),
      provenance: emptyProvenance,
    }
  }

  const [teams, template, weeklyScores] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: league.id, isOrphan: false },
      select: { id: true, externalId: true },
    }),
    getEffectiveLeagueRosterTemplate(league.id),
    prisma.leaguePlayerWeeklyScore.findMany({
      where: {
        /* 🛑 PLATFORM id, not `League.id`. This is the line the previous phase got wrong. */
        leagueId: league.platformLeagueId,
        seasonYear: input.season,
        week: { lte: input.regularSeasonFinalWeek },
      },
      select: { playerId: true, week: true, points: true, isStarter: true, rosterId: true },
    }),
  ])

  const seats = starterSeatsFromTemplate(template)
  const teamIdByExternal = new Map(teams.map((t) => [t.externalId, t.id]))
  const teamIds = teams.map((t) => t.id)

  /*
   * ⚠ `sleeperId` IS NOT UNIQUE IN `SportsPlayer` AND THE DUPLICATES ARE NOT COPIES.
   * `composePlayerIdentities` holds that measurement — taking the first row arbitrarily is what
   * rendered three players as grey letters on the matchup screen. Reused rather than re-solved.
   */
  const sleeperIds = [...new Set(weeklyScores.map((r) => r.playerId))]
  const identityRows = sleeperIds.length
    ? await prisma.sportsPlayer.findMany({
        where: { sleeperId: { in: sleeperIds } },
        select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
      })
    : []
  const identityBy = composePlayerIdentities(identityRows)

  const unmatchedRosterIds = new Set<string>()
  const unresolvedPlayerIds = new Set<string>()

  /** week -> teamId -> players */
  const byWeek = new Map<number, Map<string, WeeklyRosterPlayer[]>>()

  for (const row of weeklyScores) {
    if (row.rosterId == null) {
      /*
       * ⚠ A NULL `rosterId` MEANS THE PROVIDER DID NOT SAY WHOSE PLAYER THIS WAS. It cannot be
       * assigned to anyone, and guessing would move points between teams. Counted as unresolved.
       */
      unresolvedPlayerIds.add(row.playerId)
      continue
    }
    const teamId = teamIdByExternal.get(String(row.rosterId))
    if (!teamId) {
      unmatchedRosterIds.add(String(row.rosterId))
      continue
    }
    const identity = identityBy.get(row.playerId)
    const position = identity?.position ?? null
    if (!position) {
      /*
       * 🛑 NO POSITION MEANS NO SEAT, AND THAT IS THE HONEST HANDLING. Defaulting him to a flex
       * position would let an unidentified player into an optimal lineup on a guess, inflating the
       * one number nobody is supposed to be able to move.
       */
      unresolvedPlayerIds.add(row.playerId)
      continue
    }

    let weekMap = byWeek.get(row.week)
    if (!weekMap) {
      weekMap = new Map()
      byWeek.set(row.week, weekMap)
    }
    const list = weekMap.get(teamId) ?? []
    list.push({
      playerId: row.playerId,
      playerName: identity?.name ?? null,
      /* Multi-position players arrive as "RB/WR" from the vendor rows. */
      positions: position.split('/').map((p) => p.trim().toUpperCase()).filter(Boolean),
      points: row.points,
      wasStarter: row.isStarter,
    })
    weekMap.set(teamId, list)
  }

  const weeks = [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, teamMap]) => ({
      week,
      teams: [...teamMap.entries()].map(([teamId, players]): WeeklyTeamRoster => ({ teamId, players })),
    }))

  const season = computeSeasonMaxPf({
    regularSeasonFinalWeek: input.regularSeasonFinalWeek,
    weeks,
    /* One configuration for every week — see the header. Stated in provenance, never assumed. */
    slotsForWeek: () => seats,
  })

  const computed: ComputeMaxPfFreezeResult | null =
    teamIds.length === 0
      ? null
      : computeRegularSeasonMaxPf({
          leagueId: league.id,
          season: input.season,
          regularSeasonFinalWeek: input.regularSeasonFinalWeek,
          metric: 'optimal_lineup_max_pf',
          computationVersion: MAX_PF_COMPUTATION_VERSION,
          weeklyRows: season.weeklyValues,
          teamIds,
        })

  const stored = await readStoredMaxPfFreeze({
    leagueId: league.id,
    season: input.season,
    metric: 'optimal_lineup_max_pf',
    computationVersion: MAX_PF_COMPUTATION_VERSION,
  })

  const status = resolveMaxPfFreezeStatus({
    stored: stored?.snapshot ?? null,
    storedHasCorrection: stored?.hasCorrection ?? false,
    computed,
  })

  return {
    ...status,
    provenance: {
      ...emptyProvenance,
      unmatchedRosterIds: [...unmatchedRosterIds].sort(),
      unresolvedPlayerIds: [...unresolvedPlayerIds].sort(),
      weeksWithNoData: season.weeksWithNoData,
      idpEnabled: template.idpEnabled,
    },
  }
}
