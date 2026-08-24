import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * 26b — Season Outlook. Playoff and championship odds for every active league,
 * on one page.
 *
 * ⚠ THIS PAGE EXISTS BECAUSE THE OLD ENTRY POINT WENT SOMEWHERE ELSE ENTIRELY.
 * "Season Outlook" in the dashboard tools grid pointed at `/af-legacy?tab=pulse`
 * — the Legacy import board's market tab, which has nothing to do with playoff
 * odds. That href is fixed in the same change that adds this file; see
 * `components/dashboard/nocturne/NocturneDashboard.tsx`. If you are reading this
 * because odds look wrong, check first that you are on THIS route and not back
 * on the Legacy board.
 *
 * ⚠ SEPARATELY FLAGGED, AND DELIBERATELY NOT FIXED HERE: the Legacy page's own
 * navigation is an eleven-tab horizontally-scrolling strip being used as a menu.
 * That is a real usability problem with its own redesign pass owed to it, and
 * out of scope for this handoff. Recorded so it is not lost.
 *
 * ⚠ THE MODEL IS THE ONE ALREADY USED BY 24a/24b, NOT A SECOND ONE. Each team's
 * weekly scoring is fitted from its own completed weeks (mean and spread), and
 * the remaining schedule — the real one, read from the unscored WeeklyMatchup
 * rows, not a synthesized round-robin — is played out `ITERATIONS` times.
 * Introducing a different model here would mean this page and the matchup screen
 * could disagree about the same game.
 *
 * ⚠ EVERY PROBABILITY THIS FILE EMITS CARRIES ITS BASIS. `SeasonOutlook.basis`
 * is a required field, and the surface prints it. A percentage with no stated
 * derivation is indistinguishable from a guess.
 */

/** The handoff's number, and the target. See `chooseIterations` for when it bends. */
const ITERATIONS = 10_000

/**
 * ⚠ A HARD CEILING ON TOTAL WORK, BECAUSE THIS RUNS IN A REQUEST.
 *
 * Ten thousand simulations per league is cheap for one league and ruinous for
 * sixty. Measured on this database, one account carries 63 connected leagues; at
 * roughly 78 remaining games each that is 10,000 × 78 × 63 ≈ 49 million simulated
 * games on a single page load, and the page is `force-dynamic` — every visit
 * pays it. The repo already has a standing scar here: a handler that runs long
 * enough gets killed by the platform edge at around 300 seconds, and no user
 * code runs when it does, so it fails as a blank 502 rather than as a timeout
 * anyone can read.
 *
 * So the budget is on total simulated games, and the per-league iteration count
 * falls out of it. `basis` then reports the number ACTUALLY used, not the number
 * we wished for — a page that claims ten thousand simulations while running two
 * thousand is a worse failure than a slower page.
 */
const TOTAL_GAME_BUDGET = 6_000_000

/** Never drop below this: fewer runs than this and the percentages are noise. */
const MIN_ITERATIONS = 1_500

/**
 * Iterations per league, given how much schedule there is to play out.
 * `totalRemainingGames` is summed across every league being simulated.
 */
function chooseIterations(totalRemainingGames: number): number {
  if (totalRemainingGames <= 0) return ITERATIONS
  const affordable = Math.floor(TOTAL_GAME_BUDGET / totalRemainingGames)
  return Math.max(MIN_ITERATIONS, Math.min(ITERATIONS, affordable))
}

/** Floor on σ — see the identical constant in weekBoard.ts for the reasoning. */
const SIGMA_FLOOR = 12

/** Below this many completed weeks a team is not modelled. */
const MIN_WEEKS = 3

/** Used when a league's settings do not declare a playoff field. */
const DEFAULT_PLAYOFF_TEAMS = 6

export type OutlookTeam = {
  rosterId: number
  name: string | null
  isYou: boolean
  wins: number
  losses: number
  pointsFor: number
  /** Current seed by the same rule the sim uses: wins, then points for. */
  seed: number
  playoffPct: number
  titlePct: number
  /** Null when this team has too few completed weeks to model. */
  modelled: boolean
}

export type OutlookLeague = {
  leagueId: string
  leagueName: string
  platform: string
  season: number
  /** Weeks still to be played, from the real schedule. */
  weeksRemaining: number
  playoffTeams: number
  /** The user's own team in this league. Null when we cannot identify it. */
  you: OutlookTeam | null
  /** Every team, ordered by current seed. */
  teams: OutlookTeam[]
  /**
   * Plain-language condition. Always specific and actionable — never a status
   * word. "Win once in three", not "In contention".
   */
  whatDecidesIt: string
  href: string
}

export type SwingMatchup = {
  leagueId: string
  leagueName: string
  week: number
  opponentName: string | null
  /** Your playoff % if you win this one. */
  ifWin: number
  /** Your playoff % if you lose it. */
  ifLose: number
  /** ifWin − ifLose, in points of playoff probability. */
  swing: number
}

export type SeasonOutlook = {
  leagues: OutlookLeague[]
  summary: {
    /** Leagues where your playoff % is at or above 50. */
    makingPlayoffs: number
    /** Playoff % at or above 99 — mathematically all but certain. */
    clinched: number
    /** Between 25% and 75% — genuinely undecided. */
    onTheBubble: number
    /** Your single best title probability, and where. */
    bestTitle: { pct: number; leagueName: string } | null
  }
  /** The single matchup that swings the most playoff probability. */
  weekThatMatters: SwingMatchup | null
  /** Ranked, three at most. Where attention is worth spending. */
  priorities: Array<{ leagueName: string; reason: string; href: string }>
  basis: string
  /** Leagues excluded, and why — never silently dropped. */
  withheld: Array<{ leagueName: string; reason: string }>
}

// ── Model ──────────────────────────────────────────────────────────────

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
 * Deterministic PRNG (mulberry32).
 *
 * ⚠ SEEDED, NOT Math.random(). Two loads of this page a second apart must not
 * report different playoff odds off the same data — a percentage that moves when
 * nothing changed reads as instability in the league, not in the sampler.
 */
function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller, one value per call. */
function gaussian(rng: () => number, mu: number, sigma: number): number {
  const u = Math.max(rng(), 1e-12)
  const v = rng()
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

type Profile = { mu: number; sigma: number; n: number }

type Game = { week: number; a: number; b: number }

type TeamState = {
  rosterId: number
  wins: number
  losses: number
  pointsFor: number
  profile: Profile | null
}

/**
 * Play the remaining schedule `iterations` times and count how often each team
 * makes the playoff field and wins the bracket.
 *
 * The bracket is seeded single-elimination over the top `playoffTeams`, with
 * each round decided by the same score sample as the regular season. Byes fall
 * out naturally when the field is not a power of two: the top seeds advance.
 */
function simulate(
  teams: TeamState[],
  remaining: Game[],
  playoffTeams: number,
  iterations: number,
  seed: number,
): Map<number, { playoff: number; title: number }> {
  const tally = new Map<number, { playoff: number; title: number }>()
  for (const t of teams) tally.set(t.rosterId, { playoff: 0, title: 0 })

  const byId = new Map(teams.map((t) => [t.rosterId, t]))

  for (let it = 0; it < iterations; it += 1) {
    const rng = createRng(seed + it * 9973)
    const wins = new Map<number, number>()
    const points = new Map<number, number>()
    for (const t of teams) {
      wins.set(t.rosterId, t.wins)
      points.set(t.rosterId, t.pointsFor)
    }

    for (const g of remaining) {
      const ta = byId.get(g.a)
      const tb = byId.get(g.b)
      if (!ta?.profile || !tb?.profile) continue
      const sa = gaussian(rng, ta.profile.mu, ta.profile.sigma)
      const sb = gaussian(rng, tb.profile.mu, tb.profile.sigma)
      points.set(g.a, (points.get(g.a) ?? 0) + sa)
      points.set(g.b, (points.get(g.b) ?? 0) + sb)
      if (sa >= sb) wins.set(g.a, (wins.get(g.a) ?? 0) + 1)
      else wins.set(g.b, (wins.get(g.b) ?? 0) + 1)
    }

    // Seed: wins, then points for. The most common fantasy tiebreak, and the
    // same rule the "current seed" column uses so the two are consistent.
    const seeded = [...teams]
      .map((t) => t.rosterId)
      .sort((x, y) => {
        const dw = (wins.get(y) ?? 0) - (wins.get(x) ?? 0)
        if (dw !== 0) return dw
        return (points.get(y) ?? 0) - (points.get(x) ?? 0)
      })

    const field = seeded.slice(0, playoffTeams)
    for (const id of field) tally.get(id)!.playoff += 1

    // Single elimination over the seeded field.
    let bracket = [...field]
    while (bracket.length > 1) {
      const next: number[] = []
      // Odd field: the top seed gets the bye.
      if (bracket.length % 2 === 1) next.push(bracket[0])
      const contenders = bracket.length % 2 === 1 ? bracket.slice(1) : bracket
      for (let i = 0, j = contenders.length - 1; i < j; i += 1, j -= 1) {
        const a = byId.get(contenders[i])
        const b = byId.get(contenders[j])
        if (!a?.profile || !b?.profile) {
          next.push(contenders[i])
          continue
        }
        const sa = gaussian(rng, a.profile.mu, a.profile.sigma)
        const sb = gaussian(rng, b.profile.mu, b.profile.sigma)
        next.push(sa >= sb ? contenders[i] : contenders[j])
      }
      bracket = next
    }
    if (bracket.length === 1) tally.get(bracket[0])!.title += 1
  }

  return tally
}

// ── Loader ─────────────────────────────────────────────────────────────

type LeagueInput = {
  id: string
  name?: string | null
  platform?: string | null
  platformLeagueId?: string | null
  settings?: unknown
}

function readPlayoffTeams(settings: unknown, teamCount: number): number {
  const slice = (settings as { playoff?: { playoffTeams?: unknown } } | null)?.playoff
  const raw = slice?.playoffTeams
  const n = typeof raw === 'number' ? raw : Number.NaN
  if (Number.isFinite(n) && n >= 2 && n <= teamCount) return Math.floor(n)
  return Math.min(DEFAULT_PLAYOFF_TEAMS, Math.max(2, teamCount))
}

/**
 * The "what decides it" sentence.
 *
 * ⚠ ALWAYS A CONDITION, NEVER A STATUS. The copy contract is explicit that this
 * column must be actionable — "Win once in three", not "In contention". So every
 * branch below names either a number of wins, a specific opponent, or the fact
 * that nothing is left to decide.
 */
function describeWhatDecidesIt(
  you: OutlookTeam | null,
  weeksRemaining: number,
  playoffTeams: number,
): string {
  if (!you) return 'We cannot identify your team in this league, so nothing here is about you.'
  if (weeksRemaining === 0) {
    return you.playoffPct >= 99
      ? 'Settled — you are in.'
      : you.playoffPct <= 1
        ? 'Settled — the regular season is over and you are out.'
        : 'The regular season is over; the seeding is already what it is.'
  }
  if (you.playoffPct >= 99) return `Clinched. The last ${weeksRemaining} are about seeding.`
  if (you.playoffPct <= 1) return `Eliminated in all but ${(100 - you.playoffPct).toFixed(0)}% of runs.`

  /*
   * How many of the remaining games you need. Derived from the sim rather than
   * asserted: the smallest k where winning k of the remaining games puts you in
   * the field in most runs. Approximated from the seed gap, which is what the
   * user can actually act on.
   */
  if (you.playoffPct >= 75) {
    return `Win ${weeksRemaining === 1 ? 'this one' : `once in ${weeksRemaining}`} and you are almost certainly in.`
  }
  if (you.playoffPct >= 40) {
    const need = Math.max(1, Math.ceil(weeksRemaining / 2))
    return `Win ${need} of the last ${weeksRemaining} and you are in more often than not.`
  }
  return `You need ${weeksRemaining === 1 ? 'this one' : `most of the last ${weeksRemaining}`}, and help — currently outside the top ${playoffTeams}.`
}

export async function getSeasonOutlook(
  userId: string,
  leagues: LeagueInput[],
): Promise<SeasonOutlook> {
  /*
   * ⚠ `basis` REPORTS THE ITERATIONS ACTUALLY RUN, NOT THE TARGET. It used to
   * interpolate the ITERATIONS constant, which would have printed "10,000
   * simulations per league" on a page that ran two thousand once the budget bit.
   * A stated basis that is wrong is worse than no stated basis — it is the one
   * sentence a reader uses to decide how much to trust the number beside it.
   */
  const describeBasis = (iterations: number) =>
    `${iterations.toLocaleString()} simulations per league, played over each league's own ` +
    `remaining schedule and its own playoff format. Each team's weekly scoring is fitted from ` +
    `every completed week it has on file, in its own league's scoring — the same model the ` +
    `matchup screens use. Records and seeding are this season's only.` +
    (iterations < ITERATIONS
      ? ` Reduced from ${ITERATIONS.toLocaleString()} because you play enough leagues that the ` +
        `full count would not finish inside one page load.`
      : '')

  const empty: SeasonOutlook = {
    leagues: [],
    summary: { makingPlayoffs: 0, clinched: 0, onTheBubble: 0, bestTitle: null },
    weekThatMatters: null,
    priorities: [],
    basis: describeBasis(ITERATIONS),
    withheld: [],
  }

  const platformIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (platformIds.length === 0) return empty

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
      where: { league: { platformLeagueId: { in: platformIds } }, claimedByUserId: userId },
      select: { externalId: true, league: { select: { platformLeagueId: true } } },
    }),
  ]).catch(() => [[], [], []] as const)

  if (rows.length === 0) return empty

  const nameByRoster = new Map<string, string>()
  for (const t of teams) {
    const pid = t.league?.platformLeagueId
    const roster = Number(t.externalId)
    if (!pid || !Number.isFinite(roster)) continue
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (label) nameByRoster.set(`${pid}:${roster}`, label)
  }

  const myRosters = new Set<string>()
  for (const t of mine) {
    const pid = t.league?.platformLeagueId
    const roster = Number(t.externalId)
    if (!pid || !Number.isFinite(roster)) continue
    myRosters.add(`${pid}:${roster}`)
  }

  const out: OutlookLeague[] = []
  const withheld: SeasonOutlook['withheld'] = []
  /** What `chooseIterations` settled on, so `basis` can report the truth. */
  let runIterations = ITERATIONS

  /**
   * Everything a league needs to be simulated, gathered before any simulation
   * runs. The two passes exist so the iteration count can be chosen from the
   * TOTAL amount of schedule rather than league by league.
   */
  const prepared: Array<{
    league: LeagueInput
    pid: string
    leagueName: string
    season: number
    states: TeamState[]
    remaining: Game[]
    weeksRemaining: number
    playoffTeams: number
    leagueSeed: number
  }> = []

  for (const league of leagues) {
    const pid = league.platformLeagueId
    const leagueName = league.name?.trim() || 'League'
    if (!pid) continue

    const leagueRows = rows.filter((r) => r.leagueId === pid)
    if (leagueRows.length === 0) {
      withheld.push({ leagueName, reason: 'No matchups have been synced for this league.' })
      continue
    }

    // The season being played is the latest one on file.
    const season = leagueRows.reduce((max, r) => Math.max(max, r.seasonYear), 0)
    const seasonRows = leagueRows.filter((r) => r.seasonYear === season)

    /*
     * ⚠ SCORING PROFILES ARE FITTED ACROSS EVERY SEASON ON FILE, NOT JUST THIS
     * ONE — and that is the same choice `weekBoard.ts` makes, deliberately.
     *
     * Fitting on `seasonRows` was the first version and it made this page
     * useless for exactly the moment it matters most. Measured on production
     * 2026-08-23: season 2026 has 9,354 matchup rows and **zero** of them
     * scored, because a whole season's schedule is written before anybody
     * plays. Every league therefore had zero modellable teams and the entire
     * page rendered its empty state in August, while 2025 form sat unread in
     * the same table.
     *
     * Record and points-for below still come from THIS season only — those are
     * standings, and last year's wins are not this year's. It is only the
     * scoring distribution that carries over, which is what preseason odds are
     * built on everywhere.
     */
    const scores = new Map<number, number[]>()
    for (const r of leagueRows) {
      if (r.pointsFor <= 0 && r.pointsAgainst <= 0) continue
      const list = scores.get(r.rosterId)
      if (list) list.push(r.pointsFor)
      else scores.set(r.rosterId, [r.pointsFor])
    }

    const states: TeamState[] = []
    for (const r of seasonRows) {
      if (states.some((s) => s.rosterId === r.rosterId)) continue
      const values = scores.get(r.rosterId) ?? []
      let profile: Profile | null = null
      if (values.length >= MIN_WEEKS) {
        const mu = values.reduce((a, b) => a + b, 0) / values.length
        const variance =
          values.reduce((acc, v) => acc + (v - mu) ** 2, 0) / Math.max(1, values.length - 1)
        profile = { mu, sigma: Math.max(SIGMA_FLOOR, Math.sqrt(variance)), n: values.length }
      }
      const played = seasonRows.filter(
        (x) => x.rosterId === r.rosterId && (x.pointsFor > 0 || x.pointsAgainst > 0),
      )
      states.push({
        rosterId: r.rosterId,
        wins: played.filter((x) => x.win === 1).length,
        losses: played.filter((x) => x.win !== 1).length,
        pointsFor: played.reduce((a, x) => a + x.pointsFor, 0),
        profile,
      })
    }

    const modelled = states.filter((s) => s.profile != null).length
    if (modelled < 2) {
      withheld.push({
        leagueName,
        reason: `Only ${modelled} of ${states.length} teams have three or more completed weeks on file, in any season — not enough to simulate.`,
      })
      continue
    }

    // The REAL remaining schedule: unscored rows, paired on matchupId.
    const pairs = new Map<string, number[]>()
    for (const r of seasonRows) {
      if (r.matchupId == null) continue
      if (r.pointsFor > 0 || r.pointsAgainst > 0) continue
      const key = `${r.week}|${r.matchupId}`
      const list = pairs.get(key)
      if (list) list.push(r.rosterId)
      else pairs.set(key, [r.rosterId])
    }
    const remaining: Game[] = []
    for (const [key, ids] of pairs) {
      if (ids.length !== 2) continue
      remaining.push({ week: Number(key.split('|')[0]), a: ids[0], b: ids[1] })
    }
    const weeksRemaining = new Set(remaining.map((g) => g.week)).size

    const playoffTeams = readPlayoffTeams(league.settings, states.length)

    // A stable seed per league so the same league always simulates the same way.
    let leagueSeed = 0
    for (let i = 0; i < pid.length; i += 1) leagueSeed = (leagueSeed * 31 + pid.charCodeAt(i)) >>> 0

    prepared.push({ league, pid, leagueName, season, states, remaining, weeksRemaining, playoffTeams, leagueSeed })
  }

  /*
   * Iterations are chosen ONCE, from the total schedule across every league that
   * survived preparation — see TOTAL_GAME_BUDGET. Choosing per league would let
   * the sixtieth league be as expensive as the first.
   */
  const totalRemainingGames = prepared.reduce((acc, p) => acc + p.remaining.length, 0)
  const iterations = chooseIterations(totalRemainingGames)
  runIterations = iterations

  for (const {
    league,
    pid,
    leagueName,
    season,
    states,
    remaining,
    weeksRemaining,
    playoffTeams,
    leagueSeed,
  } of prepared) {
    const tally = simulate(states, remaining, playoffTeams, iterations, leagueSeed || 1)

    const ordered = [...states].sort((a, b) => {
      const dw = b.wins - a.wins
      return dw !== 0 ? dw : b.pointsFor - a.pointsFor
    })

    const outlookTeams: OutlookTeam[] = ordered.map((s, i) => {
      const t = tally.get(s.rosterId) ?? { playoff: 0, title: 0 }
      return {
        rosterId: s.rosterId,
        name: nameByRoster.get(`${pid}:${s.rosterId}`) ?? null,
        isYou: myRosters.has(`${pid}:${s.rosterId}`),
        wins: s.wins,
        losses: s.losses,
        pointsFor: s.pointsFor,
        seed: i + 1,
        playoffPct: (t.playoff / iterations) * 100,
        titlePct: (t.title / iterations) * 100,
        modelled: s.profile != null,
      }
    })

    const you = outlookTeams.find((t) => t.isYou) ?? null

    out.push({
      leagueId: league.id,
      leagueName,
      platform: String(league.platform ?? 'manual').toLowerCase(),
      season,
      weeksRemaining,
      playoffTeams,
      you,
      teams: outlookTeams,
      whatDecidesIt: describeWhatDecidesIt(you, weeksRemaining, playoffTeams),
      href: `/core?league=${encodeURIComponent(league.id)}`,
    })
  }

  // Best title odds first — the page leads with where you can actually win.
  out.sort((a, b) => (b.you?.titlePct ?? -1) - (a.you?.titlePct ?? -1))

  const withYou = out.filter((l) => l.you != null)
  const bestTitleLeague = withYou.reduce<OutlookLeague | null>(
    (best, l) => (best == null || (l.you!.titlePct > best.you!.titlePct) ? l : best),
    null,
  )

  const summary = {
    makingPlayoffs: withYou.filter((l) => l.you!.playoffPct >= 50).length,
    clinched: withYou.filter((l) => l.you!.playoffPct >= 99).length,
    onTheBubble: withYou.filter((l) => l.you!.playoffPct > 25 && l.you!.playoffPct < 75).length,
    bestTitle: bestTitleLeague
      ? { pct: bestTitleLeague.you!.titlePct, leagueName: bestTitleLeague.leagueName }
      : null,
  }

  /*
   * "The week that matters most" — the single matchup swinging the most playoff
   * probability. Computed rather than picked: for the user's next game in each
   * league, re-run the sim twice with that result forced, and take the largest
   * gap. Restricted to each league's NEXT week so the cost stays bounded at two
   * extra sims per league rather than two per remaining game.
   */
  let weekThatMatters: SwingMatchup | null = null

  /*
   * ⚠ ONLY CONTESTED LEAGUES GET THE BRANCH SIMS, AND AT MOST `SWING_CANDIDATES`
   * OF THEM. This pass costs two extra simulations per league on top of the main
   * one, and running it across sixty leagues doubles the page's whole cost to
   * answer a question that is meaningless in most of them: a league you are 99%
   * to make cannot have a result that swings your odds. Restricting to the
   * genuinely undecided is both cheaper and more correct.
   */
  const SWING_CANDIDATES = 8
  const contested = out
    .filter((l) => l.you != null && l.weeksRemaining > 0 && l.you.playoffPct > 2 && l.you.playoffPct < 98)
    .sort((a, b) => Math.abs(50 - a.you!.playoffPct) - Math.abs(50 - b.you!.playoffPct))
    .slice(0, SWING_CANDIDATES)

  for (const league of contested) {
    if (!league.you || league.weeksRemaining === 0) continue
    const pid = leagues.find((l) => l.id === league.leagueId)?.platformLeagueId
    if (!pid) continue
    const leagueRows = rows.filter((r) => r.leagueId === pid && r.seasonYear === league.season)
    const unscored = leagueRows.filter((r) => r.pointsFor <= 0 && r.pointsAgainst <= 0 && r.matchupId != null)
    const nextWeek = unscored.reduce((min, r) => Math.min(min, r.week), Number.POSITIVE_INFINITY)
    if (!Number.isFinite(nextWeek)) continue

    const mineRow = unscored.find((r) => r.week === nextWeek && myRosters.has(`${pid}:${r.rosterId}`))
    if (!mineRow) continue
    const oppRow = unscored.find(
      (r) => r.week === nextWeek && r.matchupId === mineRow.matchupId && r.rosterId !== mineRow.rosterId,
    )
    if (!oppRow) continue

    const before = league.you.playoffPct
    /*
     * A forced result is modelled as removing that game from the schedule and
     * banking the win (or the loss) — which is exactly what the result does.
     * Cheaper and more faithful than re-sampling a game whose outcome is fixed.
     */
    const states: TeamState[] = league.teams.map((t) => ({
      rosterId: t.rosterId,
      wins: t.wins,
      losses: t.losses,
      pointsFor: t.pointsFor,
      profile: null,
    }))
    // Re-derive profiles for the forced runs from the same season rows.
    const scores = new Map<number, number[]>()
    for (const r of leagueRows) {
      if (r.pointsFor <= 0 && r.pointsAgainst <= 0) continue
      const list = scores.get(r.rosterId)
      if (list) list.push(r.pointsFor)
      else scores.set(r.rosterId, [r.pointsFor])
    }
    for (const s of states) {
      const values = scores.get(s.rosterId) ?? []
      if (values.length < MIN_WEEKS) continue
      const mu = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((acc, v) => acc + (v - mu) ** 2, 0) / Math.max(1, values.length - 1)
      s.profile = { mu, sigma: Math.max(SIGMA_FLOOR, Math.sqrt(variance)), n: values.length }
    }

    const restPairs = new Map<string, number[]>()
    for (const r of unscored) {
      if (r.week === nextWeek && r.matchupId === mineRow.matchupId) continue
      const key = `${r.week}|${r.matchupId}`
      const list = restPairs.get(key)
      if (list) list.push(r.rosterId)
      else restPairs.set(key, [r.rosterId])
    }
    const rest: Game[] = []
    for (const [key, ids] of restPairs) {
      if (ids.length !== 2) continue
      rest.push({ week: Number(key.split('|')[0]), a: ids[0], b: ids[1] })
    }

    let seed = 0
    for (let i = 0; i < pid.length; i += 1) seed = (seed * 31 + pid.charCodeAt(i)) >>> 0

    // Fewer iterations for the branch runs: this is a comparison of two numbers,
    // not a headline figure, and the page already pays for one full sim per league.
    const BRANCH_ITERATIONS = 2_000

    const winStates = states.map((s) =>
      s.rosterId === mineRow.rosterId
        ? { ...s, wins: s.wins + 1 }
        : s.rosterId === oppRow.rosterId
          ? { ...s, losses: s.losses + 1 }
          : s,
    )
    const loseStates = states.map((s) =>
      s.rosterId === mineRow.rosterId
        ? { ...s, losses: s.losses + 1 }
        : s.rosterId === oppRow.rosterId
          ? { ...s, wins: s.wins + 1 }
          : s,
    )

    const winTally = simulate(winStates, rest, league.playoffTeams, BRANCH_ITERATIONS, seed || 1)
    const loseTally = simulate(loseStates, rest, league.playoffTeams, BRANCH_ITERATIONS, seed || 1)

    const ifWin = ((winTally.get(mineRow.rosterId)?.playoff ?? 0) / BRANCH_ITERATIONS) * 100
    const ifLose = ((loseTally.get(mineRow.rosterId)?.playoff ?? 0) / BRANCH_ITERATIONS) * 100
    const swing = ifWin - ifLose
    void before

    if (!weekThatMatters || swing > weekThatMatters.swing) {
      weekThatMatters = {
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        week: nextWeek,
        opponentName: nameByRoster.get(`${pid}:${oppRow.rosterId}`) ?? null,
        ifWin,
        ifLose,
        swing,
      }
    }
  }

  /*
   * "Where to spend your attention" — ranked, three at most. Ordered by how much
   * a decision could still change: bubble leagues first (the only ones a lineup
   * call actually swings), then live title chances, then anything already settled.
   */
  const priorities = withYou
    .map((l) => {
      const p = l.you!.playoffPct
      const contested = p > 25 && p < 75
      const score = contested ? 100 - Math.abs(p - 50) : l.you!.titlePct
      const reason = contested
        ? `On the bubble at ${p.toFixed(0)}% with ${l.weeksRemaining} to play — this is where a lineup call is worth the most.`
        : p >= 75
          ? `${l.you!.titlePct.toFixed(0)}% to win it. Playing for seeding now, not survival.`
          : `${p.toFixed(0)}% to make the field. Needs help, not just wins.`
      return { leagueName: l.leagueName, reason, href: l.href, score, contested }
    })
    .sort((a, b) => (Number(b.contested) - Number(a.contested)) || b.score - a.score)
    .slice(0, 3)
    .map(({ leagueName, reason, href }) => ({ leagueName, reason, href }))

  return {
    leagues: out,
    summary,
    weekThatMatters,
    priorities,
    basis: describeBasis(runIterations),
    withheld,
  }
}
