import type { PrismaClient } from '@prisma/client'

import { findMyRoster, rosterPlayerIds } from '@/lib/core-app/myRoster'
import { isIdpPosition } from '@/lib/core-app/scoringNotes'
import { loadSnapShares, type SnapShareOutcome } from '@/lib/core-app/snapShare'

import { loadActualWeeklyPoints, type ActualWeekOutcome } from './actualWeeklyPoints'
import { deriveDefenderRole, type DefenderRoleLine } from './defenderRole'
import { loadLeagueIdpVorp } from './leagueIdpVorp'
import { tendencyForTeam, type TeamDefenseTendency } from './teamTendencies'

/**
 * The Defense Hub payload — every number a manager reads about their defenders, or the reason
 * there isn't one.
 *
 * ⚠ THE PAGE THIS REPLACES WAS A MOCK, AND NOT A SUBTLE ONE. `DefenseHubClient` built its rows
 * from `const MOCK_IDS = ['def1','def2','def3']`, named the players `Defender 1..3`, took their
 * points from a hash of the id string, set snap shares to `60 + i` and called the opponents
 * `@OPP0`. Everything here is assembled from Postgres or refused.
 */

export type DefenseHubState =
  | 'ok'
  /** The league does not start defensive slots. Not a failure — this page just isn't for it. */
  | 'not_idp_league'
  | 'no_scoring_settings'
  | 'no_team_claimed'
  | 'no_roster'
  | 'no_defenders'
  | 'no_projection_history'
  | 'valuation_refused'

export interface DefenseHubDefender {
  sleeperId: string
  name: string
  team: string | null
  position: string | null
  /** League-scored projected points. Null when the scoring could not price him — never zero. */
  projection: number | null
  vorp: number | null
  positionRank: number | null
  value: number | null
  /**
   * True when `value` is the tier curve's FLOOR rather than a measured price.
   *
   * ⚠ THE CURVE SATURATES, AND THE RAW NUMBER HIDES IT. Measured on NFC Dreaming!
   * 2026-08-28: of 250 priced defenders, 121 (48.4%) sit on the floor of 88, against a median
   * of 106. Rendered as a bare number, a floor price is indistinguishable from a real one, so
   * two floor-priced defenders read as equivalent assets and invite a trade graded on the
   * difference between them. Same failure as a "C" trade grade that actually means no data.
   *
   * ⚠ THIS FLAG IS SPECIFIC TO THIS SURFACE'S VALUE SOURCE. `loadLeagueIdpVorp` prices only
   * defenders the league could rank, so its curve bottoms out; `buildIdpKickerValueMap` —
   * which waiver-intelligence and league-rankings-v2 use — does NOT saturate (measured the
   * same day: 1 of 295 at the floor, 164 distinct values). Do not copy this flag onto those.
   */
  valueIsFloor: boolean
  /** Why the numbers above are absent, when they are. Null when they are present. */
  reason: string | null
  /**
   * What he actually scored in the last completed week, under THIS league's settings.
   *
   * ⚠ NOT INTERCHANGEABLE WITH A ZERO. `no_game` is a bye, an inactive or an un-ingested week;
   * `unscored` means the league prices none of what he did. Either rendered as 0.0 tells a
   * manager his starter blanked, which is a different and much more actionable claim.
   */
  lastWeek: ActualWeekOutcome | null
}

export interface DefenseHubSnap {
  sleeperId: string
  name: string
  share: number | null
  games: number
  basis: 'offense' | 'defense' | null
  /**
   * Week-over-week movement.
   *
   * ⚠ PERMANENTLY NULL UNTIL A SECOND WEEK OF THE CURRENT SEASON EXISTS. A delta needs two
   * points from the same season; comparing the opening week against last year's finale would
   * report a trend across an offseason of roster and scheme change as though it were form.
   */
  trend: null
  reason: string | null
}

export interface DefenseHubRoleCard {
  sleeperId: string
  name: string
  lines: DefenderRoleLine[]
  games: number
}

export interface DefenseHubTendencyCard {
  team: string
  tendency: TeamDefenseTendency
}

export interface DefenseHubPayload {
  state: DefenseHubState
  /** Present only when `state` is 'ok'. */
  projectedFor: { season: number; week: number } | null
  coverage: { defenders: number; projected: number; priced: number }
  defenders: DefenseHubDefender[]
  snaps: DefenseHubSnap[]
  roles: DefenseHubRoleCard[]
  tendencies: DefenseHubTendencyCard[]
  /**
   * Things the reader would otherwise assume we simply didn't render. Each is a statement about
   * what is missing and why, not a placeholder.
   */
  notes: string[]
}

const EMPTY = (state: DefenseHubState, notes: string[] = []): DefenseHubPayload => ({
  state,
  projectedFor: null,
  coverage: { defenders: 0, projected: 0, priced: 0 },
  defenders: [],
  snaps: [],
  roles: [],
  tendencies: [],
  notes,
})

const NO_CAP_NOTE =
  'No salary, contract or cap-efficiency columns: those tables have zero rows in production, ' +
  'so there is nothing to show for any league yet.'

const TENDENCY_NOTE =
  'Opponent tendencies are facts about how a defence has been played, not a matchup grade. ' +
  'Grading them measured worse than leaving them out over 5,291 out-of-sample player-weeks.'

/**
 * The league's own starting slots.
 *
 * Only the slots are read here — the scoring settings are `loadLeagueIdpVorp`'s business, and
 * reading them in two places invites the two to disagree about whether a league is IDP at all.
 */
function extractRosterPositions(settings: unknown): string[] | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const rawSlots = (s.roster_positions ?? s.rosterPositions ?? null) as unknown
  return Array.isArray(rawSlots) ? rawSlots.map((x) => String(x).toUpperCase()) : null
}

function extractScoring(settings: unknown): Record<string, unknown> | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.scoring_settings ?? s.scoringSettings ?? null) as unknown
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

export interface LoadDefenseHubArgs {
  prisma: PrismaClient
  /** Either id space — `League.id` uuid or the platform's own league id. */
  leagueId: string
  /** The signed-in user, used to find WHICH roster in the league is theirs. */
  userId: string
}

export async function loadDefenseHub(args: LoadDefenseHubArgs): Promise<DefenseHubPayload> {
  const league =
    (await args.prisma.league
      .findUnique({
        where: { id: args.leagueId },
        select: { id: true, settings: true, leagueType: true },
      })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, settings: true, leagueType: true },
      })
      .catch(() => null))

  if (!league) return EMPTY('no_scoring_settings')

  const rosterPositions = extractRosterPositions(league.settings)

  /*
   * The caller's own roster, resolved through the claimed-team chain rather than by matching
   * the user id against `Roster.platformUserId` directly — see `myRoster.ts` for why that
   * shortcut renders an empty page to most of the people it is built for.
   */
  const mine = await findMyRoster(args.prisma, league.id, args.userId)
  if (!mine.found) return EMPTY(mine.reason)

  const myIds = rosterPlayerIds(mine.playerData)
  if (myIds.length === 0) return EMPTY('no_roster')

  /*
   * ⚠ REPLACEMENT LEVEL IS A PROPERTY OF THE LEAGUE, NOT OF YOUR TEAM. VORP asks what a
   * defender is worth ABOVE the best player his owner could get for nothing, which is decided
   * by every roster in the league and the starting requirements together. Feeding only the
   * caller's twelve defenders would measure each of them against his own bench — inflating
   * VORP on a thin roster and crushing it on a deep one, for the same player.
   *
   * So the whole league is priced, and only the caller's players are rendered.
   */
  const leagueRosters = await args.prisma.roster
    .findMany({ where: { leagueId: league.id }, select: { playerData: true } })
    .catch(() => [] as Array<{ playerData: unknown }>)

  const leagueIds = new Set<string>()
  for (const r of leagueRosters) for (const id of rosterPlayerIds(r.playerData)) leagueIds.add(id)
  for (const id of myIds) leagueIds.add(id)

  const numTeams = Math.max(leagueRosters.length, 1)

  const vorp = await loadLeagueIdpVorp({
    prisma: args.prisma,
    leagueId: league.id,
    rosterPositions,
    rosterPlayerIds: [...leagueIds],
    numTeams,
    isDynasty: (league.leagueType ?? '').toLowerCase().includes('dynasty'),
  })

  if (vorp.skipped === 'not_an_idp_league') return EMPTY('not_idp_league')
  if (vorp.skipped === 'no_scoring_settings') return EMPTY('no_scoring_settings')
  if (vorp.skipped === 'no_projection_history') return EMPTY('no_projection_history')
  if (vorp.skipped === 'valuation_refused') return EMPTY('valuation_refused')

  /*
   * `SportsPlayer` carries duplicate rows per Sleeper id — 571 rostered ids resolved to 1,329
   * rows when measured — so a row that actually carries a team and a position is preferred over
   * a bare stub rather than letting the planner decide which duplicate wins.
   */
  const rows = await args.prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: myIds } },
      select: { sleeperId: true, name: true, team: true, position: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => [] as Array<{ sleeperId: string | null; name: string; team: string | null; position: string | null }>)

  const best = new Map<string, { name: string; team: string | null; position: string | null }>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const existing = best.get(r.sleeperId)
    const better = !existing || (!existing.position && r.position) || (!existing.team && r.team)
    if (better) best.set(r.sleeperId, { name: r.name, team: r.team, position: r.position })
  }

  /*
   * ⚠ NOT EVERY ROSTER ENTRY IS A SLEEPER ID. A second importer writes name-encoded pseudo-ids
   * of the form `name:Brian Thomas Jr.:WR:JAX`, which never join to a player row. Those players
   * cannot be shown — but dropping them without saying so is how a manager comes to believe we
   * lost half his roster, so they are counted and reported.
   */
  const unresolved = myIds.filter((id) => !best.has(id)).length

  const myDefenders = myIds
    .map((id) => ({ sleeperId: id, ...(best.get(id) ?? { name: id, team: null, position: null }) }))
    .filter((p) => isIdpPosition(p.position))

  const notes = [NO_CAP_NOTE]
  if (unresolved > 0) {
    notes.push(
      `${unresolved} roster ${unresolved === 1 ? 'entry is' : 'entries are'} stored in an id ` +
        'space we cannot resolve to a player, so they are not shown here.',
    )
  }

  if (myDefenders.length === 0) return EMPTY('no_defenders', notes)

  /*
   * The last COMPLETED week, not the one being projected. `projectedFor.week` is one past the
   * newest game on file, so scoring it would return `no_game` for everybody — the fixtures have
   * not been played.
   */
  const lastCompleted = vorp.projectedFor
    ? { season: vorp.projectedFor.season, week: vorp.projectedFor.week - 1 }
    : null

  const [snapMap, logRows, actualMap] = await Promise.all([
    loadSnapShares({
      prisma: args.prisma,
      players: myDefenders.map((d) => ({ sleeperId: d.sleeperId, position: d.position })),
    }),
    args.prisma.playerGameStat
      .findMany({
        where: { sportType: 'NFL', playerId: { in: myDefenders.map((d) => d.sleeperId) } },
        select: { playerId: true, normalizedStatMap: true },
        orderBy: [{ season: 'desc' }, { weekOrRound: 'desc' }],
      })
      .catch(() => [] as Array<{ playerId: string; normalizedStatMap: unknown }>),
    lastCompleted && lastCompleted.week >= 1
      ? loadActualWeeklyPoints({
          prisma: args.prisma,
          season: lastCompleted.season,
          week: lastCompleted.week,
          playerIds: myDefenders.map((d) => d.sleeperId),
          scoring: extractScoring(league.settings),
        })
      : Promise.resolve(new Map<string, ActualWeekOutcome>()),
  ])

  const logsByPlayer = new Map<string, unknown[]>()
  for (const l of logRows) {
    const arr = logsByPlayer.get(l.playerId) ?? []
    if (arr.length >= 40) continue
    arr.push(l.normalizedStatMap)
    logsByPlayer.set(l.playerId, arr)
  }

  /*
   * The floor is a property of the WHOLE priced board, not of this manager's slice — taking
   * the minimum over `myDefenders` would call his worst defender "floor" in a roster that
   * happens to hold none.
   */
  const allValues = [...vorp.valueBySleeperId.values()]
  const boardFloor = allValues.length > 0 ? Math.min(...allValues) : null

  const defenders: DefenseHubDefender[] = myDefenders.map((d) => {
    const projection = vorp.projectionBySleeperId.get(d.sleeperId) ?? null
    const v = vorp.vorpBySleeperId.get(d.sleeperId) ?? null
    return {
      sleeperId: d.sleeperId,
      name: d.name,
      team: d.team,
      position: d.position,
      projection,
      vorp: v,
      positionRank: vorp.positionRankBySleeperId.get(d.sleeperId) ?? null,
      value: vorp.valueBySleeperId.get(d.sleeperId) ?? null,
      valueIsFloor:
        boardFloor != null && (vorp.valueBySleeperId.get(d.sleeperId) ?? null) === boardFloor,
      /*
       * The two absences are different and a manager acts on them differently: a player with no
       * scored game yet will have one, a player the league's scoring cannot price never will.
       */
      reason:
        projection == null
          ? 'no projection history yet — no scored game on file for this player'
          : v == null
            ? 'ranked, but replacement level at his position could not be established'
            : null,
      lastWeek: actualMap.get(d.sleeperId) ?? null,
    }
  })

  defenders.sort((a, b) => (b.projection ?? -1) - (a.projection ?? -1))

  const snaps: DefenseHubSnap[] = myDefenders.map((d) => {
    const s: SnapShareOutcome | undefined = snapMap.get(d.sleeperId)
    return {
      sleeperId: d.sleeperId,
      name: d.name,
      share: s?.available ? s.data.share : null,
      games: s?.available ? s.data.games : 0,
      basis: s?.available ? s.data.basis : null,
      trend: null,
      reason: s && !s.available ? s.reason : null,
    }
  })

  const roles: DefenseHubRoleCard[] = myDefenders.map((d) => {
    const derived = deriveDefenderRole(logsByPlayer.get(d.sleeperId) ?? [])
    return { sleeperId: d.sleeperId, name: d.name, lines: derived.lines, games: derived.games }
  })

  /*
   * One card per distinct team the caller has defenders on. Keyed by the defender's OWN team,
   * because the blitz and box figures describe his defence rather than the offence it faces —
   * and those are the ones that bear on his own snap-for-snap chances.
   */
  const tendencies: DefenseHubTendencyCard[] = []
  const seenTeams = new Set<string>()
  for (const d of myDefenders) {
    const key = d.team?.toUpperCase()
    if (!key || seenTeams.has(key)) continue
    seenTeams.add(key)
    const tendency = tendencyForTeam(key)
    if (tendency) tendencies.push({ team: key, tendency })
  }

  return {
    state: 'ok',
    projectedFor: vorp.projectedFor,
    coverage: vorp.coverage,
    defenders,
    snaps,
    roles,
    tendencies,
    notes: [...notes, TENDENCY_NOTE],
  }
}
