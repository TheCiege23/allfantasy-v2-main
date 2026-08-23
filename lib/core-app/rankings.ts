import 'server-only'

import { prisma } from '@/lib/prisma'
import { RANK_LEVELS, getLevelFromXp, type RankLevelRow } from '@/lib/rank/levels'
import {
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
  RANK_XP_LEAGUE_SIZE_MULTIPLIER,
} from '@/lib/rank/rank-xp-constants'
import { computePrestige, winRateOf } from '@/lib/core-app/prestige'

/**
 * Rankings — the data layer for handoffs 14a (ladder + boards), 14b (FAQ) and
 * 14c (compare).
 *
 * ⚠ THE LADDER IS DERIVED FROM `RANK_LEVELS`, NEVER RETYPED. The design's seven
 * tiers and their XP ranges are already in `lib/rank/levels.ts` and they match
 * the mock exactly — 0/1,000/8,000/32,000/110,000/225,000/350,000. Copying those
 * boundaries into the view is how a ladder starts lying after someone retunes
 * one threshold, so every range here is computed from the level table itself.
 *
 * ⚠ `rank_tier` IS NOT TRUSTWORTHY AND IS NOT READ. Measured on the full-data
 * database: of the five profiles that have ever been ranked, four store a
 * placeholder ("T21", "T8", "T5", "T3") instead of a tier name, and only one
 * holds a real one ("All-Pro"). The tier is therefore always re-derived from
 * `xp_level` through `RANK_LEVELS`, which cannot be out of step with the ladder
 * the same page draws.
 *
 * ⚠ TWO ENGINES HAVE WRITTEN `xp_total` AND THEY DISAGREE — see
 * `reconcileXp` below. This is the reason the XP card leads with the number the
 * disclosed formula produces rather than the stored one.
 */

/* ────────────────────────────── the ladder ──────────────────────────────── */

export type LadderTier = {
  /** `tierGroup` from the level table, 1–7. */
  group: number
  /** "All-Pro". */
  tier: string
  /** Sub-rank names inside the tier, in level order. */
  subRanks: string[]
  minXp: number
  /** `null` on the last rung — Dynasty has no ceiling. */
  maxXp: number | null
  /** "Level 25 · the last rung" for Dynasty, "Lv 13–17" otherwise. */
  levelRange: string
  firstLevel: number
  lastLevel: number
  /** Hex from the level table, used for the tier-coloured left border. */
  color: string
  isCurrent: boolean
}

/**
 * The seven tiers, with each one's XP range closed against the next tier's
 * floor. The top tier is left open rather than given an invented ceiling.
 */
export function buildLadder(currentLevel: number | null): LadderTier[] {
  const groups = new Map<number, RankLevelRow[]>()
  for (const row of RANK_LEVELS) {
    const list = groups.get(row.tierGroup) ?? []
    list.push(row)
    groups.set(row.tierGroup, list)
  }

  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0])
  const currentGroup =
    currentLevel != null
      ? (RANK_LEVELS.find((r) => r.level === currentLevel)?.tierGroup ?? null)
      : null

  return ordered.map(([group, rows], i) => {
    const next = ordered[i + 1]?.[1][0] ?? null
    const first = rows[0]
    const last = rows[rows.length - 1]
    return {
      group,
      tier: first.tier,
      subRanks: rows.map((r) => r.name),
      minXp: first.minXp,
      maxXp: next ? next.minXp - 1 : null,
      levelRange:
        first.level === last.level
          ? `Level ${first.level} · the last rung`
          : `Lv ${first.level}–${last.level}`,
      firstLevel: first.level,
      lastLevel: last.level,
      color: first.color,
      isCurrent: currentGroup === group,
    }
  })
}

/* ─────────────────────────────── XP breakdown ───────────────────────────── */

export type XpRow = {
  key: 'wins' | 'championships' | 'playoffs' | 'seasons' | 'leagueSize'
  /** "187 wins × 10" — the rule, spelled out, per build rule 1. */
  detail: string
  xp: number
  /** 0..1 share of the computed total, for the proportional bar. */
  share: number
  /** `false` for the league-size bonus, which has no single multiplicand. */
  hasBar: boolean
}

/**
 * How a stored XP total lines up against the one the published rules produce.
 *
 * ⚠ THESE COME APART ON REAL ACCOUNTS AND THE PAGE MUST NOT HIDE IT. Two
 * systems in this repo write manager XP — `lib/rank/calculateRank.ts`, whose
 * constants this file imports, and `lib/xp-progression`, which keeps its own
 * copy of the championship weight. On the full-data database the top-ranked
 * profile stores 216,238 XP against career counters the disclosed rules score
 * at roughly 39,000, and its `career_seasons_played` / `career_leagues_played`
 * pair is inverted relative to every other row. One of those writers is wrong.
 *
 * 14b build rule 1 says the published formula is the source of truth, so the
 * formula's own total is what the card leads with, and a divergence is named on
 * screen rather than smoothed over by back-solving the difference into the
 * league-size bonus — which is where it would otherwise land, as a fabricated
 * six-figure row.
 */
export type XpReconciliation = {
  /** Sum of the four disclosed per-event terms. */
  fromEvents: number
  /** `xp_total` as stored, or null if the profile was never ranked. */
  stored: number | null
  /**
   * `stored - fromEvents`. Attributed to the league-size bonus only when it is
   * within a credible range for one; otherwise `null` and `divergent` is set.
   */
  leagueSizeBonus: number | null
  /** True when the residual cannot be a league-size bonus. */
  divergent: boolean
  /** The total the page presents and derives the level from. */
  effective: number
}

/**
 * A league-size bonus is `Σ max(0, size − 10) × 2` over league-seasons. Even a
 * career of 500 seasons in 20-team leagues tops out around 10,000, so a residual
 * far above the disclosed terms themselves is not a bonus — it is a different
 * engine's number.
 */
function reconcileXp(input: {
  wins: number
  championships: number
  playoffAppearances: number
  distinctSeasons: number
  stored: number | null
}): XpReconciliation {
  const fromEvents =
    input.wins * RANK_XP_PER_IMPORT_WIN +
    input.championships * RANK_XP_PER_CHAMPIONSHIP +
    input.playoffAppearances * RANK_XP_PER_PLAYOFF_APPEARANCE +
    input.distinctSeasons * RANK_XP_PER_DISTINCT_SEASON

  if (input.stored == null) {
    return { fromEvents, stored: null, leagueSizeBonus: null, divergent: false, effective: fromEvents }
  }

  const residual = input.stored - fromEvents
  const credible = residual >= 0 && residual <= Math.max(fromEvents, 10_000)

  return {
    fromEvents,
    stored: input.stored,
    leagueSizeBonus: credible ? residual : null,
    divergent: !credible,
    // When the two agree the stored total is used verbatim, so the level shown
    // is the level the rest of the product already believes.
    effective: credible ? input.stored : fromEvents,
  }
}

export function buildXpRows(input: {
  wins: number
  championships: number
  playoffAppearances: number
  distinctSeasons: number
  leagueSizeBonus: number | null
}): XpRow[] {
  const rows: XpRow[] = [
    {
      key: 'wins',
      detail: `${input.wins.toLocaleString()} wins × ${RANK_XP_PER_IMPORT_WIN}`,
      xp: input.wins * RANK_XP_PER_IMPORT_WIN,
      share: 0,
      hasBar: true,
    },
    {
      key: 'championships',
      detail: `${input.championships} championships × ${RANK_XP_PER_CHAMPIONSHIP}`,
      xp: input.championships * RANK_XP_PER_CHAMPIONSHIP,
      share: 0,
      hasBar: true,
    },
    {
      key: 'playoffs',
      detail: `${input.playoffAppearances} playoff appearances × ${RANK_XP_PER_PLAYOFF_APPEARANCE}`,
      xp: input.playoffAppearances * RANK_XP_PER_PLAYOFF_APPEARANCE,
      share: 0,
      hasBar: true,
    },
    {
      key: 'seasons',
      detail: `${input.distinctSeasons} seasons × ${RANK_XP_PER_DISTINCT_SEASON}`,
      xp: input.distinctSeasons * RANK_XP_PER_DISTINCT_SEASON,
      share: 0,
      hasBar: true,
    },
  ]

  if (input.leagueSizeBonus != null) {
    rows.push({
      key: 'leagueSize',
      detail: `League-size bonus — (size − 10) × ${RANK_XP_LEAGUE_SIZE_MULTIPLIER} per league-season`,
      xp: input.leagueSizeBonus,
      share: 0,
      // No bar: unlike the others this is a sum over leagues rather than one
      // count times one weight, so a proportional bar would imply a precision
      // the row does not have.
      hasBar: false,
    })
  }

  const max = Math.max(1, ...rows.filter((r) => r.hasBar).map((r) => r.xp))
  for (const r of rows) r.share = r.hasBar ? r.xp / max : 0
  return rows
}

/* ───────────────────────────── leaderboards ─────────────────────────────── */

export type LeaderRow = {
  userId: string
  rank: number
  handle: string
  avatarUrl: string | null
  /** "3 titles · 11 leagues" */
  context: string
  /** Already formatted — "47.7", "58.3%", "3". */
  score: string
  level: number
  tierGroup: number
  isYou: boolean
  /** Career counters contradict each other — the UI marks the row. */
  suspect: boolean
}

export type LeaderboardTab = {
  key: 'top' | 'drafters' | 'titles' | 'winRate' | 'active'
  label: string
  /** What the score column means, shown above the list. */
  metricLabel: string
  rows: LeaderRow[]
  /**
   * When a board cannot be computed it still renders, with this sentence in
   * place of rows. 14a build rule and 15a rule 6 both say a category is never
   * hidden — a missing tab is indistinguishable from a feature that does not
   * exist.
   */
  unavailable: string | null
}

/**
 * Minimum league-seasons to appear on the Win % board, disclosed on screen.
 *
 * ⚠ LEAGUES, NOT GAMES. Without a floor a single 3–0 season tops the board
 * forever, which is the whole reason the rule exists.
 */
export const WIN_RATE_MIN_LEAGUES = 5

type ProfileRow = {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  xpTotal: number | null
  xpLevel: number | null
  wins: number
  losses: number
  championships: number
  playoffAppearances: number
  /** Rows in the career ledger — one per league-season. */
  leagueSeasons: number
  /** Distinct seasons; this is the `× 10` multiplicand. */
  distinctSeasons: number
}

/**
 * Every profile that has ever been ranked.
 *
 * ⚠ RAW SQL, NOT THE PRISMA MODEL. `career.ts` already reads `xp_total` this way
 * and for the same reason: the column is a `bigint` and the surrounding columns
 * are snake_cased maps, and one explicit projection is easier to keep honest
 * than a select spread across two models.
 *
 * ⚠ `rank_calculated_at IS NOT NULL` IS THE ELIGIBILITY TEST, NOT `xp_total > 0`.
 * A manager who has been scored and came out at zero belongs on the board at
 * zero; a manager who has never been scored does not belong on it at all.
 */
async function loadRankedProfiles(): Promise<ProfileRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      userId: string
      username: string | null
      displayName: string | null
      avatarUrl: string | null
      xp_total: bigint | number | null
      xp_level: number | null
      career_wins: number | null
      career_losses: number | null
      career_championships: number | null
      career_playoff_appearances: number | null
      career_seasons_played: number | null
      career_leagues_played: number | null
    }>
  >`
    SELECT p."userId",
           u.username,
           u."displayName",
           u."avatarUrl",
           p.xp_total,
           p.xp_level,
           p.career_wins,
           p.career_losses,
           p.career_championships,
           p.career_playoff_appearances,
           p.career_seasons_played,
           p.career_leagues_played
      FROM user_profiles p
      JOIN app_users u ON u.id = p."userId"
     WHERE p.rank_calculated_at IS NOT NULL
  `

  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    xpTotal: r.xp_total == null ? null : Number(r.xp_total),
    xpLevel: r.xp_level,
    wins: r.career_wins ?? 0,
    losses: r.career_losses ?? 0,
    championships: r.career_championships ?? 0,
    playoffAppearances: r.career_playoff_appearances ?? 0,
    leagueSeasons: r.career_seasons_played ?? 0,
    distinctSeasons: r.career_leagues_played ?? 0,
  }))
}

function handleOf(p: ProfileRow): string {
  return p.displayName?.trim() || p.username?.trim() || 'Manager'
}

/**
 * True when a profile's career counters cannot all describe the same career.
 *
 * ⚠ THIS IS NOT DEFENSIVE — IT FIRES ON REAL DATA. `calculateRank` writes
 * `career_seasons_played` as the number of league-seasons and
 * `career_leagues_played` as the count of distinct years, and on the full-data
 * database the top-ranked profile has those two the wrong way round: 35
 * championships and 168 playoff appearances against 8 league-seasons, alongside
 * 296 "distinct seasons". You cannot win 35 titles in 8 league-seasons, and
 * nobody has played 296 distinct years.
 *
 * The row is still shown — it was ranked, and hiding it would be its own kind of
 * lie — but anything derived from the suspect pair is marked so the screen never
 * presents an impossible sentence as fact. Silently picking the orientation that
 * happens to be self-consistent would be repairing data from a render path.
 */
function countersInconsistent(p: ProfileRow): boolean {
  return Math.max(p.championships, p.playoffAppearances) > p.leagueSeasons
}

/**
 * ⚠ `tenure` IS YEARS AND `leagues` IS LEAGUE-SEASONS — DO NOT SWAP THESE. The
 * two `UserProfile` columns are named almost the opposite of what they hold:
 * `career_seasons_played` is the league-season row count and
 * `career_leagues_played` is the number of distinct years. An earlier cut of
 * this file passed them straight through in column order, which scored the same
 * manager 80.8 here and 74.8 on their own career page — tenure capped at 20
 * years was being fed a 523-row league-season count, and the 15-league cap was
 * being fed 7 years. `career.ts` maps them the way below, so this does too.
 */
function scoreProfile(p: ProfileRow) {
  const winRate = winRateOf(p.wins, p.losses)
  const prestige = computePrestige({
    championships: p.championships,
    winRate,
    seasonsPlayed: p.distinctSeasons,
    leaguesPlayed: p.leagueSeasons,
    playoffAppearances: p.playoffAppearances,
  })
  const level = p.xpLevel ?? (p.xpTotal != null ? getLevelFromXp(p.xpTotal).level : 1)
  const levelRow = RANK_LEVELS.find((r) => r.level === level) ?? RANK_LEVELS[0]
  return { winRate, prestige, level, levelRow, games: p.wins + p.losses }
}

function contextLine(p: ProfileRow): string {
  const titles = `${p.championships} ${p.championships === 1 ? 'title' : 'titles'}`
  // The league-season count is half of the suspect pair, so it is dropped rather
  // than printed next to a title count it contradicts.
  if (countersInconsistent(p)) return `${titles} · league count unreliable`
  const leagues = `${p.leagueSeasons.toLocaleString()} ${p.leagueSeasons === 1 ? 'league-season' : 'league-seasons'}`
  return `${titles} · ${leagues}`
}

function buildBoards(profiles: ProfileRow[], youId: string | null): LeaderboardTab[] {
  const scored = profiles.map((p) => ({ p, ...scoreProfile(p) }))

  const toRows = (
    list: typeof scored,
    score: (e: (typeof scored)[number]) => string,
  ): LeaderRow[] =>
    list.map((e, i) => ({
      userId: e.p.userId,
      rank: i + 1,
      handle: handleOf(e.p),
      avatarUrl: e.p.avatarUrl,
      context: contextLine(e.p),
      score: score(e),
      level: e.level,
      tierGroup: e.levelRow.tierGroup,
      isYou: youId != null && e.p.userId === youId,
      suspect: countersInconsistent(e.p),
    }))

  const byPrestige = [...scored].sort((a, b) => b.prestige.total - a.prestige.total)
  const byTitles = [...scored]
    .filter((e) => e.p.championships > 0)
    .sort((a, b) => b.p.championships - a.p.championships)
  const byWinRate = [...scored]
    .filter((e) => e.winRate != null && e.p.leagueSeasons >= WIN_RATE_MIN_LEAGUES)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))

  return [
    {
      key: 'top',
      label: 'Top users',
      metricLabel: 'GM prestige',
      rows: toRows(byPrestige, (e) => e.prestige.total.toFixed(1)),
      unavailable: null,
    },
    {
      key: 'drafters',
      label: 'Best drafters',
      metricLabel: 'Draft grade',
      rows: [],
      /*
       * ⚠ NOT A PLACEHOLDER FOR "COMING SOON" — A STATEMENT OF WHAT IS MISSING.
       * `draft_grades` is keyed on (leagueId, season, rosterId) and carries no
       * account id. Reaching an AF user from a roster means going through
       * `Roster.platformUserId`, which this repo has already documented as
       * holding a provider id on some rows and our own uuid on others. A board
       * built on that join would silently credit one manager's draft to another.
       */
      unavailable:
        'Draft grades are stored per league roster, with no link back to an AllFantasy account. Ranking drafters across accounts needs that link before the board can be trusted.',
    },
    {
      key: 'titles',
      label: 'Titles',
      metricLabel: 'Championships',
      rows: toRows(byTitles, (e) => String(e.p.championships)),
      unavailable: byTitles.length === 0 ? 'Nobody ranked has won a championship yet.' : null,
    },
    {
      key: 'winRate',
      label: 'Win %',
      metricLabel: `Win rate · ${WIN_RATE_MIN_LEAGUES}+ leagues`,
      rows: toRows(byWinRate, (e) => `${(Math.round((e.winRate ?? 0) * 1000) / 10).toFixed(1)}%`),
      unavailable:
        byWinRate.length === 0
          ? `No ranked manager has ${WIN_RATE_MIN_LEAGUES} league-seasons yet.`
          : null,
    },
    {
      key: 'active',
      label: 'Most active',
      metricLabel: 'Activity score',
      rows: [],
      /*
       * ⚠ THE WEIGHTS EXIST IN THE DESIGN; THE EVENTS DO NOT. 14b describes a
       * chat/trade/waiver weighting, but the table those counts would come from
       * has never held a row in this product. Rendering a board from it would
       * put every manager at zero and read as "nobody is active".
       */
      unavailable:
        'Activity scoring needs per-manager chat, trade and waiver counts, which are not being recorded yet.',
    },
  ]
}

/* ───────────────────────────── the page payload ─────────────────────────── */

export type YourRank = {
  handle: string | null
  level: number
  levelName: string
  tier: string
  tierGroup: number
  totalLevels: number
  xp: number
  progressPct: number
  xpToNext: number | null
  nextLevelName: string | null
} | null

export type RankingsData = {
  you: YourRank
  xpRows: XpRow[]
  reconciliation: XpReconciliation | null
  ladder: LadderTier[]
  boards: LeaderboardTab[]
  /** How many managers have ever been ranked — stated, never implied. */
  rankedPopulation: number
  /** Of those, how many have self-contradicting career counters. */
  suspectCount: number
  /** When this viewer's rank was last recomputed. */
  calculatedAt: string | null
  signedIn: boolean
}

export async function getRankingsData(userId: string | null): Promise<RankingsData> {
  const [profiles, mine] = await Promise.all([
    loadRankedProfiles(),
    userId
      ? prisma.$queryRaw<Array<{ rank_calculated_at: Date | null }>>`
          SELECT rank_calculated_at FROM user_profiles WHERE "userId" = ${userId} LIMIT 1
        `
      : Promise.resolve([]),
  ])

  const me = userId ? (profiles.find((p) => p.userId === userId) ?? null) : null

  let you: YourRank = null
  let xpRows: XpRow[] = []
  let reconciliation: XpReconciliation | null = null

  if (me) {
    reconciliation = reconcileXp({
      wins: me.wins,
      championships: me.championships,
      playoffAppearances: me.playoffAppearances,
      distinctSeasons: me.distinctSeasons,
      stored: me.xpTotal,
    })
    xpRows = buildXpRows({
      wins: me.wins,
      championships: me.championships,
      playoffAppearances: me.playoffAppearances,
      distinctSeasons: me.distinctSeasons,
      leagueSizeBonus: reconciliation.leagueSizeBonus,
    })

    const lvl = getLevelFromXp(reconciliation.effective)
    you = {
      handle: handleOf(me),
      level: lvl.level,
      levelName: lvl.name,
      tier: lvl.tier,
      tierGroup: lvl.tierGroup,
      totalLevels: RANK_LEVELS.length,
      xp: reconciliation.effective,
      progressPct: lvl.progressPct,
      xpToNext: lvl.nextLevel ? lvl.nextLevel.minXp - reconciliation.effective : null,
      nextLevelName: lvl.nextLevel?.name ?? null,
    }
  }

  return {
    you,
    xpRows,
    reconciliation,
    ladder: buildLadder(you?.level ?? null),
    boards: buildBoards(profiles, userId),
    rankedPopulation: profiles.length,
    suspectCount: profiles.filter(countersInconsistent).length,
    calculatedAt: mine[0]?.rank_calculated_at?.toISOString() ?? null,
    signedIn: userId != null,
  }
}

/* ──────────────────────────────── 14c compare ───────────────────────────── */

export type CompareMetric = {
  label: string
  you: string
  them: string
  /** Which side leads, for the `--good` highlight. `null` when tied or unknown. */
  leader: 'you' | 'them' | null
  /** Championships and best week get the accent-soft row background. */
  signature: boolean
  /**
   * Set when the metric is in the design but nothing stores it. The row still
   * renders — dropping it would hide that the comparison is incomplete.
   */
  unavailable?: string
}

export type CompareManager = {
  handle: string
  avatarUrl: string | null
  level: number
  levelName: string
  tier: string
  tierGroup: number
  seasons: number
  /** Comparison letter grade, from the shared 14b scale. */
  grade: string
  gradeScore: number
  /** Career counters contradict each other — every figure for this manager is
   *  shown with a caution marker rather than presented as settled. */
  suspect: boolean
}

export type CompareData = {
  you: CompareManager
  them: CompareManager
  metrics: CompareMetric[]
  /** Seasons both managers actually played, newest first. */
  sharedSeasons: Array<{ season: number; you: string; them: string }>
  /** Why the season table may be short. */
  sharedSeasonsNote: string
  /**
   * Head-to-head meetings. `null` throughout when no shared league history can
   * be resolved, which is the normal case — see the note on `getCompareData`.
   */
  headToHead: { yourWins: number; theirWins: number; meetings: number } | null
  headToHeadNote: string
  titleRate: { you: number | null; them: number | null }
  verdict: { headline: string; body: string } | null
}

export type CompareResult =
  | { ok: true; data: CompareData }
  | { ok: false; reason: 'not-found' | 'not-ranked' | 'self' | 'signed-out'; message: string }

/**
 * The A+–D scale, shared verbatim with 14b and any future draft-grade surface.
 * 14c build rule 1: one deterministic scale, never a bespoke one per comparison.
 */
export const GRADE_SCALE = [
  { grade: 'A+', min: 93 },
  { grade: 'A', min: 85 },
  { grade: 'A−', min: 78 },
  { grade: 'B+', min: 70 },
  { grade: 'B', min: 62 },
  { grade: 'C', min: 50 },
  { grade: 'D', min: 0 },
] as const

export function gradeFor(score: number): string {
  return GRADE_SCALE.find((g) => score >= g.min)?.grade ?? 'D'
}

function toManager(p: ProfileRow): CompareManager {
  const s = scoreProfile(p)
  return {
    handle: handleOf(p),
    avatarUrl: p.avatarUrl,
    level: s.level,
    levelName: s.levelRow.name,
    tier: s.levelRow.tier,
    tierGroup: s.levelRow.tierGroup,
    seasons: p.leagueSeasons,
    grade: gradeFor(s.prestige.total),
    gradeScore: s.prestige.total,
    suspect: countersInconsistent(p),
  }
}

function fmtRate(r: number | null): string {
  return r == null ? '—' : `${(Math.round(r * 1000) / 10).toFixed(1)}%`
}

/**
 * Compare the signed-in manager against another by handle.
 *
 * ⚠ SEASON-BY-SEASON AND HEAD-TO-HEAD ARE REPORTED AS UNAVAILABLE, NOT FAKED.
 * The design scopes both to leagues the two managers actually shared. What the
 * career counters on `UserProfile` hold is a per-manager lifetime total with no
 * league or opponent dimension, so there is nothing to intersect: producing a
 * year-by-year table from them would mean splitting a lifetime record across
 * seasons by assumption, and a head-to-head record would have to be invented
 * outright. 14c build rule 2 is that a season either manager sat out is omitted
 * — with no per-season rows, every season qualifies for omission.
 *
 * The lifetime table is real, and it is the part of the design that the current
 * data can actually answer.
 */
export async function getCompareData(
  userId: string | null,
  handle: string,
): Promise<CompareResult> {
  if (!userId) {
    return { ok: false, reason: 'signed-out', message: 'Sign in to compare your career with another manager.' }
  }

  const profiles = await loadRankedProfiles()
  const me = profiles.find((p) => p.userId === userId) ?? null
  if (!me) {
    return {
      ok: false,
      reason: 'not-ranked',
      message: 'Your career has not been ranked yet. Import a league to get a rank, then come back.',
    }
  }

  const needle = handle.trim().replace(/^@/, '').toLowerCase()
  const them =
    profiles.find(
      (p) =>
        p.username?.toLowerCase() === needle || p.displayName?.trim().toLowerCase() === needle,
    ) ?? null

  if (!them) {
    return {
      ok: false,
      reason: 'not-found',
      message: `No ranked manager matches @${needle}. Only managers who have been ranked can be compared.`,
    }
  }
  if (them.userId === me.userId) {
    return { ok: false, reason: 'self', message: 'That is you. Pick another manager to compare against.' }
  }

  const myRate = winRateOf(me.wins, me.losses)
  const theirRate = winRateOf(them.wins, them.losses)
  const myPrestige = computePrestige({
    championships: me.championships,
    winRate: myRate,
    seasonsPlayed: me.distinctSeasons,
    leaguesPlayed: me.leagueSeasons,
    playoffAppearances: me.playoffAppearances,
  })
  const theirPrestige = computePrestige({
    championships: them.championships,
    winRate: theirRate,
    seasonsPlayed: them.distinctSeasons,
    leaguesPlayed: them.leagueSeasons,
    playoffAppearances: them.playoffAppearances,
  })

  const lead = (a: number | null, b: number | null): 'you' | 'them' | null => {
    if (a == null || b == null || a === b) return null
    return a > b ? 'you' : 'them'
  }

  const metrics: CompareMetric[] = [
    {
      label: 'Record',
      you: `${me.wins.toLocaleString()}–${me.losses.toLocaleString()}`,
      them: `${them.wins.toLocaleString()}–${them.losses.toLocaleString()}`,
      leader: lead(myRate, theirRate),
      signature: false,
    },
    {
      label: 'Win rate',
      you: fmtRate(myRate),
      them: fmtRate(theirRate),
      leader: lead(myRate, theirRate),
      signature: false,
    },
    {
      label: 'Championships',
      you: String(me.championships),
      them: String(them.championships),
      leader: lead(me.championships, them.championships),
      signature: true,
    },
    {
      label: 'Playoff appearances',
      you: String(me.playoffAppearances),
      them: String(them.playoffAppearances),
      leader: lead(me.playoffAppearances, them.playoffAppearances),
      signature: false,
    },
    /*
     * ⚠ THE TWO SCORING ROWS ARE IN THE DESIGN AND CANNOT BE FILLED. Points per
     * game and best single week are per-matchup figures; the career counters
     * these comparisons read hold wins, losses, titles and playoff trips and
     * nothing about points at all. They stay in the table, empty and labelled,
     * because a silently shortened table reads as a complete one.
     */
    {
      label: 'Points per game',
      you: '—',
      them: '—',
      leader: null,
      signature: false,
      unavailable: 'Needs per-matchup scores; career totals do not carry points.',
    },
    {
      label: 'Best single week',
      you: '—',
      them: '—',
      leader: null,
      signature: true,
      unavailable: 'Needs per-matchup scores; career totals do not carry points.',
    },
    {
      label: 'GM prestige',
      you: myPrestige.total.toFixed(1),
      them: theirPrestige.total.toFixed(1),
      leader: lead(myPrestige.total, theirPrestige.total),
      signature: false,
    },
    {
      label: 'Rank XP',
      you: (me.xpTotal ?? 0).toLocaleString(),
      them: (them.xpTotal ?? 0).toLocaleString(),
      leader: lead(me.xpTotal, them.xpTotal),
      signature: false,
    },
  ]

  const titleRate = {
    you: me.playoffAppearances > 0 ? me.championships / me.playoffAppearances : null,
    them: them.playoffAppearances > 0 ? them.championships / them.playoffAppearances : null,
  }

  return {
    ok: true,
    data: {
      you: toManager(me),
      them: toManager(them),
      metrics,
      sharedSeasons: [],
      sharedSeasonsNote:
        'Season-by-season needs per-season rows for both managers in leagues you shared. Career totals are stored as lifetime figures with no league or season dimension, so there is nothing to line up year against year yet.',
      headToHead: null,
      headToHeadNote:
        'A head-to-head record needs matchup results from a league you both played in. None of the stored career data carries an opponent, so this is unknown rather than zero.',
      titleRate,
      verdict: buildVerdict(
        { handle: handleOf(me), rate: myRate, titles: me.championships, prestige: myPrestige.total, titleRate: titleRate.you },
        { handle: handleOf(them), rate: theirRate, titles: them.championships, prestige: theirPrestige.total, titleRate: titleRate.them },
      ),
    },
  }
}

type VerdictSide = {
  handle: string
  rate: number | null
  titles: number
  prestige: number
  titleRate: number | null
}

/**
 * The comparison verdict.
 *
 * ⚠ EVERY CLAUSE NAMES THE NUMBER BEHIND IT. 14c build rule 3: the verdict cites
 * the specific stats that justify it in the same card, never an unsupported
 * one-liner. This is assembled from the computed figures rather than generated,
 * so it cannot assert something the table above it contradicts.
 */
function buildVerdict(you: VerdictSide, them: VerdictSide): CompareData['verdict'] {
  const gap = you.prestige - them.prestige

  if (gap === 0) {
    return {
      headline: 'Dead even on prestige.',
      body: `Both managers score ${you.prestige.toFixed(1)} on GM prestige. ${you.handle} holds ${you.titles} ${
        you.titles === 1 ? 'title' : 'titles'
      } to ${them.handle}'s ${them.titles}.`,
    }
  }

  const leader = gap > 0 ? you : them
  const trailer = gap > 0 ? them : you
  const margin = Math.abs(gap) >= 15 ? 'clearly ahead' : Math.abs(gap) >= 5 ? 'ahead' : 'narrowly ahead'

  /*
   * ⚠ ONLY FIGURES THAT ACTUALLY SUPPORT THE CLAIM ARE CITED. An earlier cut of
   * this listed every metric in order, which produced "clearly ahead … a 44.0%
   * win rate against 44.2%" — a verdict arguing against itself with two of the
   * three numbers it quoted. Build rule 3 asks for the stats that justify the
   * take, so each candidate is tested against the direction of the verdict, and
   * anything the trailing manager leads on is moved into a "despite" clause
   * rather than dropped. Burying the counter-evidence would be the other way to
   * get this wrong.
   */
  type Cite = { for: string; against: string; leaderAhead: boolean }
  const candidates: Cite[] = []

  if (leader.rate != null && trailer.rate != null && leader.rate !== trailer.rate) {
    candidates.push({
      for: `a ${fmtRate(leader.rate)} win rate against ${fmtRate(trailer.rate)}`,
      against: `a ${fmtRate(trailer.rate)} win rate against ${fmtRate(leader.rate)}`,
      leaderAhead: leader.rate > trailer.rate,
    })
  }
  if (leader.titles !== trailer.titles) {
    candidates.push({
      for: `${leader.titles} ${leader.titles === 1 ? 'championship' : 'championships'} against ${trailer.titles}`,
      against: `${trailer.titles} ${trailer.titles === 1 ? 'championship' : 'championships'} against ${leader.titles}`,
      leaderAhead: leader.titles > trailer.titles,
    })
  }
  if (leader.titleRate != null && trailer.titleRate != null && leader.titleRate !== trailer.titleRate) {
    candidates.push({
      for: `converts ${fmtRate(leader.titleRate)} of playoff appearances into titles against ${fmtRate(trailer.titleRate)}`,
      against: `converts ${fmtRate(trailer.titleRate)} of playoff appearances into titles against ${fmtRate(leader.titleRate)}`,
      leaderAhead: leader.titleRate > trailer.titleRate,
    })
  }

  const supports = candidates.filter((c) => c.leaderAhead).map((c) => c.for)
  const counters = candidates.filter((c) => !c.leaderAhead).map((c) => c.against)

  const opening = `GM prestige ${leader.prestige.toFixed(1)} against ${trailer.prestige.toFixed(1)}`
  const supportClause = supports.length > 0 ? `${opening}, ${joinList(supports)}` : opening
  const counterClause =
    counters.length > 0 ? ` ${trailer.handle} leads on ${joinList(counters)}.` : ''

  return {
    headline: `${leader.handle} is ${margin}.`,
    body:
      `${supportClause}.${counterClause}` +
      ' Every figure here is a lifetime career total — neither manager is credited or penalised for seasons the other did not play.',
  }
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
