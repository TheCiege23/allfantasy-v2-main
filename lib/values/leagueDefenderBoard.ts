import type { PrismaClient } from '@prisma/client'

import { findMyRoster, rosterPlayerIds } from '@/lib/core-app/myRoster'
import { isIdpPosition, shortIdpPosition } from '@/lib/core-app/scoringNotes'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { loadLeagueIdpVorp } from '@/lib/idp-projections/leagueIdpVorp'
import {
  resolveLeagueKickerValue,
  type LeagueKickerValue,
} from '@/lib/kicker-values/leagueKickerValue'
import { isKickerPositionLoose } from '@/lib/league-values/leagueTradeValues'

/**
 * What every defender in the league is worth, and who holds him.
 *
 * 🛑 THIS EXISTS BECAUSE THE DEFENSE HUB DELIBERATELY SHOWS YOU ONLY YOUR OWN PLAYERS.
 * `loadDefenseHub` prices the WHOLE league — it has to, because replacement level is a property
 * of the league rather than of your team — and then renders `myDefenders` alone. Its own comment
 * says so: "the whole league is priced, and only the caller's players are rendered."
 *
 * That is right for a roster screen and wrong for the question a manager actually asks before
 * sending a trade: *what should I offer for HIS linebacker?* The values were already computed
 * and then thrown away. This module keeps them.
 *
 * ⚠ IT ADDS NO NEW VALUATION AND MUST NOT. Every number here comes from `loadLeagueIdpVorp` and
 * `resolveLeagueKickerValue`, unchanged. A second way to price a defender is exactly the
 * duplicate-board failure that `app/api/devy/board` turned out to be, and the whole point of the
 * IDP stack is that there is ONE board per league. What is new is the JOIN — value to owner —
 * and the fact that nothing is filtered out.
 *
 * ⚠ THE BOARD IS RANKED ACROSS ALL THREE GROUPS AT ONCE, matching `loadLeagueIdpVorp`. Value
 * over replacement is already measured against each position's own replacement level, which is
 * what makes a linebacker and a lineman comparable. Re-ranking within a group here would hand
 * three players the top price and undo that.
 */

/** Where a defender's number sits relative to the rest of the league's. */
export interface DefenderBoardRow {
  sleeperId: string
  name: string
  /** Normalised NFL team abbreviation, or null when no row carried one. */
  team: string | null
  /** Short IDP label — LB / DL / DB — as the board resolved it. */
  position: string | null
  /**
   * Market-unit value in THIS league. Null — never 0 — when replacement level could not be
   * established for him, because pricing a data gap as the cheapest defender in the league is
   * the failure the whole IDP stack refuses.
   */
  value: number | null
  /** Points per game above the best freely available player at his position. */
  vorp: number | null
  /**
   * The league-scored projection the value was built from, in points. Null — never zero — for a
   * defender this league's scoring could not price.
   *
   * Carried rather than recomputed: `loadLeagueIdpVorp` already scores every defender against
   * the league's own settings to build the board, and a surface that scored them a second time
   * could disagree with the values sitting beside it on the same screen.
   */
  projectedPoints: number | null
  /** Rank among his own group, for reading. Does NOT set the price. */
  positionRank: number | null
  /**
   * True when `value` is the board's own floor rather than a separately measured price. The
   * defense hub carries the same flag for the same reason: a floor is a statement about the
   * bottom of the curve, not about him.
   */
  valueIsFloor: boolean
  /** Who holds him, so the manager knows who to ask. */
  ownedBy: {
    teamName: string | null
    ownerName: string | null
    /** True when this is the caller's own player. */
    isMine: boolean
  }
}

export type DefenderBoardState =
  | 'ok'
  | 'not_idp_league'
  | 'no_scoring_settings'
  | 'no_projection_history'
  | 'valuation_refused'
  | 'no_league'
  | 'no_rostered_defenders'

export interface LeagueDefenderBoard {
  state: DefenderBoardState
  /**
   * Which week the projections behind these values are FOR, resolved from the data rather than
   * a clock — the ingest runs on its own schedule and the offseason stalls it entirely.
   *
   * ⚠ A SURFACE RENDERING THESE VALUES HAS TO SHOW THIS. `loadLeagueIdpVorp` returns it for that
   * reason: a number as specific as "4,180" invites the reader to assume it is current, and in
   * the offseason it is a projection for a week that has not been played in months.
   */
  projectedFor: { season: number; week: number } | null
  /** Richest first. Unpriced defenders sort last rather than as the cheapest. */
  rows: DefenderBoardRow[]
  /**
   * What ANY kicker in this league is worth. One number by design — see
   * `lib/kicker-values/leagueKickerValue.ts`. Null when the league starts no kicker, in which
   * case a kicker is not an asset here and quoting a price would invent a market.
   */
  kickerValue: LeagueKickerValue | null
  /** Kickers rostered anywhere in the league, so a manager can see who holds one. */
  kickers: Array<{
    sleeperId: string
    name: string
    team: string | null
    ownedBy: { teamName: string | null; ownerName: string | null; isMine: boolean }
  }>
  coverage: { defenders: number; projected: number; priced: number }
  /** True statements about what is missing, never placeholders. */
  notes: string[]
}

const EMPTY = (state: DefenderBoardState, notes: string[] = []): LeagueDefenderBoard => ({
  state,
  projectedFor: null,
  rows: [],
  kickerValue: null,
  kickers: [],
  coverage: { defenders: 0, projected: 0, priced: 0 },
  notes,
})

const CROSS_GROUP_NOTE =
  'Linebackers, linemen and defensive backs are ranked on one board. Value over replacement is ' +
  'already measured against each position’s own replacement level, which is what makes them ' +
  'comparable; ranking inside each group would price three different players at the ceiling.'

const KICKER_NOTE =
  'Every kicker in this league is worth the same, on purpose. Over 4,482 kicker games from ' +
  '2019-2025 kicker rank does not carry year to year — the correlation is negative in all six ' +
  'measured season pairs — and the startable population spans only 1.55x.'

const LEAGUE_SPECIFIC_NOTE =
  'These values are specific to THIS league. They come from its scoring settings and its ' +
  'starting slots, not from a market — no vendor prices individual defenders — so they are not ' +
  'comparable with a defender’s price in another league.'

function extractRosterPositions(settings: unknown): string[] | null {
  const s = (settings ?? {}) as Record<string, unknown>
  const raw = (s.roster_positions ?? s.rosterPositions ?? null) as unknown
  return Array.isArray(raw) ? raw.map((x) => String(x).toUpperCase()) : null
}

export interface LoadLeagueDefenderBoardArgs {
  prisma: PrismaClient
  /** Either id space — `League.id` uuid or the platform's own league id. */
  leagueId: string
  /** The signed-in user, used only to mark which rows are already his. */
  userId: string
}

export async function loadLeagueDefenderBoard(
  args: LoadLeagueDefenderBoardArgs,
): Promise<LeagueDefenderBoard> {
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

  if (!league) return EMPTY('no_league')

  const rosterPositions = extractRosterPositions(league.settings)

  const rosters = await args.prisma.roster
    .findMany({
      where: { leagueId: league.id },
      select: { platformUserId: true, playerData: true },
    })
    .catch(() => [] as Array<{ platformUserId: string; playerData: unknown }>)

  if (rosters.length === 0) return EMPTY('no_rostered_defenders')

  /*
   * Owner display names. `Roster` carries only `platformUserId`; the readable team and owner
   * names live on `LeagueTeam`, joined on that id — the same join `roster-context-loader` uses
   * for the trade console's opponent picker.
   */
  const teams = await args.prisma.leagueTeam
    .findMany({
      where: { leagueId: league.id },
      select: { platformUserId: true, teamName: true, ownerName: true },
    })
    .catch(() => [] as Array<{ platformUserId: string | null; teamName: string; ownerName: string }>)

  const teamByPlatformUser = new Map<string, { teamName: string | null; ownerName: string | null }>()
  for (const t of teams) {
    if (!t.platformUserId) continue
    teamByPlatformUser.set(t.platformUserId, { teamName: t.teamName, ownerName: t.ownerName })
  }

  /*
   * ⚠ THE CALLER'S OWN ROSTER IS RESOLVED THROUGH THE CLAIMED-TEAM CHAIN, not by matching the
   * user id against `Roster.platformUserId` — see myRoster.ts for why that shortcut renders an
   * empty screen for most of the people it is built for. A caller with no roster is NOT an
   * error here: the board is still worth reading, every row simply reports `isMine: false`.
   */
  const mine = await findMyRoster(args.prisma, league.id, args.userId).catch(() => null)
  const myIdSet = new Set<string>(
    mine && mine.found ? rosterPlayerIds(mine.playerData) : [],
  )

  /* Every rostered player in the league, and who holds each one. */
  const ownerByPlayerId = new Map<string, string>()
  const leagueIds = new Set<string>()
  for (const r of rosters) {
    for (const id of rosterPlayerIds(r.playerData)) {
      leagueIds.add(id)
      if (!ownerByPlayerId.has(id)) ownerByPlayerId.set(id, r.platformUserId)
    }
  }
  if (leagueIds.size === 0) return EMPTY('no_rostered_defenders')

  const vorp = await loadLeagueIdpVorp({
    prisma: args.prisma,
    leagueId: league.id,
    rosterPositions,
    rosterPlayerIds: [...leagueIds],
    numTeams: Math.max(rosters.length, 1),
  })

  if (vorp.skipped === 'not_an_idp_league') return EMPTY('not_idp_league')
  if (vorp.skipped === 'no_scoring_settings') return EMPTY('no_scoring_settings')
  if (vorp.skipped === 'no_projection_history') return EMPTY('no_projection_history')
  if (vorp.skipped === 'valuation_refused') return EMPTY('valuation_refused')

  /*
   * ⚠ RESOLVED OVER THE WHOLE LEAGUE, NOT `myIds` — that single-word difference is this module.
   * `SportsPlayer` carries duplicate rows per Sleeper id (571 ids resolved to 1,329 rows when
   * measured), so a row carrying a position and a team is preferred over a bare stub rather
   * than letting the planner pick a duplicate.
   */
  const allIds = [...leagueIds]
  const rows = await args.prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: allIds } },
      select: { sleeperId: true, name: true, team: true, position: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(
      () =>
        [] as Array<{
          sleeperId: string | null
          name: string
          team: string | null
          position: string | null
        }>,
    )

  const best = new Map<string, { name: string; team: string | null; position: string | null }>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const existing = best.get(r.sleeperId)
    const better = !existing || (!existing.position && r.position) || (!existing.team && r.team)
    if (better) best.set(r.sleeperId, { name: r.name, team: r.team, position: r.position })
  }

  const ownerFor = (sleeperId: string) => {
    const platformUserId = ownerByPlayerId.get(sleeperId) ?? null
    const t = platformUserId ? teamByPlatformUser.get(platformUserId) ?? null : null
    return {
      teamName: t?.teamName ?? null,
      ownerName: t?.ownerName ?? null,
      isMine: myIdSet.has(sleeperId),
    }
  }

  const allValues = [...vorp.valueBySleeperId.values()]
  const boardFloor = allValues.length > 0 ? Math.min(...allValues) : null

  const board: DefenderBoardRow[] = []
  for (const id of allIds) {
    const info = best.get(id)
    if (!info || !isIdpPosition(info.position)) continue
    const value = vorp.valueBySleeperId.get(id) ?? null
    board.push({
      sleeperId: id,
      name: info.name,
      team: info.team ? normalizeTeamAbbrev(info.team) ?? info.team : null,
      position: shortIdpPosition(info.position),
      value,
      vorp: vorp.vorpBySleeperId.get(id) ?? null,
      projectedPoints: vorp.projectionBySleeperId.get(id) ?? null,
      positionRank: vorp.positionRankBySleeperId.get(id) ?? null,
      valueIsFloor: boardFloor != null && value === boardFloor,
      ownedBy: ownerFor(id),
    })
  }

  /*
   * ⚠ UNPRICED DEFENDERS SORT LAST, NOT CHEAPEST. A null value means replacement level could not
   * be established for him — it is an absence of information, and letting it fall to the bottom
   * of a descending numeric sort would render it as "worth least in the league".
   */
  board.sort((a, b) => {
    if (a.value == null && b.value == null) return a.name.localeCompare(b.name)
    if (a.value == null) return 1
    if (b.value == null) return -1
    return b.value - a.value
  })

  const kickerValue = resolveLeagueKickerValue({
    rosterPositions,
    numTeams: Math.max(rosters.length, 1),
    isDynasty: String(league.leagueType ?? '').toLowerCase() !== 'redraft',
  })

  const kickers =
    kickerValue.value == null
      ? []
      : allIds
          .map((id) => ({ id, info: best.get(id) }))
          .filter((x) => x.info && isKickerPositionLoose(x.info.position))
          .map((x) => ({
            sleeperId: x.id,
            name: x.info!.name,
            team: x.info!.team ? normalizeTeamAbbrev(x.info!.team) ?? x.info!.team : null,
            ownedBy: ownerFor(x.id),
          }))

  const notes = [LEAGUE_SPECIFIC_NOTE, CROSS_GROUP_NOTE]
  if (kickerValue.value != null) notes.push(KICKER_NOTE)

  const unpriced = board.filter((r) => r.value == null).length
  if (unpriced > 0) {
    notes.push(
      `${unpriced} ${unpriced === 1 ? 'defender is' : 'defenders are'} shown without a value: ` +
        'replacement level could not be established for them, which is different from being ' +
        'worth nothing.',
    )
  }

  return {
    state: 'ok',
    projectedFor: vorp.projectedFor,
    rows: board,
    kickerValue: kickerValue.value == null ? null : kickerValue,
    kickers,
    coverage: vorp.coverage,
    notes,
  }
}
