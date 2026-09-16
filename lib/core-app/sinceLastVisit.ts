import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { asIds, isResolvableId, rosterCandidates } from './dash3aPanels'
import { listPlayerFollows } from '@/lib/follows/playerFollows'
import { handoffFor } from './platformLinks'
import type { RecentTrade } from './recentTrades'
import type { SourceScreen } from '@/lib/league-links/sourceLinkResolver'

/**
 * "Since your last visit" — what changed in your leagues while you were away.
 *
 * User decisions, 2026-09-14: trades, injury changes on your rosters, alerts you
 * missed, and results/standings moves; one card at the top of the Core home;
 * "since your last Core visit", capped at 7 days.
 *
 * ⚠ `League.lastViewedAt` IS NOT A LAST VISIT. Measured on production the day this
 * was written: 2 of 292 leagues had ever recorded one, and it is stamped on a league
 * row that claimed teammates share. The visit here is PER USER, kept in
 * `SportsDataCache` the same way the morning briefing keeps what it sent — no
 * migration.
 *
 * ⚠ TWO OF THE FOUR SECTIONS ARE ONLY HONEST AS A COMPARISON WITH A SNAPSHOT.
 *   - `SportsInjury` is one row per player per source, overwritten on every import;
 *     `updatedAt` moves for a player who has been Active all month. A status CHANGE
 *     is not in the table, so each visit stores the statuses it saw and the next
 *     visit compares.
 *   - Standings keep no history either — `LeagueTeam` holds the current rank and
 *     record only — so the same snapshot carries them.
 * On a first visit there is nothing to compare, and the card says so rather than
 * claiming nothing changed.
 *
 * ⚠ A VISIT IS A SESSION, NOT A RENDER. Reloading the home seconds after it rendered
 * would otherwise move "since" to seconds ago and wipe the brief. Renders less than
 * SESSION_GAP_MS apart keep the same window and the same baseline.
 */

export const VISIT_KEY_PREFIX = 'core-visit:v1:'
export const SESSION_GAP_MS = 30 * 60_000
export const MAX_WINDOW_MS = 7 * 24 * 60 * 60_000
const MARKER_TTL_MS = 60 * 24 * 60 * 60_000
/** Bounds the injury lookup on a very large portfolio; a brief is not an exhaustive report. */
const MAX_INJURY_PLAYERS = 250
const MAX_ALERT_ROWS = 300

export type StandingSnap = { rank: number | null; wins: number; losses: number; ties: number }

export type VisitSnapshot = {
  takenAt: string
  /** By `League.id`, for your claimed team. */
  standings: Record<string, StandingSnap>
  /**
   * By Sleeper player id. Only players with a NON-STALE injury fact are stored; the
   * value is the status, or null for "no designation stated". A player without a
   * fresh fact is absent, never "healthy" — absent is not compared.
   */
  injuries: Record<string, string | null>
}

export type VisitMarker = {
  version: 1
  lastSeenAt: string
  sinceAt: string
  firstVisit: boolean
  /** The snapshot this session's brief compares against. */
  baseline: VisitSnapshot | null
  /** The state as this session last saw it — the next session's baseline. */
  latest: VisitSnapshot | null
  /**
   * 🛑 THE TRADE LINE HAS ITS OWN BOUNDARY, BECAUSE ONLY IT CAN BE READ BLIND.
   *
   * Standings and injuries are snapshot diffs: this render read them, so `latest` is true and
   * the next visit can compare against it. The trade line is not — it is handed an array from
   * `getRecentTrades`, and that read RESOLVES while missing trades (its grade cache falls back
   * to `[]`, each league's live scan catches its own failure, a scan can answer for one of
   * three weeks). An empty array means "nothing traded" or "we were blind", and only the
   * caller knows which.
   *
   * Holding the WHOLE marker back on a blind trade read was the first attempt, and it is worse
   * than the bug: the marker also carries `latest`, so one flaky league would freeze the
   * standings and injury baselines too — and a new user whose very first render had one league
   * fail would sit at `comparisonPending` forever. With a Sleeper-shaped failure rate that is
   * the common case, not the rare one.
   *
   * So this advances only when the trades read could stand behind what it returned. Absent on
   * a marker written before this existed, which falls back to `lastSeenAt` — exactly the old
   * behaviour, and the reason nothing needs migrating.
   */
  tradesSeenAt?: string
}

export type VisitWindow = {
  sinceAt: Date
  firstVisit: boolean
  /** True when the real last visit is older than MAX_WINDOW_MS, so the window was cut. */
  windowCapped: boolean
  baseline: VisitSnapshot | null
  /**
   * Where the TRADE line measures from — never later than `sinceAt`, and never past the floor.
   * It sits further back exactly as long as the trades read keeps coming back partial.
   */
  tradesSinceAt: Date
}

/**
 * The trade boundary for this window: the last point a trades read could stand behind, floored
 * at MAX_WINDOW_MS and never later than the visit window itself. `min` is the whole point — a
 * run of blind reads must not let the boundary drift forward past trades nobody has been shown.
 */
function tradeBoundary(marker: VisitMarker, sinceAt: Date, floor: Date): Date {
  const seen = marker.tradesSeenAt ? new Date(marker.tradesSeenAt) : null
  if (!seen || !Number.isFinite(seen.getTime())) return sinceAt
  return new Date(Math.max(floor.getTime(), Math.min(sinceAt.getTime(), seen.getTime())))
}

export function resolveVisitWindow(marker: VisitMarker | null, now: Date): VisitWindow {
  const floor = new Date(now.getTime() - MAX_WINDOW_MS)
  if (!marker) return { sinceAt: floor, firstVisit: true, windowCapped: true, baseline: null, tradesSinceAt: floor }

  const last = new Date(marker.lastSeenAt)
  const lastMs = last.getTime()
  if (Number.isFinite(lastMs) && now.getTime() >= lastMs && now.getTime() - lastMs < SESSION_GAP_MS) {
    const since = new Date(marker.sinceAt)
    const sinceOk = Number.isFinite(since.getTime()) && since.getTime() >= floor.getTime()
    const sinceAt = sinceOk ? since : floor
    return {
      sinceAt,
      firstVisit: marker.firstVisit,
      windowCapped: !sinceOk || marker.firstVisit,
      baseline: marker.baseline,
      tradesSinceAt: tradeBoundary(marker, sinceAt, floor),
    }
  }

  const capped = !Number.isFinite(lastMs) || lastMs < floor.getTime()
  const sinceAt = capped ? floor : last
  return {
    sinceAt,
    firstVisit: false,
    windowCapped: capped,
    baseline: marker.latest,
    tradesSinceAt: tradeBoundary(marker, sinceAt, floor),
  }
}

export function nextVisitMarker(
  window: VisitWindow,
  current: VisitSnapshot,
  now: Date,
  /** False when the trades read rejected or reported itself partial — see `tradesSeenAt`. */
  tradesComplete = true,
): VisitMarker {
  return {
    version: 1,
    lastSeenAt: now.toISOString(),
    sinceAt: window.sinceAt.toISOString(),
    firstVisit: window.firstVisit,
    baseline: window.baseline,
    latest: current,
    tradesSeenAt: (tradesComplete ? now : window.tradesSinceAt).toISOString(),
  }
}

function isMarker(value: unknown): value is VisitMarker {
  const v = value as Partial<VisitMarker> | null
  return Boolean(v && v.version === 1 && typeof v.lastSeenAt === 'string' && typeof v.sinceAt === 'string')
}

// ── Sections ───────────────────────────────────────────────────────────────────

/** "Open in <platform>" for a brief line — a verified provider destination (2026-09-14). */
export type BriefHandoff = { href: string; label: string; screen: string }

export type BriefTrade = {
  leagueId: string
  leagueName: string
  acceptedAt: string
  summary: string
  /** Present only when that league's trade screen (or league page) is a verified destination. */
  handoff?: BriefHandoff
}

export type BriefInjury = {
  playerId: string
  name: string
  position: string | null
  from: string | null
  to: string | null
  leagues: string[]
  /** The same leagues by id, when known — a one-league injury links to that lineup. */
  leagueIds?: string[]
  /** Present only for a one-league injury with a verified destination. */
  handoff?: BriefHandoff
  /**
   * You follow him (2026-09-14). Omitted, not false, when you do not — so a brief with no
   * follows is exactly the brief built before follows existed. `leagues` is empty when he is
   * on none of your rosters.
   */
  followed?: true
}

export type BriefStanding = {
  leagueId: string
  leagueName: string
  wins: number
  losses: number
  ties: number
  won: number
  lost: number
  tied: number
  rank: number | null
  previousRank: number | null
}

export type BriefAlertGroup = { type: string; label: string; count: number; latestTitle: string }

export type SinceLastVisitBrief = {
  sinceAt: string
  firstVisit: boolean
  windowCapped: boolean
  trades: { items: BriefTrade[]; atLeast: boolean }
  injuries: BriefInjury[]
  standings: BriefStanding[]
  alerts: { total: number; groups: BriefAlertGroup[] }
  /** Injury and standings changes need a previous snapshot; this visit had none. */
  comparisonPending: boolean
}

function sideText(side: RecentTrade['sides'][number]): string {
  const who = side.teamName || side.managerName
  const got = side.received.slice(0, 2).map((a) => a.name)
  const more = side.received.length > 2 ? ` +${side.received.length - 2}` : ''
  return got.length ? `${who} got ${got.join(', ')}${more}` : `${who} got nothing we can name`
}

/**
 * Trades that landed after `since`, from the list the home already loaded.
 *
 * ⚠ THAT LIST IS CAPPED. `getRecentTrades` returns only the newest `limit`, so when
 * every trade it returned is new there may be more — `atLeast` makes the card say
 * "3+" rather than a count it cannot stand behind.
 */
export function tradesSince(trades: RecentTrade[], since: Date, limit: number): { items: BriefTrade[]; atLeast: boolean } {
  const items = trades
    .filter((t) => new Date(t.acceptedAt).getTime() > since.getTime())
    .map((t) => ({
      leagueId: t.leagueId,
      leagueName: t.leagueName,
      acceptedAt: t.acceptedAt,
      summary: t.sides.map(sideText).join('; '),
    }))
  return { items, atLeast: trades.length >= limit && items.length === trades.length && items.length > 0 }
}

export function diffInjuries(
  baseline: VisitSnapshot | null,
  current: VisitSnapshot,
  meta: Map<string, { name: string; position: string | null; leagues: string[]; leagueIds?: string[]; followed?: boolean }>,
): BriefInjury[] {
  if (!baseline) return []
  const out: BriefInjury[] = []
  for (const [playerId, to] of Object.entries(current.injuries)) {
    if (!(playerId in baseline.injuries)) continue
    const from = baseline.injuries[playerId] ?? null
    if (from === to) continue
    const m = meta.get(playerId)
    if (!m) continue
    out.push({
      playerId,
      name: m.name,
      position: m.position,
      from,
      to,
      leagues: m.leagues,
      // Carried only when known, so a caller without ids gets exactly the old shape.
      ...(m.leagueIds ? { leagueIds: m.leagueIds } : {}),
      ...(m.followed ? { followed: true as const } : {}),
    })
  }
  return out.sort((a, b) => b.leagues.length - a.leagues.length || a.name.localeCompare(b.name))
}

export function diffStandings(
  baseline: VisitSnapshot | null,
  current: VisitSnapshot,
  leagueNames: Map<string, string>,
): BriefStanding[] {
  if (!baseline) return []
  const out: BriefStanding[] = []
  for (const [leagueId, now] of Object.entries(current.standings)) {
    const was = baseline.standings[leagueId]
    if (!was) continue
    const won = now.wins - was.wins
    const lost = now.losses - was.losses
    const tied = now.ties - was.ties
    /* A record that went DOWN is a season rollover or a re-import, not a result. */
    if (won < 0 || lost < 0 || tied < 0) continue
    const rankMoved = now.rank != null && was.rank != null && now.rank !== was.rank
    if (won === 0 && lost === 0 && tied === 0 && !rankMoved) continue
    out.push({
      leagueId,
      leagueName: leagueNames.get(leagueId) ?? 'Your league',
      wins: now.wins,
      losses: now.losses,
      ties: now.ties,
      won,
      lost,
      tied,
      rank: now.rank,
      previousRank: was.rank,
    })
  }
  return out
}

const ALERT_LABELS: Record<string, string> = {
  chimmy_alert: 'Chimmy alerts',
  player_injury_update: 'injury updates',
  player_news_update: 'player news',
  live_score_swing: 'live game alerts',
  injury_update: 'injury updates',
  breaking_news: 'breaking news',
  trade_proposed: 'trade offers',
  trade_accepted: 'accepted trades',
  trade_rejected: 'rejected trades',
  trade_countered: 'trade counters',
  waiver_processed: 'waiver results',
  waiver_claim: 'waiver claims',
  draft_pick: 'draft picks',
  draft_starting: 'drafts starting',
  lineup_lock: 'lineup locks',
  commissioner_action: 'commissioner actions',
}

export function groupAlerts(rows: Array<{ type: string; title: string; createdAt: Date }>): { total: number; groups: BriefAlertGroup[] } {
  const byType = new Map<string, { count: number; latest: { title: string; at: number } }>()
  for (const r of rows) {
    const at = new Date(r.createdAt).getTime()
    const g = byType.get(r.type)
    if (!g) byType.set(r.type, { count: 1, latest: { title: r.title, at } })
    else {
      g.count += 1
      if (at > g.latest.at) g.latest = { title: r.title, at }
    }
  }
  const groups = [...byType.entries()]
    .map(([type, g]) => ({
      type,
      label: ALERT_LABELS[type] ?? type.replace(/_/g, ' '),
      count: g.count,
      latestTitle: g.latest.title,
    }))
    .sort((a, b) => b.count - a.count)
  return { total: rows.length, groups }
}

// ── Loader ─────────────────────────────────────────────────────────────────────

async function readMarker(userId: string): Promise<VisitMarker | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${VISIT_KEY_PREFIX}${userId}` }, select: { data: true } })
    .catch(() => null)
  return isMarker(row?.data) ? (row!.data as unknown as VisitMarker) : null
}

async function writeMarker(userId: string, marker: VisitMarker, now: Date): Promise<void> {
  const data = marker as unknown as object
  const expiresAt = new Date(now.getTime() + MARKER_TTL_MS)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: `${VISIT_KEY_PREFIX}${userId}` },
      update: { data, expiresAt },
      create: { cacheKey: `${VISIT_KEY_PREFIX}${userId}`, data, expiresAt },
    })
    .catch(() => undefined)
}

async function snapshotStandings(userId: string, leagueIds: string[]): Promise<Record<string, StandingSnap>> {
  if (leagueIds.length === 0) return {}
  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: { in: leagueIds }, claimedByUserId: userId },
      select: { leagueId: true, currentRank: true, wins: true, losses: true, ties: true },
    })
    .catch(() => [])
  const out: Record<string, StandingSnap> = {}
  /* One claimed team per league; a duplicate would make any diff meaningless, so the league is dropped. */
  const dupes = new Set<string>()
  for (const t of teams) {
    if (out[t.leagueId]) dupes.add(t.leagueId)
    out[t.leagueId] = { rank: t.currentRank ?? null, wins: t.wins, losses: t.losses, ties: t.ties }
  }
  for (const id of dupes) delete out[id]
  return out
}

async function snapshotInjuries(
  userId: string,
  leagues: Array<{ id: string; name: string | null; sport?: string | null }>,
  now: Date,
): Promise<{
  injuries: Record<string, string | null>
  meta: Map<string, { name: string; position: string | null; leagues: string[]; leagueIds: string[]; followed?: boolean }>
  /** The user's own team id per league (LeagueTeam.externalId), for provider lineup links. */
  teamIdByLeague: Map<string, string>
}> {
  const empty = { injuries: {}, meta: new Map(), teamIdByLeague: new Map<string, string>() }
  /* Injury feeds cover the NFL; another sport's empty result would read as "nobody is hurt". */
  const nfl = leagues.filter((l) => String(l.sport ?? 'NFL').toUpperCase() === 'NFL')
  const nameById = new Map(nfl.map((l) => [l.id, l.name ?? 'Your league']))

  /*
   * Players you follow join the lookup (2026-09-14), rostered or not. NFL follows with a
   * Sleeper id only — the snapshot is keyed by Sleeper id. A failed or unavailable follow
   * read (the migration not applied) is simply no follows; the roster brief is unchanged.
   */
  const [teams, follows] = await Promise.all([
    nfl.length > 0
      ? prisma.leagueTeam
          .findMany({
            where: { leagueId: { in: nfl.map((l) => l.id) }, claimedByUserId: userId },
            select: { leagueId: true, platformUserId: true, externalId: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    listPlayerFollows(userId).catch(() => null),
  ])
  const followedIds = new Set(
    (follows ?? [])
      .filter((f) => f.sport === 'NFL' && f.sleeperId && isResolvableId(f.sleeperId))
      .map((f) => f.sleeperId as string),
  )
  if (teams.length === 0 && followedIds.size === 0) return empty

  /* One claimed team per league; a league with two is ambiguous, so it gets no team-specific link. */
  const teamIdByLeague = new Map<string, string>()
  const twoTeams = new Set<string>()
  for (const t of teams) {
    if (teamIdByLeague.has(t.leagueId)) twoTeams.add(t.leagueId)
    if (t.externalId) teamIdByLeague.set(t.leagueId, String(t.externalId))
  }
  for (const id of twoTeams) teamIdByLeague.delete(id)

  const rosters =
    teams.length > 0
      ? await prisma.roster
          .findMany({
            where: {
              OR: teams.map((t) => ({ leagueId: t.leagueId, platformUserId: { in: rosterCandidates(t, userId) } })),
            },
            select: { leagueId: true, playerData: true },
          })
          .catch(() => [])
      : []

  const leaguesByPlayer = new Map<string, Set<string>>()
  /* The same leagues by id, so a one-league injury can link to that league's lineup. */
  const leagueIdsByPlayer = new Map<string, Set<string>>()
  const seenLeague = new Set<string>()
  for (const r of rosters) {
    if (seenLeague.has(r.leagueId)) continue
    seenLeague.add(r.leagueId)
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    for (const id of [...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)]) {
      if (!isResolvableId(id)) continue
      const set = leaguesByPlayer.get(id) ?? new Set<string>()
      set.add(nameById.get(r.leagueId) ?? 'Your league')
      leaguesByPlayer.set(id, set)
      const leagueSet = leagueIdsByPlayer.get(id) ?? new Set<string>()
      leagueSet.add(r.leagueId)
      leagueIdsByPlayer.set(id, leagueSet)
    }
  }
  /* Rostered players first, then followed-only ones, under the same bound. */
  const ids = [
    ...leaguesByPlayer.keys(),
    ...[...followedIds].filter((id) => !leaguesByPlayer.has(id)),
  ].slice(0, MAX_INJURY_PLAYERS)
  if (ids.length === 0) return empty

  const players = await prisma.sportsPlayer
    .findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, name: true, position: true, team: true } })
    .catch(() => [])
  const playerById = new Map<string, { name: string; position: string | null; team: string | null }>()
  for (const p of players) {
    if (p.sleeperId && p.name && !playerById.has(p.sleeperId)) {
      playerById.set(p.sleeperId, { name: p.name, position: p.position ?? null, team: p.team ?? null })
    }
  }
  if (playerById.size === 0) return empty

  const resolution = await resolveInjuryFacts({
    sport: 'NFL',
    players: [...playerById.values()].map((p) => ({ name: p.name, position: p.position, team: p.team })),
    now,
  }).catch(() => null)
  if (!resolution || !resolution.coverage.sourceAvailable || resolution.feedStale) return empty

  const injuries: Record<string, string | null> = {}
  const meta = new Map<string, { name: string; position: string | null; leagues: string[]; leagueIds: string[]; followed?: boolean }>()
  for (const [id, p] of playerById) {
    const fact = resolution.byPlayer.get(normalizeMatchName(p.name))
    /* No fact, or a stale one, is "we cannot say" — never stored, so never compared. */
    if (!fact || fact.stale) continue
    injuries[id] = fact.status ?? null
    meta.set(id, {
      name: p.name,
      position: p.position,
      leagues: [...(leaguesByPlayer.get(id) ?? [])],
      leagueIds: [...(leagueIdsByPlayer.get(id) ?? [])],
      ...(followedIds.has(id) ? { followed: true } : {}),
    })
  }
  return { injuries, meta, teamIdByLeague }
}

/** A league as the brief needs it to build a provider link. */
export type BriefLeagueLink = {
  id: string
  name: string | null
  platform?: string | null
  platformLeagueId?: string | null
  season?: number | string | null
}

/**
 * One tap from a brief line to the provider screen that acts on it (user decision
 * 2026-09-14).
 *
 * - A trade → that league's trade screen, else its verified league page.
 * - An injury on ONE of your leagues → your lineup there, else that league's page.
 * - An injury across several leagues gets no single button: which lineup to open is the
 *   user's call, and a button naming one league would quietly hide the others.
 *
 * Verified destinations only (platformLinks.handoffFor), so MFL / Fantrax / Fleaflicker
 * lines keep just their in-app link. The key is OMITTED, not null, when there is no link,
 * so a brief with nothing to hand off is exactly the brief built before this existed.
 */
export function attachBriefHandoffs(
  brief: SinceLastVisitBrief,
  leagues: BriefLeagueLink[],
  teamIdByLeague: Map<string, string>,
): SinceLastVisitBrief {
  const byId = new Map(leagues.map((l) => [l.id, l]))
  const linkFor = (leagueId: string, screen: SourceScreen): BriefHandoff | null => {
    const l = byId.get(leagueId)
    if (!l) return null
    const link = handoffFor(
      {
        id: l.id,
        name: l.name,
        platform: l.platform,
        platformLeagueId: l.platformLeagueId ?? null,
        season: l.season ?? null,
        teamId: teamIdByLeague.get(l.id) ?? null,
      },
      screen,
    )
    return link ? { href: link.href, label: link.label, screen: link.screen } : null
  }
  return {
    ...brief,
    trades: {
      ...brief.trades,
      items: brief.trades.items.map((t) => {
        const handoff = linkFor(t.leagueId, 'trade')
        return handoff ? { ...t, handoff } : t
      }),
    },
    injuries: brief.injuries.map((i) => {
      const handoff = i.leagueIds?.length === 1 ? linkFor(i.leagueIds[0], 'lineup') : null
      return handoff ? { ...i, handoff } : i
    }),
  }
}

export async function getSinceLastVisit(args: {
  userId: string
  /** platform + platformLeagueId + season build the brief's provider handoff links. */
  leagues: Array<BriefLeagueLink & { sport?: string | null }>
  recentTrades: RecentTrade[]
  /** The `limit` the home passed to `getRecentTrades`. */
  tradesLimit: number
  now: Date
  /** False for a prefetch or any speculative render: read the brief, never move the visit. */
  recordVisit: boolean
  /**
   * False when `recentTrades` is not the whole picture — the read rejected, or reported itself
   * partial. The visit still moves; only the TRADE boundary is held, so the trades this read
   * could not see are still there to report next time. See `tradesSeenAt`.
   */
  tradesComplete: boolean
}): Promise<SinceLastVisitBrief | null> {
  const { userId, leagues, now } = args
  const marker = await readMarker(userId)
  const window = resolveVisitWindow(marker, now)

  const leagueIds = leagues.map((l) => l.id)
  const [standings, injurySnap, alertRows] = await Promise.all([
    snapshotStandings(userId, leagueIds),
    snapshotInjuries(userId, leagues, now),
    prisma.platformNotification
      .findMany({
        where: { userId, readAt: null, createdAt: { gt: window.sinceAt } },
        select: { type: true, title: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_ALERT_ROWS,
      })
      .catch(() => [] as Array<{ type: string; title: string; createdAt: Date }>),
  ])

  const current: VisitSnapshot = { takenAt: now.toISOString(), standings, injuries: injurySnap.injuries }
  if (args.recordVisit) await writeMarker(userId, nextVisitMarker(window, current, now, args.tradesComplete), now)

  const leagueNames = new Map(leagues.map((l) => [l.id, l.name ?? 'Your league']))
  const brief: SinceLastVisitBrief = {
    sinceAt: window.sinceAt.toISOString(),
    firstVisit: window.firstVisit,
    windowCapped: window.windowCapped,
    // Its OWN boundary, which sits further back than `sinceAt` while the trades read is blind.
    trades: tradesSince(args.recentTrades, window.tradesSinceAt, args.tradesLimit),
    injuries: diffInjuries(window.baseline, current, injurySnap.meta),
    standings: diffStandings(window.baseline, current, leagueNames),
    alerts: groupAlerts(alertRows),
    comparisonPending: window.baseline == null,
  }

  const somethingChanged =
    brief.trades.items.length > 0 || brief.injuries.length > 0 || brief.standings.length > 0 || brief.alerts.total > 0
  return somethingChanged ? attachBriefHandoffs(brief, leagues, injurySnap.teamIdByLeague) : null
}
