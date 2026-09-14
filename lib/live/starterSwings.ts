import { prisma } from '@/lib/prisma'
import { ingestBatch, type NotificationEvent } from '@/lib/notification-engine'
import { computeWinProbability, type MatchupPlayer } from '@/lib/projections/winProbability'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { resolveLeagueCardTypeKey } from '@/lib/league-media/leagueTypeMedia'

/**
 * Starter swing alerts — tell a manager when a live score changed where they STAND,
 * and name the starter who changed it.
 *
 * The play alerts (`bigPlayNotifier`) say "Bijan scored". This says what that did:
 * "You took the lead in Dynasty Gridiron — Bijan +14.2 pts. Now 88.4–81.0. Win chance
 * 41% → 63%."
 *
 * User decisions, 2026-09-14:
 *   - trigger on the lead changing hands, or win probability moving 15+ points;
 *   - guillotine leagues alert on crossing the cut, in either direction;
 *   - keep the per-play alerts beside this, unchanged;
 *   - Sleeper first — it is the only platform with live, platform-scored per-player
 *     points (`refreshLiveSleeperPoints`); others follow when they have a writer.
 *
 * ⚠ POINTS ARE THE PLATFORM'S, NEVER RECOMPUTED. The before/after totals are sums of
 * `LeaguePlayerWeeklyScore` rows exactly as Sleeper scored them. Only the PROJECTION
 * half of win probability is ours, and it is the same league-rescored projection the
 * Matchup screen uses (`matchupProjections.ts`), so an alert and the screen agree.
 *
 * ⚠ THE BEFORE STATE IS TAKEN INSIDE THE SAME PASS THAT REFRESHES THE SCORES. The
 * writer rewrites every row and reports no diff, so "what changed" only exists if
 * someone reads the rows immediately before it runs. Comparing against a stored
 * snapshot from an earlier pass would alert on a swing another pass already told.
 */

export type ScoreRow = {
  playerId: string
  rosterId: number | null
  isStarter: boolean
  points: number
}

export type PairingRow = { rosterId: string; matchupId: number | null }

export type RosterState = {
  rosterId: string
  /** Sum of starters' platform points. 0 when the roster has no scoring yet. */
  total: number
  starters: Map<string, number>
  /** Sleeper writes a roster's rows only once it has real scoring. */
  hasRows: boolean
  opponentRosterId: string | null
  /** Null when either side has no rows, or any starter could not be priced. */
  pWin: number | null
  /** Points so far plus each starter's remaining projection. Null when any starter is unpriced. */
  projectedFinish: number | null
}

export type LeagueWeekState = {
  rosters: Map<string, RosterState>
  /**
   * Rosters currently projected to finish last (ties included). Null when the league
   * cannot be ranked — a roster with no rows or an unpriced starter — because ranking
   * the priced teams above the unpriced ones is an artefact of coverage, not of play.
   */
  lowestProjected: Set<string> | null
}

export const ODDS_SWING_THRESHOLD = 0.15

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildLeagueWeekState(input: {
  rows: ScoreRow[]
  pairing: PairingRow[]
  projectionByPlayer: Map<string, number>
}): LeagueWeekState {
  const startersByRoster = new Map<string, Map<string, number>>()
  for (const row of input.rows) {
    if (!row.isStarter || row.rosterId == null) continue
    const key = String(row.rosterId)
    const map = startersByRoster.get(key) ?? new Map<string, number>()
    map.set(row.playerId, row.points)
    startersByRoster.set(key, map)
  }

  const matchupOf = new Map(input.pairing.map((p) => [String(p.rosterId), p.matchupId]))

  const priced = (starters: Map<string, number>): MatchupPlayer[] =>
    [...starters].map(([playerId, points]) => ({
      playerId,
      projectedPoints: input.projectionByPlayer.get(playerId) ?? null,
      actualPoints: points,
      /*
       * Nothing marks one player's game as over, so every starter is treated as still
       * to play. A starter who finished under projection then carries phantom
       * remaining variance — the model's own "safe direction" (see
       * `loadSideProjections`): more uncertainty, never false certainty.
       */
      isFinal: false,
    }))

  const rosters = new Map<string, RosterState>()
  for (const { rosterId: rawId, matchupId } of input.pairing) {
    const rosterId = String(rawId)
    const starters = startersByRoster.get(rosterId) ?? new Map<string, number>()
    const hasRows = startersByRoster.has(rosterId)
    const total = round2([...starters.values()].reduce((sum, p) => sum + p, 0))

    const opponents = matchupId == null
      ? []
      : input.pairing.filter((p) => String(p.rosterId) !== rosterId && p.matchupId === matchupId)
    const opponentRosterId = opponents.length === 1 ? String(opponents[0]!.rosterId) : null

    let projectedFinish: number | null = null
    if (hasRows) {
      let remaining = 0
      let unpriced = false
      for (const [playerId, points] of starters) {
        const proj = input.projectionByPlayer.get(playerId)
        if (proj == null) {
          unpriced = true
          break
        }
        remaining += Math.max(0, proj - points)
      }
      projectedFinish = unpriced ? null : round2(total + remaining)
    }

    let pWin: number | null = null
    const opponentStarters = opponentRosterId ? startersByRoster.get(opponentRosterId) : undefined
    if (hasRows && opponentStarters && matchupOf.get(rosterId) != null) {
      const result = computeWinProbability(
        { teamId: rosterId, starters: priced(starters) },
        { teamId: opponentRosterId!, starters: priced(opponentStarters) },
      )
      pWin = result.available ? result.pWin : null
    }

    rosters.set(rosterId, { rosterId, total, starters, hasRows, opponentRosterId, pWin, projectedFinish })
  }

  let lowestProjected: Set<string> | null = null
  const finishes = [...rosters.values()].map((r) => r.projectedFinish)
  if (finishes.length >= 2 && finishes.every((f): f is number => f != null)) {
    const min = Math.min(...finishes)
    lowestProjected = new Set([...rosters.values()].filter((r) => r.projectedFinish === min).map((r) => r.rosterId))
  }

  return { rosters, lowestProjected }
}

export type SwingKind = 'took_lead' | 'lost_lead' | 'fell_to_cut' | 'escaped_cut' | 'odds_up' | 'odds_down'

const KIND_PRIORITY: SwingKind[] = ['took_lead', 'lost_lead', 'fell_to_cut', 'escaped_cut', 'odds_up', 'odds_down']

export type StarterSwing = {
  rosterId: string
  opponentRosterId: string | null
  kinds: SwingKind[]
  primary: SwingKind
  you: { before: number; after: number }
  opponent: { before: number; after: number } | null
  pWin: { before: number; after: number } | null
  projectedFinish: { before: number | null; after: number | null }
  /** The starter whose points moved it. Null when nobody on the relevant side gained. */
  mover: { playerId: string; rosterId: string; delta: number; isYours: boolean } | null
}

function biggestGain(
  before: Map<string, number> | undefined,
  after: Map<string, number> | undefined,
): { playerId: string; delta: number } | null {
  if (!after) return null
  let best: { playerId: string; delta: number } | null = null
  for (const [playerId, points] of after) {
    const delta = round2(points - (before?.get(playerId) ?? 0))
    if (delta > 0 && (!best || delta > best.delta)) best = { playerId, delta }
  }
  return best
}

export function detectStarterSwings(
  before: LeagueWeekState,
  after: LeagueWeekState,
  opts: { elimination: boolean; oddsThreshold?: number },
): StarterSwing[] {
  const threshold = opts.oddsThreshold ?? ODDS_SWING_THRESHOLD
  const swings: StarterSwing[] = []

  for (const a of after.rosters.values()) {
    const b = before.rosters.get(a.rosterId)
    if (!b) continue
    const kinds: SwingKind[] = []
    let opponent: StarterSwing['opponent'] = null
    let pWin: StarterSwing['pWin'] = null

    if (!opts.elimination && a.opponentRosterId && a.opponentRosterId === b.opponentRosterId) {
      const ao = after.rosters.get(a.opponentRosterId)
      const bo = before.rosters.get(a.opponentRosterId)
      if (ao && bo) {
        opponent = { before: bo.total, after: ao.total }
        /*
         * STRICTLY behind to strictly ahead. From a tie — including 0–0 at kickoff —
         * the first score is not a lead "changing hands", and alerting on it would
         * fire for every matchup in the league on the first touchdown of the day.
         */
        if (b.total < bo.total && a.total > ao.total) kinds.push('took_lead')
        else if (b.total > bo.total && a.total < ao.total) kinds.push('lost_lead')
      }
      if (a.pWin != null && b.pWin != null) {
        pWin = { before: b.pWin, after: a.pWin }
        const d = a.pWin - b.pWin
        if (d >= threshold - 1e-9) kinds.push('odds_up')
        else if (d <= -threshold + 1e-9) kinds.push('odds_down')
      }
    }

    if (opts.elimination && before.lowestProjected && after.lowestProjected) {
      const wasLow = before.lowestProjected.has(a.rosterId)
      const isLow = after.lowestProjected.has(a.rosterId)
      if (!wasLow && isLow) kinds.push('fell_to_cut')
      else if (wasLow && !isLow) kinds.push('escaped_cut')
    }

    if (kinds.length === 0) continue
    const primary = KIND_PRIORITY.find((k) => kinds.includes(k))!

    let mover: StarterSwing['mover'] = null
    if (primary === 'took_lead' || primary === 'odds_up' || primary === 'escaped_cut') {
      const g = biggestGain(b.starters, a.starters)
      if (g) mover = { ...g, rosterId: a.rosterId, isYours: true }
    } else if ((primary === 'lost_lead' || primary === 'odds_down') && a.opponentRosterId) {
      const g = biggestGain(before.rosters.get(a.opponentRosterId)?.starters, after.rosters.get(a.opponentRosterId)?.starters)
      if (g) mover = { ...g, rosterId: a.opponentRosterId, isYours: false }
    } else if (primary === 'fell_to_cut' && before.lowestProjected) {
      /* You fell because someone climbed past you: the biggest gainer among the teams
         that were at the bottom and no longer are. */
      for (const id of before.lowestProjected) {
        if (id === a.rosterId || after.lowestProjected?.has(id)) continue
        const g = biggestGain(before.rosters.get(id)?.starters, after.rosters.get(id)?.starters)
        if (g && (!mover || g.delta > mover.delta)) mover = { ...g, rosterId: id, isYours: false }
      }
    }

    swings.push({
      rosterId: a.rosterId,
      opponentRosterId: a.opponentRosterId,
      kinds,
      primary,
      you: { before: b.total, after: a.total },
      opponent,
      pWin,
      projectedFinish: { before: b.projectedFinish, after: a.projectedFinish },
      mover,
    })
  }

  return swings
}

const pct = (p: number) => Math.round(p * 100)
const pts = (n: number) => n.toFixed(1)

export function swingCopy(
  swing: StarterSwing,
  names: { leagueName: string; moverName: string | null },
): { title: string; body: string; severity: NotificationEvent['severity'] } {
  const league = names.leagueName
  const title = {
    took_lead: `You took the lead in ${league}`,
    lost_lead: `You lost the lead in ${league}`,
    fell_to_cut: `You're projected last in ${league}`,
    escaped_cut: `You're out of last place in ${league}`,
    odds_up: `Your win chances jumped in ${league}`,
    odds_down: `Your win chances dropped in ${league}`,
  }[swing.primary]

  const parts: string[] = []
  if (swing.mover) {
    const who = names.moverName ?? 'A starter'
    parts.push(`${swing.mover.isYours ? who : `Their ${who}`} +${pts(swing.mover.delta)} pts.`)
  }
  if (swing.opponent) parts.push(`Now ${pts(swing.you.after)}–${pts(swing.opponent.after)}.`)
  if (swing.pWin) parts.push(`Win chance ${pct(swing.pWin.before)}% → ${pct(swing.pWin.after)}%.`)
  if ((swing.primary === 'fell_to_cut' || swing.primary === 'escaped_cut') && swing.projectedFinish.after != null) {
    parts.push(`Projected to finish with ${pts(swing.projectedFinish.after)}.`)
  }

  const severity: NotificationEvent['severity'] =
    swing.primary === 'odds_up' || swing.primary === 'odds_down' ? 'medium' : 'high'
  return { title, body: parts.join(' '), severity }
}

/** The rows a swing is measured against. Read immediately BEFORE the points writer runs. */
export async function snapshotLeagueWeekScores(
  platformLeagueId: string,
  season: number,
  week: number,
): Promise<ScoreRow[]> {
  return prisma.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: platformLeagueId, seasonYear: season, week },
    select: { playerId: true, rosterId: true, isStarter: true, points: true },
  })
}

/**
 * Compare a league-week before and after a points refresh, and alert the managers
 * whose standing swung. Returns how many notifications were handed to the engine.
 *
 * Never throws: this rides the live-points pass, and a missed alert must never cost a
 * score update.
 */
export async function notifyStarterSwingsForLeagueWeek(
  input: { platformLeagueId: string; season: number; week: number; beforeRows: ScoreRow[] },
  deps: { ingest?: (events: NotificationEvent[]) => Promise<unknown> } = {},
): Promise<number> {
  try {
    const { platformLeagueId, season, week } = input
    const leagues = await prisma.league.findMany({
      where: { platform: { equals: 'sleeper', mode: 'insensitive' }, platformLeagueId, season },
      select: {
        id: true,
        name: true,
        settings: true,
        leagueType: true,
        leagueVariant: true,
        isDynasty: true,
        guillotineMode: true,
        teams: { select: { externalId: true, claimedByUserId: true } },
      },
    })
    if (leagues.length === 0) return 0

    const [afterRows, pairing] = await Promise.all([
      snapshotLeagueWeekScores(platformLeagueId, season, week),
      prisma.weeklyMatchup.findMany({
        where: { leagueId: platformLeagueId, seasonYear: season, week },
        select: { rosterId: true, matchupId: true },
      }),
    ])
    if (pairing.length < 2) return 0

    const starterIds = [...new Set(
      [...input.beforeRows, ...afterRows].filter((r) => r.isStarter).map((r) => r.playerId),
    )]
    const scoring = extractScoringSettings(leagues[0]!.settings)
    const projectionByPlayer = new Map<string, number>()
    if (scoring && starterIds.length > 0) {
      const projections = await prisma.fantasyProjection.findMany({
        // AF mirror rows carry no component stat line to rescore — same filter as the Matchup screen.
        where: { playerId: { in: starterIds }, season: String(season), week, source: { not: 'allfantasy' } },
        select: { playerId: true, stats: true },
      })
      for (const p of projections) {
        if (projectionByPlayer.has(p.playerId)) continue
        const s = (p.stats ?? {}) as Record<string, unknown>
        const scored = computeLeagueProjectedPoints((s.stats ?? null) as Record<string, unknown> | null, scoring)
        if (scored) projectionByPlayer.set(p.playerId, scored.points)
      }
    }

    const first = leagues[0]!
    /* The same rule the Core rail uses to decide a league has no head-to-head. */
    const elimination =
      resolveLeagueCardTypeKey({
        leagueType: first.leagueType,
        leagueVariant: first.leagueVariant,
        settings: (first.settings ?? undefined) as Record<string, unknown> | undefined,
        isDynasty: first.isDynasty,
        guillotineMode: first.guillotineMode,
      }) === 'guillotine'

    const before = buildLeagueWeekState({ rows: input.beforeRows, pairing, projectionByPlayer })
    const after = buildLeagueWeekState({ rows: afterRows, pairing, projectionByPlayer })
    const swings = detectStarterSwings(before, after, { elimination })
    if (swings.length === 0) return 0

    const moverIds = [...new Set(swings.flatMap((s) => (s.mover ? [s.mover.playerId] : [])))]
    const players = moverIds.length
      ? await prisma.sportsPlayer.findMany({
          where: { sleeperId: { in: moverIds } },
          select: { sleeperId: true, name: true },
        })
      : []
    const nameBySleeperId = new Map<string, string>()
    for (const p of players) {
      if (p.sleeperId && p.name && !nameBySleeperId.has(p.sleeperId)) nameBySleeperId.set(p.sleeperId, p.name)
    }

    const batch: NotificationEvent[] = []
    for (const swing of swings) {
      const figures = swing.opponent
        ? `${swing.you.after.toFixed(2)}-${swing.opponent.after.toFixed(2)}`
        : `${swing.projectedFinish.after?.toFixed(2) ?? 'x'}`
      /*
       * Built from the league-week, the roster, what swung and the scores it swung to —
       * so two overlapping passes that see the same refresh produce the same key and
       * the engine delivers once, while a later, different swing is its own alert.
       */
      const idempotencyKey = `swing:${platformLeagueId}:${season}:${week}:${swing.rosterId}:${swing.kinds.join('+')}:${figures}`

      /* One import per manager: every mirror of this league whose team is this roster. */
      for (const league of leagues) {
        const userIds = [...new Set(
          league.teams
            .filter((t) => String(t.externalId) === swing.rosterId && t.claimedByUserId)
            .map((t) => t.claimedByUserId as string),
        )]
        if (userIds.length === 0) continue
        const copy = swingCopy(swing, {
          leagueName: league.name ?? 'your league',
          moverName: swing.mover ? nameBySleeperId.get(swing.mover.playerId) ?? null : null,
        })
        batch.push({
          type: 'live_score_swing',
          title: copy.title,
          body: copy.body,
          userIds,
          leagueId: league.id,
          severity: copy.severity,
          source: 'starter-swings',
          actionHref: `/core/matchup?league=${encodeURIComponent(league.id)}`,
          actionLabel: 'Matchup',
          /* Same rule as the play alerts: a Sunday of swings is never an email or a text. */
          skipChannels: { email: true, sms: true },
          meta: {
            idempotencyKey,
            /*
             * One device notification per matchup per week: a newer swing REPLACES the
             * older one on the phone, because "you lost the lead" is stale the moment
             * "you took it back" arrives. (Play alerts tag per play for the opposite
             * reason — two touchdowns are two things that happened.)
             */
            pushTag: `starter-swing:${platformLeagueId}:${season}:${week}:${swing.rosterId}`,
            platformLeagueId,
            season,
            week,
            rosterId: swing.rosterId,
            kinds: swing.kinds,
            primary: swing.primary,
            you: swing.you,
            opponent: swing.opponent,
            pWin: swing.pWin,
            projectedFinish: swing.projectedFinish,
            mover: swing.mover,
          },
        })
      }
    }
    if (batch.length === 0) return 0

    await (deps.ingest ?? ingestBatch)(batch)
    return batch.length
  } catch {
    return 0
  }
}
