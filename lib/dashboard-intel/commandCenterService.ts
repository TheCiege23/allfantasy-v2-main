import 'server-only'

/**
 * commandCenterService — the dashboard's cross-league brain. ONE aggregation
 * over every intelligence layer already in the OS, per user:
 *
 *  - Decision OS      → buildLeagueHomePulse per league (watch/at-risk items)
 *  - LeagueContext    → variant + PIRATE house rules (pirate-week warnings)
 *  - Trade engine     → AF-native trades awaiting the viewer's call
 *  - Draft intel      → live/paused/upcoming drafts per league
 *  - Matchup model    → this week's win probabilities (league-scored projections)
 *  - Market values    → portfolio value + 30-day risers/fallers (FantasyCalc)
 *  - Legacy (H2H)     → all-time rivalry record vs this week's opponent
 *
 * Three outputs: an urgency-RANKED feed (every item names its engine and links
 * to the surface that renders it fully), the week-at-a-glance strip, and the
 * portfolio tracker. The whole payload caches 10 minutes per user (the
 * underlying engines have their own caches) and also feeds Chimmy's
 * portfolio grounding — so the chat, the OS, and the dashboard read from the
 * same facts. Honesty: items are counted or engine-emitted, never invented;
 * anything unavailable lands in `missing`.
 */

import { prisma } from '@/lib/prisma'
import { buildLeagueHomePulse } from '@/lib/decision-os/league-pulse'
import { getLeagueContext, type LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'
import { getMatchupCenter } from '@/lib/matchup-intel/matchupCenterService'
import { getMarketValues, playerValue, type MarketValuesPayload } from '@/lib/trade-intel/marketValueService'
import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'
import { listLeagueDrafts } from '@/lib/draft-intel/sleeperDraftIntelService'
import { listAfLeagueTrades } from '@/lib/league-trade-engine/tradeService'
import { getNflInjuries, injuryForName } from '@/lib/sports-data/playerAssetsService'

const SLEEPER = 'https://api.sleeper.app/v1'
const CACHE_PREFIX = 'command-center:v3:'
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_LEAGUES = 12

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

type WireRoster = { roster_id: number; owner_id: string | null; players?: string[] | null; starters?: string[] | null }

// ── Payload types ────────────────────────────────────────────────────────────
export type FeedSeverity = 'crit' | 'warn' | 'info' | 'ok'
export type FeedItem = {
  id: string
  leagueId: string
  leagueName: string
  severity: FeedSeverity
  score: number
  title: string
  detail: string
  /** Which intelligence layer emitted this — the OS shows its work. */
  engine: string
  href: string
}

export type WeekMatchup = {
  leagueId: string
  leagueName: string
  oppName: string
  /** Viewer's win probability (projection model) — null when unprojected. */
  winProb: number | null
  myPoints: number
  oppPoints: number
  myProjected: number | null
  oppProjected: number | null
  /** Legacy wiring: the full rivalry read vs this opponent from the H2H deep sync. */
  rivalry: {
    wins: number
    losses: number
    ties: number
    avgMargin: number
    closest: { season: string; week: number; margin: number } | null
  } | null
  pirate: boolean
}

export type PortfolioLeague = {
  leagueId: string
  leagueName: string
  mode: 'dynasty' | 'redraft'
  rosterValue: number
  playersValued: number
}
export type PortfolioMover = {
  leagueId: string
  leagueName: string
  playerId: string
  name: string
  position: string | null
  value: number
  trend30Day: number
}

export type ExposureRow = {
  playerId: string
  name: string
  position: string | null
  /** Leagues where the viewer rosters this player. */
  count: number
  leagueNames: string[]
  /** count / leagues-with-a-roster, as a % (0-100). */
  exposurePct: number
  marketValue: number | null
  /** Injury flag from Rolling Insights when the RSC token is configured. */
  injury: { status: string; note: string | null } | null
}

export type CommandCenterPayload = {
  version: 3
  fetchedAt: string
  leaguesScanned: number
  feed: FeedItem[]
  week: {
    matchups: WeekMatchup[]
    favoredCount: number
    projectedCount: number
    modelNote: string
  }
  portfolio: {
    totalValue: number
    leagues: PortfolioLeague[]
    risers: PortfolioMover[]
    fallers: PortfolioMover[]
    source: string
    note: string
  }
  exposure: {
    rows: ExposureRow[]
    rostersCounted: number
    injuriesConfigured: boolean
    note: string
  }
  engines: string[]
  missing: string[]
}

// ── Per-league gather ────────────────────────────────────────────────────────
type LeagueRow = {
  id: string
  name: string
  platformLeagueId: string
  sport: string | null
  format: string | null
  platform: string | null
  teamCount: number | null
  status: string | null
  lifecycleState: string | null
  /**
   * No model in the schema has a `draftDate` column, so this was NEVER
   * populated — the invalid select key voided the whole projection and any
   * consumer reading it got undefined. Kept in the contract (11 downstream
   * call sites depend on the field existing) but now explicitly supplied as
   * null at the boundary rather than silently absent. Sourcing a real draft
   * date means reading the draft records, which is its own change.
   */
  draftDate: Date | null
  isCommissioner: boolean
  teams: {
    id: string
    teamName: string | null
    ownerName: string | null
    isOrphan: boolean
    claimedByUserId: string | null
    platformUserId: string | null
    wins: number | null
    losses: number | null
    ties: number | null
    pointsFor: number | null
    /**
     * `faabRemaining` / `waiverPriority` were declared here to match a select
     * that could never resolve — both fields live on `Roster`, not `LeagueTeam`.
     * Dropped alongside the select. Restoring them means joining through to
     * Roster, which is the real fix for `userFaabRemaining` reading null across
     * every connected league.
     */
  }[]
}

async function buildCommandCenter(userId: string): Promise<CommandCenterPayload> {
  const missing: string[] = []
  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  const sleeperUserId = profile?.sleeperUserId ?? null

  const leaguesRaw = await prisma.league.findMany({
    where: {
      platform: 'sleeper',
      platformLeagueId: { not: '' },
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: {
      id: true,
      name: true,
      platformLeagueId: true,
      sport: true,
      /**
       * `format: true` was here, but League has NO `format` column (closest are
       * `scoring` and `isDynasty`). Prisma rejects an unknown key, which voided
       * this entire `select` — note the error reported the result as the full
       * model with "152 more" properties. Selecting real columns and deriving
       * `format` in the map below.
       */
      scoring: true,
      isDynasty: true,
      platform: true,
      /**
       * `teamCount: true` and `draftDate: true` were also invalid here.
       * League stores team count as `leagueSize` (schema:5351) — `teamCount`
       * exists on six OTHER models but not this one — and `draftDate` exists on
       * no model at all. Each invalid key alone voids the whole select, so this
       * query has never returned the projection it appears to describe.
       * `lifecycleState` (schema:5522) is real and stays.
       */
      leagueSize: true,
      status: true,
      lifecycleState: true,
      userId: true,
      teams: {
        select: {
          id: true,
          teamName: true,
          ownerName: true,
          isOrphan: true,
          claimedByUserId: true,
          platformUserId: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          /**
           * `faabRemaining` and `waiverPriority` were selected here but they do
           * NOT exist on LeagueTeam — they live on `Roster` (schema ~7127/7130).
           * Prisma validates selects at runtime, so this could not have been
           * returning FAAB; it is almost certainly why `userFaabRemaining` reads
           * null across all 62 connected leagues.
           *
           * Removed rather than papered over, because the correct fix is to join
           * through to Roster and that is a deliberate change with its own
           * verification (does every LeagueTeam have a resolvable Roster? which
           * side wins when both carry a value?). Restoring FAAB is tracked
           * separately — see the waiver-state gap in AF_PROJECTIONS_ENGINE_BRIEF.
           */
        },
      },
    },
    take: MAX_LEAGUES,
  })
  const leagues: LeagueRow[] = leaguesRaw
    .filter((l): l is typeof l & { platformLeagueId: string } => Boolean(l.platformLeagueId))
    .map((l) => ({
      ...l,
      // Derived, not stored: dynasty is an explicit flag, otherwise fall back to
      // the scoring preset. Null when neither is known — never guessed.
      format: l.isDynasty ? 'dynasty' : (l.scoring ?? null),
      // League stores this as `leagueSize`; the LeagueRow contract calls it
      // `teamCount`. Renamed at the boundary rather than in the query.
      teamCount: l.leagueSize ?? null,
      // League.name is nullable in the schema but the LeagueRow contract (and
      // its consumers) treat it as a string. Coerce once here rather than
      // making 11 call sites null-aware.
      name: l.name ?? '',
      // No `draftDate` column exists on any model — supply null explicitly so
      // the field is honestly empty rather than undefined-by-omission.
      draftDate: null,
      isCommissioner: l.userId === userId,
    }))

  const feed: FeedItem[] = []
  const weekMatchups: WeekMatchup[] = []
  const portfolioLeagues: PortfolioLeague[] = []
  const movers: PortfolioMover[] = []
  const valuesByKey = new Map<string, MarketValuesPayload>()
  // Exposure: playerId → league names where the viewer rosters him.
  const ownership = new Map<string, string[]>()
  let rostersCounted = 0

  for (const league of leagues) {
    const sid = league.platformLeagueId
    const decideHref = `/league/${league.id}?view=decide`

    const context = await withTimeout<LeagueContextEnvelope>(getLeagueContext(sid), 4000)
    if (!context) {
      missing.push(`${league.name}: league context`)
      continue
    }
    const pirate = Boolean(context.houseRules.pirate?.active)

    // ── Decision OS pulse (watch / at-risk → feed) ──
    try {
      const pulse = buildLeagueHomePulse({
        league: {
          id: league.id,
          name: league.name,
          sport: league.sport,
          format: league.format,
          platform: league.platform,
          teamCount: league.teamCount,
          status: league.status,
          lifecycleState: league.lifecycleState,
          draftDate: league.draftDate,
          isCommissioner: league.isCommissioner,
        },
        teams: league.teams,
        isCommissioner: league.isCommissioner,
      })
      if (pulse.status === 'at-risk' || pulse.status === 'watch') {
        feed.push({
          id: `pulse:${league.id}`,
          leagueId: league.id,
          leagueName: league.name,
          severity: pulse.status === 'at-risk' ? 'crit' : 'warn',
          score: pulse.status === 'at-risk' ? 65 : 50,
          title: `League Pulse: ${pulse.statusLabel}`,
          detail: pulse.headline,
          engine: 'Decision OS',
          href: decideHref,
        })
      }
    } catch {
      missing.push(`${league.name}: Decision OS pulse`)
    }

    // ── Trade engine: AF-native trades awaiting the viewer's call ──
    try {
      const candidateIds = [userId, sleeperUserId].filter((v): v is string => Boolean(v))
      const myRosterRow = await prisma.roster.findFirst({
        where: { leagueId: league.id, platformUserId: { in: candidateIds } },
        select: { id: true },
      })
      if (myRosterRow) {
        const trades = await listAfLeagueTrades(league.id, { take: 25 })
        const awaiting = trades.filter(
          (t) => t.status === 'pending' && t.receiverRosterId === myRosterRow.id,
        )
        if (awaiting.length > 0) {
          feed.push({
            id: `trades:${league.id}`,
            leagueId: league.id,
            leagueName: league.name,
            severity: 'crit',
            score: 100,
            title: `${awaiting.length} trade offer${awaiting.length === 1 ? '' : 's'} awaiting YOUR call`,
            detail: 'Open the Trade Center to review with format-correct market values attached.',
            engine: 'Trade engine + market values',
            href: `/league/${league.id}?view=trades`,
          })
        }
      }
    } catch {
      missing.push(`${league.name}: trade engine`)
    }

    // ── Draft intel: live / imminent drafts ──
    const drafts = await withTimeout(listLeagueDrafts(sid), 3500)
    for (const d of drafts ?? []) {
      if (d.status === 'drafting' || d.status === 'paused') {
        feed.push({
          id: `draft:${d.draftId}`,
          leagueId: league.id,
          leagueName: league.name,
          severity: d.status === 'drafting' ? 'crit' : 'warn',
          score: d.status === 'drafting' ? 95 : 80,
          title: d.status === 'drafting' ? 'Draft is LIVE right now' : 'Draft paused mid-stream',
          detail: 'Live Intel has the board, your needs, runs, and best-available by your format.',
          engine: 'Draft intel + LeagueContext',
          href: `/league/${league.id}?view=draft_intel`,
        })
      } else if (d.status === 'pre_draft' && d.startTime) {
        const hours = (new Date(d.startTime).getTime() - Date.now()) / 3_600_000
        if (hours > 0 && hours <= 72) {
          feed.push({
            id: `draft:${d.draftId}`,
            leagueId: league.id,
            leagueName: league.name,
            severity: hours <= 24 ? 'warn' : 'info',
            score: hours <= 24 ? 85 : 55,
            title: `Draft in ${hours <= 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`}`,
            detail: 'Prep in Live Intel — needs, market values, and run detection are pre-loaded.',
            engine: 'Draft intel',
            href: `/league/${league.id}?view=draft_intel`,
          })
        }
      }
    }

    // ── Lineup gaps (live roster feed) ──
    const rosters = await withTimeout(j<WireRoster[]>(`/league/${sid}/rosters`), 3000)
    const myRoster = sleeperUserId
      ? (rosters ?? []).find((r) => r.owner_id === sleeperUserId) ?? null
      : null
    if (myRoster) {
      const empty = (myRoster.starters ?? []).filter((s) => !s || s === '0').length
      const inSeason = ['in_season', 'active', 'playoffs'].includes(
        String(league.lifecycleState ?? league.status ?? '').toLowerCase(),
      )
      if (empty > 0 && inSeason) {
        feed.push({
          id: `lineup:${league.id}`,
          leagueId: league.id,
          leagueName: league.name,
          severity: 'crit',
          score: 90,
          title: `${empty} empty starter slot${empty === 1 ? '' : 's'}`,
          detail: 'The live roster panel shows exactly which slots are open.',
          engine: 'Live roster + LeagueContext',
          href: `/league/${league.id}?view=team`,
        })
      }
    }

    // ── Matchup model + Legacy rivalry (week strip; pirate-week warning) ──
    const center = await withTimeout(getMatchupCenter(sid), 5000)
    if (center) {
      const mine = sleeperUserId
        ? center.matchups.find((m) => m.a.ownerId === sleeperUserId || m.b.ownerId === sleeperUserId) ?? null
        : null
      if (mine) {
        const meIsA = mine.a.ownerId === sleeperUserId
        const me = meIsA ? mine.a : mine.b
        const opp = meIsA ? mine.b : mine.a
        const winProb = mine.winProbA != null ? (meIsA ? mine.winProbA : 100 - mine.winProbA) : null

        let rivalry: WeekMatchup['rivalry'] = null
        if (opp.ownerId && sleeperUserId) {
          const h2h = await withTimeout(getLeagueH2H(sid), 3500)
          const meH2H = h2h?.managers.find((m) => m.ownerId === sleeperUserId)
          const rec = meH2H?.byOpponent.find((o) => o.opponentOwnerId === opp.ownerId)
          if (rec) {
            rivalry = {
              wins: rec.wins,
              losses: rec.losses,
              ties: rec.ties,
              avgMargin: rec.avgMargin,
              closest: rec.closest,
            }
          }
        }

        weekMatchups.push({
          leagueId: league.id,
          leagueName: league.name,
          oppName: opp.teamName || opp.name,
          winProb,
          myPoints: me.actualPoints,
          oppPoints: opp.actualPoints,
          myProjected: me.projectedPoints,
          oppProjected: opp.projectedPoints,
          rivalry,
          pirate,
        })

        if (pirate && winProb != null && winProb < 45) {
          feed.push({
            id: `pirate:${league.id}`,
            leagueId: league.id,
            leagueName: league.name,
            severity: 'warn',
            score: 70,
            title: 'Pirate week: projected to LOSE a player',
            detail: `Win probability ${winProb.toFixed(0)}% — losing this matchup forfeits a player to ${opp.name}. Floor plays over ceiling.`,
            engine: 'LeagueContext (pirate) + matchup model',
            href: decideHref,
          })
        }
      }
    }

    // ── Exposure: count viewer ownership across leagues ──
    if (myRoster) {
      rostersCounted += 1
      for (const pid of myRoster.players ?? []) {
        if (!pid || pid === '0') continue
        const list = ownership.get(pid) ?? []
        list.push(league.name)
        ownership.set(pid, list)
      }
    }

    // ── Portfolio: roster market value + movers ──
    if (myRoster) {
      const vKey = `${context.variant.dynasty || context.variant.keeper}:${context.variant.superflex}:${context.teams}:${context.scoring.format}`
      let values = valuesByKey.get(vKey) ?? null
      if (!values) {
        values = await withTimeout(getMarketValues(context), 4000)
        if (values) valuesByKey.set(vKey, values)
      }
      if (values) {
        let total = 0
        let counted = 0
        for (const pid of myRoster.players ?? []) {
          const v = playerValue(values, pid)
          if (v != null) {
            total += v
            counted += 1
            const entry = values.bySleeperId[pid]
            if (entry?.trend30Day != null && entry.trend30Day !== 0) {
              movers.push({
                leagueId: league.id,
                leagueName: league.name,
                playerId: pid,
                name: entry.name,
                position: entry.position,
                value: entry.value,
                trend30Day: entry.trend30Day,
              })
            }
          }
        }
        portfolioLeagues.push({
          leagueId: league.id,
          leagueName: league.name,
          mode: values.mode,
          rosterValue: total,
          playersValued: counted,
        })
      } else {
        missing.push(`${league.name}: market values`)
      }
    }
  }

  feed.sort((a, b) => b.score - a.score)
  movers.sort((a, b) => b.trend30Day - a.trend30Day)
  const risers = movers.slice(0, 5)
  const fallers = [...movers].sort((a, b) => a.trend30Day - b.trend30Day).slice(0, 5)
  const projected = weekMatchups.filter((m) => m.winProb != null)
  const favoredCount = projected.filter((m) => (m.winProb ?? 0) > 50).length

  // ── Exposure rows: meta from the value charts already fetched; injuries
  //    from Rolling Insights when configured. Multi-owned players first. ──
  const metaFor = (pid: string) => {
    for (const v of valuesByKey.values()) {
      const e = v.bySleeperId[pid]
      if (e) return e
    }
    return null
  }
  const injuries = await withTimeout(getNflInjuries(), 2500)
  const exposureRows: ExposureRow[] = [...ownership.entries()]
    .map(([playerId, leagueNames]) => ({ playerId, leagueNames, meta: metaFor(playerId) }))
    .filter((x): x is typeof x & { meta: NonNullable<ReturnType<typeof metaFor>> } => Boolean(x.meta))
    .map(({ playerId, leagueNames, meta }) => ({
      playerId,
      name: meta.name,
      position: meta.position,
      count: leagueNames.length,
      leagueNames,
      exposurePct: rostersCounted > 0 ? Math.round((leagueNames.length / rostersCounted) * 100) : 0,
      marketValue: meta.value,
      injury:
        injuries && 'available' in injuries && injuries.available
          ? injuryForName(injuries, meta.name)
          : null,
    }))
    .sort((a, b) => b.count - a.count || (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .slice(0, 10)

  return {
    version: 3,
    fetchedAt: new Date().toISOString(),
    leaguesScanned: leagues.length,
    feed: feed.slice(0, 12),
    week: {
      matchups: weekMatchups,
      favoredCount,
      projectedCount: projected.length,
      modelNote:
        'Win probability from the projection model (σ=28 heuristic, league-scored projections) — pre-game, shown next to live points once games start.',
    },
    portfolio: {
      totalValue: portfolioLeagues.reduce((a, l) => a + l.rosterValue, 0),
      leagues: portfolioLeagues.sort((a, b) => b.rosterValue - a.rosterValue),
      risers,
      fallers,
      source: 'FantasyCalc market consensus, fetched per league in its exact format',
      note: 'Dynasty and redraft values share a scale but are format-specific — the total is an indicative portfolio number, not a tradeable one.',
    },
    exposure: {
      rows: exposureRows,
      rostersCounted,
      injuriesConfigured: Boolean(injuries?.configured),
      note:
        'Exposure = share of your rosters carrying the player. Only market-ranked players are listed. ' +
        (injuries?.configured
          ? 'Injury flags from Rolling Insights.'
          : 'Injury flags appear once the Rolling Insights token is configured.'),
    },
    engines: [
      'Decision OS (League Pulse)',
      'LeagueContext envelope (incl. pirate house rules)',
      'Trade engine',
      'Draft intel',
      'Matchup projection model',
      'Market values (FantasyCalc)',
      'Legacy H2H (rivalries)',
      'Player exposure (+ Rolling Insights injuries)',
    ],
    missing,
  }
}

/** Cached accessor (10 min per user); `force` bypasses. */
export async function getCommandCenter(
  userId: string,
  options?: { force?: boolean },
): Promise<CommandCenterPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${userId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as CommandCenterPayload)
      : null
  if (!options?.force && cachedPayload?.version === 3 && cached && cached.expiresAt > now) {
    return cachedPayload
  }
  const fresh = await buildCommandCenter(userId).catch((err) => {
    console.error('[command-center] build failed', { userId, err })
    return null
  })
  if (fresh) {
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey },
        update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
        create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) },
      })
      .catch(() => null)
    return fresh
  }
  return cachedPayload?.version === 3 ? cachedPayload : null
}
