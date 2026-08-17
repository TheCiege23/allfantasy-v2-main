import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName } from './leagueHome'
import type {
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

  const [playerRows, injuryRows] = await Promise.all([
    playerIds.length
      ? prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: playerIds } },
            select: { sleeperId: true, name: true, position: true, team: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    prisma.sportsInjury
      .findMany({
        where: { sport: { in: sports } },
        orderBy: { fetchedAt: 'desc' },
        take: 4000,
        select: { playerName: true, status: true, description: true },
      })
      .catch(() => []),
  ])

  /*
   * ⚠ `sleeperId` IS NOT UNIQUE IN `SportsPlayer` — 501 distinct roster ids
   * resolved to 1,231 rows. Duplicates are near-identical records for the same
   * athlete; first wins, and the count of *players* is taken from the id set
   * rather than from the row count, which would have overstated every exposure
   * figure on this screen by roughly 2.5×.
   */
  const playerById = new Map<string, { name: string; position: string | null }>()
  for (const p of playerRows) {
    if (!p.sleeperId || playerById.has(p.sleeperId)) continue
    playerById.set(p.sleeperId, { name: p.name, position: p.position })
  }

  const injuryByName = new Map<string, { status: string; description: string | null }>()
  for (const i of injuryRows) {
    if (!i.status) continue
    const key = i.playerName.trim().toLowerCase()
    if (injuryByName.has(key)) continue
    if (HEALTHY.has(i.status.trim().toLowerCase())) continue
    injuryByName.set(key, { status: i.status, description: i.description })
  }

  /** Designation for a roster id, or null when we hold none. Never "healthy". */
  function designationOf(playerId: string): { name: string; position: string | null; status: string; description: string | null } | null {
    const p = playerById.get(playerId)
    if (!p) return null
    const inj = injuryByName.get(p.name.trim().toLowerCase())
    if (!inj) return null
    return { name: p.name, position: p.position, status: inj.status, description: inj.description }
  }

  /* ── Per-league hurt counts, and the exposure book in the same pass ─────── */

  type BookEntry = {
    name: string
    position: string | null
    status: string
    description: string | null
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
          position: d.position,
          status: d.status,
          description: d.description,
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
    .slice(0, 6)
    .map((b) => ({
      initials: initialsOf(b.name),
      name: b.name,
      note: [b.position, b.status].filter(Boolean).join(' · '),
      exposure: `${b.leagues.size} of ${totalActive}`,
      tone: isUnavailable(b.status) ? ('bad' as const) : ('warn' as const),
    }))

  /* ── Honest notices ────────────────────────────────────────────────────── */

  const everSynced = active.some((l) => Boolean(l.lastSyncedAt))

  return {
    firstLock,
    // 0 of 893 LeagueTeam rows carry a result. There is no record to report.
    today: null,
    next24: next24.length > 0 ? next24 : null,
    leagues: shown,
    quiet,
    overflow,
    totalLeagues: totalActive,
    // No brief is generated on this path. Chimmy is the only thing that spends
    // tokens, and a home page that spends on every load would bill for a visit.
    brief: null,
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
