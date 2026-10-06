import 'server-only'

import { prisma } from '@/lib/prisma'
import { historicalScoringSpread } from './historicalScoringSpread'
import { readWeeklyHistory } from './weekBoard'
import { weeklyScopeKey, weeklyFormat, canCertifyWeeklyPlayoffStatus } from './weeklyCapabilities'
import { leagueWeekProgress } from './leagueWeekProgress'
import { getFirstStatedKickoff } from './seasonPhase'
import {
  bandAround,
  mathStatus,
  pctOf,
  readMilestones,
  rootingGuide,
  scheduleStrength,
  seedFromString,
  simulateSeason,
  type Milestones,
  type RootingGame,
  type ScheduleStrength,
  type SimGame,
  type SimInput,
  type SimTeam,
} from './outlookSim'
import { readPlayoffFormat, type FormatSource } from './outlookFormat'
import {
  computeLeagueSim,
  leagueSimCost,
  leagueSimHash,
  readLeagueSims,
  writeLeagueSims,
  type LeagueSimResult,
} from './seasonOutlookSims'
import {
  BRANCH_ITERATIONS,
  buildFocusInsights,
  loadScenarioModel,
  type OutlookFocus,
} from './seasonOutlookFocus'

/**
 * 26b — Season Outlook. Playoff, bye and championship odds for every active league, on one page.
 *
 * ⚠ THIS PAGE EXISTS BECAUSE THE OLD ENTRY POINT WENT SOMEWHERE ELSE ENTIRELY.
 * "Season Outlook" in the dashboard tools grid pointed at `/af-legacy?tab=pulse`
 * — the Legacy import board's market tab, which has nothing to do with playoff
 * odds. That href was fixed in the same change that added this file, in the Nocturne
 * dashboard — a screen since deleted as unreachable, so the fix now lives only in history
 * (git log --diff-filter=D -- components/dashboard/nocturne/). If you are reading this
 * because odds look wrong, check first that you are on THIS route and not back
 * on the Legacy board.
 *
 * ⚠ THE MODEL IS THE ONE ALREADY USED BY 24a/24b, NOT A SECOND ONE. Each team's
 * weekly scoring is fitted from its own completed weeks (mean and spread), and
 * the remaining schedule — the real one, read from the unscored WeeklyMatchup
 * rows, not a synthesized round-robin — is played out many times. The simulation
 * itself now lives in `outlookSim.ts`, pure, so the browser can run the same
 * model for the scenario panel.
 *
 * ⚠ EVERY PROBABILITY THIS FILE EMITS CARRIES ITS BASIS. `SeasonOutlook.basis`
 * is a required field and the surface prints it; each league also carries a
 * structured `assumptions` block (inputs, sample sizes, when it was run, what is
 * missing). A percentage with no stated derivation is indistinguishable from a guess.
 *
 * ── 2026-09-17: what changed, and the two bugs that went with it ──────────────
 *
 *   - The playoff field was read from `settings.playoff.playoffTeams`, a key no import writes, so
 *     every league ran with six. `outlookFormat.ts` reads the keys that exist.
 *   - A six-team field was bracketed 1v6, 2v5, 3v4. Byes are now played as byes.
 *   - Unscored rows past the regular season were counted as regular-season games whenever a
 *     platform paired them. The league's own last regular week now bounds the schedule.
 *   - Runs are stored per league and reused until the inputs change (`seasonOutlookSims.ts`).
 */

/** The handoff's number, and the target. See `chooseIterations` for when it bends. */
export const ITERATIONS = 10_000

/**
 * ⚠ A HARD CEILING ON TOTAL WORK, BECAUSE THIS RUNS IN A REQUEST.
 *
 * Ten thousand simulations per league is cheap for one league and ruinous for
 * sixty. Measured on this database, one account carries 63 connected leagues; at
 * roughly 78 remaining games each that is 10,000 × 78 × 63 ≈ 49 million simulated
 * games on a single page load. A handler that runs long enough gets killed by the
 * platform edge at around 300 seconds, and no user code runs when it does, so it
 * fails as a blank 502 rather than as a timeout anyone can read.
 *
 * So the budget is on total simulated games, and the per-league iteration count
 * falls out of it. It is spent only on leagues with no stored run (see
 * `seasonOutlookSims.ts`), and the range run is counted in it (×1.5, which is why
 * the number is half as large again as the 6M it replaced — same iterations as before).
 * `basis` reports the number ACTUALLY used, not the number we wished for.
 */
const TOTAL_GAME_BUDGET = 9_000_000

/** Never drop below this: fewer runs than this and the percentages are noise. */
const MIN_ITERATIONS = 1_500

function chooseIterations(costAtOneIteration: number): number {
  if (costAtOneIteration <= 0) return ITERATIONS
  const affordable = Math.floor(TOTAL_GAME_BUDGET / costAtOneIteration)
  return Math.max(MIN_ITERATIONS, Math.min(ITERATIONS, affordable))
}

/** Floor on σ — see the identical constant in weekBoard.ts for the reasoning. */

/** Below this many completed weeks a team is not modelled. */
const MIN_WEEKS = 3

export type OddsRange = { lo: number; hi: number }

export type OutlookTeam = {
  rosterId: string
  name: string | null
  isYou: boolean
  wins: number
  losses: number
  ties?: number
  pointsFor: number
  /** Current seed by the same rule the sim uses: wins, then points for. */
  seed: number
  playoffPct: number
  /** Seeded inside the bye line. 0 in a field with no byes. */
  byePct: number
  titlePct: number
  /** 100 − playoffPct: the chance the season ends without a playoff berth. */
  missPct: number
  /**
   * How far each number could move if the teams' scoring averages had been fitted differently —
   * 10th to 90th percentile over re-drawn averages. Null for a team that is not modelled.
   */
  range: { playoff: OddsRange; bye: OddsRange; title: OddsRange } | null
  /** By arithmetic, not by a percentage that rounds to 0 or 100. */
  status: 'clinched' | 'eliminated' | null
  /** False when this team has too few completed weeks to model. */
  modelled: boolean
  /** Completed weeks its scoring is fitted from, across every season on file. */
  weeksFitted: number
  weeklyMean: number | null
  /** Wins its weekly scores would have earned against the whole league this season. */
  expectedWins: number | null
  schedule: ScheduleStrength | null
}

export type OutlookAssumptions = {
  iterations: number
  rangeBatches: number
  rangeRunsPerBatch: number
  /** Seasons whose completed weeks the scoring fit reads. */
  seasonsFitted: number[]
  weeksFitted: { min: number; median: number; max: number } | null
  teams: number
  modelledTeams: number
  remainingGames: number
  regularSeasonEndWeek: number | null
  playoffTeams: { value: number; source: FormatSource }
  byes: { value: number; source: FormatSource }
  tiebreak: string
  /** When this league's simulation was actually run. */
  computedAt: string
  /** True when the run was reused because nothing it reads had changed. */
  reused: boolean
  /** Things the model does not know or does not use — always stated, never implied. */
  missing: string[]
}

export type OutlookLeague = {
  /** Current scoring period of this model, distinct from a later pending scenario week. */
  period?: number
  leagueId: string
  leagueName: string
  platform: string
  season: number
  /** Weeks still to be played, from the real schedule. */
  weeksRemaining: number
  playoffTeams: number
  byeTeams: number
  /** The user's own team in this league. Null when we cannot identify it. */
  you: OutlookTeam | null
  /** Every team, ordered by current seed. */
  teams: OutlookTeam[]
  /**
   * Plain-language condition. Always specific and actionable — never a status
   * word. "Get to 8 wins", not "In contention".
   */
  whatDecidesIt: string
  href: string
  /** Record and points likely needed for a berth. Null when you are not identified or not modelled. */
  milestones: Milestones | null
  assumptions: OutlookAssumptions
  /** Rosters, drivers, moves and scenarios — only for the league being rendered. */
  focus: OutlookFocus | null
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
  /**
   * True when winning this game puts you in the field in essentially every run.
   * "Win and you are in" is a much stronger statement than a percentage, and it
   * is only made when the simulation actually supports it.
   */
  clinchOnWin: boolean
  /**
   * Teams whose absence from the field most raises your own odds *in the runs
   * where you lose this game* — the specific help you need, named.
   *
   * ⚠ THIS IS A CONDITIONAL PROBABILITY, NOT A STANDINGS-ADJACENCY GUESS. It is
   * P(you make it | this team misses) − P(you make it), measured across the
   * lose-branch runs. The team directly above you in the table is often NOT the
   * one that helps you most, because seeding depends on points for as well as
   * record.
   *
   * Empty when no rival clears the lift threshold, which is itself meaningful:
   * it means no single result rescues you and the copy says so.
   */
  helpIfLose: string[]
  /**
   * The other games that week, ranked by how far their result moves your odds — who to root for.
   * From one unforced run, so each pair is P(you make it | that side won); see `rootingGuide`.
   *
   * ⚠ OPTIONAL BECAUSE STORED BOARDS PREDATE IT. A summary cached before this field existed has no
   * key at all, and a reader must treat that as "no guide", never as "no game matters".
   */
  rooting?: Array<RootingGame & { aName: string | null; bName: string | null }>
}

export type SeasonOutlook = {
  leagues: OutlookLeague[]
  summary: {
    /** Leagues where your playoff % is at or above 50. */
    makingPlayoffs: number
    /** Clinched by conservative arithmetic under the supported league rules. */
    clinched: number
    /** Between 25% and 75% — genuinely undecided. */
    onTheBubble: number
    /** Leagues where you are more likely than not to earn a bye. */
    onByePace: number
    /** Your single best title probability, and where. */
    bestTitle: { pct: number; leagueName: string } | null
  }
  /** The single matchup that swings the most playoff probability. */
  weekThatMatters: SwingMatchup | null
  /** Every contested league's own swing game, keyed by league id. */
  swingByLeague: Record<string, SwingMatchup>
  /** Ranked, three at most. Where attention is worth spending. */
  priorities: Array<{ leagueName: string; reason: string; href: string }>
  basis: string
  /** Leagues excluded, and why — never silently dropped. */
  withheld: Array<{ leagueName: string; reason: string }>
  /**
   * First future kickoff a source STATES is regular season, ISO — null when
   * none is stated. Drives the phase-aware empty state; see
   * lib/core-app/seasonPhase.ts.
   */
  firstKickoffAt: string | null
  /** When this board was assembled. Each league's own run time is in its assumptions. */
  generatedAt: string
  /** How many league runs were reused versus computed for this board. */
  runs: { reused: number; computed: number }
}

// ── Loader ─────────────────────────────────────────────────────────────

export type LeagueInput = {
  id: string
  name?: string | null
  platform?: string | null
  platformLeagueId?: string | null
  settings?: unknown
  sport?: string | null
  leagueType?: string | null
}

/** The row shape Season Outlook simulates from — `weeklyMatchup`, narrowed. */
type OutlookMatchupRow = {
  finalized?: boolean
  scored?: boolean
  leagueId: string
  seasonYear: number
  week: number
  rosterId: string
  matchupId: number | null
  pointsFor: number
  pointsAgainst: number
  win: number
}

type FactPair = { leagueId: string; season: number; week: number; a: string; b: string }

/**
 * Fold imported season history into the rows this screen fits its scoring model on.
 *
 * ⚠ THE HISTORY WAS ALWAYS BEING IMPORTED; NOTHING READ IT. Every provider's
 * historical backfill writes `MatchupFact` (`dw_matchup_facts`), and no surface on the
 * site queried that table.
 *
 * ⚠ TWO ID SPACES, AND THEY ARE NOT INTERCHANGEABLE. `WeeklyMatchup.leagueId` is the
 * PROVIDER's league id; `MatchupFact.leagueId` is the AllFantasy uuid. They are joined
 * through `LeagueInput` here rather than assumed equal.
 *
 * `teamA`/`teamB` are already canonical: the sync resolves each historical roster to the
 * CURRENT season's `source_team_id`, which is what `LeagueTeam.externalId` holds and what
 * this screen keys `rosterId` on. A manager who has since left is stored as
 * `former:sleeper:<ownerId>` (see `historicalTeamIdentity.ts`), which does not parse as a
 * number and is dropped — they are not a team in this league now.
 *
 * ⚠ ONLY FOR LEAGUES THAT ALREADY HAVE LIVE ROWS. A league with history but no current
 * matchups keeps reporting "no matchups synced" rather than simulating a finished season.
 *
 * Also returns the fact PAIRINGS, because a synthesised row has no `matchupId` and so cannot
 * say who it played — and past strength of schedule needs exactly that.
 */
function mergeImportedMatchupHistory(
  live: readonly OutlookMatchupRow[],
  facts: readonly {
    leagueId: string
    season: number | null
    weekOrPeriod: number
    teamA: string
    teamB: string
    scoreA: number
    scoreB: number
  }[],
  leagues: readonly LeagueInput[],
): { rows: OutlookMatchupRow[]; pairs: FactPair[] } {
  if (facts.length === 0) return { rows: [...live], pairs: [] }

  const platformByLeagueId = new Map<string, string>()
  for (const league of leagues) {
    if (league.platformLeagueId) platformByLeagueId.set(league.id, league.platformLeagueId)
  }

  const leaguesWithLiveRows = new Set(live.map((r) => r.leagueId))
  /* Live rows win every collision — an imported fact never overwrites a synced week. */
  const seen = new Set(live.map((r) => `${r.leagueId}|${r.seasonYear}|${r.week}|${r.rosterId}`))

  const added: OutlookMatchupRow[] = []
  const pairs: FactPair[] = []
  for (const fact of facts) {
    const platformLeagueId = platformByLeagueId.get(fact.leagueId)
    if (!platformLeagueId || fact.season == null) continue
    if (!leaguesWithLiveRows.has(platformLeagueId)) continue
    if (!Number.isFinite(Number(fact.teamA)) || !Number.isFinite(Number(fact.teamB))) continue
    if (fact.scoreA > 0 || fact.scoreB > 0) {
      pairs.push({ leagueId: platformLeagueId, season: fact.season, week: fact.weekOrPeriod, a: fact.teamA, b: fact.teamB })
    }

    const sides = [
      { team: fact.teamA, pointsFor: fact.scoreA, pointsAgainst: fact.scoreB },
      { team: fact.teamB, pointsFor: fact.scoreB, pointsAgainst: fact.scoreA },
    ]
    for (const side of sides) {
      const rosterId = side.team
      const key = `${platformLeagueId}|${fact.season}|${fact.weekOrPeriod}|${rosterId}`
      if (seen.has(key)) continue
      seen.add(key)
      added.push({
        leagueId: platformLeagueId,
        seasonYear: fact.season,
        week: fact.weekOrPeriod,
        rosterId,
        matchupId: null,
        pointsFor: side.pointsFor,
        pointsAgainst: side.pointsAgainst,
        /* A tie is not a win. `win` is an Int on WeeklyMatchup, matched here. */
        win: side.pointsFor > side.pointsAgainst ? 1 : 0,
      })
    }
  }

  return { rows: added.length > 0 ? [...live, ...added] : [...live], pairs }
}

/**
 * The "what decides it" sentence.
 *
 * ⚠ ALWAYS A CONDITION, NEVER A STATUS. Where the simulation gives a win total that
 * gets you in, the sentence names it; the older wording ("win once in three") was an
 * approximation from the seed gap and is kept only as the fallback.
 */
function describeWhatDecidesIt(
  you: OutlookTeam | null,
  weeksRemaining: number,
  playoffTeams: number,
  m: Milestones | null,
): string {
  if (!you) return 'We cannot identify your team in this league, so nothing here is about you.'
  if (you.status === 'clinched') {
    return weeksRemaining > 0 ? `Clinched. The last ${weeksRemaining} are about seeding.` : 'Settled — you are in.'
  }
  if (you.status === 'eliminated') return 'Eliminated — no remaining result gets you into the field.'
  if (weeksRemaining === 0) {
    return 'The modeled schedule is complete. Verify final standings and qualification rules.'
  }
  if (you.playoffPct >= 99) return `Very likely to qualify in the model; not mathematically clinched. ${weeksRemaining} periods remain.`
  /*
   * ⚠ THIS READ "Out in all but ${100 - pct}% of runs" — i.e. "Out in all but 99% of runs" at 1%
   * and "Out in all but 100% of runs" at 0%, which says the opposite of what it means. Measured on
   * the production standings screen 2026-09-28.
   */
  if (you.playoffPct <= 1) {
    return you.playoffPct === 0 ? 'No qualifying simulated runs; this alone does not establish mathematical elimination.' : 'A long-shot forecast; a nonzero probability is not mathematical elimination.'
  }

  if (m) {
    const target = m.winsForSafe ?? m.winsForLikely
    if (target != null) {
      const need = target - m.currentWins
      const safe = m.winsForSafe != null
      if (need <= 0) return `You already have ${m.currentWins} wins, which gets you in ${safe ? 'nine times in ten' : 'more often than not'}.`
      return (
        `Get to ${target} wins — ${need} of your last ${weeksRemaining} — and you are in ${safe ? 'nine times in ten' : 'more often than not'}.` +
        (you.playoffPct < 40 ? ' You will likely need help too.' : '')
      )
    }
    return `No win total gets you in reliably — winning out still needs help from outside the top ${playoffTeams}.`
  }

  if (you.playoffPct >= 75) {
    return `Win ${weeksRemaining === 1 ? 'this one' : `once in ${weeksRemaining}`} and you are almost certainly in.`
  }
  if (you.playoffPct >= 40) {
    const need = Math.max(1, Math.ceil(weeksRemaining / 2))
    return `Win ${need} of the last ${weeksRemaining} and you are in more often than not.`
  }
  return `You need ${weeksRemaining === 1 ? 'this one' : `most of the last ${weeksRemaining}`}, and help — currently outside the top ${playoffTeams}.`
}

/** Re-exported: it moved to a client-safe module so the league screen can render it. */
export { describeTeamOutlook } from './outlookCopy'

export type Prepared = {
  period?: number
  statusCanBeCertified: boolean
  league: LeagueInput
  pid: string
  leagueName: string
  season: number
  sim: SimInput
  seed: number
  played: SimGame[]
  weeks: number[]
  weeksRemaining: number
  expectedWins: Map<string, number>
  seasonsFitted: number[]
  format: ReturnType<typeof readPlayoffFormat>
  missing: string[]
  /** The unscored rows, kept for the swing branch. */
  unscored: OutlookMatchupRow[]
}

function fitProfile(values: number[]): SimTeam['profile'] {
  if (values.length < MIN_WEEKS) return null
  const mu = values.reduce((a, b) => a + b, 0) / values.length
  return { mu, sigma: historicalScoringSpread(values), n: values.length }
}

/** All-play: each week, the share of the league a team outscored. Summed over weeks. */
function allPlayWins(seasonRows: readonly OutlookMatchupRow[]): Map<string, number> {
  const byWeek = new Map<number, Array<{ id: string; pts: number }>>()
  for (const r of seasonRows) {
    if (r.pointsFor <= 0 && r.pointsAgainst <= 0) continue
    const list = byWeek.get(r.week) ?? []
    list.push({ id: r.rosterId, pts: r.pointsFor })
    byWeek.set(r.week, list)
  }
  const out = new Map<string, number>()
  for (const list of byWeek.values()) {
    if (list.length < 2) continue
    for (const me of list) {
      let beat = 0
      for (const o of list) {
        if (o.id === me.id) continue
        if (me.pts > o.pts) beat += 1
        else if (me.pts === o.pts) beat += 0.5
      }
      out.set(me.id, (out.get(me.id) ?? 0) + beat / (list.length - 1))
    }
  }
  return out
}

export type OutlookInputs = {
  prepared: Prepared[]
  withheld: SeasonOutlook['withheld']
  /** `${platformLeagueId}:${rosterId}` → team name. */
  nameByRoster: Map<string, string>
  /** `${platformLeagueId}:${rosterId}` for the user's own teams. */
  myRosters: Set<string>
  /** AllFantasy league id → sport. */
  sportOf: Map<string, string>
}

/**
 * Everything the simulation reads, per league, before any simulation runs. Shared by the page
 * (`getSeasonOutlook`) and the scheduled pre-compute (`seasonOutlookPrewarm.ts`), so the two can
 * never hash different inputs for the same league. Null when no league has anything to read.
 */
export async function loadOutlookInputs(userId: string, leagues: LeagueInput[], identityLeagues: LeagueInput[] = leagues): Promise<OutlookInputs | null> {
  const [history, sports] = await Promise.all([
    readWeeklyHistory(userId, leagues, identityLeagues),
    prisma.league.findMany({ where: { id: { in: leagues.map(l => l.id) } }, select: { id: true, sport: true, season: true, settings: true, status: true, leagueType: true } }),
  ])
  if (!history) return null
  const rows = history.rows
  const nameByRoster = history.rosterNames
  const myRosters = new Set(history.myRosters.keys())
  const sportOf = new Map<string, string>(sports.map(l => [l.id, String(l.sport)]))
  const rowsByLeague = new Map<string, OutlookMatchupRow[]>()
  for (const r of rows) {
    const list = rowsByLeague.get(r.leagueId)
    if (list) list.push(r)
    else rowsByLeague.set(r.leagueId, [r])
  }

  const withheld: SeasonOutlook['withheld'] = []
  const prepared: Prepared[] = []

  for (const league of leagues) {
    const pid = weeklyScopeKey(league)
    const leagueName = league.name?.trim() || 'League'
    const storedLeague = sports.find(l => l.id === league.id)
    const formatMode = weeklyFormat({ ...league, leagueType: storedLeague?.leagueType ?? league.leagueType, settings: storedLeague?.settings ?? league.settings })
    if (formatMode !== 'head-to-head') {
      withheld.push({ leagueName, reason: 'This format needs a category, season-table or survival model; head-to-head points playoff odds are unavailable.' })
      continue
    }
    const leagueRows = rowsByLeague.get(pid) ?? []
    if (leagueRows.length === 0) {
      withheld.push({ leagueName, reason: 'No matchups have been synced for this league.' })
      continue
    }

    // A stated current season wins over an older season that happens to have scores.
    const season = history.periodsByLeague.get(pid)?.season ?? storedLeague?.season ?? leagueRows.reduce((max, r) => Math.max(max, r.seasonYear), 0)
    const seasonRows = leagueRows.filter((r) => r.seasonYear === season)
    if (!seasonRows.length) {
      withheld.push({ leagueName, reason: `No current-season schedule is on file for ${season}. Historical scoring alone cannot establish this season's playoff path.` })
      continue
    }
    const nativeRule = history.nativeRules.get(pid)
    if (nativeRule?.season === season && nativeRule.medianGame) {
      withheld.push({ leagueName, reason: 'This native season uses median games. Its additional qualification results are not supported by this playoff model.' })
      continue
    }
    const progress = leagueWeekProgress(sports.find((l) => l.id === league.id) ?? { settings: league.settings, season })
    const final = (r: OutlookMatchupRow) => r.finalized ?? (progress.currentWeek == null || progress.isFinal(r.seasonYear, r.week))

    /*
     * ⚠ SCORING PROFILES ARE FITTED ACROSS EVERY SEASON ON FILE, NOT JUST THIS
     * ONE — the same choice `weekBoard.ts` makes. Season 2026 had zero scored rows
     * in August while 2025 form sat unread in the same table. Record and points-for
     * still come from THIS season only.
     */
    const scores = new Map<string, number[]>()
    const seasonsFitted = new Set<number>()
    for (const r of leagueRows) {
      if (!final(r) || (r.scored !== true && r.pointsFor <= 0 && r.pointsAgainst <= 0)) continue
      seasonsFitted.add(r.seasonYear)
      const list = scores.get(r.rosterId)
      if (list) list.push(r.pointsFor)
      else scores.set(r.rosterId, [r.pointsFor])
    }

    const byRoster = new Map<string, OutlookMatchupRow[]>()
    for (const r of seasonRows) {
      const list = byRoster.get(r.rosterId)
      if (list) list.push(r)
      else byRoster.set(r.rosterId, [r])
    }

    const inputSettings = league.settings && typeof league.settings === 'object' ? league.settings : {}
    const storedSettings = storedLeague?.settings && typeof storedLeague.settings === 'object' ? storedLeague.settings : {}
    const effectiveLeague = { ...league, settings: { ...inputSettings, ...storedSettings } }
    const format = readPlayoffFormat(effectiveLeague.settings, byRoster.size)
    if (nativeRule?.season === season && nativeRule.playoffStartWeek > 1) format.regularSeasonEndWeek = nativeRule.playoffStartWeek - 1
    const endWeek = format.regularSeasonEndWeek
    const regular = (week: number) => endWeek == null || week <= endWeek

    const simTeams: SimTeam[] = []
    for (const [rosterId, list] of byRoster) {
      const played = list.filter((x) => final(x) && regular(x.week) && (x.scored === true || x.pointsFor > 0 || x.pointsAgainst > 0))
      simTeams.push({
        rosterId,
        wins: played.filter((x) => x.win === 1).length,
        losses: played.filter((x) => x.pointsFor < x.pointsAgainst).length,
        ties: played.filter((x) => x.pointsFor === x.pointsAgainst).length,
        pointsFor: played.reduce((a, x) => a + x.pointsFor, 0),
        profile: fitProfile(scores.get(rosterId) ?? []),
      })
    }

    const modelled = simTeams.filter((s) => s.profile != null).length
    if (modelled < 2) {
      withheld.push({
        leagueName,
        reason: `Only ${modelled} of ${simTeams.length} teams have three or more completed weeks on file, in any season — not enough to simulate.`,
      })
      continue
    }

    // The REAL schedule: rows paired on matchupId. Unscored → remaining; scored → played.
    const pairs = new Map<string, { week: number; ids: string[]; scored: boolean }>()
    const unscored: OutlookMatchupRow[] = []
    for (const r of seasonRows) {
      if (r.matchupId == null || !regular(r.week)) continue
      const scored = final(r) && (r.scored === true || r.pointsFor > 0 || r.pointsAgainst > 0)
      if (!scored) unscored.push(r)
      const key = `${r.week}|${r.matchupId}|${scored ? 1 : 0}`
      const entry = pairs.get(key)
      if (entry) entry.ids.push(r.rosterId)
      else pairs.set(key, { week: r.week, ids: [r.rosterId], scored })
    }
    const remaining: SimGame[] = []
    const played: SimGame[] = []
    for (const p of pairs.values()) {
      if (p.ids.length !== 2) continue
      ;(p.scored ? played : remaining).push({ week: p.week, a: p.ids[0], b: p.ids[1] })
    }
    const weeks = [...new Set(remaining.map((g) => g.week))].sort((a, b) => a - b)
    const knownIds = history.knownRosterIds.get(pid)
    // Missing teams, weeks or unpaired future games must never prove a clinch.
    const completeQualificationSchedule = endWeek != null && endWeek > 0 && endWeek <= 100
      && knownIds != null && knownIds.size === byRoster.size && [...knownIds].every(id => byRoster.has(id))
      && [...byRoster].every(([id, list]) => Array.from({ length: endWeek }, (_, i) => i + 1).every(week =>
        list.some(r => r.week === week && ((final(r) && (r.scored === true || r.pointsFor > 0 || r.pointsAgainst > 0))
          || remaining.some(g => g.week === week && (g.a === id || g.b === id))))))

    /*
     * 🛑 NO UPCOMING ROW IS NOT THE SAME AS NO UPCOMING GAME. Sleeper, ESPN and Yahoo write a 0-0
     * placeholder row for every unplayed week, so an empty remainder there does mean the regular
     * season is over. The Fantrax writer stores only weeks already PLAYED — so Cream Bowl, four
     * weeks into its season, read "Settled — the regular season is over and you are out" in week 3
     * (production audit 2026-09-28; its WeeklyMatchup rows were weeks 1–4, all scored, none ahead).
     *
     * So an empty remainder is trusted only when the league STATES its last regular week and the
     * scores have reached it. Otherwise the schedule ahead is simply not on file, and the league is
     * withheld with that reason rather than simulated as a finished season.
     */
    if (weeks.length === 0) {
      const lastScoredWeek = seasonRows.reduce(
        (max, r) => (final(r) && (r.scored === true || r.pointsFor > 0 || r.pointsAgainst > 0) ? Math.max(max, r.week) : max),
        0,
      )
      if (endWeek == null || lastScoredWeek < endWeek) {
        const platform = String(league.platform ?? '').trim()
        const who = platform ? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase() : 'The platform'
        withheld.push({
          leagueName,
          reason: `The rest of the schedule is not on file — ${who} has sent only the weeks already played (through week ${lastScoredWeek}), so a finished season cannot be told from one still going.`,
        })
        continue
      }
    }

    const missing: string[] = []
    const unmodelled = simTeams.filter((t) => !t.profile).length
    if (unmodelled > 0) {
      missing.push(
        `${unmodelled} team${unmodelled === 1 ? ' has' : 's have'} fewer than ${MIN_WEEKS} completed weeks, so ${unmodelled === 1 ? 'its games are' : 'their games are'} left unplayed in every run.`,
      )
    }
    const unnamed = simTeams.filter((t) => !nameByRoster.has(`${pid}:${t.rosterId}`)).length
    if (unnamed > 0) missing.push(`${unnamed} team name${unnamed === 1 ? ' is' : 's are'} not synced.`)
    if (format.playoffTeamsSource === 'default') {
      missing.push(`The league does not state its playoff field, so ${format.playoffTeams} is assumed.`)
    }
    if (format.byeSource === 'standard' && format.byeTeams > 0) {
      missing.push(`First-round byes are not stated; a standard ${format.playoffTeams}-team bracket (${format.byeTeams} byes) is assumed.`)
    }
    if (endWeek == null) missing.push('The last regular-season week is not stated, so every paired unplayed week counts as regular season.')
    missing.push('Divisions and head-to-head tiebreaks are not modelled: seeding is wins plus half a win per final tie, then points for.')
    missing.push('Weekly scores are independent draws: bye weeks, injuries and trades only enter through the scenario tools.')

    prepared.push({
      period: history.periodsByLeague.get(pid)?.week,
      statusCanBeCertified: Boolean(completeQualificationSchedule) && canCertifyWeeklyPlayoffStatus(effectiveLeague.settings, format.playoffTeamsSource),
      league: effectiveLeague,
      pid,
      leagueName,
      season,
      sim: { teams: simTeams, remaining, playoffTeams: format.playoffTeams, byeTeams: format.byeTeams },
      seed: seedFromString(pid),
      played,
      weeks,
      weeksRemaining: weeks.length,
      expectedWins: allPlayWins(seasonRows.filter((r) => final(r) && regular(r.week))),
      seasonsFitted: [...seasonsFitted].sort((a, b) => a - b),
      format,
      missing,
      unscored,
    })
  }

  return { prepared, withheld, nameByRoster, myRosters, sportOf }
}

export async function getSeasonOutlook(
  userId: string,
  leagues: LeagueInput[],
  /**
   * The league the caller is rendering, when it is rendering one. Its swing branch is
   * guaranteed, and it alone gets the roster-based focus block.
   */
  focusLeagueId?: string | null,
  now: Date = new Date(),
  /** Keep portfolio identity checks when computing just one selected league. */
  identityLeagues: LeagueInput[] = leagues,
): Promise<SeasonOutlook> {
  const describeBasis = (minIterations: number, maxIterations: number) =>
    `${minIterations === maxIterations ? minIterations.toLocaleString() : `${minIterations.toLocaleString()}–${maxIterations.toLocaleString()}`} simulations per league, played over each league's own ` +
    `remaining schedule, playoff field and first-round byes. Each team's weekly scoring is fitted from ` +
    `every completed week it has on file, in its own league's scoring — the same model the ` +
    `matchup screens use. Records and seeding are this season's only. Ranges show how far each number ` +
    `moves when the teams' scoring averages are re-drawn from how uncertain they are.` +
    (minIterations < ITERATIONS
      ? ` Some leagues ran fewer than ${ITERATIONS.toLocaleString()} because you play enough leagues that ` +
        `the full count would not finish inside one page load; they are topped up on a later visit.`
      : '')

  const firstKickoffAt = await getFirstStatedKickoff()

  const empty: SeasonOutlook = {
    leagues: [],
    summary: { makingPlayoffs: 0, clinched: 0, onTheBubble: 0, onByePace: 0, bestTitle: null },
    weekThatMatters: null,
    swingByLeague: {},
    priorities: [],
    basis: describeBasis(ITERATIONS, ITERATIONS),
    withheld: [],
    firstKickoffAt,
    generatedAt: now.toISOString(),
    runs: { reused: 0, computed: 0 },
  }

  const inputs = await loadOutlookInputs(userId, leagues, identityLeagues)
  if (!inputs) return empty
  const { prepared, withheld, nameByRoster, myRosters, sportOf } = inputs

  /*
   * ── Runs: reuse what is stored, compute what is not ───────────────────────
   *
   * The budget is spent only on leagues with no valid stored run, and whatever is left tops up
   * leagues whose stored run was cut short on an earlier, heavier load.
   */
  const stored = await readLeagueSims(prepared.map((p) => p.pid), now)
  const results = new Map<string, LeagueSimResult>()
  const reused = new Set<string>()
  const misses: Prepared[] = []
  const shortHits: Prepared[] = []
  for (const p of prepared) {
    const hit = stored.get(p.pid)
    if (hit && hit.hash === leagueSimHash(p.sim, p.seed)) {
      results.set(p.pid, hit)
      reused.add(p.pid)
      if (hit.iterations < ITERATIONS) shortHits.push(p)
    } else {
      misses.push(p)
    }
  }

  const missCost = misses.reduce((acc, p) => acc + leagueSimCost(p.sim, 1), 0)
  const iterations = chooseIterations(missCost)
  let spent = 0
  const toWrite: Array<[string, LeagueSimResult]> = []
  for (const p of misses) {
    const result = computeLeagueSim(p.sim, p.seed, iterations, now)
    spent += leagueSimCost(p.sim, iterations)
    results.set(p.pid, result)
    toWrite.push([p.pid, result])
  }
  for (const p of shortHits) {
    const cost = leagueSimCost(p.sim, ITERATIONS)
    if (spent + cost > TOTAL_GAME_BUDGET) continue
    const result = computeLeagueSim(p.sim, p.seed, ITERATIONS, now)
    spent += cost
    results.set(p.pid, result)
    reused.delete(p.pid)
    toWrite.push([p.pid, result])
  }
  if (toWrite.length > 0) await writeLeagueSims(toWrite, now)

  const out: OutlookLeague[] = []
  for (const p of prepared) {
    const result = results.get(p.pid)!
    const n = result.iterations
    const strength = scheduleStrength(p.sim, p.played)

    const ordered = [...p.sim.teams].sort((a, b) => (b.wins + (b.ties ?? 0) / 2) - (a.wins + (a.ties ?? 0) / 2) || b.pointsFor - a.pointsFor)
    const outlookTeams: OutlookTeam[] = ordered.map((s, i) => {
      const c = result.counts[s.rosterId] ?? { playoff: 0, bye: 0, title: 0 }
      const b = result.bands[s.rosterId]
      const playoffPct = pctOf(c.playoff, n)
      const byePct = pctOf(c.bye, n)
      const titlePct = pctOf(c.title, n)
      const status = p.statusCanBeCertified ? mathStatus(p.sim, s.rosterId) : null
      return {
        rosterId: s.rosterId,
        name: nameByRoster.get(`${p.pid}:${s.rosterId}`) ?? null,
        isYou: myRosters.has(`${p.pid}:${s.rosterId}`),
        wins: s.wins,
        losses: s.losses,
        ...(s.ties ? { ties: s.ties } : {}),
        pointsFor: s.pointsFor,
        seed: i + 1,
        playoffPct,
        byePct,
        titlePct,
        missPct: 100 - playoffPct,
        range:
          s.profile && b
            ? {
                playoff: bandAround(b.playoff, playoffPct),
                bye: bandAround(b.bye, byePct),
                title: bandAround(b.title, titlePct),
              }
            : null,
        status: s.profile ? status : null,
        modelled: s.profile != null,
        weeksFitted: s.profile?.n ?? 0,
        weeklyMean: s.profile?.mu ?? null,
        expectedWins: p.expectedWins.get(s.rosterId) ?? null,
        schedule: strength[s.rosterId] ?? null,
      }
    })

    const you = outlookTeams.find((t) => t.isYou) ?? null
    const milestones = you && you.modelled ? readMilestones(result, p.sim, you.rosterId) : null
    const fitted = p.sim.teams.map((t) => t.profile?.n ?? 0).filter((v) => v > 0).sort((a, b) => a - b)

    out.push({
      leagueId: p.league.id,
      leagueName: p.leagueName,
      platform: String(p.league.platform ?? 'manual').toLowerCase(),
      season: p.season,
      period: p.period,
      weeksRemaining: p.weeksRemaining,
      playoffTeams: p.sim.playoffTeams,
      byeTeams: p.sim.byeTeams,
      you,
      teams: outlookTeams,
      whatDecidesIt: describeWhatDecidesIt(you, p.weeksRemaining, p.sim.playoffTeams, milestones),
      href: `/core?league=${encodeURIComponent(p.league.id)}`,
      milestones,
      assumptions: {
        iterations: n,
        rangeBatches: result.bandBatches,
        rangeRunsPerBatch: result.bandRunsPerBatch,
        seasonsFitted: p.seasonsFitted,
        weeksFitted: fitted.length
          ? { min: fitted[0], median: fitted[Math.floor(fitted.length / 2)], max: fitted[fitted.length - 1] }
          : null,
        teams: p.sim.teams.length,
        modelledTeams: fitted.length,
        remainingGames: p.sim.remaining.length,
        regularSeasonEndWeek: p.format.regularSeasonEndWeek,
        playoffTeams: { value: p.format.playoffTeams, source: p.format.playoffTeamsSource },
        byes: { value: p.format.byeTeams, source: p.format.byeSource },
        tiebreak: 'Wins, then points for.',
        computedAt: result.computedAt,
        reused: reused.has(p.pid),
        missing: p.missing,
      },
      focus: null,
    })
  }

  // Best title odds first — the page leads with where you can actually win.
  out.sort((a, b) => (b.you?.titlePct ?? -1) - (a.you?.titlePct ?? -1))

  const withYou = out.filter((l) => l.you != null)
  const bestTitleLeague = withYou.reduce<OutlookLeague | null>(
    (best, l) => (best == null || l.you!.titlePct > best.you!.titlePct ? l : best),
    null,
  )

  const summary: SeasonOutlook['summary'] = {
    makingPlayoffs: withYou.filter((l) => l.you!.playoffPct >= 50).length,
    clinched: withYou.filter((l) => l.you!.status === 'clinched').length,
    onTheBubble: withYou.filter((l) => l.you!.playoffPct > 25 && l.you!.playoffPct < 75).length,
    onByePace: withYou.filter((l) => l.byeTeams > 0 && l.you!.byePct >= 50).length,
    bestTitle: bestTitleLeague ? { pct: bestTitleLeague.you!.titlePct, leagueName: bestTitleLeague.leagueName } : null,
  }

  /*
   * "The week that matters most" — for the user's next game in each contested league, re-run the
   * sim with that result fixed each way and take the largest gap.
   *
   * ⚠ ONLY CONTESTED LEAGUES GET THE BRANCH SIMS, AND AT MOST `SWING_CANDIDATES` OF THEM — plus
   * the league on screen, always. A league you are 99% to make cannot have a result that swings
   * your odds.
   */
  let weekThatMatters: SwingMatchup | null = null
  const swingByLeague: Record<string, SwingMatchup> = {}
  const SWING_CANDIDATES = 8
  const contested = out
    .filter((l) => l.you != null && l.weeksRemaining > 0 && l.you.playoffPct > 2 && l.you.playoffPct < 98)
    .sort((a, b) => Math.abs(50 - a.you!.playoffPct) - Math.abs(50 - b.you!.playoffPct))
    .slice(0, SWING_CANDIDATES)
  if (focusLeagueId && !contested.some((l) => l.leagueId === focusLeagueId)) {
    const focus = out.find((l) => l.leagueId === focusLeagueId && l.you != null && l.weeksRemaining > 0)
    if (focus) contested.push(focus)
  }

  const preparedById = new Map(prepared.map((p) => [p.league.id, p]))
  for (const league of contested) {
    const p = preparedById.get(league.leagueId)
    if (!league.you || !p) continue
    /*
     * 🛑 THE SWING GAME IS ONE YOU CAN STILL AFFECT. `weeks` holds every week not yet FINAL, which on
     * a Monday includes the week being played — so the card asked "win week 3?" of The Deep!, then
     * 110 points down on the scoreboard (production 2026-09-28). A game with points already on the
     * board is in progress; the swing moves to the first week nobody has scored in yet.
     */
    const nextWeek = p.weeks.find((w) => {
      const r = p.unscored.find((x) => x.week === w && x.rosterId === league.you!.rosterId)
      return r != null && !(r.scored === true || r.pointsFor > 0 || r.pointsAgainst > 0)
    })
    if (nextWeek == null) continue
    const mineRow = p.unscored.find((r) => r.week === nextWeek && r.rosterId === league.you!.rosterId)
    if (!mineRow) continue
    const oppRow = p.unscored.find(
      (r) => r.week === nextWeek && r.matchupId === mineRow.matchupId && r.rosterId !== mineRow.rosterId,
    )
    if (!oppRow) continue
    const game = { week: nextWeek, a: mineRow.rosterId, b: oppRow.rosterId }

    const winTally = simulateSeason(p.sim, {
      iterations: BRANCH_ITERATIONS,
      seed: p.seed,
      forced: [{ ...game, winner: mineRow.rosterId }],
    })

    /*
     * The lose branch is observed run-by-run so "what help do I need" is answered from the same
     * simulation. For each rival: runs where they missed, and runs where they missed AND you made it.
     */
    let loseRunsMeIn = 0
    const rivalOut = new Map<string, number>()
    const rivalOutMeIn = new Map<string, number>()
    const loseTally = simulateSeason(p.sim, {
      iterations: BRANCH_ITERATIONS,
      seed: p.seed,
      forced: [{ ...game, winner: oppRow.rosterId }],
      onRun: ({ field }) => {
        const meIn = field.has(mineRow.rosterId)
        if (meIn) loseRunsMeIn += 1
        for (const t of league.teams) {
          if (t.rosterId === mineRow.rosterId || field.has(t.rosterId)) continue
          rivalOut.set(t.rosterId, (rivalOut.get(t.rosterId) ?? 0) + 1)
          if (meIn) rivalOutMeIn.set(t.rosterId, (rivalOutMeIn.get(t.rosterId) ?? 0) + 1)
        }
      },
    })

    const ifWin = pctOf(winTally.counts[mineRow.rosterId]?.playoff ?? 0, BRANCH_ITERATIONS)
    const ifLose = pctOf(loseTally.counts[mineRow.rosterId]?.playoff ?? 0, BRANCH_ITERATIONS)

    /*
     * Rivals ranked by how much their absence lifts your odds. MIN_SAMPLE keeps a ratio off a
     * handful of runs from naming anyone; MIN_LIFT keeps sampling noise from reading as help.
     */
    const MIN_SAMPLE = 200
    const MIN_LIFT = 4
    const baseline = (loseRunsMeIn / BRANCH_ITERATIONS) * 100
    const helpIfLose = league.teams
      .filter((t) => t.rosterId !== mineRow.rosterId)
      .flatMap((t) => {
        const missed = rivalOut.get(t.rosterId) ?? 0
        if (missed < MIN_SAMPLE) return []
        const lift = ((rivalOutMeIn.get(t.rosterId) ?? 0) / missed) * 100 - baseline
        if (lift < MIN_LIFT) return []
        return t.name ? [{ name: t.name, lift }] : []
      })
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 2)
      .map((r) => r.name)

    const rooting = rootingGuide(p.sim, {
      iterations: BRANCH_ITERATIONS,
      seed: p.seed,
      youId: mineRow.rosterId,
      week: nextWeek,
    }).map((g) => ({
      ...g,
      aName: nameByRoster.get(`${p.pid}:${g.a}`) ?? null,
      bName: nameByRoster.get(`${p.pid}:${g.b}`) ?? null,
    }))

    const thisSwing: SwingMatchup = {
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      week: nextWeek,
      opponentName: nameByRoster.get(`${p.pid}:${oppRow.rosterId}`) ?? null,
      ifWin,
      ifLose,
      swing: ifWin - ifLose,
      clinchOnWin: p.statusCanBeCertified && mathStatus({ ...p.sim, teams: p.sim.teams.map(t => t.rosterId === league.you!.rosterId ? { ...t, wins: t.wins + 1 } : t), remaining: p.sim.remaining.filter(g => !(g.week === game.week && ((g.a === game.a && g.b === game.b) || (g.a === game.b && g.b === game.a)))) }, league.you.rosterId) === 'clinched',
      helpIfLose,
      rooting,
    }
    swingByLeague[league.leagueId] = thisSwing
    if (!weekThatMatters || thisSwing.swing > weekThatMatters.swing) weekThatMatters = thisSwing
  }

  /* The league on screen gets its rosters, drivers, moves and scenario model. */
  if (focusLeagueId) {
    const league = out.find((l) => l.leagueId === focusLeagueId)
    const p = preparedById.get(focusLeagueId)
    if (league && p) {
      const names = new Map<string, string>()
      for (const t of league.teams) if (t.name) names.set(t.rosterId, t.name)
      const loaded = await loadScenarioModel({
        leagueId: league.leagueId,
        userId,
        sport: sportOf.get(league.leagueId) ?? 'NFL',
        platform: league.platform,
        settings: p.league.settings,
        youRosterId: league.you?.rosterId ?? null,
        sim: p.sim,
        seed: p.seed,
        weeks: p.weeks,
        names,
        now,
      }).catch(() => null)
      if (loaded) {
        const swing = swingByLeague[league.leagueId] ?? null
        const insights = league.you
          ? buildFocusInsights({
              leagueId: league.leagueId,
              leagueName: league.leagueName,
              sim: p.sim,
              seed: p.seed,
              youRosterId: league.you.rosterId,
              weeks: p.weeks,
              expectedWins: league.you.expectedWins,
              remainingRank: league.you.schedule?.remainingRank ?? null,
              remainingOpponentMu: league.you.schedule?.remainingOpponentMu ?? null,
              leagueMu: league.you.schedule?.leagueMu ?? null,
              teamsRanked: league.teams.filter((t) => t.schedule?.remainingRank != null).length,
              swing: swing
                ? { week: swing.week, opponentName: swing.opponentName, ifWin: swing.ifWin, ifLose: swing.ifLose }
                : null,
              model: loaded.model,
              injuryFeedNote: loaded.injuryFeedNote,
            })
          : { drivers: [], moves: [], durability: null, branchIterations: BRANCH_ITERATIONS, notes: [] }
        league.focus = { scenario: loaded.model, ...insights }
      }
    }
  }

  /*
   * "Where to spend your attention" — ranked, three at most. Bubble leagues first (the only ones a
   * lineup call actually swings), then live title chances, then anything already settled.
   */
  const priorities = withYou
    .map((l) => {
      const pp = l.you!.playoffPct
      const isContested = pp > 25 && pp < 75
      const score = isContested ? 100 - Math.abs(pp - 50) : l.you!.titlePct
      const reason = isContested
        ? `On the bubble at ${pp.toFixed(0)}% with ${l.weeksRemaining} to play — this is where a lineup call is worth the most.`
        : pp >= 75
          ? `${l.you!.titlePct.toFixed(0)}% to win it. Playing for seeding now, not survival.`
          : `${pp.toFixed(0)}% to make the field. Needs help, not just wins.`
      return { leagueName: l.leagueName, reason, href: l.href, score, contested: isContested }
    })
    .sort((a, b) => Number(b.contested) - Number(a.contested) || b.score - a.score)
    .slice(0, 3)
    .map(({ leagueName, reason, href }) => ({ leagueName, reason, href }))

  const used = out.map((l) => l.assumptions.iterations)
  return {
    leagues: out,
    summary,
    weekThatMatters,
    swingByLeague,
    priorities,
    basis: used.length ? describeBasis(Math.min(...used), Math.max(...used)) : describeBasis(ITERATIONS, ITERATIONS),
    withheld,
    firstKickoffAt,
    generatedAt: now.toISOString(),
    runs: { reused: reused.size, computed: prepared.length - reused.size },
  }
}
