import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isLeagueNotStarted } from './leagueNotStarted'
import {
  computeLeagueProjectedPoints,
  extractScoringSettings,
  hasScoringRules,
  NO_LEAGUE_SCORING_REASON,
} from '@/lib/projections/leagueScoring'
import { resolveCurrentWeekFrom, isScored, type WeekScoreRow } from './currentWeek'
import { leagueDisplayName } from './leagueHome'
import { importedOrphanOwnerKey } from '@/lib/league-import/importedRosterIdentity'
import { myRosterCandidates } from './myRoster'
import { latestProjectionWeek, lookupProjections, type PlayerProjection } from './playerProjections'
import { sleeperReadableRosters } from './rosterIdSpace'
import { leagueWeekFromSettings } from './seasonTimeline'
import { realManagerName, rosterLabel } from './managerName'
import { leagueWeekProgress } from './leagueWeekProgress'
import { loadFinishedNflWeeks } from './finishedNflWeeks'
import { starterGameStates, type StarterGameState } from './matchupGameState'
import { eliminationFormat } from './railMatchupMode'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { EMPTY_SLOT, forecastMatchup, type ForecastSide } from './matchupForecast'
import { loadUnavailableBySport } from './unavailableStarters'
import { isBestBallSettings } from './lineupMode'

/**
 * Matchup pulse — the cross-league landing at `/core/matchup`.
 *
 * "Where you stand": the leagues you are leading by the widest margin and the
 * ones you are trailing in, across every platform at once, before any single
 * league is picked.
 *
 * ── What the margin actually IS, and why every row says so ──────────────────
 *
 * ⚠ THE HANDOFF ASSUMES A LIVE SCORE AND PRODUCTION DOES NOT HAVE ONE YET.
 * Measured 2026-08-29: of 62 claimed leagues carrying `WeeklyMatchup` rows, ZERO
 * have a scored week — Sleeper bootstraps all 18 weeks as 0-0 rows the moment a
 * league is imported, so "latest week on file" is week 18 in August and every
 * points column is 0. `league_player_weekly_scores` is empty outright.
 *
 * Ranking those leagues by "margin" would have produced a board of ties
 * presented as a live pulse. So each row carries its BASIS:
 *
 *   `scored`    — real points, both sides, from `WeeklyMatchup`. The design's
 *                 intent, and what every row becomes once week 1 is played.
 *   `projected` — both lineups priced under THIS league's own scoring from the
 *                 projection feed. Labelled on the row and in the section head,
 *                 never silently mixed into a scoreboard.
 *
 * A league that can be neither scored nor priced is COUNTED and named in
 * `notRanked`, not dropped: "we could not rank six of your leagues" is a fact
 * the user is entitled to, and a shorter list with no explanation reads as if
 * those leagues do not exist.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * Seven queries for the whole board regardless of league count, not seven per
 * league. A per-league fan-out over 67 claimed teams is the shape that took
 * production Postgres to a 53200 OOM; every read here is batched across the
 * user's whole portfolio, and the widest one is an aggregate rather than a row
 * dump (see step 2).
 */

/** A manager avatar or league crest we can actually render, or null. */
function asImageUrl(raw: string | null | undefined, platform: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  /*
   * ⚠ SLEEPER STORES AN AVATAR *ID*, NOT A URL, AND ONLY SOMETIMES. Production
   * carries both spellings in the same column — 38 of the top account's 67
   * leagues hold a full `sleepercdn.com` URL — so a bare id is expanded and any
   * other non-URL value renders as initials rather than a broken image.
   */
  if (String(platform ?? '').toLowerCase() === 'sleeper') {
    return `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(v)}`
  }
  return null
}

/** Two-letter badge for a league with no crest. Never blank. */
function initialsOf(name: string, take = 2): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, take).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export type PulseBasis = 'scored' | 'projected'

export type PulseRow = {
  leagueId: string
  leagueName: string
  platform: string
  /** The league crest, when the platform published one. */
  logoUrl: string | null
  leagueBadge: string
  /** Null when no `LeagueTeam` row names the opposing roster — never invented. */
  opponentName: string | null
  /** What to print: the real name, else the platform's own "Team N" (`rosterLabel`). Never "Unknown". */
  opponentLabel: string
  opponentAvatarUrl: string | null
  opponentInitials: string
  /** Signed, from your side. Positive means you are ahead. */
  margin: number
  basis: PulseBasis
  season: number
  week: number
  /**
   * The week is over: a scored row whose league-week `leagueWeekProgress` calls final — including
   * the Tuesday after a week, when every NFL game in it is final but the platform has not moved on
   * (`loadFinishedNflWeeks`). The margin is then a RESULT, and the board says won/lost, not
   * leading/trailing. Always false for a projected row.
   */
  final: boolean
  /**
   * Starters whose real-world game has not kicked off.
   *
   * ⚠ NULL IS NOT ZERO. Null means we could not place this league's starters
   * against a fixture list at all — a non-NFL league, or a week the schedule
   * does not reach. Rendering that as "0 left to play" would tell a manager
   * their week is over before it has started.
   */
  startersLeft: number | null
  /**
   * How much of each lineup the projected margin was built from. Null on a
   * scored row, where the points are the points.
   *
   * ⚠ TRAVELS WITH THE MARGIN BECAUSE THE TWO SIDES CAN BE SHORT BY DIFFERENT
   * AMOUNTS. That does not merely make both totals low, it tilts the gap
   * between them — which is the only thing this row renders.
   */
  coverage: { you: { from: number; of: number }; them: { from: number; of: number } } | null
  /**
   * Your chance of winning this matchup, 0–1 — the SAME Gaussian model the one-league page uses
   * (`computeWinProbability`), over each starter's league-scored projection, the points he has
   * already banked, and whether his game is over.
   *
   * ⚠ NULL IS A REFUSAL, NOT 50%. Any starter still to play with no projection, or a live week
   * whose points we cannot attribute to players, makes the question unanswerable — the model's
   * own rule, and the page's. A final week is 1 or 0.
   */
  pWin: number | null
  /**
   * Where the model expects this to END, from your side: banked points plus what each side's
   * unplayed starters are still projected to add. Null exactly when `pWin` is.
   *
   * This is what separates "+30.9 on Friday" from a win: a 28-starter league up 30.9 after
   * Thursday night was projected to lose 533–571 (production, 2026-10-02).
   */
  projectedMargin: number | null
  href: string
}

export type MatchupPulse = {
  leading: PulseRow[]
  trailing: PulseRow[]
  /**
   * How many leagues are ahead / behind IN TOTAL. `leading` and `trailing` are capped at five for the
   * two columns; the header printed their lengths, so it read "5 leading · 5 trailing" on an account
   * the home page correctly put at 32 ahead and 21 behind (production, 2026-09-28).
   */
  leadingTotal: number
  trailingTotal: number
  /** Leagues that carry a head-to-head this week, ranked or not. */
  considered: number
  ranked: number
  /** What the ranked rows are measured in. Null when nothing ranked. */
  basis: PulseBasis | 'mixed' | null
  /** Every ranked row is `final` — the whole board is results. False when nothing ranked. */
  allFinal: boolean
  /**
   * The sum of `pWin` over every row that has one — the record the model expects this week, in
   * wins. Null when no row has a probability. `withOdds` is how many rows it was built from, so
   * "23.4 expected wins" can say "of 41".
   */
  expectedWins: number | null
  withOdds: number
  /**
   * The matchups nearest a coin flip that are still being played — the ones worth watching, and
   * exactly the middle the top-5/bottom-5 columns hide. Rows already in either column are left out.
   */
  closest: PulseRow[]
  /** Why the rest are absent. Stated on the screen, never silently dropped. */
  notRanked: {
    /**
     * A guillotine or survivor-guillotine league: scored against the whole field, so there is no
     * opponent to rank against — even when the provider published a matchup id. See
     * `eliminationFormat`. Optional so a cached pulse from before this field still reads.
     */
    elimination?: number
    /** No `WeeklyMatchup` rows at all — the league has never been synced for a schedule. */
    noSchedule: number
    /** A week on file, but this roster has no game in it (bye, or unpaired). */
    noOpponent: number
    /** Paired, but neither scored nor priceable — no points and no projection. */
    unpriceable: number
    /**
     * Priced, but the two sides are not measured the same way — different
     * starter counts, or one lineup only partly priced. The gap between two
     * such totals is an artefact of coverage, not a lead.
     */
    uncomparable: number
    /**
     * A claimed team whose roster id this loader cannot use.
     *
     * 🛑 THIS COUNT EXISTS BECAUSE ITS ABSENCE PRODUCED A FALSE STATEMENT ON A
     * REAL ACCOUNT. `mine` requires `Number.isFinite(Number(externalId))` — the
     * WeeklyMatchup join needs Sleeper's numeric roster_id — so an ESPN SWID or
     * a Fantrax slug drops the team silently. With every claimed team dropped,
     * `considered` was 0 and the cross-league board rendered "No claimed team
     * yet" to a manager holding four. Found by rendering it, 2026-09-07.
     *
     * "We cannot place your roster against a schedule" and "you have not
     * claimed a team" are different sentences and the screen now says which.
     */
    unidentifiedRoster: number
    /**
     * Claimed leagues that have not started — still in setup, before or during their draft.
     *
     * 🛑 THESE WERE COUNTED AS `unidentifiedRoster`, "a roster id we cannot match — our gap". On
     * the audited account (production 2026-09-28) all 8 of that count were not our gap: 7 native
     * AllFantasy leagues still in setup, which have no schedule to match, and 1 second claimed
     * copy of a Fantrax league whose other copy is already ranked. The duplicate is now not
     * counted at all; these are counted here.
     */
    notStarted: number
  }
}

/**
 * Where each starter's real-world game stands THIS fantasy week.
 *
 * 🛑 THIS REPLACES A "NEXT KICKOFF PER CLUB" MAP, WHICH COULD NOT ANSWER THE QUESTION. That map held
 * only FUTURE fixtures, so on a Sunday evening a club whose game had finished was looked up, found
 * its NEXT week's game, and counted as "still to play" — every placed starter read as yet to play,
 * whatever had happened. It also never consulted the matchup's own week. And live rows skipped the
 * count altogether, so "0 left to play" could never appear (audit, 2026-10-02).
 *
 * Read per (season, week) from `SportsGame` under `starterGameStates` — the one-league page's rule:
 * a kickoff alone never proves a game finished; only a final status does.
 *
 * ⚠ ONE WIDENING, FOR A BOARD READ DAYS BEFORE KICKOFF. `starterGameStates` only trusts "scheduled"
 * from a row fetched in the last hour, which is right on game day and leaves Sunday's starters
 * `unknown` on a Friday if the schedule writer last ran on Wednesday. A regular-season fixture for
 * his club in this week, kicking off in the FUTURE and not final, is unambiguous: he has not played.
 * Anything else that `starterGameStates` could not place stays `unknown`.
 */
export function weekGameStates(
  players: ReadonlyMap<string, { team: string | null }>,
  games: WeekGame[],
  now: Date,
): Map<string, StarterGameState> {
  const states = starterGameStates(players, games, now)
  const nextKickoff = new Map<string, Date>()
  for (const g of games) {
    if (g.seasonType !== 'regular' || !g.startTime) continue
    if (FINAL_GAME.test(String(g.status ?? '').toLowerCase())) continue
    for (const team of [g.homeTeam, g.awayTeam]) {
      const club = normalizeTeamAbbrev(team)
      if (!club) continue
      const prior = nextKickoff.get(club)
      if (!prior || g.startTime < prior) nextKickoff.set(club, g.startTime)
    }
  }
  for (const [id, player] of players) {
    if (states.get(id) !== 'unknown') continue
    const at = nextKickoff.get(normalizeTeamAbbrev(player.team) ?? '')
    if (at && at.getTime() > now.getTime()) states.set(id, 'upcoming')
  }
  return states
}

type LiveScoreRow = { leagueId: string; seasonYear: number; week: number; playerId: string; points: number }

const FINAL_GAME = /^(final|finished|completed?|status_final|status_final_ot)$/

type WeekGame = {
  season: number | null
  week: number | null
  homeTeam: string
  awayTeam: string
  status: string | null
  startTime: Date | null
  fetchedAt: Date
  seasonType: string | null
}


/**
 * The stored lineup, empty slots KEPT as `EMPTY_SLOT`.
 *
 * 🛑 AN EMPTY SLOT IS A CERTAIN ZERO, SO IT STAYS IN THE LINEUP. Dropping it gave that side fewer
 * starters than the other, and the like-for-like check then filed the league under "lineups we
 * cannot compare" — so the leagues where a manager most needed to act (a hole in the lineup) were
 * exactly the ones this board hid (audit, 2026-10-02). It is priced at 0 and never looked up.
 */
function startersOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object') return []
  const s = (playerData as Record<string, unknown>).starters
  return Array.isArray(s) ? s.map((x) => (x == null ? '' : String(x))).filter((x) => x !== '') : []
}

const EMPTY_PULSE: MatchupPulse = {
  leading: [],
  trailing: [],
  leadingTotal: 0,
  trailingTotal: 0,
  considered: 0,
  ranked: 0,
  basis: null,
  allFinal: false,
  expectedWins: null,
  withOdds: 0,
  closest: [],
  notRanked: { elimination: 0, noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0, unidentifiedRoster: 0, notStarted: 0 },
}

export async function getMatchupPulse(
  userId: string,
  now: Date = new Date(),
): Promise<MatchupPulse> {
  /* ── 1. Every team this user has claimed, with its league. ─────────────── */
  const claimedRows = await prisma.leagueTeam
    .findMany({
      where: { claimedByUserId: userId },
      select: {
        externalId: true,
        platformUserId: true,
        league: {
          select: {
            id: true,
            name: true,
            platform: true,
            platformLeagueId: true,
            season: true,
            sport: true,
            logoUrl: true,
            avatarUrl: true,
            status: true,
            lifecycleState: true,
            leagueType: true,
            guillotineMode: true,
            bestBallMode: true,
            leagueVariant: true,
          },
        },
      },
    })
  /*
   * 🛑 NO `.catch(() => [])` ON THIS READ, THE SETTINGS READ OR THE TWO SCHEDULE READS BELOW. Each
   * one is the board's whole input, and swallowing a failure turned "we could not read" into a
   * confident claim — "No claimed team yet", or every league "carries no schedule". A throw reaches
   * the page, which says the board failed to load (audit, 2026-10-02). The enrichment reads further
   * down still degrade on their own, because each of them only costs a row its price, not the board
   * its truth.
   */

  /*
   * The leagues' settings, without the keys this board never reads.
   *
   * 🛑 `settings: true` SENT ~5 MB PER RENDER ON A 95-LEAGUE ACCOUNT, AND 4 MB OF IT WAS ONE KEY.
   * Measured on production 2026-10-03: `identity_mappings` (the importer's id crosswalk) was 4.07 MB
   * of the 4.98 MB of settings text, read on every render and every 20-second refresh to answer five
   * questions none of which touch it. Dropped in SQL, the read is ~0.95 MB.
   *
   * ⚠ EXCLUDE, DO NOT INCLUDE. This board reads settings only through `leagueWeekFromSettings`,
   * `extractScoringSettings`, `isBestBallSettings`, `leagueWeekProgress` and `eliminationFormat`;
   * none reads any key below (checked 2026-10-03). Listing the keys they DO read instead would drop
   * one silently the day one of them starts reading another — and nothing would fail, the week or
   * the scoring would just quietly change. An unknown new key stays in. Adding a key to this list
   * needs the same check against those five readers.
   *
   * One row per league, where the select above repeats a league for every team claimed in it.
   */
  const leagueIdsForSettings = [...new Set(claimedRows.flatMap((c) => (c.league ? [c.league.id] : [])))]
  const settingsRows = leagueIdsForSettings.length
    ? await prisma.$queryRawUnsafe<Array<{ id: string; settings: Prisma.JsonValue | null }>>(
        /* `jsonb - key` throws on a scalar. Every row is an object or NULL today (2026-10-03,
           542 / 18); anything else passes through untouched rather than failing the board. */
        `SELECT id,
                CASE WHEN jsonb_typeof(settings::jsonb) = 'object'
                     THEN settings::jsonb
                            - 'identity_mappings'
                            - 'foundation_defaults'
                            - 'import_coverage'
                            - 'importCanonical'
                            - 'source_tracking'
                     ELSE settings::jsonb
                END AS settings
           FROM leagues
          WHERE id = ANY($1::text[])`,
        leagueIdsForSettings,
      )
    : []
  const settingsById = new Map(settingsRows.map((r) => [r.id, r.settings]))
  const claimed = claimedRows.map((c) => ({
    ...c,
    league: c.league ? { ...c.league, settings: settingsById.get(c.league.id) ?? null } : null,
  }))

  const mine = claimed.filter(
    (c) => c.league?.platformLeagueId && Number.isFinite(Number(c.externalId)),
  )
  /*
   * See `notRanked.unidentifiedRoster`. Reporting `considered: 0` here told a
   * manager with four claimed teams that they had none.
   */
  const { unidentifiedRoster, notStarted } = classifyUnplaced(claimed, mine)
  if (mine.length === 0) {
    return {
      ...EMPTY_PULSE,
      considered: claimed.length,
      notRanked: { ...EMPTY_PULSE.notRanked, unidentifiedRoster, notStarted },
    }
  }

  const plids = [...new Set(mine.map((c) => c.league!.platformLeagueId as string))]
  const leagueIds = [...new Set(mine.map((c) => c.league!.id))]
  /* League.id → platform league id, for the duplicate-league fold at the end. */
  const plidByLeagueId = new Map(
    mine.map((c) => [c.league!.id, c.league!.platformLeagueId as string]),
  )

  /* ── 2. Which week each league is on, then only that week's rows. ──────────
   *
   * ⚠ TWO NARROW READS RATHER THAN ONE WIDE ONE. A Sleeper import bootstraps all
   * eighteen weeks up front, so "every weekly row for this user's leagues" is
   * ~13,000 rows for a 62-league account — pulled over the wire to use about
   * 750 of them. The aggregate below answers "is this week scored" server-side
   * at one row per league-week, and only the resolved weeks are then fetched.
   * A per-league fan-out is the shape that took production Postgres to a 53200
   * OOM; a needlessly wide single read is the same mistake spelled differently.
   */
  const weekSummary = await prisma.weeklyMatchup
    .groupBy({
      by: ['leagueId', 'seasonYear', 'week'],
      where: { leagueId: { in: plids }, seasonYear: { gte: now.getUTCFullYear() - 1 } },
      _max: { pointsFor: true, pointsAgainst: true },
    })

  /*
   * `_max` per league-week is exactly what `isScored` asks of a whole week: one
   * row with a point on it makes the week played. Fed through the SAME
   * `resolveCurrentWeekFrom` the per-league screen uses, so the two surfaces
   * cannot name different opponents.
   */
  const summaryByPlid = new Map<string, WeekScoreRow[]>()
  for (const g of weekSummary) {
    const row: WeekScoreRow = {
      seasonYear: g.seasonYear,
      week: g.week,
      pointsFor: g._max.pointsFor ?? 0,
      pointsAgainst: g._max.pointsAgainst ?? 0,
    }
    const list = summaryByPlid.get(g.leagueId)
    if (list) list.push(row)
    else summaryByPlid.set(g.leagueId, [row])
  }

  const weekByPlid = new Map<string, { season: number; week: number }>()
  for (const [plid, rows] of summaryByPlid) {
    const league = mine.find((team) => team.league?.platformLeagueId === plid)?.league
    const statedWeek = leagueWeekFromSettings(league?.settings)
    const resolved = statedWeek && league?.season
      ? { season: Number(league.season), week: statedWeek }
      : resolveCurrentWeekFrom(rows)
    if (resolved) weekByPlid.set(plid, { season: resolved.season, week: resolved.week })
  }

  const currentRows = weekByPlid.size
    ? await prisma.weeklyMatchup
        .findMany({
          where: {
            OR: [...weekByPlid].map(([leagueId, w]) => ({
              leagueId,
              seasonYear: w.season,
              week: w.week,
            })),
          },
          select: {
            leagueId: true,
            seasonYear: true,
            week: true,
            rosterId: true,
            matchupId: true,
            pointsFor: true,
            pointsAgainst: true,
          },
        })
    : []

  const rowsByPlid = new Map<string, typeof currentRows>()
  for (const r of currentRows) {
    const list = rowsByPlid.get(r.leagueId)
    if (list) list.push(r)
    else rowsByPlid.set(r.leagueId, [r])
  }

  /* ── 3. Names and crests for every roster in play. ─────────────────────── */
  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: { in: leagueIds } },
      select: {
        leagueId: true,
        externalId: true,
        teamName: true,
        ownerName: true,
        avatarUrl: true,
        platformUserId: true,
      },
    })
    .catch(() => [])
  const teamBy = new Map(teams.map((t) => [`${t.leagueId}:${t.externalId}`, t]))

  /*
   * Pair each claimed team with its opponent for THAT league's current week.
   * `resolveCurrentWeekFrom` is the pure in-memory form of the same rule the
   * per-league screen applies — earliest unplayed week inside the newest season,
   * never `max(week)` — so the two surfaces cannot name different opponents.
   */
  type Pending = {
    leagueId: string
    /** The key `WeeklyMatchup` and `league_player_weekly_scores` both use. */
    platformLeagueId: string
    leagueName: string
    platform: string
    sport: string | null
    logoUrl: string | null
    leagueBadge: string
    season: number
    week: number
    scored: boolean
    yourPoints: number
    theirPoints: number
    /**
     * Keys to try against `Roster.platformUserId`, in order.
     *
     * ⚠ NOT ONE KEY. `Roster.platformUserId` is always set but does not always
     * hold the PLATFORM's id — sometimes it holds our own `User` uuid, and
     * sometimes the roster id. Measured here first-hand: keying on
     * `LeagueTeam.platformUserId` alone resolved the OPPONENT's roster in every
     * league and the user's own in NONE, so all 41 pairable leagues came back
     * "could not be priced" while the lineups sat in the table. `myRosterCandidates`
     * is the repo's canonical answer to this and matches at most one roster.
     */
    yourRosterKeys: string[]
    theirRosterKeys: string[]
    opponentName: string | null
    opponentLabel: string
    opponentAvatarUrl: string | null
    opponentInitials: string
    scoringSettings: Record<string, unknown> | null
    /** A best-ball league has no lineup decision and no win probability from one lineup. */
    bestBall: boolean
  }

  const pending: Pending[] = []
  const notRanked = { elimination: 0, noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0 }

  for (const c of mine) {
    const l = c.league!
    /*
     * Format before pairing: a guillotine league can carry provider matchup ids, and pairing on them
     * drew a fake opponent and a win probability. The rail has always refused it; so does this now.
     */
    if (eliminationFormat(l)) {
      notRanked.elimination++
      continue
    }
    const plid = l.platformLeagueId as string
    const resolved = weekByPlid.get(plid)
    const weekRows = rowsByPlid.get(plid)
    if (!resolved || !weekRows || weekRows.length === 0) {
      notRanked.noSchedule++
      continue
    }

    // WeeklyMatchup.rosterId is String now, matching LeagueTeam.externalId
    // directly -- was Number(c.externalId), which stopped matching the moment
    // rosterId became a native string instead of an Int this always had to
    // round-trip through.
    const myRosterId = c.externalId
    const mineRow = weekRows.find((r) => r.rosterId === myRosterId)
    const oppRow =
      mineRow?.matchupId != null
        ? weekRows.find((r) => r.matchupId === mineRow.matchupId && r.rosterId !== myRosterId)
        : undefined

    if (!mineRow || !oppRow) {
      notRanked.noOpponent++
      continue
    }

    const oppTeam = teamBy.get(`${l.id}:${String(oppRow.rosterId)}`)
    // The importer stores an unowned Sleeper roster as "Unknown" — a placeholder, not a name (managerName.ts).
    const opponentName = realManagerName(oppTeam?.teamName) || realManagerName(oppTeam?.ownerName)
    const opponentLabel = rosterLabel([opponentName], oppRow.rosterId)
    const leagueName = leagueDisplayName(l.name)
    const platform = String(l.platform ?? 'manual').toLowerCase()

    pending.push({
      leagueId: l.id,
      platformLeagueId: plid,
      leagueName,
      platform,
      sport: l.sport ?? null,
      logoUrl: asImageUrl(l.logoUrl, platform) ?? asImageUrl(l.avatarUrl, platform),
      leagueBadge: initialsOf(leagueName),
      season: resolved.season,
      week: resolved.week,
      scored: isScored(mineRow) || isScored(oppRow),
      yourPoints: mineRow.pointsFor,
      theirPoints: oppRow.pointsFor,
      yourRosterKeys: myRosterCandidates(
        { platformUserId: c.platformUserId, externalId: c.externalId },
        userId,
      ),
      /*
       * The opponent's own candidates, minus `userId` — that key is the CALLER's,
       * and offering it here could match the caller's roster to the other side of
       * their own matchup.
       *
       * 🛑 AND THE ORPHAN KEY, BECAUSE A MANAGERLESS TEAM HAS NO MANAGER ID TO OFFER. Since #1005 its
       * roster is stored under `orphan-<provider>-<teamId>` (`importedOrphanOwnerKey`, the write
       * side's own function). Production 2026-09-17: 207 of the 210 teams no manager id could reach
       * are orphans, and 60 matchups of a claimed team in 16 leagues face one — every one of those
       * pairings fell into `notRanked.unpriceable`, so the league vanished from this board.
       *
       * ⚠ DERIVED RATHER THAN RESOLVED, AND THAT IS A COST DECISION. The full rule
       * (`resolveRostersForTeams`) needs every roster of every league, because the key may be one we
       * cannot name — a dozen rows on a single-league screen, but ~1.5 MB on the 96-league account
       * this board serves, against ~250 KB today. This key IS nameable, so it costs nothing. What it
       * does not cover is a team whose MANAGER CHANGED (3 of the 210); that one still needs the
       * resolver, and the screens that can afford it use it.
       */
      theirRosterKeys: [
        oppTeam?.platformUserId,
        String(oppRow.rosterId),
        importedOrphanOwnerKey(platform, String(oppRow.rosterId)),
      ].filter((v): v is string => typeof v === 'string' && v.length > 0),
      opponentName,
      opponentLabel,
      opponentAvatarUrl: asImageUrl(oppTeam?.avatarUrl, platform),
      opponentInitials: initialsOf(opponentLabel),
      scoringSettings: extractScoringSettings(l.settings),
      /* The same three-way test the league page applies, so the two cannot disagree on format. */
      bestBall: l.bestBallMode === true || l.leagueVariant === 'best_ball' || isBestBallSettings(l.settings),
    })
  }

  if (pending.length === 0) {
    return {
      ...EMPTY_PULSE,
      considered: claimed.length,
      notRanked: { ...notRanked, unidentifiedRoster, notStarted },
    }
  }

  /* ── 4. Lineups for both sides of EVERY pairing. ───────────────────────────
   *
   * 🛑 LIVE PAIRINGS USED TO BE SKIPPED HERE, AND THAT IS WHY THIS BOARD RANKED BY THE WRONG THING.
   * With no lineup, a scored row knew only the two team totals, so it ranked by points-so-far: on
   * the Friday of week 4 a league up 30.9 after Thursday night sat third in "Leading" while both
   * 28-starter lineups had everyone else still to play and it was projected to lose 533–571
   * (production, 2026-10-02). A win probability needs to know what each side has LEFT, and that is
   * a property of the lineup. One more key-scoped read for the scored leagues, not a fan-out.
   */
  const rosterKeys = [
    ...new Set(pending.flatMap((p) => [...p.yourRosterKeys, ...p.theirRosterKeys])),
  ]

  const platformByLeague = new Map(pending.map((p) => [p.leagueId, p.platform]))
  // In Sleeper ids: an ESPN lineup translated, any other foreign one emptied — a Fleaflicker/MFL/
  // Fantrax/Yahoo starter id (or an untranslatable ESPN one: 12483 is Stafford there, Jack Bech in
  // Sleeper's space) would be priced as a stranger; such a lineup lands in `unpriceable`.
  const rosters = rosterKeys.length
    ? await sleeperReadableRosters(
        await prisma.roster
          .findMany({
            where: { leagueId: { in: leagueIds }, platformUserId: { in: rosterKeys } },
            select: { leagueId: true, platformUserId: true, playerData: true },
          })
          .catch(() => []),
        (r) => platformByLeague.get(r.leagueId),
      )
    : []
  const startersBy = new Map<string, string[]>()
  for (const r of rosters) {
    startersBy.set(`${r.leagueId}:${r.platformUserId}`, startersOf(r.playerData))
  }

  /** First candidate that actually names a roster in this league. */
  const startersFor = (leagueId: string, keys: string[]): string[] => {
    for (const k of keys) {
      const hit = startersBy.get(`${leagueId}:${k}`)
      if (hit) return hit
    }
    return []
  }

  const lineups = new Map(
    pending.map((p) => [
      p.leagueId,
      { you: startersFor(p.leagueId, p.yourRosterKeys), them: startersFor(p.leagueId, p.theirRosterKeys) },
    ]),
  )

  /* ── 5. Projections and availability, one read per league-week on the board. ──
   *
   * 🛑 EACH LEAGUE IS PRICED FOR ITS OWN WEEK. This read the feed's NEWEST week for every league —
   * and the feed holds the week ahead, so a week-4 matchup could be priced on week-5 numbers while
   * the league page priced it on week 4. Usually one or two groups for a whole board.
   *
   * ⚠ A WEEK THE FEED DOES NOT HOLD STILL GETS A MARGIN, FROM THE NEWEST WEEK, as before — but no
   * odds and no injury zeros: a probability needs this week's prices, and a current injury says
   * nothing about another week's projection. The shared forecast refuses an unpriced starter.
   */
  const everyStarter = [
    ...new Set([...lineups.values()].flatMap((l) => [...l.you, ...l.them]).filter((id) => id !== EMPTY_SLOT)),
  ]
  const weekKeyOf = (p: { sport: string | null; season: number; week: number }) =>
    `${String(p.sport ?? 'NFL').toUpperCase()}:${p.season}:${p.week}`
  const groups = new Map<string, { sport: string; season: number; week: number; ids: Set<string> }>()
  for (const p of pending) {
    const key = weekKeyOf(p)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { sport: String(p.sport ?? 'NFL').toUpperCase(), season: p.season, week: p.week, ids: new Set() }))
    const lineup = lineups.get(p.leagueId)
    for (const id of [...(lineup?.you ?? []), ...(lineup?.them ?? [])]) if (id !== EMPTY_SLOT) g.ids.add(id)
  }
  type WeekPrices = {
    /** This week's feed, or the newest week's when this one is missing — see `exact`. */
    projections: Map<string, PlayerProjection>
    /** True when `projections` IS this league-week's. Only then may odds or injuries use it. */
    exact: boolean
    /** Ruled out or on bye this week, by Sleeper id. Empty unless `exact`. */
    unavailable: Set<string>
  }
  const emptyProjections = (): Map<string, PlayerProjection> => new Map()
  const weekPricesP: Promise<Map<string, WeekPrices>> = Promise.all(
    [...groups].map(async ([key, g]): Promise<[string, WeekPrices]> => {
      const ids = [...g.ids]
      if (ids.length === 0) return [key, { projections: emptyProjections(), exact: true, unavailable: new Set() }]
      const at = { season: String(g.season), week: g.week }
      const [exact, unavailable] = await Promise.all([
        lookupProjections(ids, at, null, g.sport).catch(emptyProjections),
        loadUnavailableBySport({ sleeperIds: ids, sports: [g.sport], season: g.season, week: g.week })
          .then((m) => m.get(g.sport) ?? new Set<string>())
          .catch(() => new Set<string>()),
      ])
      if (exact.size > 0) return [key, { projections: exact, exact: true, unavailable }]
      const newest = await latestProjectionWeek().catch(() => null)
      const fallback =
        newest && !(newest.season === at.season && newest.week === at.week)
          ? await lookupProjections(ids, newest, null, g.sport).catch(emptyProjections)
          : emptyProjections()
      return [key, { projections: fallback, exact: false, unavailable: new Set() }]
    }),
  ).then((entries) => new Map(entries))

  /*
   * ── 6. Per-player points and game states, read alongside the projections. ──
   *
   * Points: one batched read over `league_player_weekly_scores` for the scored league-weeks only,
   * key-scoped to the starters on the board. Games: one read over this board's NFL (season, week)
   * pairs. Neither depends on the other or on the projections, so the three run together.
   */
  const scoredPending = pending.filter((p) => p.scored)
  const nflWeeks = [
    ...new Map(
      pending
        .filter((p) => String(p.sport ?? 'NFL').toUpperCase() === 'NFL')
        .map((p) => [`${p.season}:${p.week}`, { season: p.season, week: p.week }]),
    ).values(),
  ]
  const [weekPrices, scoreRows, weekGames] = await Promise.all([
    weekPricesP,
    scoredPending.length && everyStarter.length
      ? Promise.resolve()
          .then(() =>
            prisma.leaguePlayerWeeklyScore.findMany({
              where: {
                OR: scoredPending.map((p) => ({ leagueId: p.platformLeagueId, seasonYear: p.season, week: p.week })),
                playerId: { in: everyStarter },
              },
              select: { leagueId: true, seasonYear: true, week: true, playerId: true, points: true },
            }),
          )
          .catch(() => [])
      : Promise.resolve([] as LiveScoreRow[]),
    nflWeeks.length
      ? Promise.resolve()
          .then(() =>
            prisma.sportsGame.findMany({
              where: {
                sport: 'NFL',
                season: { in: [...new Set(nflWeeks.map((w) => w.season))] },
                week: { in: [...new Set(nflWeeks.map((w) => w.week))] },
                OR: [{ seasonType: 'regular' }, { seasonType: null }],
              },
              select: {
                season: true, week: true, homeTeam: true, awayTeam: true, status: true,
                startTime: true, fetchedAt: true, seasonType: true,
              },
              take: 1000,
            }),
          )
          .catch(() => [])
      : Promise.resolve([] as WeekGame[]),
  ])

  /* `${platformLeagueId}:${season}:${week}` → player → points. Absent = nothing attributable. */
  const pointsByLeagueWeek = new Map<string, Map<string, number>>()
  for (const r of scoreRows) {
    const key = `${r.leagueId}:${r.seasonYear}:${r.week}`
    let m = pointsByLeagueWeek.get(key)
    if (!m) pointsByLeagueWeek.set(key, (m = new Map()))
    m.set(r.playerId, r.points)
  }

  /*
   * ⚠ A GAME MISSING ITS WEEK OR SEASON IS DROPPED, NOT GUESSED. Week 4 and preseason week 4 share
   * a number; the query already excludes typed preseason, and an untyped row is only ever trusted by
   * `starterGameStates` as a newer reading of a regular fixture.
   */
  const gamesByWeek = new Map<string, WeekGame[]>()
  for (const g of weekGames) {
    if (g.season == null || g.week == null) continue
    const key = `${g.season}:${g.week}`
    const list = gamesByWeek.get(key)
    if (list) list.push(g)
    else gamesByWeek.set(key, [g])
  }

  /**
   * One lineup's per-starter facts: the margin's price, the odds' price, availability and, for NFL,
   * game state.
   *
   * ⚠ TWO PRICES, ON PURPOSE. `projected` is the MARGIN's: it falls back to the vendor total rather
   * than dropping a player, because a total missing a starter reads LOW, and low is the direction that
   * makes someone believe they are losing when they are not. `leagueScored` is the ODDS': only a
   * number this league's rules produced, exactly what the league page prices with — a PPR total is
   * not this league's number, and a probability built on one is the 98%-beside-"—" disagreement the
   * shared forecast exists to end (`matchupForecast.ts`).
   */
  function starterFacts(p: Pending, ids: string[]) {
    const isNfl = String(p.sport ?? 'NFL').toUpperCase() === 'NFL'
    const prices = weekPrices.get(weekKeyOf(p))
    const projections = prices?.projections ?? emptyProjections()
    const unavailableIds = prices?.unavailable ?? new Set<string>()
    const filled = ids.filter((id) => id !== EMPTY_SLOT)
    const players = new Map(filled.map((id) => [id, { team: projections.get(id)?.team ?? null }]))
    const states = isNfl
      ? weekGameStates(players, gamesByWeek.get(`${p.season}:${p.week}`) ?? [], now)
      : new Map<string, StarterGameState>()
    return ids.map((id) => {
      /* An empty slot: a certain zero, finished before it starts. Never looked up. */
      if (id === EMPTY_SLOT) {
        return { id, empty: true, unavailable: false, projected: 0, leagueScored: 0, state: 'final' as StarterGameState }
      }
      /* Ruled out or on bye THIS week: a zero, as the league page counts him. */
      if (unavailableIds.has(id)) {
        return { id, empty: false, unavailable: true, projected: 0, leagueScored: 0, state: 'final' as StarterGameState }
      }
      const proj = projections.get(id)
      const league =
        p.scoringSettings && proj?.componentStats
          ? computeLeagueProjectedPoints(proj.componentStats, p.scoringSettings)
          : null
      return {
        id,
        empty: false,
        unavailable: false,
        projected: league?.points ?? proj?.projectedPoints ?? null,
        leagueScored: prices?.exact ? league?.points ?? null : null,
        state: (states.get(id) ?? 'unknown') as StarterGameState,
      }
    })
  }

  /** Price one lineup: its projected total, and how many starters that total was built from. */
  function price(facts: ReturnType<typeof starterFacts>) {
    let total = 0
    let from = 0
    for (const f of facts) {
      if (f.projected == null) continue
      total += f.projected
      from += 1
    }
    return { total, from, of: facts.length }
  }

  /**
   * Starters still to play — yet to kick off or playing now.
   *
   * ⚠ NULL IS NOT ZERO, AND NOW IT MEANS EXACTLY ONE THING: at least one starter's game could not be
   * placed in this week's schedule. "Fewer left" from a count that skipped the ones we could not
   * place would be false; "0 left to play" on a lineup whose games are all final is the most useful
   * thing this row says on a Monday night, and it could never appear before. An empty slot is
   * nobody, so it is not counted at all.
   */
  function leftToPlay(facts: ReturnType<typeof starterFacts>): number | null {
    const real = facts.filter((f) => !f.empty)
    if (real.length === 0 || real.some((f) => f.state === 'unknown')) return null
    return real.filter((f) => f.state === 'upcoming' || f.state === 'live').length
  }

  /** One side in the shared forecast's terms — the same inputs the league page builds. */
  function forecastSide(
    facts: ReturnType<typeof starterFacts>,
    teamPoints: number,
    byPlayer: ReadonlyMap<string, number> | null,
  ): ForecastSide {
    return {
      teamPoints,
      hasPlayerPoints: facts.some((f) => byPlayer?.has(f.id)),
      starters: facts.map((f) => ({
        playerId: f.id,
        projected: f.leagueScored,
        unavailable: f.unavailable,
        actual: byPlayer?.get(f.id) ?? 0,
        state: f.state,
      })),
    }
  }


  /*
   * Which league-weeks are over. A week is final once the league has moved past it — or, for NFL,
   * once every regular-season game in it is final, which is Tuesday rather than Wednesday. One read
   * for the whole board. See leagueWeekProgress.
   */
  const leagueById = new Map(mine.map((t) => [t.league!.id, t.league!]))
  const finishedNfl = await loadFinishedNflWeeks(
    pending.flatMap((p) => {
      const lg = leagueById.get(p.leagueId)
      const leg = leagueWeekFromSettings(lg?.settings)
      return String(p.sport ?? '').toUpperCase() === 'NFL' && leg != null ? [{ season: p.season, week: leg }] : []
    }),
  )
  const isFinalWeek = (p: Pending): boolean => {
    const lg = leagueById.get(p.leagueId)
    if (!lg) return false
    return leagueWeekProgress(
      { settings: lg.settings, season: lg.season != null ? Number(lg.season) : null, status: lg.status, sport: lg.sport },
      finishedNfl,
    ).isFinal(p.season, p.week)
  }

  const ranked: PulseRow[] = []

  for (const p of pending) {
    const lineup = lineups.get(p.leagueId) ?? { you: [], them: [] }
    const yourFacts = starterFacts(p, lineup.you)
    const theirFacts = starterFacts(p, lineup.them)
    const you = price(yourFacts)
    const them = price(theirFacts)

    let margin: number
    let basis: PulseBasis
    let coverage: PulseRow['coverage'] = null

    if (p.scored) {
      margin = p.yourPoints - p.theirPoints
      basis = 'scored'
    } else if (you.from === 0 || them.from === 0) {
      notRanked.unpriceable++
      continue
    } else if (you.of !== them.of || you.from !== you.of || them.from !== them.of) {
      /*
       * ⚠ A MARGIN BETWEEN TWO UNEQUALLY COVERED TOTALS IS NOT A MARGIN. Measured
       * here: one league paired a 12-starter lineup against a 5-starter one and
       * produced "+120.5", which would have topped the leading column purely
       * because the other roster is half-stored. MyTeam's `edge()` already
       * refuses on exactly this condition; ranking is a stronger claim than a
       * sentence, so it refuses too rather than qualifying the number.
       */
      notRanked.uncomparable++
      continue
    } else {
      margin = you.total - them.total
      basis = 'projected'
      coverage = {
        you: { from: you.from, of: you.of },
        them: { from: them.from, of: them.of },
      }
    }

    const final = basis === 'scored' && isFinalWeek(p)
    const isNfl = String(p.sport ?? 'NFL').toUpperCase() === 'NFL'

    /*
     * ── The win probability ─────────────────────────────────────────────
     *
     * A finished week is a result: 1, 0, or a tie. Otherwise the shared model, fed exactly what the
     * league page feeds it. Before kickoff nobody has banked anything and nobody is final, so a
     * projected row is a pure projection; once points exist they must be ATTRIBUTABLE to players —
     * with only the two team totals, "what is left" is unknowable, and the league page refuses in
     * the same place for the same reason.
     */
    let pWin: number | null = null
    let projectedMargin: number | null = null
    if (final) {
      pWin = margin > 0 ? 1 : margin < 0 ? 0 : 0.5
      projectedMargin = Math.round(margin * 10) / 10
    } else {
      const byPlayer =
        basis === 'scored' ? pointsByLeagueWeek.get(`${p.platformLeagueId}:${p.season}:${p.week}`) ?? null : null
      /*
       * 🛑 THE SHARED FORECAST, NOT A SECOND COPY OF ITS RULES. Best ball, unknown game states after
       * kickoff (every non-NFL live row), points with no per-player rows, an unpriced starter still to
       * play — each refuses here exactly where the league page refuses. See `matchupForecast.ts`.
       */
      const result = forecastMatchup(
        forecastSide(yourFacts, basis === 'scored' ? p.yourPoints : 0, byPlayer),
        forecastSide(theirFacts, basis === 'scored' ? p.theirPoints : 0, byPlayer),
        { bestBall: p.bestBall, noRulesReason: hasScoringRules(p.scoringSettings) ? null : NO_LEAGUE_SCORING_REASON },
      )
      if (result.available) {
        pWin = result.pWin
        projectedMargin = Math.round(result.projectedMargin * 10) / 10
      }
    }

    ranked.push({
      leagueId: p.leagueId,
      leagueName: p.leagueName,
      platform: p.platform,
      logoUrl: p.logoUrl,
      leagueBadge: p.leagueBadge,
      opponentName: p.opponentName,
      opponentLabel: p.opponentLabel,
      opponentAvatarUrl: p.opponentAvatarUrl,
      opponentInitials: p.opponentInitials,
      margin: Math.round(margin * 10) / 10,
      basis,
      season: p.season,
      week: p.week,
      final,
      startersLeft: isNfl ? leftToPlay(yourFacts) : null,
      coverage,
      pWin,
      projectedMargin,
      href: `/core/matchup?league=${encodeURIComponent(p.leagueId)}`,
    })
  }

  /*
   * ⚠ ONE ROW PER PLATFORM LEAGUE. Production carries the same Sleeper league
   * under more than one `League.id` — "KBFL" resolved twice with an identical
   * opponent and an identical margin, and both would have taken a slot in a
   * top-five that only has five. Deduped on the platform id rather than the
   * name, because two genuinely different leagues can share a name.
   *
   * This does NOT merge them in `ranked`: the count is of leagues considered
   * and ranked, and quietly reducing it would hide the duplication rather than
   * stop it crowding the board.
   */
  const seenPlatformLeague = new Set<string>()
  const deduped = ranked.filter((r) => {
    const key = plidByLeagueId.get(r.leagueId)
    if (!key) return true
    if (seenPlatformLeague.has(key)) return false
    seenPlatformLeague.add(key)
    return true
  })

  /*
   * ── Ranking: by WHO WILL WIN, not by who is ahead right now ─────────────
   *
   * 🛑 RANKED BY RAW MARGIN, THIS BOARD WAS DECIDED BY THURSDAY NIGHT. A live margin with most of
   * both lineups still to play says almost nothing, and it sat in the same sort as full-week
   * projections — so the Friday board led with whichever leagues had a Thursday starter, including
   * one up 30.9 that was projected to lose by 37 (production, 2026-10-02).
   *
   * A row is FAVOURED when the model gives you better than even odds, and ranked by those odds;
   * the margin breaks ties (two finished wins, both 100%). A row the model refused is placed by its
   * margin's sign and ranked AFTER every row that has odds — it is still a fact, just a weaker one,
   * and dropping it would hide a league. A coin flip or a level score sits in neither column.
   */
  const side = (r: PulseRow): 1 | -1 | 0 => {
    if (r.pWin != null) return r.pWin > 0.5 ? 1 : r.pWin < 0.5 ? -1 : 0
    return r.margin > 0 ? 1 : r.margin < 0 ? -1 : 0
  }
  const hasOdds = (r: PulseRow) => (r.pWin != null ? 1 : 0)
  const ahead = deduped.filter((r) => side(r) === 1)
  const behind = deduped.filter((r) => side(r) === -1)
  const leading = [...ahead]
    .sort((a, b) => hasOdds(b) - hasOdds(a) || (b.pWin ?? 0) - (a.pWin ?? 0) || b.margin - a.margin)
    .slice(0, 5)
  const trailing = [...behind]
    .sort((a, b) => hasOdds(b) - hasOdds(a) || (a.pWin ?? 0) - (b.pWin ?? 0) || a.margin - b.margin)
    .slice(0, 5)

  /*
   * The closest games still being played, nearest a coin flip first — the middle the two columns
   * hide, and the leagues worth watching. By odds where there are odds; a row without them sorts
   * after every row with them, closest margin first.
   */
  const shownIds = new Set([...leading, ...trailing].map((r) => r.leagueId))
  const closeness = (r: PulseRow) => (r.pWin != null ? Math.abs(r.pWin - 0.5) : 1 + Math.abs(r.margin))
  const closest = deduped
    .filter((r) => !r.final && !shownIds.has(r.leagueId))
    .sort((a, b) => closeness(a) - closeness(b))
    .slice(0, 5)

  const withOddsRows = deduped.filter((r) => r.pWin != null)
  const expectedWins = withOddsRows.length
    ? Math.round(withOddsRows.reduce((s, r) => s + (r.pWin ?? 0), 0) * 10) / 10
    : null

  const bases = new Set(ranked.map((r) => r.basis))

  return {
    leading,
    trailing,
    leadingTotal: ahead.length,
    trailingTotal: behind.length,
    considered: claimed.length,
    ranked: ranked.length,
    basis: bases.size === 0 ? null : bases.size > 1 ? 'mixed' : [...bases][0],
    allFinal: deduped.length > 0 && deduped.every((r) => r.final),
    expectedWins,
    withOdds: withOddsRows.length,
    closest,
    notRanked: { ...notRanked, unidentifiedRoster, notStarted },
  }
}

type UnplacedClaim = {
  league: { platform: string | null; platformLeagueId: string | null; status?: string | null; lifecycleState?: string | null } | null
}

/**
 * Why each claimed team the board could not place is absent. See `notRanked.notStarted`.
 *
 * Exported so the rule can be tested without the loader's reads. PURE.
 */
export function classifyUnplaced<T extends UnplacedClaim>(claimed: T[], placed: T[]): { unidentifiedRoster: number; notStarted: number } {
  const key = (c: T) => `${String(c.league?.platform ?? '').toLowerCase()}:${c.league?.platformLeagueId ?? ''}`
  const placedSet = new Set(placed)
  const placedLeagues = new Set(placed.map(key))
  let unidentifiedRoster = 0
  let notStarted = 0
  for (const c of claimed) {
    if (placedSet.has(c)) continue
    /* A second claimed copy of a league already on the board is not missing from it. */
    if (c.league?.platformLeagueId && placedLeagues.has(key(c))) continue
    /* League states in which no schedule exists yet — the one rule, in leagueNotStarted.ts. */
    if (isLeagueNotStarted(c.league)) notStarted++
    else unidentifiedRoster++
  }
  return { unidentifiedRoster, notStarted }
}
