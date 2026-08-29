import 'server-only'

import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { getTeamInfo } from '@/lib/team-abbrev'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveCurrentWeekFrom, isScored, type WeekScoreRow } from './currentWeek'
import { leagueDisplayName } from './leagueHome'
import { myRosterCandidates } from './myRoster'
import { latestProjectionWeek, lookupProjections } from './playerProjections'

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
  opponentAvatarUrl: string | null
  opponentInitials: string
  /** Signed, from your side. Positive means you are ahead. */
  margin: number
  basis: PulseBasis
  season: number
  week: number
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
  href: string
}

export type MatchupPulse = {
  leading: PulseRow[]
  trailing: PulseRow[]
  /** Leagues that carry a head-to-head this week, ranked or not. */
  considered: number
  ranked: number
  /** What the ranked rows are measured in. Null when nothing ranked. */
  basis: PulseBasis | 'mixed' | null
  /** Why the rest are absent. Stated on the screen, never silently dropped. */
  notRanked: {
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
  }
}

/**
 * Next REGULAR-SEASON kickoff per NFL club.
 *
 * ⚠ `seasonType: 'regular'` IS LOAD-BEARING, NOT A TIDY-UP. Read without it on
 * 2026-08-29 the next 200 future fixtures were ALL preseason — four near-
 * duplicate rows per game, one per source — so no regular-season club ever
 * entered the map, every lineup failed to place, and "left to play" came back
 * 0 for all 37 leagues. Zero is the one answer that must never be guessed here:
 * it says a manager's week is over before it has started. Preseason is also the
 * wrong measure on its own terms — nobody's lineup scores an exhibition game.
 *
 * A local, cached copy rather than an import from `dash34.ts`: that module is
 * 1,700 lines behind a different loader's cache key, and reaching into it for
 * fifteen lines would couple this screen's freshness to the home page's.
 */
const readNflFixturesCached = unstable_cache(
  async () => {
    const rows = await prisma.sportsGame
      .findMany({
        where: { sport: 'NFL', seasonType: 'regular', startTime: { gte: new Date() } },
        orderBy: { startTime: 'asc' },
        take: 200,
        select: { startTime: true, homeTeam: true, awayTeam: true },
      })
      .catch(() => [])
    return rows.map((g) => ({ ...g, startTime: g.startTime ? g.startTime.toISOString() : null }))
  },
  ['core-matchup-pulse-nfl-regular-fixtures'],
  { revalidate: 60 },
)

/**
 * Club (long name, lowercased) → its next kickoff.
 *
 * ⚠ KEYED ON THE LONG FORM. `SportsGame` stores "Atlanta Falcons" while the
 * projection feed stores "ATL", so the lookup runs the short form through
 * `getTeamInfo` first. Club codes are not unique across sports, which is why
 * this map is only ever consulted for an NFL league.
 */
async function nextKickoffByClub(now: Date): Promise<Map<string, Date>> {
  const rows = await readNflFixturesCached().catch(() => [])
  const out = new Map<string, Date>()
  for (const g of rows) {
    if (!g.startTime) continue
    const at = new Date(g.startTime)
    if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime()) continue
    for (const club of [g.homeTeam, g.awayTeam]) {
      const key = club?.trim().toLowerCase()
      if (!key || out.has(key)) continue
      out.set(key, at)
    }
  }
  return out
}

/** Sleeper writes an unfilled starting slot as "0". It is a hole, not a player. */
const EMPTY_SLOT = '0'

function startersOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object') return []
  const s = (playerData as Record<string, unknown>).starters
  return Array.isArray(s)
    ? s.map((x) => (x == null ? '' : String(x))).filter((x) => x !== '' && x !== EMPTY_SLOT)
    : []
}

const EMPTY_PULSE: MatchupPulse = {
  leading: [],
  trailing: [],
  considered: 0,
  ranked: 0,
  basis: null,
  notRanked: { noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0 },
}

export async function getMatchupPulse(
  userId: string,
  now: Date = new Date(),
): Promise<MatchupPulse> {
  /* ── 1. Every team this user has claimed, with its league. ─────────────── */
  const claimed = await prisma.leagueTeam
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
            settings: true,
          },
        },
      },
    })
    .catch(() => [])

  const mine = claimed.filter(
    (c) => c.league?.platformLeagueId && Number.isFinite(Number(c.externalId)),
  )
  if (mine.length === 0) return EMPTY_PULSE

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
    .catch(() => [])

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
    const resolved = resolveCurrentWeekFrom(rows)
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
        .catch(() => [])
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
    opponentAvatarUrl: string | null
    opponentInitials: string
    scoringSettings: Record<string, unknown> | null
  }

  const pending: Pending[] = []
  const notRanked = { noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0 }

  for (const c of mine) {
    const l = c.league!
    const plid = l.platformLeagueId as string
    const resolved = weekByPlid.get(plid)
    const weekRows = rowsByPlid.get(plid)
    if (!resolved || !weekRows || weekRows.length === 0) {
      notRanked.noSchedule++
      continue
    }

    const myRosterId = Number(c.externalId)
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
    const opponentName = oppTeam?.teamName?.trim() || oppTeam?.ownerName?.trim() || null
    const leagueName = leagueDisplayName(l.name)
    const platform = String(l.platform ?? 'manual').toLowerCase()

    pending.push({
      leagueId: l.id,
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
       */
      theirRosterKeys: [oppTeam?.platformUserId, String(oppRow.rosterId)].filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      ),
      opponentName,
      opponentAvatarUrl: asImageUrl(oppTeam?.avatarUrl, platform),
      opponentInitials: initialsOf(opponentName ?? `Roster ${oppRow.rosterId}`),
      scoringSettings: extractScoringSettings(l.settings),
    })
  }

  if (pending.length === 0) {
    return { ...EMPTY_PULSE, considered: mine.length, notRanked }
  }

  /* ── 4. Lineups for both sides of every unscored pairing. ──────────────── */
  const needProjection = pending.filter((p) => !p.scored)
  const rosterKeys = [
    ...new Set(needProjection.flatMap((p) => [...p.yourRosterKeys, ...p.theirRosterKeys])),
  ]

  const rosters = rosterKeys.length
    ? await prisma.roster
        .findMany({
          where: { leagueId: { in: leagueIds }, platformUserId: { in: rosterKeys } },
          select: { leagueId: true, platformUserId: true, playerData: true },
        })
        .catch(() => [])
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

  /* ── 5. One projection read for every starter on the board. ────────────── */
  const everyStarter = [
    ...new Set(
      needProjection.flatMap((p) => [
        ...startersFor(p.leagueId, p.yourRosterKeys),
        ...startersFor(p.leagueId, p.theirRosterKeys),
      ]),
    ),
  ]
  const projectionWeek = everyStarter.length ? await latestProjectionWeek() : null
  const projections = everyStarter.length
    ? await lookupProjections(everyStarter, projectionWeek).catch(() => new Map())
    : new Map()

  /* ── 6. Fixtures, only if an NFL league is on the board. ───────────────── */
  const anyNfl = pending.some((p) => String(p.sport ?? 'NFL').toUpperCase() === 'NFL')
  const kickoffs = anyNfl ? await nextKickoffByClub(now) : new Map<string, Date>()

  /**
   * Price one lineup under the league's own rules.
   *
   * ⚠ FALLS BACK TO THE VENDOR TOTAL RATHER THAN DROPPING THE PLAYER, and says
   * how many it priced. A total missing a starter reads LOW, and low is the
   * direction that makes someone believe they are losing when they are not —
   * which is the single claim this whole screen makes.
   */
  function price(ids: string[], scoring: Record<string, unknown> | null) {
    let total = 0
    let from = 0
    let yetToPlay = 0
    /*
     * Starters we actually placed against a fixture.
     *
     * ⚠ WITHOUT THIS, "NOBODY LEFT TO PLAY" AND "WE COULD NOT CHECK" ARE THE
     * SAME VALUE. `yetToPlay` alone cannot tell them apart — both come out 0 —
     * and the caller was resolving that ambiguity by suppressing the count
     * whenever it hit zero, which throws away the true zero along with the
     * unknown. On Monday night "0 left to play" is the most useful thing this
     * row can say, and it was the one thing it could not say.
     */
    let placed = 0
    for (const id of ids) {
      const p = projections.get(id)
      if (!p) continue
      const league =
        scoring && p.componentStats ? computeLeagueProjectedPoints(p.componentStats, scoring) : null
      const v = league?.points ?? p.projectedPoints
      if (v != null) {
        total += v
        from += 1
      }
      /*
       * ⚠ COUNTED ONLY WHEN A FIXTURE WAS ACTUALLY FOUND. An earlier cut counted
       * "the club code parsed" instead, which made an empty fixture map look
       * like a lineup that had finished playing.
       */
      const info = getTeamInfo(p.team)
      if (!info) continue
      const at = kickoffs.get(info.fullName.trim().toLowerCase())
      if (!at) continue
      placed += 1
      if (at.getTime() > now.getTime()) yetToPlay += 1
    }
    return { total, from, of: ids.length, yetToPlay, placed }
  }

  const ranked: PulseRow[] = []

  for (const p of pending) {
    const yourIds = startersFor(p.leagueId, p.yourRosterKeys)
    const theirIds = startersFor(p.leagueId, p.theirRosterKeys)
    const you = p.scored ? null : price(yourIds, p.scoringSettings)
    const them = p.scored ? null : price(theirIds, p.scoringSettings)

    let margin: number
    let basis: PulseBasis
    let coverage: PulseRow['coverage'] = null

    if (p.scored) {
      margin = p.yourPoints - p.theirPoints
      basis = 'scored'
    } else if (!you || !them || you.from === 0 || them.from === 0) {
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

    /*
     * Only stated when a real fixture placed at least one starter. A league
     * whose lineup we could not join to the regular-season schedule at all gets
     * null — see the field note on `startersLeft`.
     *
     * ⚠ THE GATE IS `placed`, NOT `yetToPlay`. Gating on `yetToPlay > 0` reads
     * as the same rule and is not: it also suppresses a lineup that HAS been
     * placed and has genuinely finished, so "0 left to play" — the whole of
     * Sunday evening — rendered as though we had never looked. That is the
     * exact "null is not zero" confusion this field's own doc warns about,
     * running in the opposite direction.
     */
    const startersLeft =
      String(p.sport ?? 'NFL').toUpperCase() === 'NFL' && you && you.placed > 0
        ? you.yetToPlay
        : null

    ranked.push({
      leagueId: p.leagueId,
      leagueName: p.leagueName,
      platform: p.platform,
      logoUrl: p.logoUrl,
      leagueBadge: p.leagueBadge,
      opponentName: p.opponentName,
      opponentAvatarUrl: p.opponentAvatarUrl,
      opponentInitials: p.opponentInitials,
      margin: Math.round(margin * 10) / 10,
      basis,
      season: p.season,
      week: p.week,
      startersLeft,
      coverage,
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
   * Level is neither leading nor trailing, and the design has no column for it.
   * A 0.0 row goes to `trailing` only if it would otherwise vanish — it does
   * not, so exact ties are simply excluded from both lists and still counted in
   * `ranked`, which is what the header renders.
   */
  const leading = deduped
    .filter((r) => r.margin > 0)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 5)
  const trailing = deduped
    .filter((r) => r.margin < 0)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 5)

  const bases = new Set(ranked.map((r) => r.basis))

  return {
    leading,
    trailing,
    considered: mine.length,
    ranked: ranked.length,
    basis: bases.size === 0 ? null : bases.size > 1 ? 'mixed' : [...bases][0],
    notRanked,
  }
}
