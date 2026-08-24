import 'server-only'

import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { getTeamInfo } from '@/lib/team-abbrev'
import { leagueDisplayName } from './leagueHome'
import type {
  Dash34Brief,
  Dash34Data,
  Dash34League,
  Dash34StateChip,
} from '@/components/core-app/screens/Dashboard34'

/**
 * The loader behind Dashboard 34a — the post-sign-in home.
 *
 * ⚠ WHAT THIS SCREEN CAN HONESTLY SHOW WAS MEASURED, NOT ASSUMED. Counted on
 * production 2026-08-17, and every omission below is one of these numbers:
 *
 *   - `LeagueTeam` rows with ANY result: **0 of 893**. No wins, no losses, no
 *     points-for anywhere in the table. So there is no record, no standing and
 *     no "today's record" — the card is omitted rather than rendering 0–0, which
 *     would read as a real result rather than as the absence of one.
 *   - `League.lastSyncedAt` non-null: **0 of 98**. Sync has never run. That is
 *     one fact about the account, so it is stated once as a notice instead of
 *     once per league — the 604-row flood this design exists to fix.
 *   - `LeagueSettings.draftDateUtc` non-null: **0**. The `draft_upcoming`
 *     detector can never fire, so a draft is not a candidate for the countdown.
 *   - `SportsGame` rows: **21,017, of which 4,278 are in the future**. Kickoff
 *     times are real, so the countdown is real — but it is a KICKOFF, not a
 *     lineup lock, and it says so. We hold no per-league lock rules.
 *   - `SportsInjury` rows: **5,153**, refreshed within the hour. Joined to
 *     rosters this produces a genuine "moving your book".
 *
 * ⚠ RE-COUNTED ON PRODUCTION 2026-08-18, BEFORE BUILDING THE BRIEF. Nothing that
 * was missing has arrived, so no line below was upgraded from "omitted" to
 * "shown" on the strength of a hope:
 *
 *   - `leagues.lastSyncedAt` non-null: **54 of 98, and that changed WHILE this
 *     was being written.** It read 0 of 98 at 13:00 and 54 of 98 at 13:52, with
 *     `syncStatus` going from `pending`×56 to `synced`×54 / `failed`×2. Sleeper
 *     sync is genuinely running now — the notice below correctly stops firing for
 *     an account whose leagues have been read, and `everSynced` is what decides
 *     that rather than a constant.
 *   - `league_teams` with ANY result (W/L/T/PF/PA): **still 0 of 893, AFTER those
 *     54 syncs landed.** THIS IS THE LOAD-BEARING NUMBER, NOT THE ONE ABOVE. Sync
 *     running is not the same as results existing: it is writing `lastSyncedAt`
 *     and no wins, losses or points. So "you're 19 behind" and "78% to win" still
 *     have no operand, and every line that depends on a score stays omitted.
 *
 *     ⚠ DO NOT TREAT A FRESH `lastSyncedAt` AS PERMISSION TO SHOW A SCORE. The
 *     two moved independently once already; re-count `league_teams` before
 *     un-omitting anything that needs a result.
 *   - `league_teams.currentRank` non-null: **798** — a dense 1..N per league.
 *     ⚠ IT IS NOT USED HERE AND MUST NOT BE. It is an ordering written over rows
 *     whose wins, losses and points are all zero, so it ranks nothing. Surfacing
 *     it would be the "a C grade means zero data" failure with a number instead
 *     of a letter.
 *   - `WeeklyMatchup`: **262 rows, every one season 2025**, 204 with points, over
 *     6 league ids — and **0 of those ids join `leagues.id`**. They are platform
 *     league ids, the other of the two id spaces. There is no current-season
 *     scored matchup for anybody.
 *   - `SportsGame` future rows: **4,268 (608 NFL)**, and all 32 NFL clubs appear
 *     in one. Per-club kickoff times ARE stored — the handoff assumed they were
 *     not — so "when does this player next play" is real, and it is the only
 *     time-pressure claim on the design's brief that survives.
 *   - `SportsInjury`: **5,209 rows, `date` non-null on all 5,209**, 1,144 fetched
 *     inside the last hour, NFL rows dated to today. So the design's "30 min ago"
 *     is a real timestamp and does not have to be synthesised.
 *
 * ⚠ AF LEGACY BOARD ROWS ARE NOT LEAGUES YOU PLAY. One production account
 * carries 60 claimed teams and **543** `LegacyLeague` board rows — historical
 * season snapshots from the Sleeper career import, flagged
 * `hasUnifiedRecord: false`. Those 603 rows are what produced 604 identical
 * "League data is stale" issues on the old home. They belong to Career &
 * Legacy, which is where this sends them, and the count is stated rather than
 * silently dropped.
 *
 * ⚠ THE INJURY JOIN IS BY NAME AND THAT IS THE WEAK LINK. `SportsInjury` carries
 * no usable player id, so this is the same lossy join `playerImpact.ts` and
 * `myTeam.ts` already use — deliberately the same, so the three surfaces cannot
 * disagree about who is hurt. A miss shows nothing; it never shows "healthy",
 * because we cannot know that.
 *
 * Nothing here calls a provider. Every read is Postgres.
 */

/** The list rows carry more than `UserLeague` declares; these are the fields used. */
export type Dash34LeagueRow = {
  id: string
  name?: string | null
  platform?: string | null
  sport?: string | null
  season?: number | string | null
  scoring?: string | null
  leagueType?: string | null
  isDynasty?: boolean | null
  teamCount?: number | null
  leagueSize?: number | null
  status?: string | null
  lifecycleState?: string | null
  isCommissioner?: boolean | null
  lastSyncedAt?: Date | string | null
  avatarUrl?: string | null
  logoUrl?: string | null
  platformLeagueId?: string | null
  sleeperLeagueId?: string | null
  hasUnifiedRecord?: boolean | null
}

export type Dash34Result = Dash34Data & {
  /** Rows excluded from the list because they are historical, not played. */
  legacyCount: number
  /**
   * "NFL WK 2" — or "NFL PRE WK 3" when the next game is a stated preseason
   * fixture — for the shell's top bar. Taken from the next scheduled game in a
   * sport you play — the only place a week number is actually recorded. Null when
   * no schedule is ingested for your sports, because a guessed week is worse than
   * none: every deadline on this product hangs off it.
   */
  weekLabel: string | null
  /**
   * What the prices on the book's rows actually are, so a surface can state it
   * once instead of implying a number tuned to a league it never saw. Null
   * when no row carries a price at all.
   */
  valueBasis: { format: 'DYNASTY' | 'REDRAFT'; qbFormat: 'ONE_QB' } | null
}

/* ── Injury vocabulary ───────────────────────────────────────────────────── */

/**
 * Statuses that carry no injury information.
 *
 * ⚠ THE FEED IS NOT ONE VOCABULARY. NFL rows say "Questionable" / "IR" /
 * "Sidelined"; NHL, NBA, MLB and soccer rows put the BODY PART in `status`
 * ("Lower Body", "Ankle", "Cruciate ligament tear"). So this cannot be a list of
 * known-bad values — it has to be a list of known-GOOD ones, and everything else
 * is surfaced verbatim. An unrecognised string is shown as written rather than
 * translated into a severity we did not read.
 */
const HEALTHY = new Set(['active', 'healthy', 'available', 'playing', 'none', 'no injury', 'fit'])

/** Cannot enter a lineup at all, as opposed to "might be limited". Mirrors playerImpact.ts. */
function isUnavailable(status: string): boolean {
  const s = status.trim().toLowerCase()
  return (
    s.startsWith('out') ||
    s.startsWith('doubt') ||
    s.startsWith('susp') ||
    s.startsWith('sidelined') ||
    s.includes('i.l') ||
    s === 'ir' ||
    s.includes('inj res') ||
    s.includes('pup') ||
    s.includes('nfi')
  )
}

/**
 * Designations that hold for a season, not a news cycle. IR, PUP, NFI and a
 * suspension stay true for months, so a report older than the freshness
 * window is still the current fact. Built on the same normalized strings
 * `isUnavailable` reads, so the two can never disagree about what "IR" means.
 */
function isSeasonScoped(status: string): boolean {
  const s = status.trim().toLowerCase()
  return (
    s === 'ir' ||
    s.includes('inj res') ||
    s.includes('injured reserve') ||
    s.includes('pup') ||
    s.includes('nfi') ||
    s.startsWith('susp')
  )
}

/**
 * How old a week-to-week designation may be before it stops being shown.
 * "Questionable, reported 8w ago" is a claim about a game long since played —
 * rendering it as current news is an invented fact. Season-scoped statuses
 * (see `isSeasonScoped`) are exempt: an IR stint is still true two months on.
 */
const STALE_REPORT_MS = 45 * 24 * 3_600_000

/* ── Formatting ──────────────────────────────────────────────────────────── */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * The countdown string.
 *
 * Rendered here so the server paint is correct and the row reserves its width;
 * `Dash34Countdown` takes over on the client and ticks from `countdownTo`, which
 * is why this value must be the same shape the ticker produces.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00:00'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (days > 0) return `${days}d ${pad(hours)}:${pad(mins)}`
  return `${hours}:${pad(mins)}:${pad(secs)}`
}

/**
 * "30 min ago" — how old a fact is.
 *
 * ⚠ SAME CONTRACT AS `formatCountdown`: the server renders this so the row paints
 * with its real width, and `Dash34Ago` re-derives it on the client from the ISO
 * instant. Both sides must produce the same shape from the same elapsed time or
 * the value visibly jumps on hydration, so this function is the single definition
 * and the client copy mirrors it exactly.
 *
 * Negative elapsed time is possible and is not an error: `SportsInjury.date` is
 * the provider's stamp, not ours, and a feed a few minutes ahead of our clock
 * would otherwise render "-1 min ago". It clamps to "just now".
 */
export function formatAgo(ms: number): string {
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * Player initials for the book avatars.
 *
 * ⚠ CODE POINTS, NOT CODE UNITS — the same defect as `initials` in Dashboard34.tsx,
 * where slicing a name mid-surrogate emitted a lone surrogate that the server and
 * client serialised differently and took hydration down for the whole page. Player
 * names are less likely to start with an emoji than league names, but "less likely"
 * is not a reason to leave the same trap in place twice.
 */
const ALNUM = /[\p{L}\p{N}]/u

function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '??'
  const firstAlnum = trimmed
    .split(/\s+/)
    .map((w) => Array.from(w).find((ch) => ALNUM.test(ch)))
    .filter((ch): ch is string => Boolean(ch))
  if (firstAlnum.length >= 2) return (firstAlnum[0] + firstAlnum[1]).toUpperCase()
  if (firstAlnum.length === 1) {
    return Array.from(trimmed).filter((ch) => ALNUM.test(ch)).slice(0, 2).join('').toUpperCase()
  }
  return Array.from(trimmed)[0] ?? '??'
}

/**
 * "2026 · 12-team · Dynasty · PPR Superflex", built only from fields that are set.
 * A label with holes in it ("· · PPR") reads as a rendering bug, so empty parts
 * are dropped rather than joined through.
 */
function formatLabelOf(row: Dash34LeagueRow): string | null {
  const size = row.teamCount ?? row.leagueSize ?? null
  const type = row.leagueType ?? (row.isDynasty ? 'Dynasty' : null)
  const parts = [
    row.season != null ? String(row.season) : null,
    size && size > 0 ? `${size}-team` : null,
    type ? type.charAt(0).toUpperCase() + type.slice(1) : null,
    row.scoring ?? null,
  ].filter((p): p is string => Boolean(p && p.trim()))
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * The league avatar.
 *
 * `logoUrl` is a commissioner upload and always a URL. `avatarUrl` is not — on
 * Sleeper rows it is an avatar *id*, which rendered straight into `src` would be
 * a broken image on every row. Anything that is not obviously a URL is treated as
 * a Sleeper id, and anything else falls through to initials.
 */
export function imageOf(row: Dash34LeagueRow): string | null {
  const logo = row.logoUrl?.trim()
  if (logo && /^https?:\/\//i.test(logo)) return logo
  const avatar = row.avatarUrl?.trim()
  if (!avatar) return null
  if (/^https?:\/\//i.test(avatar)) return avatar
  if (String(row.platform ?? '').toLowerCase() === 'sleeper') {
    return `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(avatar)}`
  }
  return null
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

/** Your handle in a league — the platform owner name, never the team's nickname. */
function identityOf(team: { ownerName?: string | null; teamName?: string | null } | null): string | null {
  const owner = team?.ownerName?.trim()
  if (owner && owner.toLowerCase() !== 'unknown') return owner
  const name = team?.teamName?.trim()
  if (name && name.toLowerCase() !== 'unknown') return name
  return null
}

/**
 * Where a league is in its year.
 *
 * ⚠ `status` AND `lifecycleState` DISAGREE ON PRODUCTION ROWS — one league reads
 * `status: 'pre_draft'` beside `lifecycleState: 'in_season'`. `status` is written
 * by the platform import and `lifecycleState` by our own state machine, which has
 * never run for imported leagues, so the platform's word wins and ours is the
 * fallback. Picking the other way round labels 60 undrafted leagues "in season".
 */
function stageOf(row: Dash34LeagueRow): string | null {
  const raw = String(row.status ?? row.lifecycleState ?? '').toLowerCase().trim()
  return raw || null
}

/* ── Global reads, shared across users ───────────────────────────────────── */

/*
 * The injury feed, the next-40 games and the NFL fixture list are the three
 * reads in this loader that carry NO userId — every signed-in home in the same
 * sports asks the exact same three queries. They are shared through
 * `unstable_cache` (60s revalidate, keyed by the sorted sports list) so sixty
 * concurrent home loads cost three queries, not one hundred and eighty. The
 * user-scoped reads (teams, rosters, players) are deliberately NOT cached.
 *
 * ⚠ `unstable_cache` SERIALISES THROUGH JSON, so a Date column comes back as
 * an ISO STRING on a cache hit but as a Date on a miss. Each cached reader
 * therefore stores ISO strings explicitly and its wrapper revives them, so
 * `getDash34Data` sees real Dates on both paths.
 *
 * ⚠ THE CLOCK INSIDE THE CACHED READ IS ITS OWN. `now` cannot be part of the
 * cache key — a millisecond timestamp would defeat the cache — so each query
 * filters on its own `new Date()` and the wrapper re-filters against the
 * caller's `now`, dropping games that started inside the revalidation window.
 */

const readNextGamesCached = unstable_cache(
  async (sports: string[]) => {
    const rows = await prisma.sportsGame
      .findMany({
        where: { sport: { in: sports }, startTime: { gte: new Date() } },
        orderBy: { startTime: 'asc' },
        take: 40,
        select: {
          sport: true,
          startTime: true,
          week: true,
          season: true,
          homeTeam: true,
          awayTeam: true,
          /*
           * Which slate `week` counts within — "pre" | "regular" | "post", or
           * null meaning "no source has said", never "regular". Selected
           * explicitly (this model is never read with a bare findMany — the
           * column reached production before every deployed client knew it,
           * and a bare read 500s in that window). See
           * prisma/migrations/20260820200000_sports_game_season_type.
           */
          seasonType: true,
        },
      })
      .catch(() => [])
    return rows.map((g) => ({ ...g, startTime: g.startTime ? g.startTime.toISOString() : null }))
  },
  ['dash34-next-games'],
  { revalidate: 60 },
)

async function readNextGames(sports: string[], now: Date) {
  const rows = await readNextGamesCached([...sports].sort()).catch(() => [])
  return rows
    .map((g) => ({ ...g, startTime: g.startTime ? new Date(g.startTime) : null }))
    .filter((g) => g.startTime != null && g.startTime.getTime() >= now.getTime())
}

/**
 * Market value and rank for a set of players, newest capture per player.
 *
 * ⚠ THIS IS THE FIX FOR "IT SHOULDN'T BE RANDOM". The book used to order by
 * how many of your lineups a player sat in, then how many leagues held him,
 * then ALPHABETICALLY — so a deep-bench IR stash rostered in thirty leagues
 * outranked a starting RB1 rostered in seven, and ties were broken by name.
 * Nothing in that ordering knew a first-round back from a waiver flier.
 * `overallRank` does, and it is cross-positional, so an RB and a WR can be
 * compared at all.
 *
 * ⚠ FANTASYCALC ONLY, DELIBERATELY. The other ingested source is
 * FantasyPros-derived and carries a licence restriction this product cannot
 * meet — the same boundary lib/core-app/trades.ts draws and documents.
 *
 * ⚠ AND THE PRICE IS NOT YOUR LEAGUE'S PRICE. It is captured at 12 teams and
 * full PPR, varying only dynasty/redraft and 1QB/superflex, so it is not
 * adjusted for TE premium or your scoring. The card says so rather than
 * implying a number tuned to a league it never saw. NFL only: FantasyCalc
 * prices no other sport, and a missing row renders NOTHING — never a zero,
 * never a last-place rank, because "no data" and "worthless" must not look
 * alike.
 *
 * Cached like the injury feed: the answer is identical for every user, so
 * concurrent home loads share one read.
 */
const readPlayerValuesCached = unstable_cache(
  async (sleeperIds: string[], format: string, qbFormat: string) => {
    if (sleeperIds.length === 0) return []
    const rows = await prisma.playerValueSnapshot
      .findMany({
        where: { sleeperId: { in: sleeperIds }, source: 'FANTASYCALC', format, qbFormat },
        orderBy: { capturedAt: 'desc' },
        select: {
          sleeperId: true,
          value: true,
          overallRank: true,
          positionRank: true,
          capturedAt: true,
        },
      })
      .catch(() => [])
    return rows.map((r) => ({
      sleeperId: r.sleeperId,
      value: r.value,
      overallRank: r.overallRank,
      positionRank: r.positionRank,
      capturedAt: r.capturedAt.toISOString(),
    }))
  },
  ['dash34-player-values'],
  { revalidate: 60 },
)

export type PlayerValueRead = {
  value: number
  overallRank: number | null
  positionRank: number | null
  capturedAt: string
}

/** Newest capture per player. Rows arrive newest-first, so first wins. */
async function readPlayerValues(
  sleeperIds: string[],
  format: 'DYNASTY' | 'REDRAFT',
  qbFormat: 'ONE_QB' | 'SUPERFLEX',
): Promise<Map<string, PlayerValueRead>> {
  const out = new Map<string, PlayerValueRead>()
  const rows = await readPlayerValuesCached([...sleeperIds].sort(), format, qbFormat).catch(() => [])
  for (const r of rows) {
    if (!out.has(r.sleeperId)) {
      out.set(r.sleeperId, {
        value: r.value,
        overallRank: r.overallRank,
        positionRank: r.positionRank,
        capturedAt: r.capturedAt,
      })
    }
  }
  return out
}

const readInjuryFeedCached = unstable_cache(
  async (sports: string[]) => {
    const rows = await prisma.sportsInjury
      .findMany({
        /*
         * ⚠ `expiresAt` IS THE WRITER'S OWN FRESHNESS CONTRACT — every ingest
         * (lib/injuries/rollingInsightsInjuries.ts) stamps it, and retiring a
         * feed is done by expiring its rows. Reading past it resurrects rows a
         * writer has already declared dead.
         */
        where: { sport: { in: sports }, expiresAt: { gt: new Date() } },
        orderBy: { fetchedAt: 'desc' },
        take: 4000,
        /*
         * ⚠ `date` IS THE REPORT'S OWN TIMESTAMP; `fetchedAt` IS WHEN WE POLLED.
         * The card says "reported 30 min ago", which is a claim about the report,
         * so it reads `date` and shows nothing when `date` is null rather than
         * silently substituting the poll time — those are two different facts and
         * only one of them answers "is this news".
         */
        /*
         * `position` and `team` are selected only to DISAMBIGUATE a shared
         * name — two athletes called Josh Allen are told apart by them, and
         * without them the matcher can only refuse. Neither is rendered.
         */
        select: {
          playerName: true,
          status: true,
          description: true,
          date: true,
          position: true,
          team: true,
        },
      })
      .catch(() => [])
    return rows.map((i) => ({ ...i, date: i.date ? i.date.toISOString() : null }))
  },
  ['dash34-injury-feed'],
  { revalidate: 60 },
)

async function readInjuryFeed(sports: string[]) {
  const rows = await readInjuryFeedCached([...sports].sort()).catch(() => [])
  return rows.map((i) => ({ ...i, date: i.date ? new Date(i.date) : null }))
}

const readNflFixturesCached = unstable_cache(
  async () => {
    const rows = await prisma.sportsGame
      .findMany({
        where: { sport: 'NFL', startTime: { gte: new Date() } },
        orderBy: { startTime: 'asc' },
        take: 200,
        select: { startTime: true, homeTeam: true, awayTeam: true },
      })
      .catch(() => [])
    return rows.map((g) => ({ ...g, startTime: g.startTime ? g.startTime.toISOString() : null }))
  },
  ['dash34-nfl-fixtures'],
  { revalidate: 60 },
)

async function readNflFixtures(now: Date) {
  const rows = await readNflFixturesCached().catch(() => [])
  return rows
    .map((g) => ({ ...g, startTime: g.startTime ? new Date(g.startTime) : null }))
    .filter((g) => g.startTime != null && g.startTime.getTime() >= now.getTime())
}

/* ── The loader ──────────────────────────────────────────────────────────── */

export async function getDash34Data(
  userId: string,
  leagueRows: Dash34LeagueRow[],
  now: Date = new Date()
): Promise<Dash34Result> {
  /*
   * Historical board rows out of the list first, before anything expensive keys
   * off them. These are the 543-row tail; fanning roster and injury reads across
   * them would be the same fan-out that took production Postgres to a 53200 OOM.
   */
  const active = leagueRows.filter((l) => l.hasUnifiedRecord !== false)
  const legacyCount = leagueRows.length - active.length

  if (active.length === 0) {
    return {
      firstLock: null,
      today: null,
      next24: null,
      leagues: [],
      quiet: null,
      totalLeagues: 0,
      brief: null,
      book: null,
      valueBasis: null,
      legacyCount,
      weekLabel: null,
    }
  }

  const activeIds = active.map((l) => l.id)
  const sports = [...new Set(active.map((l) => String(l.sport ?? 'NFL').toUpperCase()))]

  const [teams, nextGames] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { claimedByUserId: userId, leagueId: { in: activeIds } },
        select: {
          leagueId: true,
          teamName: true,
          ownerName: true,
          platformUserId: true,
          externalId: true,
          isCommissioner: true,
          isCoCommissioner: true,
        },
      })
      .catch(() => []),
    /*
     * Enough future games to cover the next-24-hours feed as well as the single
     * next kickoff, in one read. Ordered by start time so the first row IS the
     * countdown target. Global — shared through the 60s cache above.
     */
    readNextGames(sports, now),
  ])

  const teamByLeague = new Map(teams.map((t) => [t.leagueId, t]))

  /*
   * ⚠ ROSTERS ARE MATCHED PER LEAGUE, NOT AGAINST ONE GLOBAL CANDIDATE LIST.
   * `LeagueTeam.externalId` holds values like "4" — a global `platformUserId IN
   * (...)` would happily match a stranger's roster in a different league and
   * report their injuries as yours. One OR clause per league keeps the pairing
   * intact and still costs a single query.
   *
   * All three candidates are needed: matching on platformUserId and externalId
   * alone found a roster for 38 of 106 claimed teams, because `Roster.platformUserId`
   * sometimes holds our own User uuid. Same predicate as myTeam.ts and portfolio.ts.
   */
  const rosterOr = teams.map((t) => ({
    leagueId: t.leagueId,
    platformUserId: {
      in: [t.platformUserId, t.externalId, userId].filter((v): v is string => Boolean(v)),
    },
  }))

  const rosters = rosterOr.length
    ? await prisma.roster
        .findMany({
          where: { OR: rosterOr },
          select: { leagueId: true, playerData: true },
        })
        .catch(() => [])
    : []

  /**
   * leagueId → the roster, split by slot.
   *
   * ⚠ ALL FOUR SETS ARE KEPT, AND THREE OF THEM USED TO BE THROWN AWAY. The
   * first cut collapsed everything into `all` + `starters`, so the book could
   * say "starting in 4" and nothing else — a manager looking at an injured
   * player across 61 leagues cannot act on that. "Starter in 3, bench in 5, IR
   * in 1" is the sentence, and reserve/taxi were already parsed to build `all`.
   */
  const rosterByLeague = new Map<
    string,
    { all: string[]; starters: Set<string>; reserve: Set<string>; taxi: Set<string> }
  >()
  const everyPlayerId = new Set<string>()
  for (const r of rosters) {
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    const starters = asIds(pd.starters)
    const reserve = asIds(pd.reserve)
    const taxi = asIds(pd.taxi)
    const all = [...new Set([...asIds(pd.players), ...starters, ...reserve, ...taxi])]
    // First roster wins — a league should only produce one for a given user, and
    // overwriting on a duplicate would silently pick an arbitrary one.
    if (!rosterByLeague.has(r.leagueId)) {
      rosterByLeague.set(r.leagueId, {
        all,
        starters: new Set(starters),
        reserve: new Set(reserve),
        taxi: new Set(taxi),
      })
    }
    for (const id of all) everyPlayerId.add(id)
  }

  const playerIds = [...everyPlayerId]

  const [playerRows, injuryRows, nflFixtures] = await Promise.all([
    playerIds.length
      ? prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: playerIds } },
            /*
             * `sport` is selected only to gate the kickoff join below. Club codes
             * are NOT unique across sports — ATL, CHI, DET, MIA and PHI are all
             * both an NFL and an NBA club — so joining a player's code straight
             * into `lib/team-abbrev.ts` (which is an NFL table) would tell an NBA
             * owner their Hawks forward kicks off with the Falcons.
             */
            select: {
              sleeperId: true,
              name: true,
              position: true,
              team: true,
              sport: true,
              imageUrl: true,
            },
          })
          .catch(() => [])
      : Promise.resolve([]),
    /*
     * The injury feed — filtered to unexpired rows in SQL and shared through
     * the 60s cache above. The 45-day report-age gate is applied below in the
     * loader, where the brief, the chips, the urgent counts and the book all
     * inherit it at once.
     */
    readInjuryFeed(sports),
    /*
     * Next kickoff per NFL club, for "when does this player actually play".
     *
     * Read unconditionally when an NFL league is in play rather than after the
     * book is built, so it stays inside this one Promise.all instead of adding a
     * serial round-trip to the home page's critical path. 200 rows is roughly
     * eight days of fixtures — production carries the same game from two sources
     * (one row with `week`, one without), so the raw count overstates the number
     * of distinct games by about half and the map takes first-seen per club.
     * Global — shared through the 60s cache above.
     */
    sports.includes('NFL') ? readNflFixtures(now) : Promise.resolve([]),
  ])

  /**
   * Full club name → its next kickoff. `SportsGame` stores "Atlanta Falcons"
   * while `SportsPlayer.team` stores "ATL", which is why this is keyed on the
   * long form and the lookup runs the short form through `getTeamInfo` first.
   * Ascending order means the first row seen for a club IS its next game.
   */
  const nextKickoffByClub = new Map<string, Date>()
  for (const g of nflFixtures) {
    if (!g.startTime) continue
    for (const club of [g.homeTeam, g.awayTeam]) {
      const key = club?.trim().toLowerCase()
      if (!key || nextKickoffByClub.has(key)) continue
      nextKickoffByClub.set(key, g.startTime)
    }
  }

  /** Next kickoff for an NFL club code, or null when we cannot resolve it. */
  function kickoffFor(sport: string | null, team: string | null): Date | null {
    if (String(sport ?? '').toUpperCase() !== 'NFL') return null
    const info = getTeamInfo(team)
    // getTeamInfo returns null for anything outside the 32-club table, so free
    // agents and unrecognised codes fall out here rather than matching loosely.
    if (!info) return null
    return nextKickoffByClub.get(info.fullName.trim().toLowerCase()) ?? null
  }

  /*
   * ⚠ `sleeperId` IS NOT UNIQUE IN `SportsPlayer` — 501 distinct roster ids
   * resolved to 1,231 rows. Duplicates are near-identical records for the same
   * athlete; first wins, and the count of *players* is taken from the id set
   * rather than from the row count, which would have overstated every exposure
   * figure on this screen by roughly 2.5×.
   */
  const playerById = new Map<
    string,
    {
      name: string
      position: string | null
      team: string | null
      sport: string | null
      imageUrl: string | null
    }
  >()
  for (const p of playerRows) {
    if (!p.sleeperId || playerById.has(p.sleeperId)) continue
    playerById.set(p.sleeperId, {
      name: p.name,
      position: p.position,
      team: p.team,
      sport: p.sport,
      imageUrl: p.imageUrl ?? null,
    })
  }

  /*
   * ⚠ THE JOIN THAT CAN MAKE A PLAYER VANISH. `SportsInjury` carries no usable
   * player id, so a designation is bound to a roster player by NAME. The first
   * cut lowercased both sides and took the first hit, which fails two ways:
   * a suffix or punctuation difference drops the player out of the book
   * entirely — silently, because a miss is indistinguishable from healthy —
   * and two athletes sharing a name get each other's injury.
   *
   * `resolveVerifiedMatch` is the repo's canonical matcher (the one
   * lib/injuries/injuryReadPort.ts uses): it verifies a shared name against
   * position and club, and REFUSES rather than guessing when it still cannot
   * tell them apart — the QB-Josh-Allen-versus-LB-Josh-Allen case. Refusals
   * are collected and stated in the coverage list instead of disappearing.
   *
   * Only the MATCHING moves here. The feed read stays the shared, cached,
   * user-independent query it was, so sixty concurrent home loads still cost
   * one read rather than sixty.
   */
  const injuryIndex = buildNameIndex(
    injuryRows
      .filter((i) => Boolean(i.status))
      .map((i) => ({
        name: i.playerName,
        position: i.position ?? null,
        team: i.team ?? null,
        row: i,
      })),
  )
  const ambiguousInjuryNames = new Set<string>()

  const injuryByName = new Map<
    string,
    { status: string; description: string | null; reportedAt: Date | null }
  >()
  for (const i of injuryRows) {
    if (!i.status) continue
    const key = i.playerName.trim().toLowerCase()
    if (injuryByName.has(key)) continue
    if (HEALTHY.has(i.status.trim().toLowerCase())) continue
    /*
     * ⚠ THE FRESHNESS GATE LIVES HERE, IN THE LOADER, so the brief, the triage
     * chips, the urgent counts and the book all inherit it at once. A dated
     * report older than 45 days is last season's news unless the status itself
     * spans a season (IR, PUP, NFI, suspension — `isSeasonScoped`). A row with
     * no `date` cannot be judged stale and is kept: it already passed the
     * writer's own `expiresAt`, and dropping it would hide a designation on
     * the strength of a missing timestamp rather than a stale one. Kept rows
     * still carry `reportedAt`, so "reported 3w ago" renders exactly as before.
     */
    if (
      i.date != null &&
      now.getTime() - i.date.getTime() > STALE_REPORT_MS &&
      !isSeasonScoped(i.status)
    ) {
      continue
    }
    injuryByName.set(key, { status: i.status, description: i.description, reportedAt: i.date })
  }

  /** Designation for a roster id, or null when we hold none. Never "healthy". */
  function designationOf(playerId: string): {
    name: string
    position: string | null
    team: string | null
    sport: string | null
    status: string
    description: string | null
    reportedAt: Date | null
    imageUrl: string | null
  } | null {
    const p = playerById.get(playerId)
    if (!p) return null

    /*
     * Verified identity first. A refusal is recorded and treated as "we hold
     * nothing" — which is the honest answer, and never "healthy".
     */
    const verified = resolveVerifiedMatch(injuryIndex, {
      name: p.name,
      position: p.position,
      team: p.team,
    })
    if (verified.reason === 'ambiguous') {
      ambiguousInjuryNames.add(p.name)
      return null
    }
    if (!verified.match) return null

    const inj = injuryByName.get(verified.match.row.playerName.trim().toLowerCase())
    if (!inj) return null
    return {
      name: p.name,
      position: p.position,
      team: p.team,
      sport: p.sport,
      status: inj.status,
      description: inj.description,
      reportedAt: inj.reportedAt,
      imageUrl: p.imageUrl ?? null,
    }
  }

  /* ── Per-league hurt counts, and the exposure book in the same pass ─────── */

  type BookEntry = {
    name: string
    imageUrl: string | null
    position: string | null
    team: string | null
    sport: string | null
    status: string
    description: string | null
    reportedAt: Date | null
    leagues: Set<string>
    /** The roster id that produced this entry — the join key for value. */
    sleeperId: string
    startingIn: number
    benchIn: number
    irIn: number
    taxiIn: number
    /** leagueId → the slot this player occupies there. */
    slotByLeague: Map<string, 'starter' | 'bench' | 'ir' | 'taxi'>
  }
  const book = new Map<string, BookEntry>()
  /**
   * ⚠ `startingUnavailable` IS A SEPARATE COUNT FROM `unavailable`, AND CONFLATING
   * THEM MADE EVERY ROW URGENT. The first cut tinted a row red when it had a
   * flagged starter AND anyone at all unavailable — including a benched player on
   * IR, which is the normal state of a dynasty roster. On the 61-league account
   * that lit all eight visible rows red at once, which is the same as lighting
   * none: the point of the tint is that it picks one league out of the list.
   */
  const hurtByLeague = new Map<
    string,
    { total: number; starting: number; unavailable: number; startingUnavailable: number }
  >()

  for (const [leagueId, roster] of rosterByLeague) {
    let total = 0
    let starting = 0
    let unavailable = 0
    let startingUnavailable = 0
    for (const pid of roster.all) {
      const d = designationOf(pid)
      if (!d) continue
      total++
      const isStarter = roster.starters.has(pid)
      if (isStarter) starting++
      if (isUnavailable(d.status)) {
        unavailable++
        if (isStarter) startingUnavailable++
      }

      /*
       * One slot per player per league, decided once. Starter wins over
       * everything (a player listed both places is playing), then IR, then
       * taxi, then bench. A league whose roster we could not read contributes
       * no slot at all rather than a defaulted "bench".
       */
      const slot: 'starter' | 'bench' | 'ir' | 'taxi' = isStarter
        ? 'starter'
        : roster.reserve.has(pid)
          ? 'ir'
          : roster.taxi.has(pid)
            ? 'taxi'
            : 'bench'

      const key = d.name.trim().toLowerCase()
      const entry = book.get(key)
      if (entry) {
        entry.leagues.add(leagueId)
        entry.slotByLeague.set(leagueId, slot)
        if (slot === 'starter') entry.startingIn++
        else if (slot === 'ir') entry.irIn++
        else if (slot === 'taxi') entry.taxiIn++
        else entry.benchIn++
      } else {
        book.set(key, {
          name: d.name,
          imageUrl: d.imageUrl,
          position: d.position,
          team: d.team,
          sport: d.sport,
          status: d.status,
          description: d.description,
          reportedAt: d.reportedAt,
          leagues: new Set([leagueId]),
          sleeperId: pid,
          startingIn: slot === 'starter' ? 1 : 0,
          benchIn: slot === 'bench' ? 1 : 0,
          irIn: slot === 'ir' ? 1 : 0,
          taxiIn: slot === 'taxi' ? 1 : 0,
          slotByLeague: new Map([[leagueId, slot]]),
        })
      }
    }
    hurtByLeague.set(leagueId, { total, starting, unavailable, startingUnavailable })
  }

  const NO_HURT = { total: 0, starting: 0, unavailable: 0, startingUnavailable: 0 }

  /* ── The league list ───────────────────────────────────────────────────── */

  const leagues: Dash34League[] = active.map((row) => {
    const team = teamByLeague.get(row.id) ?? null
    const hurt = hurtByLeague.get(row.id) ?? NO_HURT
    const stage = stageOf(row)
    const platform = String(row.platform ?? 'manual').toLowerCase()
    const commish = Boolean(row.isCommissioner || team?.isCommissioner || team?.isCoCommissioner)

    const chips: Dash34StateChip[] = []
    if (stage === 'drafting') chips.push({ label: 'DRAFTING', tone: 'live' })
    else if (stage === 'pre_draft' || stage === 'setup') chips.push({ label: 'PRE DRAFT', tone: 'warn' })
    else if (stage === 'complete' || stage === 'completed') chips.push({ label: 'SEASON OVER' })
    if (commish) chips.push({ label: 'YOU COMMISH', tone: 'good' })
    if (hurt.startingUnavailable > 0) {
      chips.push({
        label: `${hurt.startingUnavailable} STARTER${hurt.startingUnavailable === 1 ? '' : 'S'} OUT`,
        tone: 'bad',
      })
    } else if (hurt.starting > 0) {
      chips.push({
        label: `${hurt.starting} STARTER${hurt.starting === 1 ? '' : 'S'} FLAGGED`,
        tone: 'warn',
      })
    } else if (hurt.total > 0) {
      chips.push({ label: `${hurt.total} FLAGGED`, tone: 'warn' })
    }

    /*
     * The urgent tint is reserved for a STARTER WHO CANNOT PLAY. Questionable is a
     * risk to weigh, not an impossibility, and a hurt bench player changes nothing
     * about today — tinting either the same colour is how an urgency signal stops
     * meaning anything.
     */
    const priority: Dash34League['priority'] =
      hurt.startingUnavailable > 0 ? 'urgent' : stage === 'drafting' ? 'draft' : null

    const action =
      hurt.total > 0
        ? { label: 'See who is flagged', href: `/core/my-team?league=${encodeURIComponent(row.id)}` }
        : stage === 'drafting' || stage === 'pre_draft'
          ? { label: 'Draft HQ', href: `/core/draft-hq?league=${encodeURIComponent(row.id)}` }
          : { label: 'Open league', href: `/core?league=${encodeURIComponent(row.id)}` }

    return {
      id: row.id,
      name: leagueDisplayName(row.name),
      platform,
      imageUrl: imageOf(row),
      formatLabel: formatLabelOf(row),
      sport: row.sport ?? null,
      /*
       * ⚠ `ownerName` IS THE HANDLE; `teamName` IS THE TEAM. The handoff asks for
       * "your username in that league", and reading `teamName` first put "$20 SF",
       * "Free TEP" and "❌❌❌" on these rows — real team names, but not an
       * identity. Checked against production: the two differ on 51 of 68 claimed
       * teams, so this is not a distinction without a difference. "Unknown" is the
       * importer's placeholder for an unfilled seat and is treated as absent.
       */
      usernameInLeague: identityOf(team),
      chips,
      // No `LeagueTeam` row on production carries a result, so there is no score
      // to show and no projection to show it against.
      score: null,
      matchupNote: rosterByLeague.has(row.id) ? 'No scores read yet' : 'No roster imported yet',
      projection: null,
      priority,
      href: action.href,
      actionLabel: action.label,
    }
  })

  /*
   * "Sorted by what needs you first" — and with no scores, records or deadlines
   * on file, the only real signals are an unavailable starter, a draft in
   * progress, and being the person accountable for the league.
   */
  function rank(l: Dash34League): number {
    const hurt = hurtByLeague.get(l.id) ?? NO_HURT
    if (l.priority === 'urgent') return 0
    if (l.priority === 'draft') return 1
    if (hurt.starting > 0) return 2
    if (hurt.total > 0) return 3
    if ((l.chips ?? []).some((c) => c.label === 'PRE DRAFT')) return 4
    if ((l.chips ?? []).some((c) => c.label === 'YOU COMMISH')) return 5
    return 6
  }

  const needs = leagues.filter((l) => rank(l) < 6).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const quietLeagues = leagues.filter((l) => rank(l) >= 6).sort((a, b) => a.name.localeCompare(b.name))

  /*
   * The list is capped. This is the same lesson as the rail: at 60 leagues a
   * complete list is an inventory, and Portfolio is the screen for that. Anything
   * past the cap that still needs attention is counted into the tail row rather
   * than dropped.
   */
  const LIST_LIMIT = 8
  const shown = needs.slice(0, LIST_LIMIT)
  /*
   * ⚠ OVERFLOW IS NOT QUIET, AND FOLDING ONE INTO THE OTHER WAS A LIE. The first
   * cut added the two together and rendered "53 leagues are quiet — nothing needs
   * you." On that account nearly all 53 had a flagged player; they were pushed off
   * the list by the cap, not because nothing needed doing. Two counts, two
   * sentences.
   */
  const overflow = needs.length - shown.length

  const quiet =
    quietLeagues.length > 0
      ? {
          count: quietLeagues.length,
          sample:
            quietLeagues.length === 1
              ? `${quietLeagues[0].name} (${quietLeagues[0].platform.toUpperCase()}) is quiet`
              : null,
        }
      : null

  /* ── First kickoff ─────────────────────────────────────────────────────── */

  /*
   * The band's CTA. The handoff opens the source platform, which is the right
   * action when the band names one league — but this countdown is a league-wide
   * kickoff, so it points at the roster screen for the league at the top of the
   * list, which is by construction the one most likely to need a decision. With no
   * leagues it falls back to Player Finder rather than rendering a dead button.
   */
  const topLeague = needs[0] ?? null
  const nextGame = nextGames[0] ?? null

  /*
   * Which slate the countdown's game belongs to. Production stores the same
   * game once per source (see the fixtures comment above), and the sources are
   * not equally informed: TheSportsDB rows carry `seasonType: null` while the
   * Rolling Insights / ESPN row for the SAME game states it — and which
   * duplicate sorts first is arbitrary. So slate and week are coalesced across
   * every fetched row describing the same game (same start instant, same two
   * clubs), taking a value only when the rows that state one agree. Silence or
   * disagreement yields null, and null renders NO slate label rather than a
   * guess — an unlabelled kickoff is ambiguous, but "Week 3" over the 27 Aug
   * preseason game reads as regular season and is wrong (founder-reported
   * 2026-08-24).
   */
  const clubPair = (g: { homeTeam: string | null; awayTeam: string | null }) =>
    [g.homeTeam ?? '', g.awayTeam ?? ''].map((c) => c.trim().toLowerCase()).sort().join('|')
  const nextStart = nextGame?.startTime ?? null
  const sameGameRows =
    nextGame && nextStart
      ? nextGames.filter(
          (g) => g.startTime?.getTime() === nextStart.getTime() && clubPair(g) === clubPair(nextGame),
        )
      : []
  const statedSlates = [...new Set(sameGameRows.map((g) => g.seasonType).filter((s): s is string => Boolean(s)))]
  const nextGameSlate = statedSlates.length === 1 ? statedSlates[0] : null
  const statedWeeks = [...new Set(sameGameRows.map((g) => g.week).filter((w): w is number => w != null))]
  // The first row's own week wins when it has one; a sibling source's sole
  // stated week fills the gap; conflicting claims fill nothing.
  const nextGameWeek = nextGame ? (nextGame.week ?? (statedWeeks.length === 1 ? statedWeeks[0] : null)) : null
  const firstLock = nextGame?.startTime
    ? {
        countdown: formatCountdown(nextGame.startTime.getTime() - now.getTime()),
        countdownTo: nextGame.startTime.toISOString(),
        /*
         * ⚠ "FIRST KICKOFF", NOT "FIRST LOCK". The handoff labels this FIRST LOCK,
         * but a lineup lock is a per-league rule and we hold none — 0 of 98
         * leagues have ever been read. This is the first game we have a start time
         * for in a sport you play, which is a real deadline and a different claim.
         */
        countdownLabel: 'FIRST KICKOFF',
        kickoffLabel: [
          nextGame.sport,
          /*
           * The slate, when a source has stated it. "Week N" alone continues
           * to mean regular season; preseason and postseason are named
           * outright; an unknown slate adds nothing rather than guessing.
           */
          nextGameSlate === 'pre' ? 'Preseason' : nextGameSlate === 'post' ? 'Postseason' : null,
          nextGameWeek != null ? `Week ${nextGameWeek}` : null,
          nextGame.startTime.toUTCString().slice(0, 22) + ' UTC',
        ]
          .filter(Boolean)
          .join(' · '),
        headline: `${nextGame.awayTeam} at ${nextGame.homeTeam}`,
        /*
         * Raw club names for the band's club marks, NFL only — names and codes
         * collide across sports and lib/team-abbrev.ts is an NFL table. A
         * non-NFL next game emits null and the headline text stands alone.
         */
        awayClub:
          String(nextGame.sport ?? '').toUpperCase() === 'NFL' ? (nextGame.awayTeam ?? null) : null,
        homeClub:
          String(nextGame.sport ?? '').toUpperCase() === 'NFL' ? (nextGame.homeTeam ?? null) : null,
        // No lineup reader exists, so there are no slot chips to show. An empty
        // array renders nothing rather than inventing "FLEX empty".
        slots: [],
        openHref: topLeague
          ? `/core/my-team?league=${encodeURIComponent(topLeague.id)}`
          : '/core/players',
        openLabel: topLeague ? `Check ${topLeague.name}` : 'Open Player Finder',
      }
    : null

  /* ── Next 24 hours ─────────────────────────────────────────────────────── */

  const horizon = now.getTime() + 24 * 3_600_000
  const next24 = nextGames
    .filter((g) => g.startTime && g.startTime.getTime() <= horizon)
    .slice(0, 5)
    .map((g) => ({
      text: `${g.awayTeam} at ${g.homeTeam}`,
      time: g.startTime!.toISOString(),
      tone: 'accent' as const,
    }))

  /* ── Moving your book ──────────────────────────────────────────────────── */

  /*
   * 34a shows six; the v2 exposure module lists them all, ordered by how many
   * leagues carry the player. One builder, one ordering — the cap is the only
   * difference, so it is a constant rather than two code paths.
   */
  const BOOK_LIMIT = 40
  const totalActive = active.length

  /*
   * ONE price scale for a cross-league list. The book spans every league at
   * once, so it cannot use each league's own format — it picks the account's
   * dominant one and the card names it, rather than mixing dynasty and redraft
   * prices in a single ordering and calling the result a ranking.
   *
   * Superflex is not derivable here (it needs roster_positions, which this
   * loader does not read), so ONE_QB is assumed and said out loud.
   */
  const dynastyCount = active.filter((row) => Boolean(row.isDynasty)).length
  const valueFormat: 'DYNASTY' | 'REDRAFT' =
    dynastyCount * 2 >= totalActive ? 'DYNASTY' : 'REDRAFT'
  const bookEntries = [...book.values()]
  const valueBySleeperId = await readPlayerValues(
    bookEntries.map((b) => b.sleeperId).filter(Boolean),
    valueFormat,
    'ONE_QB',
  )
  const rankOf = (b: BookEntry): number | null =>
    valueBySleeperId.get(b.sleeperId)?.overallRank ?? null

  const bookRows = bookEntries
    .sort((a, b) => {
      const au = isUnavailable(a.status)
      const bu = isUnavailable(b.status)
      if (au !== bu) return au ? -1 : 1
      /*
       * ⚠ MARKET RANK IS THE PRIMARY ORDER, AND EXPOSURE IS A TIEBREAK. It was
       * the other way round, which is why a bench stash held everywhere led a
       * starting RB1. An unranked player sorts AFTER every ranked one — never
       * to a sentinel rank, because "we hold no price" must not read as "worth
       * nothing".
       */
      const ar = rankOf(a)
      const br = rankOf(b)
      if (ar !== br) {
        if (ar == null) return 1
        if (br == null) return -1
        return ar - br
      }
      if (b.startingIn !== a.startingIn) return b.startingIn - a.startingIn
      if (b.leagues.size !== a.leagues.size) return b.leagues.size - a.leagues.size
      return a.name.localeCompare(b.name)
    })
    .slice(0, BOOK_LIMIT)
    .map((b) => {
      const kickoff = kickoffFor(b.sport, b.team)
      return {
        initials: initialsOf(b.name),
        name: b.name,
        imageUrl: b.imageUrl,
        /*
         * The leagues carrying this player, resolved to something renderable. The
         * set of ids was already being collected to COUNT exposure; naming them is
         * what turns "7 of 61" from a number into something actionable — you can
         * see which seven without opening seven leagues.
         */
        leagues: [...b.leagues]
          .map((id) => {
            const row = active.find((l) => l.id === id)
            return row
              ? {
                  id,
                  name: leagueDisplayName(row.name),
                  platform: String(row.platform ?? ''),
                  imageUrl: imageOf(row),
                  /*
                   * Which slot he occupies in THIS league — the difference
                   * between "you must act here" and "no action needed". Null
                   * when the roster could not be read; the chip then shows no
                   * slot rather than defaulting to bench.
                   */
                  slot: b.slotByLeague.get(id) ?? null,
                }
              : null
          })
          .filter(
            (
              x,
            ): x is {
              id: string
              name: string
              platform: string
              imageUrl: string | null
              slot: 'starter' | 'bench' | 'ir' | 'taxi' | null
            } => x !== null,
          )
          .sort((a, b2) => a.name.localeCompare(b2.name)),
        note: [b.position, b.status].filter(Boolean).join(' · '),
        /*
         * The two halves of `note` again, separately. The badge needs the slot on
         * its own and the status line needs the designation on its own; splitting
         * the joined string back apart in the component would put a parser
         * between the loader and the screen for a fact the loader already holds.
         */
        position: b.position,
        team: b.team,
        /* NFL gate for the club mark beside the code — codes collide across sports. */
        sport: b.sport,
        status: b.status,
        exposure: `${b.leagues.size} of ${totalActive}`,
        /*
         * The same fact as numbers. A share bar needs a ratio, and parsing it back
         * out of the display string would break the moment the wording changes.
         */
        exposureCount: b.leagues.size,
        exposureTotal: totalActive,
        /* How many of those leagues have them in the lineup, not just rostered. */
        startingIn: b.startingIn,
        /*
         * The rest of the split. "Starting in 4" alone cannot be acted on
         * across 61 leagues; "starter in 3, bench in 5, IR in 1" can. Reserve
         * and taxi were already parsed to build the roster — they were simply
         * discarded before reaching here.
         */
        benchIn: b.benchIn,
        irIn: b.irIn,
        taxiIn: b.taxiIn,
        /*
         * What the feed actually said, e.g. "Ruled out — ankle. Did not
         * practice Friday." It was selected, stored and carried this far, then
         * dropped at this map — the card had a status word and no update. Null
         * stays null: nothing is synthesised about a timeline, because no
         * injury table in this database holds an expected return.
         */
        description: b.description,
        /*
         * Market price and rank, or absent. See readPlayerValues for the
         * licence boundary, the format caveat, and why a miss renders nothing
         * at all rather than a last-place rank.
         */
        value: valueBySleeperId.get(b.sleeperId) ?? null,
        /*
         * ⚠ REAL OR ABSENT. `SportsInjury.date` is non-null on all 5,209 production
         * rows, so this is normally set — but it is emitted as null rather than
         * back-filled from `fetchedAt` or from `now` when it is missing, and the
         * card renders no freshness line at all in that case. An invented "just
         * now" on a three-week-old designation is worse than no timestamp.
         */
        reportedAt: b.reportedAt ? b.reportedAt.toISOString() : null,
        reportedAgo: b.reportedAt ? formatAgo(now.getTime() - b.reportedAt.getTime()) : null,
        /*
         * NFL only, and null for every other sport — see the note on the player
         * select. This is the club's next scheduled game, which is what makes one
         * flagged starter more urgent than another; it is NOT a lineup lock.
         */
        nextKickoffAt: kickoff ? kickoff.toISOString() : null,
        tone: isUnavailable(b.status) ? ('bad' as const) : ('warn' as const),
      }
    })

  /* ── Honest notices ────────────────────────────────────────────────────── */

  const everSynced = active.some((l) => Boolean(l.lastSyncedAt))

  /* ── Chimmy's brief ────────────────────────────────────────────────────── */

  /*
   * ⚠ NOT ONE TOKEN IS SPENT BUILDING THIS. Every line below is assembled from
   * values already computed above — the ranked list, the injury book, the fixture
   * read — and no model is called. That is not an optimisation, it is the
   * requirement: PR #433 removed three per-league Anthropic call sites from the
   * signed-in home precisely because they billed on every page view, and a brief
   * generated on load would put the same charge back on the same screen. Chimmy
   * spends when the user clicks "Ask Chimmy", and only then.
   *
   * ⚠ FOUR OF THE DESIGN'S FIVE CLAIMS ARE ABSENT ON PURPOSE, NOT PENDING.
   * Re-measured on production today (see the header):
   *
   *   "the FLEX is worth ~11 points"  — no projection exists for any roster slot.
   *   "you're 19 behind"              — 0 of 893 team rows carry a score.
   *   "78% to win"                    — no win model; /my-team's figure is a
   *                                     points ratio, which is a different number
   *                                     wearing the same %.
   *   "the Yahoo center can wait"     — needs the player's own game time…
   *
   * …and that last one is the exception. Per-club kickoffs ARE stored (4,268
   * future rows, all 32 NFL clubs present), so `nextKickoffAt` is real and the
   * brief can say which flagged player plays first. It is the only urgency claim
   * on the design that has an operand, and it carries the card.
   *
   * A line whose input is missing is dropped from the array. None is defaulted,
   * because a defaulted line is indistinguishable from a measured one — the same
   * failure as a "C" trade grade that actually means we hold no data.
   */
  /*
   * ⚠ `leagues`, NOT `shown`. These count across EVERY active league, uncapped,
   * while the priority cards below the brief render the top 8. That gap is the
   * point: on the 60-league account the cards can show three urgent leagues while
   * the brief correctly says eleven. Counting only the visible ones would make
   * the summary agree with the list by under-reporting the account, which is the
   * "53 leagues are quiet" failure in a different costume.
   */
  const urgentLeagues = leagues.filter((l) => l.priority === 'urgent')
  const draftingLeagues = leagues.filter((l) => l.priority === 'draft')
  const flaggedLeagues = leagues.filter((l) => (hurtByLeague.get(l.id) ?? NO_HURT).total > 0)

  const briefLines: Dash34Brief['lines'] = []

  /*
   * The concentration line. This is the one thing this product knows that no
   * single-league app can: the same designation hitting several of your teams at
   * once. It leads when it is true of more than one league — in one league it is
   * just an injury, and the league row already says so.
   */
  const topRow = bookRows[0] ?? null
  if (topRow && topRow.exposureCount != null && topRow.exposureCount > 1) {
    const startingClause =
      topRow.startingIn > 0
        ? ` — in your lineup in ${topRow.startingIn} of them`
        : ' — on the bench in all of them'
    briefLines.push({
      key: 'concentration',
      tone: topRow.tone,
      text:
        `${topRow.name}${topRow.position ? ` (${topRow.position})` : ''} is ` +
        `${topRow.status.toLowerCase()} in ${topRow.exposureCount} of your ` +
        `${totalActive} leagues${startingClause}.`,
    })
  }

  /*
   * When that player next plays. Rendered as an instant rather than a phrase, so
   * the component can localise it — the server cannot know the reader's zone, and
   * a kickoff in the wrong one is the number someone sets an alarm by.
   */
  if (topRow?.nextKickoffAt) {
    briefLines.push({
      key: 'kickoff',
      tone: 'plain',
      text: `${topRow.name} plays next at`,
      atIso: topRow.nextKickoffAt,
    })
  }

  /*
   * What is actually waiting on a decision. Three separate counts rather than one
   * total: a starter who cannot play, a draft on the clock, and a flag that is
   * only worth a look are three different jobs, and summing them is how a queue
   * stops telling you what to do first.
   */
  if (urgentLeagues.length > 0) {
    briefLines.push({
      key: 'urgent',
      tone: 'bad',
      text:
        `${urgentLeagues.length} ${urgentLeagues.length === 1 ? 'league has' : 'leagues have'} ` +
        `a starter who cannot play: ${urgentLeagues.slice(0, 3).map((l) => l.name).join(', ')}` +
        `${urgentLeagues.length > 3 ? ` and ${urgentLeagues.length - 3} more` : ''}.`,
    })
  }
  if (draftingLeagues.length > 0) {
    briefLines.push({
      key: 'drafting',
      tone: 'warn',
      text:
        `${draftingLeagues.length} ${draftingLeagues.length === 1 ? 'draft is' : 'drafts are'} ` +
        `on the clock: ${draftingLeagues.slice(0, 3).map((l) => l.name).join(', ')}.`,
    })
  }
  /*
   * Only stated when it is NOT already covered by the urgent line — otherwise the
   * same league is counted twice in consecutive sentences and the brief reads as
   * though there is more wrong than there is.
   */
  const onlyFlagged = flaggedLeagues.filter((l) => l.priority !== 'urgent').length
  if (onlyFlagged > 0) {
    briefLines.push({
      key: 'flagged',
      tone: 'warn',
      text: `${onlyFlagged} more ${onlyFlagged === 1 ? 'league carries' : 'leagues carry'} a flagged player who can still play.`,
    })
  }

  /*
   * The headline restates the single biggest fact, and it is chosen by the same
   * ranking the list uses so the two can never disagree about what matters most.
   */
  const briefHeadline =
    urgentLeagues.length > 0
      ? `${urgentLeagues.length} ${urgentLeagues.length === 1 ? 'lineup needs' : 'lineups need'} a change`
      : draftingLeagues.length > 0
        ? `${draftingLeagues.length} ${draftingLeagues.length === 1 ? 'draft is' : 'drafts are'} running`
        : flaggedLeagues.length > 0
          ? `${flaggedLeagues.length} ${flaggedLeagues.length === 1 ? 'league has' : 'leagues have'} a player worth a look`
          : 'Nothing is waiting on you'

  /*
   * ⚠ THE CARD SHOWS UP EVEN WHEN THERE IS NOTHING TO SAY, AND THAT IS THE POINT.
   * With no lines the headline is "Nothing is waiting on you" and the caveat
   * below states what was and was not checked. Hiding the card in the quiet case
   * would leave the reader unable to tell "checked, all clear" from "not looking".
   */
  const chimmyBrief: Dash34Brief = {
    /*
     * ⚠ NOT "SUNDAY BRIEF". The design names a weekday; the only weekday this
     * loader could defend is the one belonging to the next kickoff, and that is a
     * date in the SERVER's zone, not the reader's. Naming the wrong day at the top
     * of the home screen is a worse error than not naming one, so the eyebrow is
     * day-free and the real, localisable kickoff instant sits beside it.
     */
    label: "CHIMMY'S BRIEF",
    headline: briefHeadline,
    lines: briefLines,
    countdown:
      firstLock && firstLock.countdownTo
        ? {
            initial: firstLock.countdown,
            to: firstLock.countdownTo,
            label: firstLock.countdownLabel ?? 'FIRST KICKOFF',
          }
        : null,
    /*
     * What the brief did NOT read. Load-bearing: everything above is derived from
     * the injury feed and the fixture list, neither of which is your league. With
     * sync never having run there are no scores, no records and no lineups behind
     * any of it, and a brief that sounds this confident has to say so.
     */
    caveat: everSynced
      ? 'Built from the injury feed and the fixture list. Live scores, projections and standings are not part of it.'
      : `Built from the injury feed and the fixture list — not from your leagues. No sync has ever run against ${totalActive === 1 ? 'your league' : `any of your ${totalActive} leagues`}, so there are no scores, records or lineups behind this.`,
    askLabel: 'Ask Chimmy',
    /*
     * The second action goes to the full ranked list, which is on this same page —
     * an anchor, not a route. There is no separate briefing surface to link to and
     * the repo is at Vercel's 2,048-route ceiling, so inventing one would cost a
     * route to duplicate a section the reader is already scrolling towards.
     */
    moreHref: '#af-d2-needs',
    moreLabel: 'See every call',
  }

  return {
    firstLock,
    // 0 of 893 LeagueTeam rows carry a result. There is no record to report.
    today: null,
    next24: next24.length > 0 ? next24 : null,
    leagues: shown,
    /*
     * Every league that needs something, uncapped, plus the quiet ones — for the
     * Dashboard v2 left panel, which is a browsable list rather than a top-N
     * queue. `leagues` stays capped at LIST_LIMIT because the 34a main column
     * is a queue and a 60-row queue is an inventory. Two surfaces, two shapes,
     * one ranking.
     */
    allLeagues: [...needs, ...quietLeagues],
    quiet,
    overflow,
    totalLeagues: totalActive,
    // No *generated* brief on this path. Chimmy is the only thing that spends
    // tokens, and a home page that spends on every load would bill for a visit.
    // `chimmyBrief` below is the deterministic one and costs nothing.
    brief: null,
    chimmyBrief,
    book: bookRows.length > 0 ? bookRows : null,
    /*
     * What the prices on those rows actually are, so the card can say it
     * instead of implying a number tuned to a league it never saw.
     */
    valueBasis: valueBySleeperId.size > 0 ? { format: valueFormat, qbFormat: 'ONE_QB' as const } : null,
    legacyCount,
    weekLabel:
      nextGame && nextGameWeek != null
        ? `${nextGame.sport}${nextGameSlate === 'pre' ? ' PRE' : nextGameSlate === 'post' ? ' POST' : ''} WK ${nextGameWeek}`
        : null,
    notice: everSynced
      ? null
      : {
          title: 'No league has been read yet',
          body:
            totalActive === 1
              ? 'Your league is imported, but a sync has never run against it — so there are no scores, records or lineups behind this screen yet.'
              : `All ${totalActive} of your leagues are imported, but a sync has never run against any of them — so there are no scores, records or lineups behind this screen yet.`,
          href: '/import',
          label: 'Check your connections',
        },
    coverage: [
      { label: 'Live scores', reason: 'no weekly scoring is ingested for imported leagues' },
      { label: 'AF projections', reason: 'requires per-league scoring rules and a synced roster' },
      { label: 'Records and standings', reason: 'no league result has been read yet' },
      { label: 'Empty lineup slots', reason: 'no lineup reader for imported leagues yet' },
      /*
       * ⚠ NARROWED, BECAUSE THE OLD WORDING WAS FALSE. Completed trades ARE
       * ingested and graded every 30 minutes, and the home now renders them —
       * see lib/core-app/recentTrades. What genuinely is not read is the
       * PENDING side: an offer sitting in your inbox, and a waiver claim before
       * it processes.
       */
      { label: 'Pending trade offers and waiver claims', reason: 'only completed transactions are read' },
      { label: 'League chatter', reason: 'Discord and platform chat are not ingested' },
      /*
       * ⚠ THE MISS THAT USED TO BE INVISIBLE. When two athletes share a name
       * and neither position nor club can tell them apart, the matcher refuses
       * rather than binding one of them an injury that may be the other's. The
       * player then carries no designation here — and saying so is the whole
       * point: before this, a name that failed to match simply vanished from
       * the book, and a screen with a missing player looks exactly like a
       * screen with a healthy one.
       */
      ...(ambiguousInjuryNames.size > 0
        ? [
            {
              label: `Injury status for ${[...ambiguousInjuryNames].slice(0, 3).join(', ')}${
                ambiguousInjuryNames.size > 3 ? ` and ${ambiguousInjuryNames.size - 3} more` : ''
              }`,
              reason: 'more than one player shares that name and we will not guess which',
            },
          ]
        : []),
    ],
  }
}
