import 'server-only'

import { prisma } from '@/lib/prisma'
import { getFirstStatedKickoff } from './seasonPhase'
import { isScored, resolveCurrentWeekFrom, resolveStatedWeek } from './currentWeek'
import { leagueWeekProgress } from './leagueWeekProgress'
import { readLeagueWeekMetadata } from './leagueWeekMetadata'
import { leagueArtUrl, managerArtUrl } from './leagueArt'
import { MIN_WEEKS_FOR_PROJECTION } from './weekBoardRules'

/**
 * 24a "Your Week" and 24b "Rivalry Radar" — one read, two views.
 *
 * Both screens are built from the same table and the same pairing, so they share
 * a loader. Splitting them would mean two passes over the same rows and, worse,
 * two chances for the two screens to disagree about who beat whom.
 *
 * ⚠ THE JOIN IS `League.platformLeagueId`, NOT `League.id`. WeeklyMatchup is
 * written from Sleeper's payload, so its `leagueId` holds the PLATFORM league id
 * and its `rosterId` holds Sleeper's numeric roster_id. `lib/core-app/weekAll.ts`
 * carries the measurement: joining on `League.id` matches 0 rows and returns an
 * empty set with no error. Same trap, same join, stated again because this file
 * is where somebody would next make the mistake.
 *
 * ⚠ THE PROJECTION MODEL IS DEFINED HERE, IN FULL, AND IS DELIBERATELY SMALL.
 * The handoff asks for win probabilities and a "coin flip" grouping, and this
 * database has no projection engine behind a cross-league matchup list. So
 * rather than omit the screen or invent a number, this computes one from the
 * only thing actually on file — each roster's own scored weeks:
 *
 *     µ  = mean pointsFor over that roster's COMPLETED weeks
 *     σ  = sample standard deviation of the same, floored (see SIGMA_FLOOR)
 *     P(win) = Φ( (µ_you − µ_them) / √(σ_you² + σ_them²) )
 *
 * That is a heuristic, not a simulation, and every surface that renders it is
 * required to say so and to print `sampleSize` — which is why `WeekBoard.model`
 * is not optional. A win probability with no visible n is the failure mode this
 * whole comment exists to prevent.
 *
 * ⚠ A ROSTER WITH TOO FEW COMPLETED WEEKS GETS NO PROJECTION AT ALL, and its
 * matchup lands in `unprojected` rather than being defaulted to 50%. Two teams
 * about whom we know nothing are not a coin flip; they are an unknown, and those
 * are different claims.
 */

/*
 * ⚠ `MIN_WEEKS_FOR_PROJECTION` NOW LIVES IN `weekBoardRules.ts`, WITH
 * `COIN_FLIP_POINTS`, because the SCREEN needs it too — `WeekBoard.tsx` lists
 * the unprojectable matchups and says how far short of the threshold each one
 * is. It is imported above rather than restated here; see that file's header
 * for why a shared threshold cannot live in this `server-only` module.
 */

/**
 * Floor on σ. A roster with two near-identical weeks produces a σ near zero,
 * which drives Φ to 0 or 1 and prints "99% to win" off a two-game sample. The
 * floor is roughly a typical week-to-week fantasy swing and keeps the tail sane.
 */
const SIGMA_FLOOR = 12

/*
 * The coin-flip threshold lives in `weekBoardRules.ts`, not here.
 *
 * ⚠ IT MOVED BECAUSE THIS MODULE IS `server-only` AND THE SCREEN IS A CLIENT
 * COMPONENT. `YourWeek.tsx` imported the constant from this file, which dragged
 * `server-only` (and prisma behind it) into the client bundle and 500'd the
 * whole `/core` catch-all — every screen on that route, not just this one. tsc
 * does not catch it; it is a bundler boundary, not a type error. Re-exported
 * here so server-side callers still have one obvious place to find it.
 */
export { COIN_FLIP_POINTS } from './weekBoardRules'
import { COIN_FLIP_POINTS } from './weekBoardRules'

/**
 * Guillotine and survivor leagues eliminate the LOWEST score each week, so the
 * weekly stake is existential rather than a head-to-head result. Read off
 * `League.leagueType`, where the create wizard and the importers both record
 * the format — no new query, no guess.
 */
export function isEliminationFormat(leagueType: string | null | undefined): boolean {
  const t = String(leagueType ?? '').toLowerCase()
  return t.includes('guillotine') || t.includes('survivor')
}

// ── Types ──────────────────────────────────────────────────────────────

export type WeekOpponent = {
  rosterId: string
  /** Null when no LeagueTeam row names this roster — never a made-up name. */
  name: string | null
  /**
   * The team's avatar as a loadable URL, via `managerArtUrl` — a bare Sleeper
   * avatar id is expanded to the CDN, anything unresolvable is null. Null means
   * "render initials", not "still loading".
   */
  avatarUrl: string | null
}

export type WeekMatchup = {
  leagueId: string
  leagueName: string
  platform: string
  /** League artwork via `leagueArtUrl`. Null renders the monogram crest. */
  leagueImageUrl: string | null
  season: number
  week: number
  opponent: WeekOpponent
  /**
   * True for guillotine/survivor leagues, where the LOWEST score each week is
   * eliminated. The weekly stake is categorically different from head-to-head,
   * so surfaces say so; nothing else about the card changes.
   */
  elimination: boolean
  /** Null when either side has too little history — see MIN_WEEKS_FOR_PROJECTION. */
  projection: {
    you: number
    them: number
    /** Signed: positive means you are projected ahead. */
    margin: number
    /** 0–1. */
    winProbability: number
  } | null
  /**
   * The fallback signal when `projection` is null: what each side has actually
   * averaged over the weeks on file.
   *
   * 🛑 IT IS NOT A PROJECTION AND CARRIES NO WIN PROBABILITY, deliberately.
   * `MIN_WEEKS_FOR_PROJECTION` exists because a one- or two-week sample has no
   * usable sigma, and `winProbabilityOf` needs one — a probability computed off
   * two games would be a confident number with nothing behind it. A MEAN is
   * still honest at n=1: it is a statement about what happened, not a forecast.
   *
   * Null when EITHER side has no scored week at all, which is the genuine
   * "nothing to say" case rather than the thin one.
   */
  form: {
    you: number
    them: number
    /** Signed: positive means you have outscored them so far. */
    margin: number
    /** The THINNER of the two sides' week counts — what the comparison rests on. */
    weeks: number
  } | null
  /** Completed weeks behind YOUR side of the projection. */
  yourSampleWeeks: number
  href: string
}

/** One matchup in the focused league that the user is NOT playing in. */
export type LeagueSideline = {
  a: { rosterId: string; name: string | null; avatarUrl: string | null; projected: number | null }
  b: { rosterId: string; name: string | null; avatarUrl: string | null; projected: number | null }
  /** Probability side A wins. Null when either side is unprojectable. */
  aWinProbability: number | null
}

/**
 * One league's own week — the hero matchup plus the rest of that league's
 * board.
 *
 * ⚠ THE SIDELINE GAMES WERE ALWAYS COMPUTED AND ALWAYS DISCARDED. `pairRows`
 * pairs every matchup in the week and the cross-league loop drops any pair the
 * user is not in (`if (!aIsMine && !bIsMine) continue`). That is correct for a
 * board about your nine leagues and wrong for a screen about one league, where
 * the other five games are half the story.
 */
export type LeagueWeekBoard = {
  leagueId: string
  leagueName: string
  platform: string
  season: number
  week: number
  /** Your own matchup. Null when you have no game this week (bye, or unmatched). */
  yours: WeekMatchup | null
  /** Every other matchup in the league this week. */
  sidelines: LeagueSideline[]
  /**
   * All-time head-to-head against THIS week's opponent, from every season on
   * file. Null when they have never met before — which is a real answer for a
   * first-season league and not the same as 0-0.
   */
  rivalry: {
    wins: number
    losses: number
    meetings: number
    averageMargin: number
  } | null
  /**
   * Current-season W-L by rosterId, from SCORED rows only.
   *
   * ⚠ AN ABSENT ROSTER MEANS "HAS NOT PLAYED", NOT 0-0. A freshly synced league
   * carries a whole season of 0-0 rows, so a roster with no entry here has no
   * record yet — printing 0-0 beside a team name would state a fact that does
   * not exist. The screen renders nothing for an absent roster.
   */
  records: Record<string, { wins: number; losses: number }>
  /** The user's roster in this league, for looking up their own record. */
  yourRosterId: string | null
  /** The team name the platform published, when it published one. */
  yourTeamName: string | null
  /** Your team's avatar, resolved the same way as `WeekOpponent.avatarUrl`. */
  yourAvatarUrl: string | null
}

export type WeekBoard = {
  season: number | null
  week: number | null
  /** Projected within COIN_FLIP_POINTS. Ordered closest-first. */
  coinFlips: WeekMatchup[]
  /** Already leaning one way. Ordered by how lopsided. */
  leaning: WeekMatchup[]
  /** Scheduled, but neither side has enough history to project. */
  unprojected: WeekMatchup[]
  /**
   * Guillotine/survivor weeks, which have no opponent and so cannot be a `WeekMatchup`.
   * Kept a separate bucket rather than forced into `unprojected` with an invented
   * opponent — see `buildEliminationWeeks`.
   */
  eliminationWeeks: EliminationWeek[]
  /** Stated on the screen, never implied. */
  model: {
    basis: string
    /** Total completed roster-weeks the projections were fitted on. */
    sampleSize: number
  }
  /** Leagues of the user's that carry no schedule for this week at all. */
  withoutSchedule: number
  /**
   * First future kickoff a source STATES is regular season, ISO — null when
   * none is stated. Lets the empty state say "the season has not started"
   * instead of prescribing a re-sync. See lib/core-app/seasonPhase.ts.
   */
  firstKickoffAt: string | null
  /**
   * The focused league's own board, when the caller asked for one. Keyed off
   * `focusLeagueId` so a cross-league render pays nothing for it.
   */
  leagueBoard: LeagueWeekBoard | null
}

export type RivalryCard = {
  leagueId: string
  leagueName: string
  platform: string
  opponent: WeekOpponent
  /** All-time, across every synced season. */
  series: { wins: number; losses: number; meetings: number }
  /** Signed average margin across the series, from your side. */
  averageMargin: number
  closest: {
    season: number
    week: number
    margin: number
    /** True when you won that one. */
    won: boolean
  } | null
  /** This week's meeting, when they are on your schedule. */
  thisWeek: { winProbability: number | null; projectedMargin: number | null } | null
  /**
   * ⚠ A SINGLE MEETING IS NOT A RIVALRY, and the copy contract forbids calling
   * it one. Surfaces read this flag rather than re-deriving it from `meetings`,
   * so the judgement is made once.
   */
  sampleTooSmall: boolean
}

export type RivalryRadar = {
  season: number | null
  week: number | null
  /** Series the opponent leads. */
  theyOwnYou: RivalryCard[]
  /** Series you lead. */
  youOwnThem: RivalryCard[]
  /** Level series, and single meetings — shown, but never as "rivalries". */
  even: RivalryCard[]
  /** The closest series that is ALSO closest today. Null when nothing qualifies. */
  oneToWatch: RivalryCard | null
  /** How much history the whole view is built from. */
  totals: { seasons: number; meetings: number; platforms: number }
  /**
   * First future kickoff a source STATES is regular season, ISO — null when
   * none is stated. Drives the phase-aware empty state; see
   * lib/core-app/seasonPhase.ts.
   */
  firstKickoffAt: string | null
}

// ── Math ───────────────────────────────────────────────────────────────

/**
 * Standard normal CDF via Abramowitz & Stegun 7.1.26 for erf. Max absolute
 * error 1.5e-7 — far tighter than anything a win probability rounded to a whole
 * percent can express.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * P(a beats b) under the model in this file's header. Exported so the pre-game odds snapshot
 * (`matchupOddsSweep`) and the board can never compute a different number for the same matchup.
 */
export function winProbabilityOf(a: { mu: number; sigma: number }, b: { mu: number; sigma: number }): number {
  return normalCdf((a.mu - b.mu) / Math.sqrt(a.sigma ** 2 + b.sigma ** 2))
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stdev(values: number[]): number {
  if (values.length < 2) return SIGMA_FLOOR
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1)
  return Math.max(SIGMA_FLOOR, Math.sqrt(variance))
}

// ── Shared read ────────────────────────────────────────────────────────

type LeagueInput = {
  id: string
  name?: string | null
  platform?: string | null
  platformLeagueId?: string | null
  /** `League.leagueType`. Carried through only to flag elimination formats. */
  leagueType?: string | null
  /** `League.logoUrl` / `League.avatarUrl`. Carried through only for the crest. */
  logoUrl?: string | null
  avatarUrl?: string | null
}

export type MatchupRow = {
  finalized?: boolean
  leagueId: string
  seasonYear: number
  week: number
  rosterId: string
  matchupId: number | null
  pointsFor: number
  pointsAgainst: number
  win: number
}

type History = {
  /** Every row, all seasons, for leagues the user is in. */
  rows: MatchupRow[]
  /** platformLeagueId → league metadata. */
  leagueByPlatformId: Map<string, LeagueMeta>
  /** "platformLeagueId:rosterId" → the user owns this roster. */
  myRosters: Map<string, string>
  /** "platformLeagueId:rosterId" → team name, when one is on file. */
  rosterNames: Map<string, string>
  /** "platformLeagueId:rosterId" → loadable avatar URL, when one resolves. */
  rosterAvatars: Map<string, string>
  latest: { season: number; week: number } | null
}

type LeagueMeta = {
  id: string
  name: string
  platform: string
  elimination: boolean
  imageUrl: string | null
}

async function readHistory(userId: string, leagues: LeagueInput[]): Promise<History | null> {
  const platformIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (platformIds.length === 0) return null

  /*
   * Internal `League.id` → that league's CURRENT platform id. `MatchupFact` is keyed on the
   * internal id (one id for every season); `WeeklyMatchup` and `buildProfiles` are keyed on the
   * platform id. See `priorSeasonRowsFromFacts` — this map is the bridge between the two.
   */
  const platformIdByLeagueId = new Map<string, string>()
  for (const l of leagues) {
    if (typeof l.platformLeagueId === 'string' && l.platformLeagueId.length > 0) {
      platformIdByLeagueId.set(l.id, l.platformLeagueId)
    }
  }

  const [rows, teams, mine, priorFacts, periodMetadata] = await Promise.all([
    prisma.weeklyMatchup.findMany({
      where: { leagueId: { in: platformIds } },
      select: {
        leagueId: true,
        seasonYear: true,
        week: true,
        rosterId: true,
        matchupId: true,
        pointsFor: true,
        pointsAgainst: true,
        win: true,
      },
    }),
    /*
     * Every team in these leagues, not just the user's — this is what names an
     * OPPONENT. Without it a rivalry card can only say "roster 7", and a rivalry
     * against a number is not a rivalry.
     */
    prisma.leagueTeam.findMany({
      where: { league: { platformLeagueId: { in: platformIds } } },
      select: {
        externalId: true,
        teamName: true,
        ownerName: true,
        /*
         * The avatar column holds a bare id on Sleeper and a URL elsewhere, so
         * it is only ever read through `managerArtUrl` — which needs the
         * platform, hence `league.platform` beside it.
         */
        avatarUrl: true,
        league: { select: { platformLeagueId: true, platform: true } },
      },
    }),
    prisma.leagueTeam.findMany({
      where: {
        league: { platformLeagueId: { in: platformIds } },
        claimedByUserId: userId,
      },
      select: {
        externalId: true,
        avatarUrl: true,
        league: { select: { platformLeagueId: true, platform: true } },
      },
    }),
    /*
     * Prior seasons. See `priorSeasonRowsFromFacts` for why this table and not `WeeklyMatchup`:
     * every platform's historical backfill writes per-week rows here, keyed on the INTERNAL
     * league id, and nothing folded them into a projection until now.
     *
     * 🛑 THE try/catch IS NOT A `.catch()`, AND THAT DISTINCTION IS THE BUG THIS SHIPPED WITH.
     * `prisma.matchupFact.findMany(...).catch(...)` reads a PROPERTY before it builds a promise.
     * Where the delegate is absent, the throw is SYNCHRONOUS — no promise exists yet, so
     * `.catch` never runs, `Promise.all` rejects, and `readHistory` returns null. A board that
     * the current season could fill perfectly well goes blank, which is the exact opposite of
     * what the fail-open was written to guarantee. It was caught by seven red tests in a suite
     * whose prisma mock lists the two delegates this module used to read.
     *
     * A league with no imported history is the NORMAL case; the fold is additive by
     * construction, and neither an empty result nor a failed read may cost the reader a board.
     */
    (async () => {
      try {
        return await prisma.matchupFact.findMany({
          where: { leagueId: { in: [...platformIdByLeagueId.keys()] } },
          select: {
            leagueId: true,
            season: true,
            weekOrPeriod: true,
            teamA: true,
            teamB: true,
            scoreA: true,
            scoreB: true,
          },
        })
      } catch {
        return [] as Array<{
          leagueId: string
          season: number | null
          weekOrPeriod: number
          teamA: string
          teamB: string
          scoreA: number
          scoreB: number
        }>
      }
    })(),
    readLeagueWeekMetadata(leagues.map((l) => l.id)),
  ])

  /*
   * Which (league, season) pairs `WeeklyMatchup` already covers. A fact for one of these is
   * DROPPED rather than added — see `priorSeasonRowsFromFacts`: double-counting a week would
   * tighten sigma and inflate n at the same time, making a projection look better-evidenced
   * than it is.
   */
  const seasonsAlreadyHeld = new Set<string>()
  for (const r of rows) seasonsAlreadyHeld.add(`${r.leagueId}:${r.seasonYear}`)

  const priorRows = priorSeasonRowsFromFacts(priorFacts, platformIdByLeagueId, seasonsAlreadyHeld)

  /*
   * ⚠ THE GUARD IS ON THE COMBINED SET, NOT ON `rows`. It used to return null when
   * `WeeklyMatchup` was empty, which would now discard a league whose entire history is in
   * `MatchupFact` — exactly the league this change exists to serve.
   */
  if (rows.length === 0 && priorRows.length === 0) return null

  const leagueByPlatformId = new Map<string, LeagueMeta>()
  for (const l of leagues) {
    if (!l.platformLeagueId) continue
    leagueByPlatformId.set(l.platformLeagueId, {
      id: l.id,
      name: l.name?.trim() || 'League',
      platform: String(l.platform ?? 'manual').toLowerCase(),
      elimination: isEliminationFormat(l.leagueType),
      imageUrl: leagueArtUrl({ logoUrl: l.logoUrl, avatarUrl: l.avatarUrl, platform: l.platform }),
    })
  }

  /* The team row's own league platform first; the caller's copy if the row lacks one. */
  const platformOf = (t: { league?: { platform?: string | null } | null }, pid: string) =>
    t.league?.platform ?? leagueByPlatformId.get(pid)?.platform ?? null

  const rosterNames = new Map<string, string>()
  const rosterAvatars = new Map<string, string>()
  for (const t of teams) {
    const pid = t.league?.platformLeagueId
    if (!pid || !t.externalId) continue
    // teamName is what shows in the platform's own UI; ownerName is the person.
    // Prefer the team, fall back to the person, never to a placeholder.
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (label) rosterNames.set(`${pid}:${t.externalId}`, label)
    const avatar = managerArtUrl({ avatarUrl: t.avatarUrl, platform: platformOf(t, pid) })
    if (avatar) rosterAvatars.set(`${pid}:${t.externalId}`, avatar)
  }

  const myRosters = new Map<string, string>()
  for (const t of mine) {
    const pid = t.league?.platformLeagueId
    if (!pid || !t.externalId) continue
    myRosters.set(`${pid}:${t.externalId}`, t.externalId)
    /*
     * The row the user actually claimed wins for their own avatar. Several
     * League copies can share one platformLeagueId, and the claimed one is the
     * copy whose team is unambiguously theirs.
     */
    const avatar = managerArtUrl({ avatarUrl: t.avatarUrl, platform: platformOf(t, pid) })
    if (avatar) rosterAvatars.set(`${pid}:${t.externalId}`, avatar)
  }

  /*
   * ⚠ "THIS WEEK" IS THE EARLIEST UNPLAYED WEEK, NOT `max(week)`. This is the one
   * that bit: the obvious reading — latest season, latest week on file — is what
   * weekAll.ts does, and it is right there only because every row it sees is a
   * COMPLETED 2025 week, so the last row on file is the last week played.
   *
   * Measured on production 2026-08-23, that assumption no longer holds:
   *
   *     season 2025: 298 rows, 204 scored, weeks to 17
   *     season 2026: 9,354 rows, **0 scored**, weeks to 18
   *
   * A whole season of schedule is written before a single game is played. Taking
   * the maximum week therefore selected 2026 week 18 — the last week of the
   * regular season — and rendered it as "your week" in August. The screen was not
   * empty and threw no error; it was confidently showing the wrong week.
   *
   * The rule that is right under both shapes: within the latest season on file,
   * the current week is the EARLIEST week that still has an unscored row. When
   * every week is scored the season is over, and the last one is the honest
   * answer.
   */
  /*
   * The rule above now lives in `lib/core-app/currentWeek.ts`. It was written
   * here first and stayed here, which is exactly why matchup.ts, weekAll.ts and
   * todayStrip.ts each kept their own `max(week)` version — the correct
   * derivation was one function call away and not importable.
   */
  /*
   * 🛑 RESOLVED FROM THE CURRENT-SEASON ROWS ONLY, NOT THE COMBINED SET.
   *
   * `latest` is the SLATE — which week the board is about — and it is global across every
   * league the reader has. Prior seasons must inform the MODEL and never the slate: a single
   * league carrying a stale or mislabelled `MatchupFact` season would otherwise move the week
   * for all of them, and this screen has already shipped a bug of exactly that shape (see
   * `resolveCurrentWeekFrom`'s header, which exists because a max(week) reading rendered a
   * finished season as "your week" in August).
   *
   * The fallback is deliberate and narrow: with no `WeeklyMatchup` rows at all there is no
   * slate to protect, and resolving from history is what keeps a league whose only scoring is
   * imported from vanishing entirely.
   */
  const progressByLeague = new Map(periodMetadata.map((l) => [l.platformLeagueId, leagueWeekProgress(l)]))
  const resolved = resolveCurrentWeekFrom(rows.length > 0 ? rows : priorRows)
  const stated = resolveStatedWeek(periodMetadata.filter((league) => {
    const progress = progressByLeague.get(league.platformLeagueId)
    return progress?.currentWeek != null && rows.some((row) => row.leagueId === league.platformLeagueId && row.seasonYear === league.season && row.week === progress.currentWeek)
  }))
  const latest: { season: number; week: number } | null = stated ? { season: stated.seasonYear, week: stated.week } : (resolved
    ? { season: resolved.season, week: resolved.week }
    : null)

  /*
   * ⚠ THE COMBINED SET IS WHAT LEAVES, AND THE TWO CONSUMERS WANT DIFFERENT HALVES OF IT.
   * `thisWeek` filters to `latest.season`/`latest.week`, so prior seasons fall out of the
   * pairing on their own and no card can be built from them. `buildProfiles` takes every
   * scored row regardless of season, which is precisely the point of this change.
   */
  return {
    rows: (priorRows.length > 0 ? [...rows, ...priorRows] : rows).map((r) => {
      const progress = progressByLeague.get(r.leagueId)
      return { ...r, finalized: progress?.currentWeek != null ? progress.isFinal(r.seasonYear, r.week) : undefined }
    }),
    leagueByPlatformId,
    myRosters,
    rosterNames,
    rosterAvatars,
    latest,
  }
}

/** Per-roster scoring history, keyed "platformLeagueId:rosterId". */
export function buildProfiles(rows: MatchupRow[]): Map<string, { mu: number; sigma: number; n: number }> {
  const buckets = new Map<string, number[]>()
  for (const r of rows) {
    if (r.finalized === false || !isScored(r)) continue
    const key = `${r.leagueId}:${r.rosterId}`
    const list = buckets.get(key)
    if (list) list.push(r.pointsFor)
    else buckets.set(key, [r.pointsFor])
  }
  const out = new Map<string, { mu: number; sigma: number; n: number }>()
  for (const [key, values] of buckets) {
    if (values.length < MIN_WEEKS_FOR_PROJECTION) continue
    out.set(key, { mu: mean(values), sigma: stdev(values), n: values.length })
  }
  return out
}

/**
 * Per-roster scoring MEANS for rosters that fall short of the projection
 * threshold — keyed "platformLeagueId:rosterId", same as `buildProfiles`.
 *
 * ⚠ IT RETURNS THE ROSTERS `buildProfiles` DROPS, AND ONLY THOSE. The two maps
 * are disjoint by construction, so a caller that checks `profiles` first and
 * falls back here can never get both for one roster and never has to decide
 * which wins.
 *
 * ⚠ NO SIGMA, ON PURPOSE. A standard deviation over one or two games is not a
 * spread, it is an artifact, and anything downstream that saw a `sigma` field
 * here would eventually feed it to `winProbabilityOf`. Withholding it is what
 * keeps "form" and "projection" from quietly becoming the same thing.
 */
/**
 * Prior-season weekly scoring, read from `MatchupFact` and returned in `MatchupRow` shape.
 *
 * 🛑 THE PRIOR SEASONS WERE ALREADY INGESTED. THEY WERE JUST IN A TABLE THIS FILE NEVER READ.
 * Every platform's `HistoricalBackfillService` (Sleeper, Yahoo, ESPN, MFL, Fantrax) walks that
 * platform's season chain and writes per-week rows into `MatchupFact`. `buildProfiles` read only
 * `WeeklyMatchup`, which the parity collectors populate ONE SEASON AT A TIME — they enumerate the
 * latest imported season and treat older ones as frozen history that is never refetched. So a
 * league imported this year could not reach `MIN_WEEKS_FOR_PROJECTION` until week 4, while two
 * prior seasons of its scoring sat on disk unread.
 *
 * ⚠ TWO KEY SPACES, AND CONVERTING BETWEEN THEM IS THE WHOLE JOB.
 *   `MatchupFact.leagueId` is our INTERNAL `League.id` — one id spanning every season.
 *   `WeeklyMatchup.leagueId` is the PLATFORM league id, which on Sleeper is a DIFFERENT id per
 *   season. `buildProfiles` keys on the platform id, so a fact row must be filed under the
 *   league's CURRENT platform id or it forms its own bucket and counts toward nothing.
 *   `lib/core-app/railMatchups.ts` already does exactly this conversion; this follows it.
 *
 * ⚠ `teamA`/`teamB` ARE ALREADY CANONICAL ROSTER IDS, NOT THAT SEASON'S RAW ONES.
 * `SleeperHistoricalMatchupSyncService` maps each historical `roster_id` through `owner_id` to the
 * CURRENT season's roster id before writing (`canonicalIdByHistoricalRosterId`). That is what makes
 * a 2024 week joinable to a 2026 roster at all — the raw ids are per-league-instance and a manager's
 * number moves between seasons. Do not "normalise" these; they are already normalised.
 *
 * 🛑 IT SUPPLIES ONLY SEASONS `WeeklyMatchup` DOES NOT HAVE, AND THAT RULE IS NOT COSMETIC.
 * The two tables overlap for any season both were populated for, and the same week counted twice
 * would narrow the sample's spread while inflating `n` — a tighter sigma and a more confident
 * projection built on one game pretending to be two. Keyed on (league, season) rather than on a
 * date, because which seasons each table holds is a property of how they were populated, not of
 * when this runs.
 */
export function priorSeasonRowsFromFacts(
  facts: readonly {
    leagueId: string
    season: number | null
    weekOrPeriod: number
    teamA: string
    teamB: string
    scoreA: number
    scoreB: number
  }[],
  /** Internal `League.id` → that league's CURRENT platform league id. */
  platformIdByLeagueId: ReadonlyMap<string, string>,
  /** "platformLeagueId:season" already present in `WeeklyMatchup` — these facts are dropped. */
  seasonsAlreadyHeld: ReadonlySet<string>,
): MatchupRow[] {
  const out: MatchupRow[] = []
  /* Synthesised per (league, season, week), exactly as the parity collectors synthesise theirs. */
  const pairIndex = new Map<string, number>()

  /*
   * 🛑 ONE REAL LEAGUE EXISTS UNDER SEVERAL INTERNAL IDS, SO THE SAME GAME ARRIVES SEVERAL TIMES.
   *
   * `leagues.userId` is the IMPORTER, so a league every member connected exists once PER MEMBER —
   * see `lib/core-app/realLeague.ts`, which measured 23 real leagues held under more than one row,
   * and 21 of them on the account this was found on. `platformIdByLeagueId` maps EACH of those
   * internal ids onto the ONE platform id, so facts fetched for all of them land in a single
   * bucket and every historical game is counted once per copy.
   *
   * Measured against production 2026-09-20 for that account: 30,446 scored prior-season rows
   * folded in where only 19,625 are distinct — 1.55x, with the duplication concentrated in the
   * 21 multi-copy leagues rather than spread evenly.
   *
   * ⚠ THE HARM IS THE THRESHOLD, NOT THE MEAN. Exact duplicates leave mu unchanged and sigma
   * nearly so, which is what makes this invisible on inspection. What moves is `n`: a roster with
   * ONE real scored week in a triple-imported league reaches `MIN_WEEKS_FOR_PROJECTION` and gets a
   * confident-looking projection off a single game — precisely what that threshold exists to
   * prevent, and what the `seasonsAlreadyHeld` guard below prevents on the OTHER route. The same
   * inflated `n` is then printed to the reader as the model's sample size.
   *
   * ⚠ DEDUPED ON THE GAME, NOT ON THE LEAGUE COPY. Picking one internal id and dropping the rest
   * would be cheaper and would silently lose seasons: the copies are independently backfilled, so
   * one may carry history another lacks. Taking the UNION and then collapsing identical games
   * keeps the widest coverage and cannot lose a season.
   *
   * ⚠ THE PAIR IS ORDER-NORMALISED because nothing guarantees two copies wrote the same side as
   * `teamA`. Keying on the raw order would leave a mirrored duplicate in place, which is the
   * shape of bug that looks fixed and is not.
   */
  const seenGames = new Set<string>()

  for (const fact of facts) {
    if (fact.season == null) continue
    const platformLeagueId = platformIdByLeagueId.get(fact.leagueId)
    if (!platformLeagueId) continue
    if (seasonsAlreadyHeld.has(`${platformLeagueId}:${fact.season}`)) continue

    const [lo, hi] = fact.teamA <= fact.teamB ? [fact.teamA, fact.teamB] : [fact.teamB, fact.teamA]
    const gameKey = `${platformLeagueId}|${fact.season}|${fact.weekOrPeriod}|${lo}|${hi}`
    if (seenGames.has(gameKey)) continue
    seenGames.add(gameKey)

    const groupKey = `${platformLeagueId}|${fact.season}|${fact.weekOrPeriod}`
    const matchupId = (pairIndex.get(groupKey) ?? 0) + 1
    pairIndex.set(groupKey, matchupId)

    const common = {
      leagueId: platformLeagueId,
      seasonYear: fact.season,
      week: fact.weekOrPeriod,
      matchupId,
    }
    /*
     * `win` is not read by `buildProfiles` and a fact carries no tie flag, so it is derived
     * plainly rather than guessed at: a higher score is a win, equal scores are not.
     */
    out.push({
      ...common,
      rosterId: fact.teamA,
      pointsFor: fact.scoreA,
      pointsAgainst: fact.scoreB,
      win: fact.scoreA > fact.scoreB ? 1 : 0,
    })
    out.push({
      ...common,
      rosterId: fact.teamB,
      pointsFor: fact.scoreB,
      pointsAgainst: fact.scoreA,
      win: fact.scoreB > fact.scoreA ? 1 : 0,
    })
  }
  return out
}

export function buildFormProfiles(rows: MatchupRow[]): Map<string, { mu: number; n: number }> {
  const buckets = new Map<string, number[]>()
  for (const r of rows) {
    if (r.finalized === false || !isScored(r)) continue
    const key = `${r.leagueId}:${r.rosterId}`
    const list = buckets.get(key)
    if (list) list.push(r.pointsFor)
    else buckets.set(key, [r.pointsFor])
  }
  const out = new Map<string, { mu: number; n: number }>()
  for (const [key, values] of buckets) {
    if (values.length === 0 || values.length >= MIN_WEEKS_FOR_PROJECTION) continue
    out.set(key, { mu: mean(values), n: values.length })
  }
  return out
}

/**
 * Pair rows into head-to-heads on (league, season, week, matchupId).
 *
 * ⚠ `matchupId` IS NULLABLE AND A NULL DOES NOT PAIR. Rows without one are
 * dropped rather than guessed at — inferring an opponent by, say, matching
 * pointsAgainst would silently pair two teams who never played each other.
 */
export type Pairing = {
  leagueId: string
  season: number
  week: number
  a: MatchupRow
  b: MatchupRow
}

export function pairRows(rows: MatchupRow[]): Pairing[] {
  const groups = new Map<string, MatchupRow[]>()
  for (const r of rows) {
    if (r.matchupId == null) continue
    const key = `${r.leagueId}|${r.seasonYear}|${r.week}|${r.matchupId}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  const out: Pairing[] = []
  for (const list of groups.values()) {
    // Exactly two. A group of one is a bye or a half-written week; a group of
    // three is corrupt. Neither is a head-to-head.
    if (list.length !== 2) continue
    out.push({
      leagueId: list[0].leagueId,
      season: list[0].seasonYear,
      week: list[0].week,
      a: list[0],
      b: list[1],
    })
  }
  return out
}

/**
 * A week in a league that has no opponents — guillotine, survivor, "chopped".
 *
 * 🛑 THESE LEAGUES RENDERED NOTHING AT ALL, AND THE CAUSE IS ONE LINE IN `pairRows`:
 * `if (list.length !== 2) continue`. Sleeper sends `matchup_id: null` for a format where
 * everyone plays the field, so the parity collector stores each roster as its own group of
 * ONE. Measured on production 2026-09-20 across this account's seven such leagues: every
 * one carries `distinct_matchup_ids` equal to its ROSTER count (18, 18, 20) and
 * `avg(pointsAgainst) = 0.0`. A group of one never pairs, so no card was ever built and the
 * league was silently absent from the board — not "unprojected", missing.
 *
 * ⚠ AND BACKFILLING HISTORY WOULD NOT HAVE FIXED IT, which is what makes this the fix
 * rather than an ingest change. `buildSeasonMatchupFacts` drops the same rows at the same
 * two gates, and `MatchupFact` is pairwise (`teamA`/`teamB`/`scoreA`/`scoreB`) — there is no
 * row shape for a week with no opponent. The six such leagues that DO have a prior season
 * on file report `historicalBackfillStatus: 'complete'` truthfully.
 *
 * The weekly stake here is the cut line, not a head-to-head: the lowest score is out.
 */
export type EliminationWeek = {
  leagueId: string
  leagueName: string
  platform: string
  leagueImageUrl: string | null
  season: number
  week: number
  /** Your score this week. Null when your roster has not scored yet. */
  yourScore: number | null
  /** The lowest score in the scored field — whoever is currently out. */
  cutLine: number | null
  /** 1 = top of the field. Null while you are unscored. */
  rank: number | null
  /** Rosters carrying a score this week. The field you are measured against. */
  fieldSize: number
  /** Your points clear of the cut line. 0 means you ARE the cut line. */
  margin: number | null
  /** True only when your score is the lowest of a field of at least two. */
  onTheBlock: boolean
  /**
   * Whether `League.leagueType` actually says guillotine/survivor.
   *
   * ⚠ IT IS NOT THE TRIGGER, AND MUST NOT BECOME ONE. This account's
   * "🪓 Elimination Station 2" is stored as `redraft` while behaving exactly like the
   * others — 18 groups of one, zero points against. Gating on the label would drop the
   * league the label is wrong about, which is the one case a label check exists to catch.
   * The SHAPE of the week decides; the label only informs the wording.
   */
  labelled: boolean
  href: string
}

/**
 * Build the elimination cards for a week's rows.
 *
 * 🛑 THE TRIGGER IS "THIS LEAGUE PRODUCED NO PAIRS AT ALL", NEVER "your row did not pair".
 * A bye in an ordinary head-to-head league also leaves one roster unpaired, and reading
 * that as an elimination week would put a cut line on a league that has none. Requiring the
 * WHOLE league to be pairless separates the two, and it is also what makes double-emission
 * impossible: a league falls into exactly one of the two loops.
 */
export function buildEliminationWeeks(args: {
  /** Already filtered to the latest season and week. */
  rows: MatchupRow[]
  /** Platform ids that produced at least one pair this week. */
  pairedLeagueIds: Set<string>
  leagueByPlatformId: Map<string, LeagueMeta>
  /**
   * "platformLeagueId:rosterId" for every roster the user owns.
   *
   * ⚠ A MEMBERSHIP TEST, NOT A `Set` — `readHistory` builds this as a
   * `Map<string, string>` (key → externalId) and the pairing loop only ever calls `.has`
   * on it. Typing the parameter `Set<string>` compiled against the tests, which pass a
   * real Set, and failed only at the CALL SITE inside `getWeekBoard`. Asking for the one
   * operation actually used lets both through without a cast.
   */
  myRosters: { has(key: string): boolean }
}): EliminationWeek[] {
  const byLeague = new Map<string, MatchupRow[]>()
  for (const r of args.rows) {
    if (args.pairedLeagueIds.has(r.leagueId)) continue
    const list = byLeague.get(r.leagueId)
    if (list) list.push(r)
    else byLeague.set(r.leagueId, [r])
  }

  const out: EliminationWeek[] = []

  for (const [pid, rows] of byLeague) {
    const meta = args.leagueByPlatformId.get(pid)
    if (!meta) continue

    const yours = rows.find((r) => args.myRosters.has(`${pid}:${r.rosterId}`))
    if (!yours) continue

    /*
     * ⚠ THE FIELD IS THE SCORED ROSTERS, NOT EVERY ROW. A roster knocked out in week 1
     * still carries a 0-0 row for every later week, so counting all rows would hold a
     * permanent cut line of 0 under a league where nobody is near it — and would report a
     * field of 18 in a league with four teams left.
     */
    const field = rows.filter((r) => isScored(r))
    const fieldSize = field.length

    const cutLine = fieldSize > 0 ? Math.min(...field.map((r) => r.pointsFor)) : null
    const yourScore = isScored(yours) ? yours.pointsFor : null
    const rank = yourScore == null ? null : 1 + field.filter((r) => r.pointsFor > yourScore).length

    /*
     * ⚠ A FIELD OF ONE IS NOT A CUT LINE. The only scored roster is simultaneously the
     * highest and the lowest, so "on the block" would fire on the first roster to post a
     * point every single week. Two is the smallest field where "lowest" means anything.
     */
    const onTheBlock =
      yourScore != null && cutLine != null && fieldSize >= 2 && yourScore === cutLine

    out.push({
      leagueId: meta.id,
      leagueName: meta.name,
      platform: meta.platform,
      leagueImageUrl: meta.imageUrl,
      season: rows[0].seasonYear,
      week: rows[0].week,
      yourScore,
      cutLine,
      rank,
      fieldSize,
      margin: yourScore != null && cutLine != null ? yourScore - cutLine : null,
      onTheBlock,
      labelled: meta.elimination,
      href: `/core/matchup?league=${encodeURIComponent(meta.id)}`,
    })
  }

  /*
   * Most urgent first: on the block, then closest to it. A league with no scores yet sorts
   * last — it has nothing to say this week, but it is still ON the board, which is the whole
   * point of this change.
   */
  out.sort(
    (a, b) =>
      Number(b.onTheBlock) - Number(a.onTheBlock) ||
      (a.margin ?? Number.POSITIVE_INFINITY) - (b.margin ?? Number.POSITIVE_INFINITY) ||
      a.leagueName.localeCompare(b.leagueName),
  )

  return out
}

// ── 24a — Your Week ────────────────────────────────────────────────────

export async function getWeekBoard(
  userId: string,
  leagues: LeagueInput[],
  /**
   * The league being rendered on its own, when there is one. Only this league's
   * sideline games and rivalry are computed — doing it for every league would
   * pay for sixty boards to show one.
   */
  focusLeagueId?: string | null,
): Promise<WeekBoard> {
  /*
   * The phase read runs beside the history read: it is what lets the empty
   * state distinguish "nothing synced" from "season not started", and it is
   * one cached findFirst — see lib/core-app/seasonPhase.ts.
   */
  const [history, firstKickoffAt] = await Promise.all([
    readHistory(userId, leagues).catch(() => null),
    getFirstStatedKickoff(),
  ])

  const empty: WeekBoard = {
    season: null,
    week: null,
    coinFlips: [],
    leaning: [],
    unprojected: [],
    eliminationWeeks: [],
    model: { basis: 'No completed weeks are on file yet, so nothing here is projected.', sampleSize: 0 },
    withoutSchedule: leagues.length,
    firstKickoffAt,
    leagueBoard: null,
  }

  if (!history?.latest) return empty

  const { latest, leagueByPlatformId, myRosters, rosterNames, rosterAvatars } = history
  const profiles = buildProfiles(history.rows)
  /*
   * The rosters `buildProfiles` dropped for being under the threshold. See
   * `buildFormProfiles`: the two maps are disjoint, so the fallback below can
   * never contradict a projection.
   */
  const formProfiles = buildFormProfiles(history.rows)
  const sampleSize = [...profiles.values()].reduce((acc, p) => acc + p.n, 0)

  const thisWeek = pairRows(
    history.rows.filter((r) => r.seasonYear === latest.season && r.week === latest.week),
  )

  const coinFlips: WeekMatchup[] = []
  const leaning: WeekMatchup[] = []
  const unprojected: WeekMatchup[] = []
  const leaguesSeen = new Set<string>()

  for (const pair of thisWeek) {
    const meta = leagueByPlatformId.get(pair.leagueId)
    if (!meta) continue

    // Which side is the user's?
    const aIsMine = myRosters.has(`${pair.leagueId}:${pair.a.rosterId}`)
    const bIsMine = myRosters.has(`${pair.leagueId}:${pair.b.rosterId}`)
    if (!aIsMine && !bIsMine) continue
    const you = aIsMine ? pair.a : pair.b
    const them = aIsMine ? pair.b : pair.a

    leaguesSeen.add(meta.id)

    const oppKey = `${pair.leagueId}:${them.rosterId}`
    const opponent: WeekOpponent = {
      rosterId: them.rosterId,
      name: rosterNames.get(oppKey) ?? null,
      avatarUrl: rosterAvatars.get(oppKey) ?? null,
    }

    const mineProfile = profiles.get(`${pair.leagueId}:${you.rosterId}`)
    const theirProfile = profiles.get(oppKey)

    const card: WeekMatchup = {
      leagueId: meta.id,
      leagueName: meta.name,
      platform: meta.platform,
      leagueImageUrl: meta.imageUrl,
      season: pair.season,
      week: pair.week,
      opponent,
      elimination: meta.elimination,
      projection: null,
      form: null,
      yourSampleWeeks: mineProfile?.n ?? 0,
      href: `/core/matchup?league=${encodeURIComponent(meta.id)}`,
    }

    if (mineProfile && theirProfile) {
      const margin = mineProfile.mu - theirProfile.mu
      card.projection = {
        you: mineProfile.mu,
        them: theirProfile.mu,
        margin,
        winProbability: winProbabilityOf(mineProfile, theirProfile),
      }
    } else {
      /*
       * ── Form, for the matchups a projection cannot reach ──────────────
       *
       * 🛑 THIS IS THE COMMON CASE EARLY IN A SEASON, NOT AN EDGE CASE, AND THE
       * REASON IS STRUCTURAL RATHER THAN A SYNC PROBLEM. `WeeklyMatchup` is
       * populated one season at a time — every parity collector enumerates the
       * LATEST imported season and treats older ones as "frozen history, never
       * refetched" (`enumerateExternalMatchupConnections`), and the Sleeper path
       * takes a single required `seasonYear`. So a league imported this year has
       * only this year's weeks on file, and until week 4 that is fewer than
       * `MIN_WEEKS_FOR_PROJECTION`. On the account this was measured against, 47
       * of 65 matchups landed here at week 2.
       *
       * Leaving them blank is what made "All leagues" show nothing in the weeks
       * people care most about. A mean over one or two games is a weak signal,
       * but it is a TRUE one, and the view labels it as form rather than as a
       * call. Both sides are required: an average against an opponent we have
       * never seen score is not a comparison.
       */
      const mineForm = mineProfile ?? formProfiles.get(`${pair.leagueId}:${you.rosterId}`)
      const theirForm = theirProfile ?? formProfiles.get(oppKey)
      if (mineForm && theirForm) {
        card.form = {
          you: mineForm.mu,
          them: theirForm.mu,
          margin: mineForm.mu - theirForm.mu,
          weeks: Math.min(mineForm.n, theirForm.n),
        }
      }
    }

    if (!card.projection) unprojected.push(card)
    else if (Math.abs(card.projection.margin) <= COIN_FLIP_POINTS) coinFlips.push(card)
    else leaning.push(card)
  }

  /*
   * ── Leagues with no opponent ───────────────────────────────────────
   *
   * `pairedLeagueIds` is read off `thisWeek` rather than recomputed, so the two loops
   * cannot disagree about which leagues pair — a league is in exactly one of them.
   */
  const pairedLeagueIds = new Set(thisWeek.map((p) => p.leagueId))
  const eliminationWeeks = buildEliminationWeeks({
    rows: history.rows.filter((r) => r.seasonYear === latest.season && r.week === latest.week),
    pairedLeagueIds,
    leagueByPlatformId,
    myRosters,
  })

  /*
   * 🛑 COUNT THESE AS SEEN, OR THE FIX REPORTS ITSELF AS THE BUG IT REMOVED.
   * `withoutSchedule` is `leagues.length - leaguesSeen.size`, and these leagues were
   * landing in it — a guillotine league was being counted as having no schedule for the
   * week while carrying a full set of rows. Adding the card without this would put the
   * league on the board AND go on reporting it as absent, in the same render.
   */
  for (const e of eliminationWeeks) leaguesSeen.add(e.leagueId)

  // Coin flips: closest first — the tightest game is the one that most needs a
  // decision. The rest: most lopsided first, so scanning down is scanning away
  // from anything that matters.
  coinFlips.sort((a, b) => Math.abs(a.projection!.margin) - Math.abs(b.projection!.margin))
  leaning.sort((a, b) => Math.abs(b.projection!.margin) - Math.abs(a.projection!.margin))
  /*
   * ⚠ `unprojected` IS ORDERED TOO NOW, AND IT WAS NOT BEFORE — it left here in
   * whatever order the schedule pairs happened to iterate in. That was harmless
   * while both surfaces only COUNTED it. `WeekBoard` now lists the first ten of
   * it, and "the first ten of an arbitrary order" is a ranking claim nobody
   * made: on the account that prompted this there are 47 of them, so 37 are
   * dropped by an accident of iteration.
   *
   * Most completed weeks first, so the matchups nearest the threshold — the ones
   * that will be projectable soonest — lead. `yourSampleWeeks` is already on the
   * card for exactly this reason.
   *
   * ⚠ SORTED HERE, NOT IN THE VIEW. `YourWeek.tsx` states the rule in its own
   * header: the loader hands the tiers over ordered and the screen contains no
   * `.sort()`, so the two cannot silently disagree about what matters.
   */
  /*
   * ⚠ FORM FIRST, THEN THE OLD ORDER. A row carrying a form line says something
   * about this week; a row without one says only how far short it is. Ordering
   * on `yourSampleWeeks` alone does NOT achieve this — that counts YOUR side,
   * and a matchup where you have two weeks and the opponent has none has a high
   * `yourSampleWeeks` and nothing to show. The tiebreakers below are unchanged.
   */
  unprojected.sort(
    (a, b) =>
      Number(Boolean(b.form)) - Number(Boolean(a.form)) ||
      b.yourSampleWeeks - a.yourSampleWeeks ||
      a.leagueName.localeCompare(b.leagueName),
  )

  /*
   * ── The focused league's own board ──────────────────────────────────
   *
   * Built from `thisWeek`, the same pairing the loop above just walked, so the
   * hero here and the card on the cross-league board cannot disagree about who
   * is playing whom.
   */
  let leagueBoard: LeagueWeekBoard | null = null

  if (focusLeagueId) {
    const pid = leagues.find((l) => l.id === focusLeagueId)?.platformLeagueId ?? null
    const meta = pid ? leagueByPlatformId.get(pid) : null

    if (pid && meta) {
      const leaguePairs = thisWeek.filter((p) => p.leagueId === pid)

      const yours =
        [...coinFlips, ...leaning, ...unprojected].find((c) => c.leagueId === meta.id) ?? null

      const projectedOf = (rosterId: string): number | null =>
        profiles.get(`${pid}:${rosterId}`)?.mu ?? null

      const sidelines: LeagueSideline[] = leaguePairs
        .filter(
          (p) =>
            !myRosters.has(`${pid}:${p.a.rosterId}`) && !myRosters.has(`${pid}:${p.b.rosterId}`),
        )
        .map((p) => {
          const aProfile = profiles.get(`${pid}:${p.a.rosterId}`)
          const bProfile = profiles.get(`${pid}:${p.b.rosterId}`)
          const aWinProbability = aProfile && bProfile ? winProbabilityOf(aProfile, bProfile) : null
          return {
            a: {
              rosterId: p.a.rosterId,
              name: rosterNames.get(`${pid}:${p.a.rosterId}`) ?? null,
              avatarUrl: rosterAvatars.get(`${pid}:${p.a.rosterId}`) ?? null,
              projected: projectedOf(p.a.rosterId),
            },
            b: {
              rosterId: p.b.rosterId,
              name: rosterNames.get(`${pid}:${p.b.rosterId}`) ?? null,
              avatarUrl: rosterAvatars.get(`${pid}:${p.b.rosterId}`) ?? null,
              projected: projectedOf(p.b.rosterId),
            },
            aWinProbability,
          }
        })
        // Closest first — the game most likely to move the table is the one
        // worth glancing at, same ordering rule the coin-flip list uses.
        .sort((x, y) => {
          const dx = x.aWinProbability == null ? 1 : Math.abs(0.5 - x.aWinProbability)
          const dy = y.aWinProbability == null ? 1 : Math.abs(0.5 - y.aWinProbability)
          return dx - dy
        })

      /*
       * All-time record against this week's opponent, out of every season
       * already in `history.rows`. Computed here rather than by calling
       * getRivalryRadar, which would re-read the whole history for one number.
       */
      let rivalry: LeagueWeekBoard['rivalry'] = null
      if (yours) {
        const oppRosterId = yours.opponent.rosterId
        let wins = 0
        let losses = 0
        let marginSum = 0
        let meetings = 0
        for (const pair of pairRows(history.rows.filter((r) => r.leagueId === pid))) {
          const aMine = myRosters.has(`${pid}:${pair.a.rosterId}`)
          const bMine = myRosters.has(`${pid}:${pair.b.rosterId}`)
          if (!aMine && !bMine) continue
          const you = aMine ? pair.a : pair.b
          const them = aMine ? pair.b : pair.a
          if (them.rosterId !== oppRosterId) continue
          // Only games actually played count as meetings; a scheduled fixture is
          // not a head-to-head result.
          if (you.finalized === false || them.finalized === false || (!isScored(you) && !isScored(them))) continue
          meetings += 1
          marginSum += you.pointsFor - them.pointsFor
          if (you.pointsFor > them.pointsFor) wins += 1
          else losses += 1
        }
        if (meetings > 0) {
          rivalry = { wins, losses, meetings, averageMargin: marginSum / meetings }
        }
      }

      /*
       * Current-season W-L per roster, for the records the 38a header shows
       * beside each team name.
       *
       * ⚠ COMPUTED FROM ROWS ALREADY IN MEMORY, NOT A SECOND QUERY. `history.rows`
       * is every row for every league the user is in; filtering it costs nothing
       * next to another round trip.
       *
       * ⚠ AN UNSCORED ROW IS NOT A LOSS. The Sleeper sync bootstraps a whole
       * season of 0-0 rows before anybody plays, so counting `pointsFor >
       * pointsAgainst` over raw rows would hand every team in a fresh league an
       * 0-13 record and render it beside their name as fact. Only scored pairs
       * are counted, which is why a preseason league correctly shows nothing
       * here rather than a wall of zeros.
       */
      const records: Record<string, { wins: number; losses: number }> = {}
      for (const pair of pairRows(
        history.rows.filter((r) => r.leagueId === pid && r.seasonYear === latest.season),
      )) {
        const scored =
          pair.a.pointsFor > 0 ||
          pair.a.pointsAgainst > 0 ||
          pair.b.pointsFor > 0 ||
          pair.b.pointsAgainst > 0
        if (!scored || pair.a.finalized === false || pair.b.finalized === false) continue
        // A tie advances neither column; it is rare and inventing a bucket for
        // it would misreport two teams rather than omit one game.
        if (pair.a.pointsFor === pair.b.pointsFor) continue
        const aWon = pair.a.pointsFor > pair.b.pointsFor
        for (const [rid, won] of [
          [pair.a.rosterId, aWon],
          [pair.b.rosterId, !aWon],
        ] as Array<[string, boolean]>) {
          const rec = (records[rid] ??= { wins: 0, losses: 0 })
          if (won) rec.wins += 1
          else rec.losses += 1
        }
      }

      /* `myRosters` is keyed "platformLeagueId:rosterId"; the first entry for this
       * league is the user's roster in it. */
      const yourRosterId =
        [...myRosters.entries()].find(([k]) => k.startsWith(`${pid}:`))?.[1] ?? null

      leagueBoard = {
        leagueId: meta.id,
        leagueName: meta.name,
        platform: meta.platform,
        season: latest.season,
        week: latest.week,
        yours,
        sidelines,
        rivalry,
        records,
        yourRosterId,
        yourTeamName:
          yourRosterId != null ? (rosterNames.get(`${pid}:${yourRosterId}`) ?? null) : null,
        yourAvatarUrl:
          yourRosterId != null ? (rosterAvatars.get(`${pid}:${yourRosterId}`) ?? null) : null,
      }
    }
  }

  return {
    season: latest.season,
    week: latest.week,
    leagueBoard,
    coinFlips,
    leaning,
    unprojected,
    eliminationWeeks,
    model: {
      basis:
        `Projected from each roster's own completed weeks in its own league's scoring — ` +
        `mean points, with the spread of those weeks as the uncertainty. ` +
        `A heuristic, not a simulation.`,
      sampleSize,
    },
    withoutSchedule: Math.max(0, leagues.length - leaguesSeen.size),
    firstKickoffAt,
  }
}

// ── 24b — Rivalry Radar ────────────────────────────────────────────────

export async function getRivalryRadar(userId: string, leagues: LeagueInput[]): Promise<RivalryRadar> {
  /*
   * Phase read beside the history read — same reasoning as getWeekBoard above.
   */
  const [history, firstKickoffAt] = await Promise.all([
    readHistory(userId, leagues).catch(() => null),
    getFirstStatedKickoff(),
  ])

  const empty: RivalryRadar = {
    season: null,
    week: null,
    theyOwnYou: [],
    youOwnThem: [],
    even: [],
    oneToWatch: null,
    totals: { seasons: 0, meetings: 0, platforms: 0 },
    firstKickoffAt,
  }

  if (!history?.latest) return empty

  const { latest, leagueByPlatformId, myRosters, rosterNames, rosterAvatars } = history
  const profiles = buildProfiles(history.rows)
  const pairs = pairRows(history.rows)

  type Acc = {
    leagueId: string
    leagueName: string
    platform: string
    opponent: WeekOpponent
    wins: number
    losses: number
    marginSum: number
    meetings: number
    closest: RivalryCard['closest']
    thisWeek: RivalryCard['thisWeek']
  }

  const byOpponent = new Map<string, Acc>()
  const seasons = new Set<number>()
  const platforms = new Set<string>()
  let meetings = 0

  for (const pair of pairs) {
    const meta = leagueByPlatformId.get(pair.leagueId)
    if (!meta) continue

    const aIsMine = myRosters.has(`${pair.leagueId}:${pair.a.rosterId}`)
    const bIsMine = myRosters.has(`${pair.leagueId}:${pair.b.rosterId}`)
    if (!aIsMine && !bIsMine) continue
    const you = aIsMine ? pair.a : pair.b
    const them = aIsMine ? pair.b : pair.a

    const key = `${pair.leagueId}:${them.rosterId}`
    let acc = byOpponent.get(key)
    if (!acc) {
      acc = {
        leagueId: meta.id,
        leagueName: meta.name,
        platform: meta.platform,
        opponent: {
          rosterId: them.rosterId,
          name: rosterNames.get(key) ?? null,
          avatarUrl: rosterAvatars.get(key) ?? null,
        },
        wins: 0,
        losses: 0,
        marginSum: 0,
        meetings: 0,
        closest: null,
        thisWeek: null,
      }
      byOpponent.set(key, acc)
    }

    const isThisWeek = pair.season === latest.season && pair.week === latest.week

    if (you.finalized !== false && them.finalized !== false && (isScored(you) || isScored(them))) {
      // A completed meeting contributes to the series.
      const margin = you.pointsFor - them.pointsFor
      const won = margin > 0
      acc.meetings += 1
      acc.marginSum += margin
      if (won) acc.wins += 1
      else acc.losses += 1
      seasons.add(pair.season)
      platforms.add(meta.platform)
      meetings += 1

      if (!acc.closest || Math.abs(margin) < Math.abs(acc.closest.margin)) {
        acc.closest = { season: pair.season, week: pair.week, margin, won }
      }
    }

    if (isThisWeek && !isScored(you) && !isScored(them)) {
      // Scheduled but not played — this is the live half of the card.
      const mineProfile = profiles.get(`${pair.leagueId}:${you.rosterId}`)
      const theirProfile = profiles.get(key)
      if (mineProfile && theirProfile) {
        const margin = mineProfile.mu - theirProfile.mu
        const sigma = Math.sqrt(mineProfile.sigma ** 2 + theirProfile.sigma ** 2)
        acc.thisWeek = { winProbability: normalCdf(margin / sigma), projectedMargin: margin }
      } else {
        acc.thisWeek = { winProbability: null, projectedMargin: null }
      }
    }
  }

  const cards: RivalryCard[] = [...byOpponent.values()]
    .filter((a) => a.meetings > 0 || a.thisWeek != null)
    .map((a) => ({
      leagueId: a.leagueId,
      leagueName: a.leagueName,
      platform: a.platform,
      opponent: a.opponent,
      series: { wins: a.wins, losses: a.losses, meetings: a.meetings },
      averageMargin: a.meetings > 0 ? a.marginSum / a.meetings : 0,
      closest: a.closest,
      thisWeek: a.thisWeek,
      sampleTooSmall: a.meetings <= 1,
    }))

  /*
   * ⚠ TIERING IS SERIES LEAD **AND** TODAY, NOT SERIES LEAD ALONE — the handoff's
   * build note. A series you lead 4–1 but are projected to lose this week is not
   * a comfortable green card, so a losing projection pulls it out of "you own
   * this one" and into the neutral tier where it gets read rather than skimmed.
   */
  const theyOwnYou: RivalryCard[] = []
  const youOwnThem: RivalryCard[] = []
  const even: RivalryCard[] = []

  for (const c of cards) {
    if (c.sampleTooSmall || c.series.wins === c.series.losses) {
      even.push(c)
      continue
    }
    const losingToday = c.thisWeek?.winProbability != null && c.thisWeek.winProbability < 0.5
    const winningToday = c.thisWeek?.winProbability != null && c.thisWeek.winProbability > 0.5
    if (c.series.losses > c.series.wins) {
      if (winningToday) even.push(c)
      else theyOwnYou.push(c)
    } else {
      if (losingToday) even.push(c)
      else youOwnThem.push(c)
    }
  }

  // Worst series first in the red tier; best series first in the green one.
  theyOwnYou.sort((a, b) => a.series.wins - a.series.losses - (b.series.wins - b.series.losses))
  youOwnThem.sort((a, b) => b.series.wins - b.series.losses - (a.series.wins - a.series.losses))
  even.sort((a, b) => b.series.meetings - a.series.meetings)

  /*
   * "The one to watch" — the handoff asked for the exact selection logic to be
   * pinned down rather than left to a reader. It is: among series with more than
   * one meeting AND a projection for this week, the smallest sum of
   * |average historical margin| and |projected margin today|. Both halves
   * normalised to points, so the two are directly addable. A close history that
   * is a blowout today does not qualify, and neither does the reverse.
   */
  let oneToWatch: RivalryCard | null = null
  let bestScore = Infinity
  for (const c of cards) {
    if (c.sampleTooSmall) continue
    if (c.thisWeek?.projectedMargin == null) continue
    const score = Math.abs(c.averageMargin) + Math.abs(c.thisWeek.projectedMargin)
    if (score < bestScore) {
      bestScore = score
      oneToWatch = c
    }
  }

  return {
    season: latest.season,
    week: latest.week,
    theyOwnYou,
    youOwnThem,
    even,
    oneToWatch,
    totals: { seasons: seasons.size, meetings, platforms: platforms.size },
    firstKickoffAt,
  }
}
