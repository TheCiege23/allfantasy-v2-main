import 'server-only'

import { prisma } from '@/lib/prisma'
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
   * "NFL WK 2", for the shell's top bar. Taken from the next scheduled game in a
   * sport you play — the only place a week number is actually recorded. Null when
   * no schedule is ingested for your sports, because a guessed week is worse than
   * none: every deadline on this product hangs off it.
   */
  weekLabel: string | null
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
function imageOf(row: Dash34LeagueRow): string | null {
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
     * countdown target.
     */
    prisma.sportsGame
      .findMany({
        where: { sport: { in: sports }, startTime: { gte: now } },
        orderBy: { startTime: 'asc' },
        take: 40,
        select: { sport: true, startTime: true, week: true, season: true, homeTeam: true, awayTeam: true },
      })
      .catch(() => []),
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

  /** leagueId → { all players, starters } from that roster. */
  const rosterByLeague = new Map<string, { all: string[]; starters: Set<string> }>()
  const everyPlayerId = new Set<string>()
  for (const r of rosters) {
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    const starters = asIds(pd.starters)
    const all = [...new Set([...asIds(pd.players), ...starters, ...asIds(pd.reserve), ...asIds(pd.taxi)])]
    // First roster wins — a league should only produce one for a given user, and
    // overwriting on a duplicate would silently pick an arbitrary one.
    if (!rosterByLeague.has(r.leagueId)) {
      rosterByLeague.set(r.leagueId, { all, starters: new Set(starters) })
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
    prisma.sportsInjury
      .findMany({
        where: { sport: { in: sports } },
        orderBy: { fetchedAt: 'desc' },
        take: 4000,
        /*
         * ⚠ `date` IS THE REPORT'S OWN TIMESTAMP; `fetchedAt` IS WHEN WE POLLED.
         * The card says "reported 30 min ago", which is a claim about the report,
         * so it reads `date` and shows nothing when `date` is null rather than
         * silently substituting the poll time — those are two different facts and
         * only one of them answers "is this news".
         */
        select: { playerName: true, status: true, description: true, date: true },
      })
      .catch(() => []),
    /*
     * Next kickoff per NFL club, for "when does this player actually play".
     *
     * Read unconditionally when an NFL league is in play rather than after the
     * book is built, so it stays inside this one Promise.all instead of adding a
     * serial round-trip to the home page's critical path. 200 rows is roughly
     * eight days of fixtures — production carries the same game from two sources
     * (one row with `week`, one without), so the raw count overstates the number
     * of distinct games by about half and the map takes first-seen per club.
     */
    sports.includes('NFL')
      ? prisma.sportsGame
          .findMany({
            where: { sport: 'NFL', startTime: { gte: now } },
            orderBy: { startTime: 'asc' },
            take: 200,
            select: { startTime: true, homeTeam: true, awayTeam: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
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

  const injuryByName = new Map<
    string,
    { status: string; description: string | null; reportedAt: Date | null }
  >()
  for (const i of injuryRows) {
    if (!i.status) continue
    const key = i.playerName.trim().toLowerCase()
    if (injuryByName.has(key)) continue
    if (HEALTHY.has(i.status.trim().toLowerCase())) continue
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
    const inj = injuryByName.get(p.name.trim().toLowerCase())
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
    startingIn: number
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

      const key = d.name.trim().toLowerCase()
      const entry = book.get(key)
      if (entry) {
        entry.leagues.add(leagueId)
        if (isStarter) entry.startingIn++
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
          startingIn: isStarter ? 1 : 0,
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
          nextGame.week != null ? `Week ${nextGame.week}` : null,
          nextGame.startTime.toUTCString().slice(0, 22) + ' UTC',
        ]
          .filter(Boolean)
          .join(' · '),
        headline: `${nextGame.awayTeam} at ${nextGame.homeTeam}`,
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
  const bookRows = [...book.values()]
    .sort((a, b) => {
      const au = isUnavailable(a.status)
      const bu = isUnavailable(b.status)
      if (au !== bu) return au ? -1 : 1
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
                }
              : null
          })
          .filter((x): x is { id: string; name: string; platform: string; imageUrl: string | null } => x !== null)
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
    legacyCount,
    weekLabel:
      nextGame?.week != null ? `${nextGame.sport} WK ${nextGame.week}` : null,
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
      { label: 'Trade offers and waiver claims', reason: 'pending transactions are not ingested' },
      { label: 'League chatter', reason: 'Discord and platform chat are not ingested' },
    ],
  }
}
