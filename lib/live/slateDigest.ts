import { prisma } from '@/lib/prisma'
import { ingestBatch, type NotificationEvent } from '@/lib/notification-engine'
import { resolveLeagueCardTypeKey } from '@/lib/league-media/leagueTypeMedia'
import { sleeperScoreTargetWeeks } from '@/lib/sleeper/sync/sleeperScoreTargetWeeks'
import { normaliseStatus } from './rollingInsightsAdapter'
import { POINTS_CORRECTION_WINDOW_MS } from './pointsRefreshGames'
import { loadLeagueWeekState, type LeagueWeekState } from './starterSwings'

/**
 * One game-day summary per manager per NFL slate (owner's decision, 2026-10-11).
 *
 * ⚠ IT REPLACES AN ALERT ON EVERY SWING. From 2026-09-14 a manager was alerted whenever a lead
 * changed hands or win probability moved 15+ points. Measured over the following 14 days in
 * production: 1,147 alerts to 41 managers, about 28 each, 12.7% read (injury alerts: 50%). One
 * manager got 95 in one league in one day. "Lost the lead" (434) and "took the lead" (400) were
 * nearly equal — a close game pinged on every possession — and a feed that loud teaches people to
 * ignore the alerts that matter. Now: after each slate, ONE notification per manager covering
 * every Sleeper league they play, e.g. "After Sunday afternoon: ahead in 4 of 6".
 *
 * A SLATE is what the NFL schedule makes of itself: everything that kicked off in the last eight
 * hours is over. In practice that is Thursday night, Sunday morning (London), Sunday afternoon,
 * Sunday night and Monday night — the early and late afternoon windows overlap, so they close as
 * one. The last slate of the week (no NFL game in the next 48 hours) reads as the result.
 *
 * ⚠ ONCE, EVEN THOUGH IT IS ASKED EVERY TWO MINUTES. The live tick calls this on every points
 * pass. The dispatcher's unique `sourceKey` keeps the in-app row single, but it does NOT stop the
 * push — a repeated key would buzz the phone on every pass. So each user's key is checked against
 * the stored rows BEFORE anything is sent, the pattern the other once-per-window alerts use.
 *
 * ⚠ NOT THE MOMENT THE LAST GAME ENDS. Scores here are the platform's own, refreshed by the live
 * pass in rotating slices of leagues, so the summary waits until the slate's last kickoff is
 * 3.5 hours old — a typical game ends ~3h10m after kickoff — to read settled points.
 *
 * Push + in-app only, never email or SMS, like every game-day alert. Sleeper leagues only: they are
 * the only platform with live, platform-scored per-player points here.
 */

/** One provider's row for one game. Several providers write the same game; see `closedNflSlate`. */
export type SlateGame = { startTime: Date; status: string | null; updatedAt?: Date | null }

export type ClosedSlate = {
  /** Stable identity of the slate: its last kickoff, Eastern date and time. */
  key: string
  /** "Sunday afternoon", "Monday night". */
  label: string
  /** No NFL game in the next 48 hours: this slate ends the week. */
  weekComplete: boolean
}

export const SLATE_SETTLE_MS = 3.5 * 3_600_000
/** No NFL game, overtime included, runs this long; a status that never turned final cannot hold the slate. */
const GAME_SURELY_OVER_MS = 5 * 3_600_000
/** Longest gap inside an NFL week is Monday night → Thursday night (~68h); between weeks it is longer. */
const NEXT_GAME_HORIZON_MS = 48 * 3_600_000

function easternParts(d: Date): { date: string; time: string; hour: number; weekday: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}${parts.minute}`,
    hour: Number(parts.hour),
    weekday: parts.weekday,
  }
}

/** A row nobody has written since kickoff was never following the game live. */
function observedSinceKickoff(game: SlateGame): boolean {
  return game.updatedAt != null && game.updatedAt.getTime() >= game.startTime.getTime()
}

function gameIsOver(game: SlateGame, now: Date): boolean {
  if (now.getTime() - game.startTime.getTime() >= GAME_SURELY_OVER_MS) return true
  const status = normaliseStatus(game.status ?? undefined)
  return status === 'final' || /postpon|cancel|suspend|forfeit/.test(status)
}

/**
 * The slate that has just finished, or null while any game in it is still on (or the last one
 * kicked off under 3.5 hours ago, or nothing has kicked off in the last eight hours).
 */
export function closedNflSlate(games: SlateGame[], now: Date): ClosedSlate | null {
  const t = now.getTime()
  const started = games.filter((g) => {
    const k = g.startTime.getTime()
    return k <= t && t - k <= POINTS_CORRECTION_WINDOW_MS
  })
  if (started.length === 0) return null
  /*
   * ⚠ EACH GAME IS SEVERAL ROWS, AND ONE PROVIDER'S COPY NEVER MOVES. Measured 2026-10-11 in
   * production: every NFL game has rows from api_sports, espn, espn_live, rolling_insights and
   * thesportsdb, and the espn_live copy was last written days before kickoff and still reads
   * "scheduled" after the game is final. Counted, it would hold every slate open until the
   * five-hour backstop. So only rows written since kickoff — the ones actually following the game —
   * can keep a slate open. If none of them was (no live feed at all), the backstop decides alone.
   */
  const watched = started.filter(observedSinceKickoff)
  const deciding = watched.length > 0 ? watched : started
  if (!deciding.every((g) => gameIsOver(g, now))) return null
  const lastKickoff = new Date(Math.max(...started.map((g) => g.startTime.getTime())))
  if (t - lastKickoff.getTime() < SLATE_SETTLE_MS) return null

  const et = easternParts(lastKickoff)
  const part = et.hour < 12 ? 'morning' : et.hour < 19 ? 'afternoon' : 'night'
  return {
    key: `${et.date}T${et.time}`,
    label: `${et.weekday} ${part}`,
    weekComplete: !games.some((g) => {
      const k = g.startTime.getTime()
      return k > t && k - t <= NEXT_GAME_HORIZON_MS
    }),
  }
}

// ── Copy ────────────────────────────────────────────────────────────────────────────────────

export type DigestLine =
  | { kind: 'h2h'; leagueId: string; leagueName: string; you: number; opponent: number; pWin: number | null }
  | { kind: 'cut'; leagueId: string; leagueName: string; projectedFinish: number }

const pts = (n: number) => n.toFixed(1)
const pct = (p: number) => Math.round(p * 100)
const MAX_LINES = 4

function standing(you: number, opponent: number): 'ahead' | 'behind' | 'tied' {
  return you > opponent ? 'ahead' : you < opponent ? 'behind' : 'tied'
}

function h2hSentence(line: Extract<DigestLine, { kind: 'h2h' }>, final: boolean): string {
  const score = `${pts(line.you)}–${pts(line.opponent)}`
  const s = standing(line.you, line.opponent)
  if (final) return `${line.leagueName}: ${s === 'ahead' ? 'won' : s === 'behind' ? 'lost' : 'tied'} ${score}.`
  const where = s === 'ahead' ? 'up' : s === 'behind' ? 'down' : 'tied'
  return `${line.leagueName}: ${where} ${score}${line.pWin != null ? `, ${pct(line.pWin)}% to win` : ''}.`
}

/** The one notification a manager gets for a slate. Null when there is nothing to say. */
export function slateDigestCopy(
  lines: DigestLine[],
  slate: ClosedSlate,
  week: number | null,
): { title: string; body: string; actionHref: string } | null {
  if (lines.length === 0) return null
  const final = slate.weekComplete
  const h2h = lines.filter((l): l is Extract<DigestLine, { kind: 'h2h' }> => l.kind === 'h2h')
  const cuts = lines.filter((l): l is Extract<DigestLine, { kind: 'cut' }> => l.kind === 'cut')

  /* Closest games first: they are the ones still worth watching. A final reads in league order. */
  const ordered = final
    ? [...h2h].sort((a, b) => a.leagueName.localeCompare(b.leagueName))
    : [...h2h].sort((a, b) => (a.pWin == null ? 1 : Math.abs(a.pWin - 0.5)) - (b.pWin == null ? 1 : Math.abs(b.pWin - 0.5)))

  const ahead = h2h.filter((l) => standing(l.you, l.opponent) === 'ahead').length
  const behind = h2h.filter((l) => standing(l.you, l.opponent) === 'behind').length
  const weekLabel = week != null ? `Week ${week} final` : 'Final'

  let title: string
  if (h2h.length === 1 && cuts.length === 0) {
    const l = h2h[0]!
    const s = standing(l.you, l.opponent)
    title = final
      ? `${weekLabel}: you ${s === 'ahead' ? 'won' : s === 'behind' ? 'lost' : 'tied'} in ${l.leagueName}`
      : `After ${slate.label}: you ${s === 'ahead' ? 'lead' : s === 'behind' ? 'trail' : 'are tied'} in ${l.leagueName}`
  } else if (h2h.length === 0) {
    title = cuts.length === 1
      ? `After ${slate.label}: projected last in ${cuts[0]!.leagueName}`
      : `After ${slate.label}: projected last in ${cuts.length} leagues`
  } else if (final) {
    title = `${weekLabel}: won ${ahead}, lost ${behind}${h2h.length - ahead - behind > 0 ? `, tied ${h2h.length - ahead - behind}` : ''}`
  } else {
    title = `After ${slate.label}: ahead in ${ahead} of ${h2h.length}`
  }

  const sentences = [
    ...cuts.map((c) => `${c.leagueName}: projected last (${pts(c.projectedFinish)} pts) — on the chopping block.`),
    ...ordered.map((l) => h2hSentence(l, final)),
  ]
  const shown = sentences.slice(0, MAX_LINES)
  const more = sentences.length - shown.length
  const body = more > 0 ? `${shown.join(' ')} +${more} more.` : shown.join(' ')

  const only = lines.length === 1 ? lines[0]! : null
  return {
    title,
    body,
    actionHref: only ? `/core/matchup?league=${encodeURIComponent(only.leagueId)}` : '/core/live?sport=NFL',
  }
}

/** A manager's line for one league, or null when it has nothing to say. */
export function digestLineFor(input: {
  state: LeagueWeekState
  rosterId: string
  elimination: boolean
  weekComplete: boolean
  leagueId: string
  leagueName: string
}): DigestLine | null {
  const mine = input.state.rosters.get(input.rosterId)
  if (!mine || !mine.hasRows) return null
  if (input.elimination) {
    /* Guillotine weeks are settled by the chop alerts; mid-week, only the danger is worth a line. */
    if (input.weekComplete || mine.projectedFinish == null) return null
    if (!input.state.lowestProjected?.has(input.rosterId)) return null
    return { kind: 'cut', leagueId: input.leagueId, leagueName: input.leagueName, projectedFinish: mine.projectedFinish }
  }
  if (!mine.opponentRosterId) return null
  const opp = input.state.rosters.get(mine.opponentRosterId)
  if (!opp) return null
  /* 0–0 after a slate means none of either side's starters has played yet: nothing happened here. */
  if (mine.total === 0 && opp.total === 0) return null
  return {
    kind: 'h2h',
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    you: mine.total,
    opponent: opp.total,
    pWin: input.weekComplete ? null : mine.pWin,
  }
}

// ── The pass ───────────────────────────────────────────────────────────────────────────────

export function slateDigestIdempotencyKey(slate: ClosedSlate): string {
  return `slate-digest:${slate.key}`
}

/** The stored row's `sourceKey`, as NotificationDispatcher writes it for this event. */
export function slateDigestStoredKey(slate: ClosedSlate, userId: string): string {
  return `live_score_swing:${slateDigestIdempotencyKey(slate)}`.slice(0, 200) + `:${userId}`
}

export type DigestLeague = {
  id: string
  name: string | null
  platformLeagueId: string
  settings: unknown
  leagueType: string | null
  leagueVariant: string | null
  isDynasty: boolean | null
  guillotineMode: boolean | null
  teams: Array<{ externalId: string | null; claimedByUserId: string | null }>
}

export type SlateDigestDeps = {
  loadGames: (now: Date) => Promise<SlateGame[]>
  loadLeagues: (season: number) => Promise<DigestLeague[]>
  currentWeek: (platformLeagueId: string, season: number) => Promise<number | null>
  loadState: (input: { platformLeagueId: string; season: number; week: number; settings: unknown }) => Promise<LeagueWeekState | null>
  alreadySent: (storedKeys: string[]) => Promise<Set<string>>
  ingest: (events: NotificationEvent[]) => Promise<unknown>
  clock: () => number
}

const defaultDeps: SlateDigestDeps = {
  loadGames: async (now) =>
    prisma.sportsGame.findMany({
      where: {
        sport: 'NFL',
        startTime: { gte: new Date(now.getTime() - POINTS_CORRECTION_WINDOW_MS), lte: new Date(now.getTime() + NEXT_GAME_HORIZON_MS) },
      },
      select: { startTime: true, status: true, updatedAt: true },
      take: 200,
    }) as Promise<SlateGame[]>,
  loadLeagues: async (season) =>
    prisma.league.findMany({
      where: {
        platform: { equals: 'sleeper', mode: 'insensitive' },
        sport: 'NFL',
        season,
        teams: { some: { claimedByUserId: { not: null } } },
      },
      select: {
        id: true,
        name: true,
        platformLeagueId: true,
        settings: true,
        leagueType: true,
        leagueVariant: true,
        isDynasty: true,
        guillotineMode: true,
        teams: { where: { claimedByUserId: { not: null } }, select: { externalId: true, claimedByUserId: true } },
      },
    }) as unknown as Promise<DigestLeague[]>,
  currentWeek: async (platformLeagueId, season) => {
    const weeks = await sleeperScoreTargetWeeks(platformLeagueId, season)
    return weeks.length > 0 ? Math.max(...weeks) : null
  },
  loadState: loadLeagueWeekState,
  alreadySent: async (keys) => {
    if (keys.length === 0) return new Set()
    const rows = await prisma.platformNotification.findMany({
      where: { sourceKey: { in: keys } },
      select: { sourceKey: true },
    })
    return new Set(rows.map((r) => r.sourceKey).filter((k): k is string => typeof k === 'string'))
  },
  ingest: ingestBatch,
  clock: () => Date.now(),
}

const DIGEST_BUDGET_MS = 20_000

/**
 * Send the slate summary to every manager who has not had it yet. Returns how many were handed to
 * the engine. Never throws: it rides the live tick, which must never fail on a summary.
 *
 * Bounded by its own time budget, separate from the points pass. Anyone it does not reach this pass
 * is reached on the next one — the stored-key check makes that safe.
 */
export async function sendSlateDigests(
  input: { now: Date; season: number },
  overrides: Partial<SlateDigestDeps> = {},
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides }
  try {
    const slate = closedNflSlate(await deps.loadGames(input.now), input.now)
    if (!slate) return 0

    const leagues = (await deps.loadLeagues(input.season)).filter((l) => l.platformLeagueId)
    const userIds = [...new Set(leagues.flatMap((l) => l.teams.map((t) => t.claimedByUserId).filter((u): u is string => !!u)))]
    if (userIds.length === 0) return 0

    const sent = await deps.alreadySent(userIds.map((u) => slateDigestStoredKey(slate, u)))
    const pending = new Set(userIds.filter((u) => !sent.has(slateDigestStoredKey(slate, u))))
    if (pending.size === 0) return 0

    /* Only the leagues a pending manager plays, each platform league read once. */
    const needed = leagues.filter((l) => l.teams.some((t) => t.claimedByUserId && pending.has(t.claimedByUserId)))
    const deadline = deps.clock() + DIGEST_BUDGET_MS
    const states = new Map<string, { state: LeagueWeekState | null; week: number | null }>()
    let complete = true
    for (const league of needed) {
      if (states.has(league.platformLeagueId)) continue
      if (deps.clock() >= deadline) {
        complete = false
        break
      }
      const week = await deps.currentWeek(league.platformLeagueId, input.season).catch(() => null)
      const state = week == null
        ? null
        : await deps.loadState({ platformLeagueId: league.platformLeagueId, season: input.season, week, settings: league.settings }).catch(() => null)
      states.set(league.platformLeagueId, { state, week })
    }

    const batch: NotificationEvent[] = []
    for (const userId of pending) {
      const mine = needed.filter((l) => l.teams.some((t) => t.claimedByUserId === userId))
      /* A manager whose leagues were not all read this pass waits for the next one, rather than
         getting a summary that leaves a league out. */
      if (!complete && mine.some((l) => !states.has(l.platformLeagueId))) continue
      const lines: DigestLine[] = []
      const weeks = new Set<number>()
      for (const league of mine) {
        const read = states.get(league.platformLeagueId)
        if (!read?.state) continue
        const elimination =
          resolveLeagueCardTypeKey({
            leagueType: league.leagueType,
            leagueVariant: league.leagueVariant,
            settings: (league.settings ?? undefined) as Record<string, unknown> | undefined,
            isDynasty: league.isDynasty,
            guillotineMode: league.guillotineMode,
          }) === 'guillotine'
        for (const team of league.teams) {
          if (team.claimedByUserId !== userId || team.externalId == null) continue
          const line = digestLineFor({
            state: read.state,
            rosterId: String(team.externalId),
            elimination,
            weekComplete: slate.weekComplete,
            leagueId: league.id,
            leagueName: league.name ?? 'your league',
          })
          if (line) {
            lines.push(line)
            if (read.week != null) weeks.add(read.week)
          }
        }
      }
      const copy = slateDigestCopy(lines, slate, weeks.size === 1 ? [...weeks][0]! : null)
      if (!copy) continue
      batch.push({
        type: 'live_score_swing',
        title: copy.title,
        body: copy.body,
        userIds: [userId],
        leagueId: lines.length === 1 ? lines[0]!.leagueId : undefined,
        severity: 'high',
        source: 'slate-digest',
        actionHref: copy.actionHref,
        actionLabel: lines.length === 1 ? 'Matchup' : 'Live scores',
        /* Same rule as every game-day alert: never an email or a text. */
        skipChannels: { email: true, sms: true },
        meta: {
          idempotencyKey: slateDigestIdempotencyKey(slate),
          /* A newer summary replaces the older one on the phone. */
          pushTag: 'slate-digest',
          slate: slate.key,
          weekComplete: slate.weekComplete,
          leagues: lines.length,
        },
      })
    }
    if (batch.length === 0) return 0
    await deps.ingest(batch)
    return batch.length
  } catch {
    return 0
  }
}
