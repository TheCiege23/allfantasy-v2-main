import 'server-only'

import { prisma } from '@/lib/prisma'
import { isScored, resolveCurrentWeekFrom } from './currentWeek'

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

/** Below this many completed weeks a roster gets no projection. */
const MIN_WEEKS_FOR_PROJECTION = 3

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

// ── Types ──────────────────────────────────────────────────────────────

export type WeekOpponent = {
  rosterId: number
  /** Null when no LeagueTeam row names this roster — never a made-up name. */
  name: string | null
}

export type WeekMatchup = {
  leagueId: string
  leagueName: string
  platform: string
  season: number
  week: number
  opponent: WeekOpponent
  /** Null when either side has too little history — see MIN_WEEKS_FOR_PROJECTION. */
  projection: {
    you: number
    them: number
    /** Signed: positive means you are projected ahead. */
    margin: number
    /** 0–1. */
    winProbability: number
  } | null
  /** Completed weeks behind YOUR side of the projection. */
  yourSampleWeeks: number
  href: string
}

/** One matchup in the focused league that the user is NOT playing in. */
export type LeagueSideline = {
  a: { rosterId: number; name: string | null; projected: number | null }
  b: { rosterId: number; name: string | null; projected: number | null }
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
  /** Stated on the screen, never implied. */
  model: {
    basis: string
    /** Total completed roster-weeks the projections were fitted on. */
    sampleSize: number
  }
  /** Leagues of the user's that carry no schedule for this week at all. */
  withoutSchedule: number
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
}

type MatchupRow = {
  leagueId: string
  seasonYear: number
  week: number
  rosterId: number
  matchupId: number | null
  pointsFor: number
  pointsAgainst: number
  win: number
}

type History = {
  /** Every row, all seasons, for leagues the user is in. */
  rows: MatchupRow[]
  /** platformLeagueId → league metadata. */
  leagueByPlatformId: Map<string, { id: string; name: string; platform: string }>
  /** "platformLeagueId:rosterId" → the user owns this roster. */
  myRosters: Map<string, number>
  /** "platformLeagueId:rosterId" → team name, when one is on file. */
  rosterNames: Map<string, string>
  latest: { season: number; week: number } | null
}

async function readHistory(userId: string, leagues: LeagueInput[]): Promise<History | null> {
  const platformIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (platformIds.length === 0) return null

  const [rows, teams, mine] = await Promise.all([
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
        league: { select: { platformLeagueId: true } },
      },
    }),
    prisma.leagueTeam.findMany({
      where: {
        league: { platformLeagueId: { in: platformIds } },
        claimedByUserId: userId,
      },
      select: { externalId: true, league: { select: { platformLeagueId: true } } },
    }),
  ])

  if (rows.length === 0) return null

  const leagueByPlatformId = new Map<string, { id: string; name: string; platform: string }>()
  for (const l of leagues) {
    if (!l.platformLeagueId) continue
    leagueByPlatformId.set(l.platformLeagueId, {
      id: l.id,
      name: l.name?.trim() || 'League',
      platform: String(l.platform ?? 'manual').toLowerCase(),
    })
  }

  const rosterNames = new Map<string, string>()
  for (const t of teams) {
    const pid = t.league?.platformLeagueId
    const roster = Number(t.externalId)
    if (!pid || !Number.isFinite(roster)) continue
    // teamName is what shows in the platform's own UI; ownerName is the person.
    // Prefer the team, fall back to the person, never to a placeholder.
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (label) rosterNames.set(`${pid}:${roster}`, label)
  }

  const myRosters = new Map<string, number>()
  for (const t of mine) {
    const pid = t.league?.platformLeagueId
    const roster = Number(t.externalId)
    if (!pid || !Number.isFinite(roster)) continue
    myRosters.set(`${pid}:${roster}`, roster)
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
  const resolved = resolveCurrentWeekFrom(rows)
  const latest: { season: number; week: number } | null = resolved
    ? { season: resolved.season, week: resolved.week }
    : null

  return { rows, leagueByPlatformId, myRosters, rosterNames, latest }
}

/** Per-roster scoring history, keyed "platformLeagueId:rosterId". */
function buildProfiles(rows: MatchupRow[]): Map<string, { mu: number; sigma: number; n: number }> {
  const buckets = new Map<string, number[]>()
  for (const r of rows) {
    if (!isScored(r)) continue
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
 * Pair rows into head-to-heads on (league, season, week, matchupId).
 *
 * ⚠ `matchupId` IS NULLABLE AND A NULL DOES NOT PAIR. Rows without one are
 * dropped rather than guessed at — inferring an opponent by, say, matching
 * pointsAgainst would silently pair two teams who never played each other.
 */
type Pairing = {
  leagueId: string
  season: number
  week: number
  a: MatchupRow
  b: MatchupRow
}

function pairRows(rows: MatchupRow[]): Pairing[] {
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
  const empty: WeekBoard = {
    season: null,
    week: null,
    coinFlips: [],
    leaning: [],
    unprojected: [],
    model: { basis: 'No completed weeks are on file yet, so nothing here is projected.', sampleSize: 0 },
    withoutSchedule: leagues.length,
    leagueBoard: null,
  }

  const history = await readHistory(userId, leagues).catch(() => null)
  if (!history?.latest) return empty

  const { latest, leagueByPlatformId, myRosters, rosterNames } = history
  const profiles = buildProfiles(history.rows)
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
    }

    const mineProfile = profiles.get(`${pair.leagueId}:${you.rosterId}`)
    const theirProfile = profiles.get(oppKey)

    const card: WeekMatchup = {
      leagueId: meta.id,
      leagueName: meta.name,
      platform: meta.platform,
      season: pair.season,
      week: pair.week,
      opponent,
      projection: null,
      yourSampleWeeks: mineProfile?.n ?? 0,
      href: `/core/matchup?league=${encodeURIComponent(meta.id)}`,
    }

    if (mineProfile && theirProfile) {
      const margin = mineProfile.mu - theirProfile.mu
      const sigma = Math.sqrt(mineProfile.sigma ** 2 + theirProfile.sigma ** 2)
      card.projection = {
        you: mineProfile.mu,
        them: theirProfile.mu,
        margin,
        winProbability: normalCdf(margin / sigma),
      }
    }

    if (!card.projection) unprojected.push(card)
    else if (Math.abs(card.projection.margin) <= COIN_FLIP_POINTS) coinFlips.push(card)
    else leaning.push(card)
  }

  // Coin flips: closest first — the tightest game is the one that most needs a
  // decision. The rest: most lopsided first, so scanning down is scanning away
  // from anything that matters.
  coinFlips.sort((a, b) => Math.abs(a.projection!.margin) - Math.abs(b.projection!.margin))
  leaning.sort((a, b) => Math.abs(b.projection!.margin) - Math.abs(a.projection!.margin))

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

      const projectedOf = (rosterId: number): number | null =>
        profiles.get(`${pid}:${rosterId}`)?.mu ?? null

      const sidelines: LeagueSideline[] = leaguePairs
        .filter(
          (p) =>
            !myRosters.has(`${pid}:${p.a.rosterId}`) && !myRosters.has(`${pid}:${p.b.rosterId}`),
        )
        .map((p) => {
          const aProfile = profiles.get(`${pid}:${p.a.rosterId}`)
          const bProfile = profiles.get(`${pid}:${p.b.rosterId}`)
          const aWinProbability =
            aProfile && bProfile
              ? normalCdf(
                  (aProfile.mu - bProfile.mu) /
                    Math.sqrt(aProfile.sigma ** 2 + bProfile.sigma ** 2),
                )
              : null
          return {
            a: {
              rosterId: p.a.rosterId,
              name: rosterNames.get(`${pid}:${p.a.rosterId}`) ?? null,
              projected: projectedOf(p.a.rosterId),
            },
            b: {
              rosterId: p.b.rosterId,
              name: rosterNames.get(`${pid}:${p.b.rosterId}`) ?? null,
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
          if (!isScored(you) && !isScored(them)) continue
          meetings += 1
          marginSum += you.pointsFor - them.pointsFor
          if (you.pointsFor > them.pointsFor) wins += 1
          else losses += 1
        }
        if (meetings > 0) {
          rivalry = { wins, losses, meetings, averageMargin: marginSum / meetings }
        }
      }

      leagueBoard = {
        leagueId: meta.id,
        leagueName: meta.name,
        platform: meta.platform,
        season: latest.season,
        week: latest.week,
        yours,
        sidelines,
        rivalry,
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
    model: {
      basis:
        `Projected from each roster's own completed weeks in its own league's scoring — ` +
        `mean points, with the spread of those weeks as the uncertainty. ` +
        `A heuristic, not a simulation.`,
      sampleSize,
    },
    withoutSchedule: Math.max(0, leagues.length - leaguesSeen.size),
  }
}

// ── 24b — Rivalry Radar ────────────────────────────────────────────────

export async function getRivalryRadar(userId: string, leagues: LeagueInput[]): Promise<RivalryRadar> {
  const empty: RivalryRadar = {
    season: null,
    week: null,
    theyOwnYou: [],
    youOwnThem: [],
    even: [],
    oneToWatch: null,
    totals: { seasons: 0, meetings: 0, platforms: 0 },
  }

  const history = await readHistory(userId, leagues).catch(() => null)
  if (!history?.latest) return empty

  const { latest, leagueByPlatformId, myRosters, rosterNames } = history
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
        opponent: { rosterId: them.rosterId, name: rosterNames.get(key) ?? null },
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

    if (isScored(you) || isScored(them)) {
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
  }
}
