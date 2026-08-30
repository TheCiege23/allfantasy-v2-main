import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState, type UnavailableSection } from './leagueHome'
import { isRuledOut } from './injuryStatus'
import { latestProjectionWeek, lookupProjections, summariseLineup } from './playerProjections'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'
import { resolveSportsWeek, type SportsWeek } from './sportsWeek'
import { describeScoringDifferences, hasIdpScoring, isIdpPosition } from './scoringNotes'
import { getTaxiTenure, type TaxiTenure } from './taxiTenure'
import { getNextMatchup, type NextMatchup } from './nextMatchup'
import { getRosterGrade, type RosterGrade } from './rosterGrade'
import { getByeWeeks } from './byeWeeks'
import { getGameWeather, type GameWeather } from './gameWeather'
import { getRosteredMarket, MIN_LEAGUES_FOR_MARKET } from './rosteredMarket'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { myRosterCandidates } from './myRoster'
import { parseDescriptiveId } from './descriptiveId'
import { crosswalkToSleeperIds } from './rosterIdCrosswalk'
import { composePlayerIdentities } from './playerIdentityCompose'
import { buildNextGameMap } from './nextGameMap'
import { displayPosition, inferSlotLabel } from './positionLabels'
import { lookupProviderIdentityNames } from './providerIdentityNames'
import { resolveSourceLink, type SourceLink } from '@/lib/league-links/sourceLinkResolver'
import { identityGapNote } from './identityGap'
import {
  BENCH_SWAP_POINTS,
  isEligibleForSlot,
  startingSlotTemplate,
} from './rosterSlots'

/**
 * My team · roster — "read-only view of your real lineup, with the fix and where
 * to make it".
 *
 * Identifying WHICH roster is yours goes LeagueTeam.claimedByUserId → its
 * platformUserId/externalId → Roster.platformUserId. Roster.platformUserId is
 * the always-set column; LeagueTeam.platformUserId is nullable and gating on it
 * has previously locked real members out of their own league, so it is used as a
 * hint here and never as the sole key.
 *
 * The lineup itself is real: Roster.playerData carries `starters` in slot order
 * plus `players`, `reserve` and `taxi`. Each id resolves through
 * SportsPlayer.sleeperId to a name, position, team and headshot.
 *
 * Game context and the lineup lock are derived from the INGESTED SCHEDULE — the
 * kickoff of each starter's real-world game — rather than from a projection feed
 * we do not have. That makes the countdown in the handoff's lock banner a real
 * number instead of a decorative one.
 */

export type LineupPlayer = {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  /**
   * The league's sport, carried per player so the crest resolves off the right
   * CDN. Hardcoding NFL would silently show a wrong or missing logo the day a
   * roster is anything else.
   */
  sport: string | null
  imageUrl: string | null
  /** "DEN vs LV · Sun 4:05p" — from the ingested schedule, null when unknown. */
  gameContext: string | null
  kickoff: Date | null
  /**
   * Exhibition or the real thing.
   *
   * ⚠ A PRESEASON PROJECTION IS NOT A FANTASY PROJECTION. Starters play a
   * series and sit. Showing an August game beside a number, with nothing
   * saying which kind of game it is, invites someone to read a meaningless
   * total as their week.
   */
  preseason: boolean
  /** Stadium, when the schedule carries one — the basis for the dome symbol. */
  venue: string | null
  injuryStatus: string | null
  /**
   * He is ruled out, so the projection is 0.0 rather than absent.
   *
   * ⚠ THIS IS THE ONE CASE WHERE ZERO IS HONEST. Everywhere else a zero would
   * be a claim we cannot support, which is why `projectedPoints` stays null.
   * A player the league has declared OUT will score nothing, and saying 0.0
   * next to the reason is more useful than an em dash that makes the reader
   * go and look it up.
   */
  ruledOut: boolean
  /**
   * The same projection re-scored under THIS LEAGUE'S rules.
   *
   * ⚠ THIS IS THE NUMBER THAT ACTUALLY APPLIES TO YOU. `projectedPoints` is the
   * vendor's line collapsed under a generic PPR preset — a league nobody is in.
   * This one is the vendor's per-stat components multiplied by the league's own
   * `scoring_settings`. In a TE-premium, six-point-passing-TD or IDP league the
   * two are not close, and the generic one is the one that is wrong.
   *
   * Null when the league's scoring cannot be read, or when not one of its
   * scoring keys matched the projected stat line — which is NOT a zero-point
   * projection and must never render as 0.0.
   */
  afProjectedPoints: number | null
  /**
   * He plays indoors this week, so weather is not a factor.
   *
   * Resolved from the HOME TEAM, not from `SportsGame.venue` — the rows that
   * carry a season type do not carry a venue, so reading the venue column would
   * return nothing for most games.
   *
   * ⚠ Retractable roofs are recorded as domes. Six stadiums can play open, and
   * nothing in this repo tracks whether the roof was shut, so a "dome" here
   * means "roofed", not "definitely closed".
   */
  indoors: boolean | null
  /**
   * How the whole app is treating this player, not how one roster is.
   *
   * SHARE USED TO BE THIS PLAYER'S FRACTION OF ONE TEAM'S PROJECTED TOTAL,
   * which answered a much smaller question than anybody was asking. What a
   * manager wants is what the field is doing: universally started, or a bench
   * stash everywhere? Computed from AllFantasy's own rosters, so it sharpens
   * every time somebody imports a league.
   *
   * Null when the sample is too small to mean anything — see
   * MIN_LEAGUES_FOR_MARKET.
   */
  market: { ownPct: number; startPct: number | null } | null
  /**
   * The cached forecast for this player's game, when one exists.
   *
   * Null for a game further out than the weather cron reaches, which is the
   * common case before the week starts. The venue mark still renders from the
   * stadium alone — "outdoors, forecast not in yet" is a different statement
   * from "outdoors, and here is the forecast".
   */
  weather: GameWeather | null
  /**
   * His team is not playing this week.
   *
   * ⚠ THE MOST PREVENTABLE LOSS IN FANTASY. Starting a player on bye is a
   * guaranteed zero and nothing on this screen warned about it. Only ever set
   * when the week's schedule is complete enough to tell a bye from a gap in
   * our own data — see byeWeeks.ts.
   */
  onBye: boolean
  /**
   * Weekly projection for this player, or null when the feed does not carry him.
   *
   * ⚠ NULL IS NOT ZERO. A slot showing "—" is a player we cannot price; a slot
   * showing 0.0 would claim we expect him to score nothing. Those are different
   * statements and only one of them is true.
   */
  projectedPoints: number | null
}

/**
 * A benched player who is eligible for this slot and projects higher.
 *
 * ⚠ THE CHECK ALWAYS RUNS; ONLY THE VERDICT VARIES. `swap` means the gap clears
 * BENCH_SWAP_POINTS and the number can carry the recommendation. `close` means a
 * bench player is nominally ahead but inside the model's own error, so the
 * honest reading is that the starter is fine — saying "start him instead" on a
 * 0.4-point edge is a coin flip wearing a decision's clothes.
 *
 * Null when nothing eligible outprojects the starter, or when either side is
 * unpriced. An unpriced player is not a zero and must never lose a comparison
 * he was never entered into.
 */
export type BenchCheck = {
  verdict: 'swap' | 'close'
  benchName: string
  benchProjected: number
  starterName: string
  starterProjected: number
}

export type LineupSlot = {
  slotLabel: string
  /** The stronger same-slot bench option, or null. See BenchCheck. */
  benchCheck: BenchCheck | null
  player: LineupPlayer | null
  /**
   * The slot genuinely holds nobody — the platform recorded an unfilled starter.
   * This drives the handoff's --bad-soft empty state and the lock-time urgency.
   */
  empty: boolean
  /**
   * A player IS in this slot, but we could not resolve his id to a player row.
   *
   * ⚠ Kept strictly separate from `empty`. An unresolved id means our identity
   * bridge failed; an empty slot means the user has a hole in their lineup.
   * Rendering the first as the second tells someone their FLEX is empty when a
   * player is sitting in it — and sends them to the platform to fix nothing.
   */
  unresolvedId: string | null
}

export type MyTeamData = {
  league: {
    id: string
    name: string
    platform: string
    format: string | null
    /**
     * Where to go to actually CHANGE the lineup.
     *
     * ⚠ AllFantasy NEVER WRITES A LINEUP for an imported league — the bench
     * check tells you what to do and this is where you do it. Resolved
     * server-side through the one hardened resolver (exact-host HTTPS
     * allowlist); null for a native league, where there is no source to open.
     */
    sourceLink: SourceLink | null
  }
  team: SectionState<{
    teamName: string
    /** The manager's display name. Imported since day one, never rendered. */
    ownerName: string
    /** Their own avatar, not the league crest. Already a full URL when present. */
    managerAvatarUrl: string | null
    /**
     * "8-4", "8-4-1", or the sentence that says why there is no record yet.
     *
     * ⚠ RENDER IT AGAINST `recordKnown`, NOT AGAINST ITS LENGTH. The absent
     * case is prose, and the tile that shows it styles its value as a 24px
     * tabular figure — so "no results read yet" rendered as the largest thing
     * on the screen, wrapping across three lines of a numeric slab. Same shape
     * as `rosterGrade`'s unavailable state: an em dash in the value, the reason
     * underneath it.
     */
    record: string
    /** False before the league has scored a single game. */
    recordKnown: boolean
    rank: number | null
    pointsFor: number
    pointsAgainst: number
    teamCount: number
  }>
  starters: SectionState<LineupSlot[]>
  /**
   * Why the roster carries unnamed rows, said ONCE.
   *
   * ⚠ IT ALSO EXPLAINS A SILENCE. The bench check skips any player it cannot
   * price, so on an ESPN league — where 0 of 145 starter ids resolve across
   * production — it runs and finds nothing, and the screen shows no bench
   * advice at all. Without this note that silence reads as "your lineup is
   * fine". Null when every id resolved.
   */
  identityNote: string | null
  bench: SectionState<LineupPlayer[]>
  /**
   * Injured reserve and taxi squad, kept apart.
   *
   * ⚠ THEY WERE ONE LIST AND EVERY ROW IN IT WAS LABELLED "IR". A taxi-squad
   * rookie is not injured, and a screen that says he is tells a manager to go
   * and fix something that is not broken. They are different rules, different
   * eligibility and different deadlines, so they are different sections.
   */
  ir: SectionState<LineupPlayer[]>
  taxi: SectionState<Array<LineupPlayer & { tenure: TaxiTenure | null }>>
  /** Earliest kickoff among starters — the real lineup lock. */
  lock: SectionState<{
    at: Date
    anyEmptySlot: boolean
    /** The week this lock belongs to, so the banner can name it. */
    week: number | null
    season: number | null
    /**
     * A lock further out than a week is not a deadline, it is a coverage gap.
     *
     * ⚠ THIS IS THE 2,321-HOUR COUNTDOWN, MADE VISIBLE. Rather than silently
     * counting down to a game months away, the banner can say the schedule for
     * the coming week has not been ingested yet — which is the actual problem.
     */
    daysAway: number
  }>
  /**
   * The lineup's projected total.
   *
   * ⚠ CARRIES `unprojected` SO A FRAGMENT CANNOT POSE AS A TOTAL. Two of six
   * sampled production lineups are only partly priced, so this is the common case.
   * A total built from 5 of 8 starters always reads LOW — the direction that makes
   * a manager bench someone they should start.
   */
  projections: SectionState<{
    total: number
    projected: number
    unprojected: number
    season: string
    week: number
    /**
     * The same lineup totalled under THIS LEAGUE'S scoring.
     *
     * Null when the league's scoring settings are unreadable, so the screen can
     * show one number honestly rather than two numbers that are secretly the
     * same one.
     */
    afTotal: number | null
    /** How many starters the league-scored total was built from. */
    afProjected: number
    /**
     * Whether the standard total is worth showing at all.
     *
     * ⚠ IN AN IDP LEAGUE IT IS NOT. The generic line does not score defenders,
     * so their contribution is null and the standard total is summed over only
     * the offensive half of the lineup. On a real 16-slot IDP roster that
     * printed 53.0 beside a league total of 166.7 — two numbers that look
     * comparable, measured over different players. The tile shows an em dash
     * and says why instead.
     */
    standardComparable: boolean
  }>
  /**
   * Why the two totals differ, in the league's own terms — the answer to the
   * button that offers to explain it.
   */
  projectionBasis: {
    /** e.g. "TE gets 1.5 per reception here, not 1." Empty when nothing stands out. */
    notes: string[]
    scoringKnown: boolean
  }
  /**
   * The upcoming matchup, projected.
   *
   * ⚠ THIS IS WHAT "POINTS FOR / AGAINST" SHOULD SAY BEFORE WEEK 1. Those tiles
   * showed the season's running totals, which are 0-0 for everyone until a game
   * is scored — two em dashes in the most prominent position on the screen, at
   * exactly the moment people look at their roster most.
   */
  nextMatchup: SectionState<NextMatchup>
  rosterGrade: SectionState<RosterGrade>
  /**
   * Byes coming up, so a stack is visible before the waiver wire is picked
   * over rather than on the morning it bites.
   */
  upcomingByes: Array<{ week: number; names: string[] }>
  liveScore: UnavailableSection
}

/** Slot labels in the order fantasy lineups conventionally read. */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * "Sun 4:05p".
 *
 * ⚠ THE DAY IS NOT DECORATION. Without it every row on the screen read as a
 * time of day with no date attached, so a game three months away looked
 * exactly like a game this weekend — which is precisely how a November
 * kickoff sat on the roster for weeks without anyone being able to see it.
 */
function formatKickoff(d: Date | null): string | null {
  if (!d) return null
  const hours = d.getUTCHours()
  const mins = d.getUTCMinutes()
  const ampm = hours >= 12 ? 'p' : 'a'
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  return `${DAYS[d.getUTCDay()]} ${h12}:${String(mins).padStart(2, '0')}${ampm}`
}


async function resolvePlayers(
  ids: string[],
  sport: string,
  projectionWeek: { season: string; week: number } | null,
  /** The real-world week to pull games for. Null means we could not resolve one. */
  week: SportsWeek | null,
  /**
   * This league's `scoring_settings`, for re-scoring the vendor's component
   * line. Null when the league never recorded any — in which case there is no
   * league-specific number to compute and the screen shows only the generic one.
   */
  scoringSettings: Record<string, unknown> | null,
  /**
   * `League.platform`, for the last-resort name lookup.
   *
   * ⚠ IT IS THE PROVIDER KEY, not decoration. Ids that fail the `sleeperId`
   * join are looked up against THAT provider's own athlete records, and asking
   * the wrong provider for an id is how a numeric collision puts a stranger in
   * someone's lineup — see `providerIdentityNames.ts`.
   */
  platform: string,
): Promise<Map<string, LineupPlayer>> {
  /*
   * ⚠ IN AN IDP LEAGUE THE GENERIC NUMBER IS NOT A PROJECTION OF ANYTHING for a
   * defender. Standard PPR contains no defensive scoring, so the vendor's line
   * returns whatever incidental offensive stat a defender is projected for.
   * Measured on a real roster: 0.3 for a linebacker the league projects at 18,
   * 0.6 for an edge rusher projected at 9. Those are not low estimates, they
   * are the absence of an estimate wearing a number.
   */
  const leagueScoresIdp = hasIdpScoring(scoringSettings)
  const out = new Map<string, LineupPlayer>()
  if (ids.length === 0) return out

  /*
   * ── Foreign roster ids, translated before every lookup ──────────────────
   *
   * ⚠ THE JOINS BELOW ARE ALL KEYED ON SLEEPER IDS — `SportsPlayer.sleeperId`
   * and the projection feed both — so an ESPN roster resolved nothing through
   * them. `providerIdentityNames` further down rescued the NAME, but only the
   * name: the provider's athlete record carries no position and no team, so
   * those lineups came out named and wholly unpriceable.
   *
   * `PlayerIdentityMap.espnId` is now filled, and it sits on rows that already
   * hold a `sleeperId`, so the id composes across with no matching anywhere.
   * Translating here means an ESPN starter resolves through the ORDINARY path
   * instead — position, club, headshot, game context, bye, weather and a
   * projection priced under the league's own rules.
   *
   * Measured 2026-08-30: 127 of 176 distinct ESPN roster ids translate, and all
   * 127 exist in `SportsPlayer`. Whatever does not still falls through to the
   * name-only bridge, then to the descriptive-id parse, then to an honest
   * "could not identify" — none of which this removes.
   */
  const sleeperIdByRosterId = await crosswalkToSleeperIds(platform, sport, ids).catch(
    () => new Map<string, string>(),
  )
  const lookupIds = [...new Set(ids.map((id) => sleeperIdByRosterId.get(id) ?? id))]

  const rows = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: lookupIds } },
    // `sport` is required by `composePlayerIdentities` — it gates the NFL-only
    // club fold, and omitting it would silently leave every club unfolded.
    select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
  })

  /*
   * ⚠ ONE ATHLETE PER SLEEPER ID, COMPOSED — NOT WHICHEVER VENDOR ROW LANDED
   * LAST. `sleeperId` is not unique in `SportsPlayer` and the duplicates are one
   * player as several vendors describe him; `composePlayerIdentities` holds the
   * measurement and the reasoning. This loop used to write `out.set(r.sleeperId,
   * …)` once per row, so the LAST row seen won every field — the mirror of the
   * first-row-wins pick that rendered three starters as grey letters on
   * `/core/matchup`. Both screens render the SAME lineup and the comments in
   * both files say they must never disagree about it; sharing this composer is
   * what makes that true rather than asserted.
   *
   * ⚠ AND IT IS NOT ONLY THE PORTRAIT. The composed `team` is folded to an
   * abbreviation, which is what the fixture join below is keyed on. Measured on
   * production 2026-08-30: 1,172 of 11,960 NFL sleeperIds carry more than one
   * spelling of their club, and the schedule lookup could only ever match one of
   * them — see the note on `rosterTeams`.
   */
  const identityBy = composePlayerIdentities(rows)

  /*
   * Every spelling each vendor has for one player, kept only to look injuries up
   * by. 39 of those 11,960 ids disagree about the name — "Chris Rodriguez" and
   * "Chris Rodriguez Jr." are one running back — and `SportsInjury` is keyed on
   * a name, not an id. Composing down to a single spelling before the lookup
   * would silently drop the match for whichever half is not stored.
   */
  const namesById = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const held = namesById.get(r.sleeperId)
    if (held) held.push(r.name)
    else namesById.set(r.sleeperId, [r.name])
  }

  /*
   * ⚠ SCOPED TO A SEASON AND A WEEK, NOT TO "THE FUTURE".
   *
   * This asked for every game after now, ordered by kickoff, and took the first
   * per team. That is only correct when the schedule table is complete, and it
   * is not. On production the first matching row was in late NOVEMBER, so every
   * starter showed a November opponent and the lock counted down 97 days to it.
   * Nothing looked wrong — real teams, a real kickoff — and with no date on the
   * row there was nothing to give it away.
   *
   * ⚠ AND THE TEAM FILTER WAS RUN IN SQL AGAINST THE WRONG VOCABULARY.
   * `SportsPlayer.team` is an abbreviation ("KC"); `SportsGame.homeTeam` holds
   * whatever the provider called it — ESPN writes "Kansas City Chiefs", Rolling
   * Insights writes the mascot. `homeTeam: { in: ["KC", ...] }` therefore matched
   * only the minority of rows that happen to store an abbreviation, which is a
   * silent partial join: some players get a game, some do not, and which is
   * which depends on who ingested the row.
   *
   * So the week is filtered in SQL and the TEAMS are matched in memory through
   * the normaliser that understands all three spellings. One NFL week is about
   * sixteen fixtures — and up to four rows each, because the unique key includes
   * `source` — so this is a small set by construction.
   */
  /*
   * ⚠ KEYED ON THE FOLDED ABBREVIATION, WHICH IS WHAT `SportsGame` IS ALSO
   * FOLDED TO BELOW. This was a `Map<normalised, raw>` built from every raw
   * spelling on every vendor row, and `Map.set` resolves a duplicate key to the
   * LAST pair — so when one player carried both "SF" and "San Francisco 49ers",
   * the fixture map ended up keyed on exactly one of them and a lookup with the
   * other returned nothing. That is no opponent, no kickoff, no venue and no
   * lineup lock for that starter, with nothing on screen to say why.
   *
   * 1,172 of 11,960 NFL sleeperIds carry more than one spelling of their club
   * (production, 2026-08-30), so this was not an edge case. Composing folds the
   * club once per player, which lets both sides of this join speak one
   * vocabulary and removes the raw-spelling indirection entirely.
   */
  const rosterTeams = new Set(
    [...identityBy.values()].map((p) => p.team).filter((t): t is string => Boolean(t)),
  )

  const weekGames =
    rosterTeams.size > 0 && week
      ? await prisma.sportsGame
          .findMany({
            where: {
              sport,
              season: week.season,
              week: week.week,
              /*
               * ⚠ WITHOUT THIS, PRESEASON WEEK 1 AND REGULAR WEEK 1 ARE THE
               * SAME QUERY. They share a season and a week number, so the
               * lookup returned both and the `startTime asc` ordering picked
               * the exhibition game every time. Every starter was badged
               * PRESEASON and the lineup lock read "Locked" against a date in
               * mid-August, for a week that had not been played.
               */
              seasonType: week.seasonType,
            },
            orderBy: { startTime: 'asc' },
            take: 400,
            select: {
              homeTeam: true,
              awayTeam: true,
              startTime: true,
              seasonType: true,
              venue: true,
            },
          })
          .catch(() => [])
      : []

  /*
   * Keyed on the FOLDED club token, the same vocabulary `rosterTeams` and every
   * composed player carry — see `buildNextGameMap` for what the translation
   * layer this replaced was costing.
   */
  const nextGameFor = buildNextGameMap(weekGames, rosterTeams)

  const injuries = await prisma.sportsInjury
    .findMany({
      // Every vendor spelling, deliberately — see `namesById`. A superset costs
      // one `IN` list and is the only way the 39 divergent names both match.
      where: { sport, playerName: { in: rows.map((r) => r.name) } },
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, status: true },
    })
    .catch(() => [])
  /*
   * ⚠ FIRST WINS, NOT LAST, AND THE `orderBy` ABOVE IS WHY. `new Map(pairs)` resolves a
   * duplicate key to the LAST pair, so feeding it rows sorted `fetchedAt: desc` kept the
   * OLDEST status for anyone with more than one row — the exact opposite of what the sort
   * asks for. Measured on production 2026-08-28: `sportsInjury` holds 6,426 NFL rows and
   * 989 players have more than one, one of them 133. Every one of those was reading stale.
   *
   * Building the map explicitly and skipping a key already present keeps the newest row,
   * matching `injByPlayer` in `runInjuryImpactDashboard.ts`, which had this right already.
   */
  const injuryByName = new Map<string, string | null>()
  for (const i of injuries) {
    const k = i.playerName.toLowerCase()
    if (!injuryByName.has(k)) injuryByName.set(k, i.status)
  }

  /*
   * ⚠ RESOLVED PER PLAYER, ACROSS EVERY SPELLING HE IS STORED UNDER. The lookup
   * used to run against whichever vendor row the loop was on, so for the 39 ids
   * whose vendors disagree about the name it was a coin toss whether a status
   * was found at all — and a missed status is not cosmetic here: `ruledOut`
   * turns a projection into a hard 0.0.
   *
   * A hit on ANY spelling counts. Two spellings both matching is possible in
   * principle; the first wins, and `injuryByName` above has already kept the
   * newest row per name, so neither candidate is stale.
   */
  const injuryById = new Map<string, string | null>()
  for (const [id, names] of namesById) {
    for (const n of names) {
      const status = injuryByName.get(n.trim().toLowerCase())
      if (status) {
        injuryById.set(id, status)
        break
      }
    }
  }

  /*
   * ⚠ PROJECTIONS ARE JOINED HERE BECAUSE THIS IS WHERE THE IDS ALREADY ARE, and
   * because the ids are the same shape the feed is keyed by — Sleeper ids. That
   * coincidence is the whole reason both screens can be priced at all; it is not a
   * given for every platform and the join will silently return nothing the day an
   * importer writes a different id space.
   */
  /*
   * The defensive half of the component line, for IDP leagues only.
   *
   * ⚠ THIS IS WHAT TURNS THE EM DASH BACK INTO A NUMBER. The suppression below is correct
   * and stays — the GENERIC feed number remains meaningless for a defender — but with a
   * projected defensive line present, `computeLeagueProjectedPoints` can finally price him
   * under his own league's rules, and `afProjectedPoints` stops being null.
   *
   * The opponent comes from the schedule join this function already did, rather than from a
   * second `SportsGame` query with its own chances of picking the wrong fixture.
   */
  /*
   * ⚠ BUILT FROM THE COMPOSED PLAYER, NOT FROM RAW ROWS. `new Map(pairs)`
   * resolves a duplicate key to the LAST pair, so each of these three maps was
   * taking its value from whichever vendor row Postgres happened to return last
   * — a different arbitrary pick from the one the render loop below made, which
   * meant the position a player was PRICED as could differ from the position he
   * was SHOWN as.
   */
  const composed = [...identityBy.entries()]
  const projections = await lookupProjections(lookupIds, projectionWeek, {
    scoringSettings,
    positionBySleeperId: new Map(composed.map(([id, p]) => [id, p.position])),
    opponentBySleeperId: new Map(
      composed.map(([id, p]) => [id, (p.team ? nextGameFor.get(p.team)?.opponent : null) ?? null])
    ),
    injuryBySleeperId: new Map(composed.map(([id]) => [id, injuryById.get(id) ?? null])),
  })

  /*
   * ⚠ ONE PASS PER PLAYER, NOT ONE PER ROW. This iterated `rows` and wrote
   * `out.set(r.sleeperId, …)` each time, so a player with three vendor rows was
   * built three times and the last one won every field — headshot, position and
   * club together. Iterating the composed map makes each player's fields come
   * from whichever vendor actually holds them.
   */
  for (const [sleeperId, p] of identityBy) {
    const g = p.team ? nextGameFor.get(p.team) : undefined
    const time = formatKickoff(g?.at ?? null)
    const injuryStatus = injuryById.get(sleeperId) ?? null
    const ruledOut = isRuledOut(injuryStatus)
    const projection = projections.get(sleeperId) ?? null
    const feedProjection = projection?.projectedPoints ?? null

    /*
     * The league-specific number. `computeLeagueProjectedPoints` returns null
     * rather than 0 when none of the league's scoring keys matched the stat
     * line, which is the difference between "this league scores him at nothing"
     * and "we cannot score this league" — only the second is ever true here.
     */
    const leagueScored =
      scoringSettings && projection?.componentStats
        ? computeLeagueProjectedPoints(projection.componentStats, scoringSettings)
        : null

    // Indoors is a fact about the home stadium, so it is resolved from whoever
    // is hosting — the player's own team when at home, his opponent when away.
    const hostTeam = g ? (g.home ? p.team : g.opponent) : null
    const venueInfo = hostTeam
      ? resolveVenueForTeam({ sport: sport as 'NFL', teamAbbrev: normalizeTeamAbbrev(hostTeam) })
      : { kind: 'none' as const }

    out.set(sleeperId, {
      sleeperId,
      /*
       * ⚠ NEVER EMPTY. `SportsPlayer.name` is non-nullable, so a composed name is
       * null only if every row for this id held whitespace — but `LineupPlayer.name`
       * is a `string` a slot renders directly, and a blank one reads as a rendering
       * bug rather than as a missing row.
       */
      name: p.name ?? `Unnamed player ${sleeperId}`,
      position: displayPosition(p.position),
      team: p.team,
      sport,
      imageUrl: p.imageUrl,
      gameContext: g ? `${p.team} ${g.home ? 'vs' : '@'} ${g.opponent}${time ? ` · ${time}` : ''}` : null,
      kickoff: g?.at ?? null,
      preseason: g?.preseason ?? false,
      venue: g?.venue ?? null,
      injuryStatus,
      ruledOut,
      /*
       * A player the league has ruled out scores nothing, and that is a fact we
       * can stand behind — so it is the one case where a zero replaces the em
       * dash. Everywhere else null survives, because "we have no projection"
       * and "we project nothing" are different claims.
       */
      projectedPoints: ruledOut
        ? 0
        : leagueScoresIdp && isIdpPosition(p.position)
          ? null
          : feedProjection,
      afProjectedPoints: ruledOut ? 0 : leagueScored?.points ?? null,
      indoors: venueInfo.kind === 'coords' ? venueInfo.dome : null,
      // All filled in by the caller: byes need the week's full slate, the
      // forecast is one batched cache read, and the market is app-wide.
      weather: null,
      market: null,
      onBye: false,
    })
  }

  /*
   * ── Ids that carry their own answer ────────────────────────────────────
   *
   * ⚠ SOME IMPORTERS MINT A DESCRIPTIVE ID WHEN THE PLATFORM GAVE THEM NONE,
   * and we were throwing the description away. The shape is
   * `name:Christian McCaffrey:RB:SF` — the name, the position and the club, in
   * the id itself. It fails the `sleeperId` join like any foreign id, so the
   * slot rendered "Player we could not identify" over a string that says
   * exactly who the player is.
   *
   * Measured on production 2026-08-29: 12 of 49 starting slots in `manual`
   * leagues (24%) are this shape.
   *
   * ⚠ WHAT THIS DELIBERATELY DOES NOT DO IS INVENT THE REST. There is no
   * `SportsPlayer` row behind it, so there is no headshot, no projection and no
   * game context — those stay null rather than being guessed from the name.
   * Naming him is a fact the id supports; pricing him is not, and a name beside
   * a fabricated projection would be worse than the em dash it replaced.
   */
  /*
   * ── The provider's own name, for ids we hold no player row for ──────────
   *
   * ⚠ RUNS BEFORE THE DESCRIPTIVE PARSE ONLY IN THE SENSE THAT BOTH ARE
   * FALLBACKS; they cannot collide, because a `name:` id is never a provider
   * athlete id. Both fill the same gap from different sources, and both stop at
   * the name.
   *
   * This is the ESPN case: 98 of 98 starting-slot ids on production ESPN
   * rosters have a `display_name` here, and none of them resolved before.
   */
  /*
   * ── Re-key onto the roster's own ids ────────────────────────────────────
   *
   * ⚠ WITHOUT THIS THE TRANSLATION IS INVISIBLE. Everything above resolved
   * against SLEEPER ids, so `out` is keyed by them — but every caller indexes
   * this map by the id the ROSTER holds (`starterIds[i]`, the bench and taxi
   * lists), so an ESPN lineup would look exactly as unresolved as before while
   * the resolved players sat in the map under keys nobody asks for.
   *
   * The entry itself is left alone: its `sleeperId` stays the CANONICAL id,
   * because that is what a player link should carry — the roster's own id
   * resolves to nothing outside its platform.
   *
   * A Sleeper league has an empty crosswalk, so this loop does nothing there.
   */
  for (const [rosterId, sleeperId] of sleeperIdByRosterId) {
    const resolved = out.get(sleeperId)
    if (resolved && !out.has(rosterId)) out.set(rosterId, resolved)
  }

  const unresolvedIds = ids.filter((id) => !out.has(id))
  const providerNames = unresolvedIds.length
    ? await lookupProviderIdentityNames(platform, sport, unresolvedIds).catch(
        () => new Map<string, { name: string }>(),
      )
    : new Map<string, { name: string }>()

  for (const [id, named] of providerNames) {
    if (out.has(id)) continue
    out.set(id, {
      sleeperId: id,
      name: named.name,
      /*
       * ⚠ NULL, NOT INFERRED. These rows carry no position and no team — 0 of
       * 1,257 — so everything below the name stays absent. A position guessed
       * from a name is exactly the kind of confident wrong answer that puts a
       * running back in a TE slot and silently breaks the bench check.
       */
      position: null,
      team: null,
      sport,
      imageUrl: null,
      gameContext: null,
      kickoff: null,
      preseason: false,
      venue: null,
      injuryStatus: null,
      ruledOut: false,
      projectedPoints: null,
      afProjectedPoints: null,
      indoors: null,
      weather: null,
      market: null,
      onBye: false,
    })
  }

  for (const id of ids) {
    if (out.has(id)) continue
    const described = parseDescriptiveId(id)
    if (!described) continue
    out.set(id, {
      sleeperId: id,
      name: described.name,
      position: described.position,
      team: described.team,
      sport,
      imageUrl: null,
      gameContext: null,
      kickoff: null,
      preseason: false,
      venue: null,
      injuryStatus: null,
      ruledOut: false,
      projectedPoints: null,
      afProjectedPoints: null,
      indoors: null,
      weather: null,
      market: null,
      onBye: false,
    })
  }

  return out
}

export async function getMyTeamData(leagueId: string, userId: string): Promise<MyTeamData | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true, name: true, platform: true, leagueType: true, sport: true,
      // `scoring_settings` lives in here — the basis for the league-specific number.
      settings: true,
      /*
       * ⚠ A SECOND, DIFFERENT LEAGUE ID. `WeeklyMatchup.leagueId` holds THIS
       * one, not `League.id`. Both are strings, so using the wrong one returns
       * an empty result instead of an error.
       */
      platformLeagueId: true,
      /* Only for the ESPN source link, which takes a seasonId. */
      season: true,
      // Superflex and dynasty both change which value market applies.
      isDynasty: true,
      starters: true,
    },
  })
  if (!league) return null

  const sport = String(league.sport ?? 'NFL')
  const base = {
    league: {
      id: league.id,
      name: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      format: league.leagueType ?? null,
      sourceLink: resolveSourceLink({
        platform: league.platform,
        sourceLeagueId: league.platformLeagueId,
        leagueName: leagueDisplayName(league.name),
        season: league.season,
        /* "Fix Lineup in <league>" — the action this screen is actually about. */
        action: 'lineup',
      }),
    },
    /*
     * The default for the early-return paths only — a roster we never found cannot
     * be projected. The full path overrides this with a real summary. It is
     * deliberately NOT phrased as "no feed exists", which is what it used to say
     * and was false: the feed carries 994 rows.
     */
    projections: {
      available: false as const,
      reason: 'no lineup found to project',
    },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: {
      available: false as const,
      reason: 'no schedule on file for this league yet',
    },
    upcomingByes: [],
    rosterGrade: {
      available: false as const,
      reason: 'no roster found to grade',
    },
    liveScore: { available: false as const, reason: 'no live scoring ingested for imported leagues' },
  }

  const myTeamRow = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: {
      teamName: true, ownerName: true, wins: true, losses: true, ties: true,
      pointsFor: true, pointsAgainst: true, currentRank: true,
      platformUserId: true, externalId: true,
      // The manager's own avatar. Already imported, never rendered until now.
      avatarUrl: true,
    },
  })

  const teamCount = await prisma.leagueTeam.count({ where: { leagueId } })

  if (!myTeamRow) {
    const unknown = {
      available: false as const,
      reason: 'we cannot tell which team in this league is yours — claim it and the lineup appears here',
    }
    return {
      ...base,
      /* No claimed team, so no lineup was read and no id was attempted. */
      identityNote: null,
      team: unknown,
      starters: unknown,
      bench: unknown,
      ir: unknown,
      taxi: unknown,
      lock: unknown,
    }
  }

  const anyResults =
    myTeamRow.wins > 0 || myTeamRow.losses > 0 || myTeamRow.ties > 0 || myTeamRow.pointsFor > 0

  const team: MyTeamData['team'] = {
    available: true,
    data: {
      teamName: myTeamRow.teamName,
      ownerName: myTeamRow.ownerName,
      managerAvatarUrl: myTeamRow.avatarUrl ?? null,
      // Same rule as screen 2: an all-zero record is an absence, not a result.
      record: anyResults
        ? myTeamRow.ties > 0
          ? `${myTeamRow.wins}-${myTeamRow.losses}-${myTeamRow.ties}`
          : `${myTeamRow.wins}-${myTeamRow.losses}`
        : 'No game in this league has been scored yet, so there is no record to read.',
      recordKnown: anyResults,
      rank: myTeamRow.currentRank,
      pointsFor: myTeamRow.pointsFor,
      pointsAgainst: myTeamRow.pointsAgainst,
      teamCount,
    },
  }

  /*
   * The candidate rule lives in `myRoster.ts` — the Defense Hub needs the same join, and this
   * one is delicate enough that a second copy would drift into rendering "no roster imported"
   * over rosters that are sitting right there. See that file for what each candidate buys.
   */
  const candidates = myRosterCandidates(myTeamRow, userId)
  const roster =
    candidates.length > 0
      ? await prisma.roster.findFirst({
          where: { leagueId, platformUserId: { in: candidates } },
          select: { playerData: true },
        })
      : null

  if (!roster) {
    const noRoster = {
      available: false as const,
      reason: 'no roster rows imported for your team in this league',
    }
    return {
      ...base,
      /* No roster rows, so nothing was resolved and nothing failed to resolve. */
      identityNote: null,
      team,
      starters: noRoster,
      bench: noRoster,
      ir: noRoster,
      taxi: noRoster,
      lock: noRoster,
    }
  }

  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const asIds = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []

  const starterIds = asIds(pd.starters)
  const allIds = asIds(pd.players)
  const reserveIds = asIds(pd.reserve)
  const taxiIds = asIds(pd.taxi)

  /*
   * ⚠ THE WEEK COMES FROM THE FEED, NOT FROM THE LEAGUE'S CLOCK. `currentWeek` and
   * the week the projection cron last wrote drift apart constantly, and asking for
   * a week nobody has written yet returns nothing — which would render "no
   * projections" on a screen whose actual problem was asking the wrong question.
   */
  const projectionWeek = await latestProjectionWeek()

  /*
   * The REAL-WORLD week, which is a different question from the week the
   * projection feed last wrote. They drift, and conflating them is how a
   * roster ends up showing week-1 projections beside November opponents.
   */
  const sportsWeek = await resolveSportsWeek(sport)

  /*
   * Null here is a real state, not a failure: plenty of imported leagues never
   * recorded their scoring. The screen then shows the generic projection alone
   * and says why there is no league-specific one, rather than printing the
   * generic number twice under two different labels.
   */
  const scoringSettings = extractScoringSettings(league.settings)

  const resolved = await resolvePlayers(
    [...new Set([...starterIds, ...allIds, ...reserveIds, ...taxiIds])],
    sport,
    projectionWeek,
    sportsWeek,
    scoringSettings,
    String(league.platform ?? '')
  )

  // Sleeper encodes an unfilled starting slot as "0" — that is the handoff's
  // "FLEX is empty" state, and it must survive as an empty slot rather than
  // being filtered out into a shorter lineup that looks complete.
  /*
   * ⚠ THE SLOT NAME COMES FROM THE LEAGUE, NOT FROM WHOEVER IS STANDING IN IT.
   * `inferSlotLabel` reads the player's position, so a FLEX holding a tight end
   * rendered as "TE" — and the bench check below would then have refused every
   * running back who is in fact eligible for that slot. The label and the
   * eligibility rule have to come from one place. `roster_positions` is present
   * on 70 of 70 Sleeper leagues in production; inference stays as the fallback
   * for a league that carries no template.
   */
  const slotTemplate = startingSlotTemplate(league.settings)

  const starterSlots = starterIds.map((id, i) => {
    const isEmptySlot = id === '0'
    const player = isEmptySlot ? null : resolved.get(id) ?? null
    return {
      slotLabel: slotTemplate?.[i] ?? inferSlotLabel(player?.position ?? null, i),
      player,
      empty: isEmptySlot,
      // Present id, no player row — a lookup failure, NOT an empty slot.
      unresolvedId: !isEmptySlot && player == null ? id : null,
    }
  })

  /*
   * ⚠ TAXI WAS MISSING FROM THIS FILTER AND EVERY TAXI PLAYER RENDERED TWICE.
   * `players` is the whole roster, so the bench is what is left after removing
   * every other section. Excluding IR but not taxi put taxi players on the
   * bench AND in the reserve list below it — the same player, twice, in two
   * places that imply different things about whether he can be started.
   */
  const starterSet = new Set(starterIds)
  const reserveSet = new Set(reserveIds)
  const taxiSet = new Set(taxiIds)
  const benchIds = allIds.filter(
    (id) => !starterSet.has(id) && !reserveSet.has(id) && !taxiSet.has(id),
  )

  /* ── The bench check ─────────────────────────────────────────────────────
   *
   * For each starting slot, the strongest BENCH player who is actually eligible
   * to fill it and projects higher under this league's own scoring.
   *
   * ⚠ EVERY GUARD BELOW IS THE DIFFERENCE BETWEEN ADVICE AND NOISE:
   *
   *   · Eligibility, from the league's own slot template. Without it the screen
   *     cheerfully reports that your kicker outprojects your quarterback.
   *   · `afProjectedPoints`, never the generic PPR figure. A recommendation
   *     scored for a league nobody is in is worse than none.
   *   · An UNPRICED player on either side ends the comparison. Null is not zero,
   *     and a player must never lose a contest he was never entered into.
   *   · A bench player on bye or ruled OUT is skipped — he is a guaranteed zero,
   *     and pointing at one is the exact mistake this feature exists to catch.
   *
   * A starter who is himself on bye or OUT is scored at 0 rather than skipped:
   * that is the single case where zero is the honest number, and it is precisely
   * when a manager most needs to be told there is a body on the bench.
   */
  const benchPlayers = benchIds
    .map((id) => resolved.get(id))
    .filter((p): p is LineupPlayer => p != null)

  /*
   * ⚠ ONE BENCH PLAYER IS OFFERED AT ONE SLOT, NOT AT EVERY SLOT HE BEATS.
   * Scoring each slot independently put Garrett Wilson on a real roster's WR
   * row AND both FLEX rows — three amber strips describing ONE substitution.
   * That reads as three problems and overstates what is actually on the bench.
   *
   * So candidate pairs are ranked by gap and assigned greedily, each bench
   * player and each slot used at most once: the biggest single improvement is
   * claimed first, and a slot whose best option has already gone elsewhere then
   * surfaces its NEXT-best eligible player rather than falling silent.
   */
  type BenchCandidate = {
    slotIndex: number
    bench: LineupPlayer
    benchProj: number
    starter: LineupPlayer
    starterProj: number
    gap: number
  }

  const benchCandidates: BenchCandidate[] = []
  starterSlots.forEach((slot, slotIndex) => {
    const starter = slot.player
    if (!starter || slot.empty) return

    /*
     * A starter on bye or ruled OUT is scored at 0 rather than skipped. That is
     * the single case where zero is the honest number, and it is exactly when a
     * manager most needs to be told there is a body on the bench.
     */
    const starterProj = starter.onBye || starter.ruledOut ? 0 : starter.afProjectedPoints
    if (starterProj == null) return

    for (const bench of benchPlayers) {
      const benchProj = bench.afProjectedPoints
      /*
       * ⚠ EVERY GUARD HERE IS THE DIFFERENCE BETWEEN ADVICE AND NOISE:
       *   · unpriced on either side ends it — null is not zero, and a player
       *     must never lose a contest he was never entered into;
       *   · a bench player on bye or OUT is a guaranteed zero, and pointing at
       *     one is the exact mistake this feature exists to catch;
       *   · eligibility comes from the league's own slot template, without which
       *     the screen reports that your kicker outprojects your quarterback.
       */
      if (benchProj == null || bench.onBye || bench.ruledOut) continue
      if (!isEligibleForSlot(slot.slotLabel, bench.position)) continue
      if (benchProj <= starterProj) continue
      benchCandidates.push({
        slotIndex,
        bench,
        benchProj,
        starter,
        starterProj,
        gap: benchProj - starterProj,
      })
    }
  })

  benchCandidates.sort((a, b) => b.gap - a.gap)

  const checkBySlot = new Map<number, BenchCheck>()
  const claimedBench = new Set<string>()
  for (const c of benchCandidates) {
    if (checkBySlot.has(c.slotIndex) || claimedBench.has(c.bench.sleeperId)) continue
    claimedBench.add(c.bench.sleeperId)
    checkBySlot.set(c.slotIndex, {
      verdict: c.gap >= BENCH_SWAP_POINTS ? 'swap' : 'close',
      benchName: c.bench.name,
      benchProjected: c.benchProj,
      starterName: c.starter.name,
      starterProjected: c.starterProj,
    })
  }

  const starters: LineupSlot[] = starterSlots.map((slot, i) => ({
    ...slot,
    benchCheck: checkBySlot.get(i) ?? null,
  }))

  const kickoffs = starters
    .map((s) => s.player?.kickoff)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())

  /*
   * ⚠ SUMMARISED OVER THE STARTERS AS STORED — INCLUDING THE "0" HOLES. An empty
   * slot is genuinely worth nothing to the lineup, but it is also not a player we
   * failed to price, so it must not inflate `unprojected` into a coverage problem.
   * Filtering it out here keeps the two failure modes — "you have a hole" and "we
   * can't price this guy" — separate, because the fixes are different.
   */
  const projectedIds = starterIds.filter((id) => id !== '0')
  const lineup = summariseLineup(
    projectedIds,
    new Map(
      projectedIds
        .map((id) => [id, resolved.get(id)] as const)
        .filter(([, p]) => p != null && p.projectedPoints != null)
        .map(([id, p]) => [
          id,
          {
            playerId: id,
            projectedPoints: p!.projectedPoints as number,
            name: p!.name,
            position: p!.position,
            team: p!.team,
            // summariseLineup only totals points; the component line is not its
            // business, and passing the roster's copy would imply it was.
            componentStats: null,
          },
        ])
    )
  )

  /*
   * The league-scored total, summed over the same starters.
   *
   * ⚠ COUNTED SEPARATELY FROM THE GENERIC TOTAL, NOT ASSUMED TO MATCH IT. A
   * player can carry a vendor projection and still fail to produce a
   * league-scored one — that is exactly what happens when a league's scoring
   * keys do not match the projected stat line. Reusing the generic coverage
   * count would report a total built from six starters as though it came from
   * eight.
   */
  let afTotal = 0
  let afProjected = 0
  for (const id of projectedIds) {
    const v = resolved.get(id)?.afProjectedPoints
    if (v == null) continue
    afTotal += v
    afProjected += 1
  }

  const scoringNotes = describeScoringDifferences(scoringSettings)

  /*
   * Null when the question cannot be answered — no recorded taxi-years limit,
   * or no season-end snapshots to count against it. The section then shows the
   * players without a countdown, because a confident "1 year left" that is
   * wrong is how someone loses a player to a deadline they thought they had.
   */
  const tenure = taxiIds.length > 0 ? await getTaxiTenure(leagueId, taxiIds) : null

  /*
   * The league's own week, which is a third clock again — distinct from both
   * the projection feed's week and the real-world NFL week. Matchups are keyed
   * by it, and it is resolved from the matchup rows themselves rather than a
   * calendar because sync bootstraps every week as an unscored 0-0 row.
   */
  const leagueWeek = league.platformLeagueId
    ? await resolveCurrentWeekForLeague(league.platformLeagueId)
    : null

  /*
   * Byes for THIS week (to flag a starter who is not playing) and the next few
   * (to show a stack forming). Null whenever the schedule is too thin to tell a
   * bye from a gap in ingestion — see byeWeeks.ts.
   */
  /*
   * One cache read for the whole roster. Keyed by the HOST team, because the
   * forecast belongs to the stadium the game is played in, not to the player.
   */
  const weather = await getGameWeather({
    sport,
    games: new Map(
      [...resolved.values()].map((p) => [
        p.sleeperId,
        {
          hostTeam: p.gameContext?.includes(' @ ')
            ? (p.gameContext.split(' @ ')[1] ?? '').split(' · ')[0]
            : p.team,
          kickoff: p.kickoff,
        },
      ]),
    ),
  }).catch(() => new Map())

  for (const [id, w] of weather) {
    const p = resolved.get(id)
    if (p) p.weather = w
  }

  /*
   * One read for the whole app, cached and user-independent — own and start
   * rates are a property of the league corpus, not of who is looking.
   *
   * Scoped to this league's format: a player started in every dynasty league
   * can be a waiver add in redraft, and blending those describes neither.
   */
  const market = await getRosteredMarket({
    sport,
    dynastyOnly: league.isDynasty ?? null,
  }).catch(() => null)

  if (market && market.leaguesCounted >= MIN_LEAGUES_FOR_MARKET) {
    for (const p of resolved.values()) {
      const row = market.byPlayerId.get(p.sleeperId)
      /*
       * Absent from the board means nobody rosters him — genuinely 0% owned,
       * and an undefined start rate. That is a real reading, not a gap.
       */
      p.market = row
        ? { ownPct: row.ownPct, startPct: row.startPct }
        : { ownPct: 0, startPct: null }
    }
  }

  const byes = sportsWeek
    ? await getByeWeeks({
        sport,
        season: sportsWeek.season,
        playerTeams: new Map([...resolved.values()].map((p) => [p.sleeperId, p.team])),
        fromWeek: sportsWeek.week,
      }).catch(() => null)
    : null

  if (byes && sportsWeek) {
    for (const id of byes.byWeek.get(sportsWeek.week) ?? []) {
      const p = resolved.get(id)
      if (!p) continue
      p.onBye = true
      /*
       * A player on bye scores nothing, and unlike "no projection on file" that
       * is a fact — the same rule as a ruled-out player. Leaving a stale number
       * beside a bye badge would be the screen arguing with itself.
       */
      p.projectedPoints = 0
      p.afProjectedPoints = 0
    }
  }

  const upcomingByes = byes
    ? [...byes.byWeek.entries()]
        .filter(([w]) => w !== sportsWeek?.week)
        .sort((a, b) => a[0] - b[0])
        .slice(0, 4)
        .map(([week, ids]) => ({
          week,
          names: ids.map((id) => resolved.get(id)?.name).filter(Boolean) as string[],
        }))
        .filter((b) => b.names.length > 0)
    : []

  const grade = await getRosterGrade({
    leagueId,
    myPlatformUserIds: candidates,
    isDynasty: Boolean(league.isDynasty),
    starters: league.starters,
    /*
     * The same scoring map that produces the AF column on every roster row, so
     * the grade is a ranking IN THIS LEAGUE rather than against a 12-team
     * full-PPR market this league may look nothing like. Without these two the
     * ledger layer cannot run and the grade silently falls back to raw market
     * prices — honest, but a weaker claim, and `basis.leagueScored` says which.
     */
    scoringSettings,
    projectionWeek,
  }).catch(() => null)

  const matchup = leagueWeek
    ? await getNextMatchup({
        leagueId,
        platformLeagueId: league.platformLeagueId,
        myExternalId: myTeamRow.externalId,
        // The third candidate key for OUR roster; see the join note in nextMatchup.ts.
        userId,
        seasonYear: leagueWeek.seasonYear,
        week: leagueWeek.week,
        scoringSettings,
        projectionWeek,
      }).catch(() => null)
    : null

  return {
    ...base,
    team,
    projectionBasis: { notes: scoringNotes, scoringKnown: scoringSettings != null },
    upcomingByes,
    rosterGrade: grade
      ? { available: true, data: grade }
      : {
          available: false,
          /*
           * One reason, and it names the input that is missing. The old copy
           * said we "do not compute positional replacement levels", which
           * stopped being true and would have gone on claiming a limitation
           * that no longer existed.
           */
          reason:
            'we need prices for most of this league’s rosters to rank yours against them, and we do not have them yet',
        },
    nextMatchup: matchup
      ? { available: true, data: matchup }
      : {
          available: false,
          reason: leagueWeek
            ? `no week ${leagueWeek.week} matchup recorded for your team yet`
            : 'no schedule on file for this league yet',
        },
    projections:
      projectionWeek && projectedIds.length > 0
        ? {
            available: true,
            data: {
              ...lineup,
              season: projectionWeek.season,
              week: projectionWeek.week,
              afTotal: afProjected > 0 ? Math.round(afTotal * 100) / 100 : null,
              afProjected,
              // Comparable only when both totals were built from the same
              // players. IDP suppression is what breaks that.
              standardComparable: !hasIdpScoring(scoringSettings),
            },
          }
        : {
            available: false,
            reason: projectionWeek
              ? 'no starters to project on this roster'
              : 'no weekly projection feed has been ingested yet',
          },
    starters:
      starters.length > 0
        ? { available: true, data: starters }
        : { available: false, reason: 'no starting lineup recorded on this roster' },
    /*
     * Counted over filled starting slots only. An EMPTY slot is a hole in the
     * lineup, not an id we failed to resolve, and folding the two together
     * would report a manager's own unfilled FLEX as our identity failure.
     */
    identityNote: identityGapNote({
      platform: String(league.platform ?? 'manual').toLowerCase(),
      total: starters.filter((sl) => !sl.empty).length,
      named: starters.filter((sl) => !sl.empty && sl.player != null).length,
      /*
       * ⚠ PRICED, NOT MERELY NAMED — and this distinction is the whole reason
       * the note survives the provider-name bridge. An id named from
       * `providerIdentityNames` carries no position and no club, so it yields no
       * projection and the bench check skips it entirely. Counting those as
       * resolved would silence this note at the exact moment a manager is
       * looking at eleven named players, no numbers, and no bench advice, with
       * nothing on screen saying why.
       */
      priced: starters.filter((sl) => !sl.empty && sl.player?.afProjectedPoints != null).length,
    }),
    bench:
      benchIds.length > 0
        ? { available: true, data: benchIds.map((id) => resolved.get(id)).filter(Boolean) as LineupPlayer[] }
        : { available: false, reason: 'no bench players recorded on this roster' },
    ir:
      reserveIds.length > 0
        ? {
            available: true,
            data: reserveIds.map((id) => resolved.get(id)).filter(Boolean) as LineupPlayer[],
          }
        : { available: false, reason: 'nobody on injured reserve' },
    taxi:
      taxiIds.length > 0
        ? {
            available: true,
            data: taxiIds
              .map((id) => {
                const p = resolved.get(id)
                return p ? { ...p, tenure: tenure?.get(id) ?? null } : null
              })
              .filter(Boolean) as Array<LineupPlayer & { tenure: TaxiTenure | null }>,
          }
        : { available: false, reason: 'nobody on the taxi squad' },
    lock:
      kickoffs.length > 0
        ? {
            available: true,
            data: {
              at: kickoffs[0],
              anyEmptySlot: starters.some((s) => s.empty),
              week: sportsWeek?.week ?? null,
              season: sportsWeek?.season ?? null,
              daysAway: Math.round((kickoffs[0].getTime() - Date.now()) / 86_400_000),
            },
          }
        : {
            available: false,
            reason: sportsWeek
              ? `no week ${sportsWeek.week} game found for any of your starters yet`
              : 'no upcoming game found for your starters, so there is no lock time to count down to',
          },
  }
}
