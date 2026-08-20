/**
 * Live game-day event detection — box-score diffing into domain events.
 *
 * Two poll snapshots go in, the events that happened between them come out. Pure
 * and synchronous so the whole state machine can be tested against replayed
 * historical games without a network, a clock, or a live Sunday.
 *
 * ⚠ BIG PLAYS ARE DETECTED WITHOUT PLAY-BY-PLAY, AND THE TRICK IS ARITHMETIC RATHER
 * THAN INFERENCE. The obvious signal, `rushing_long`, is a player's LONGEST run so
 * far: it rises once and then stays, so a 25-yard run behind an earlier 40-yarder
 * is invisible to it. That limitation is real but it is NOT the ceiling.
 *
 * If carries rise by EXACTLY ONE between polls and rushing yards jump 25, that one
 * carry WAS a 25-yard run. No play-by-play required, and no guessing. At a
 * 12-second cadence most intervals contain zero or one touch per player, so this
 * covers the large majority of big plays — including every one the longest-gain
 * signal would miss.
 *
 * When two or more attempts land in the same interval, the yards cannot be
 * attributed to a single play and the detector stays SILENT rather than
 * guessing. Real play-by-play would close that last gap; it is a narrow one.
 */

export type PlayerStatLine = {
  playerId: string
  playerName: string
  team: string | null
  stats: Record<string, number>
}

export type TeamStatLine = {
  /** Team abbreviation, e.g. "WAS". */
  team: string
  score: number | null
  stats: Record<string, number>
}

export type GameSnapshot = {
  gameId: string
  /** scheduled | in_progress | final — drives poll cadence, not detection. */
  status: string
  capturedAt: Date
  players: PlayerStatLine[]
  /** Team-level lines — the source of DST scoring and defensive events. */
  teams?: TeamStatLine[]
  redZone?: boolean
  quarter?: string | null
  /** "Preseason" | "Regular Season" | "Postseason" — verbatim from the feed. */
  seasonType?: string | null
}

export type LiveEventType =
  | 'TOUCHDOWN'
  | 'BIG_PLAY'
  | 'TURNOVER'
  | 'FIELD_GOAL'
  | 'DEFENSIVE_SCORE'
  | 'SPECIAL_TEAMS_SCORE'

export type LiveEvent = {
  gameId: string
  playerId: string
  playerName: string
  team: string | null
  type: LiveEventType
  /** The stat that moved, e.g. `rushing_touchdowns`. */
  stat: string
  delta: number
  /** New cumulative value after the change. */
  value: number
  detectedAt: Date
  /**
   * ⚠ Stable across retries — dedupe on this. Polling plus retries WILL re-emit
   * the same change, and a notification sent twice is worse than one sent late.
   */
  idempotencyKey: string
  detail: string
}

/** Counter stats where any increase is exactly one scoring event. */
const TOUCHDOWN_STATS: Record<string, { type: LiveEventType; label: string }> = {
  rushing_touchdowns: { type: 'TOUCHDOWN', label: 'rushing TD' },
  passing_touchdowns: { type: 'TOUCHDOWN', label: 'passing TD' },
  receiving_touchdowns: { type: 'TOUCHDOWN', label: 'receiving TD' },
  defense_touchdowns: { type: 'DEFENSIVE_SCORE', label: 'defensive TD' },
  interception_touchdowns: { type: 'DEFENSIVE_SCORE', label: 'pick six' },
  fumble_return_touchdowns: { type: 'DEFENSIVE_SCORE', label: 'fumble return TD' },
  kick_return_touchdowns: { type: 'SPECIAL_TEAMS_SCORE', label: 'kick return TD' },
  punt_return_touchdowns: { type: 'SPECIAL_TEAMS_SCORE', label: 'punt return TD' },
  blocked_kick_touchdowns: { type: 'SPECIAL_TEAMS_SCORE', label: 'blocked kick TD' },
  blocked_punt_touchdowns: { type: 'SPECIAL_TEAMS_SCORE', label: 'blocked punt TD' },
  field_goal_return_touchdowns: { type: 'SPECIAL_TEAMS_SCORE', label: 'FG return TD' },
}

const TURNOVER_STATS: Record<string, string> = {
  fumbles_lost: 'lost a fumble',
  passing_interceptions: 'threw an interception',
}

/**
 * Yardage stats paired with the attempt counter that makes them attributable.
 * When attempts rise by exactly one, the yardage delta IS a single play.
 */
const ATTEMPT_STATS: Record<string, { attempts: string; noun: string }> = {
  rushing_yards: { attempts: 'rushing_attempts', noun: 'rush' },
  receiving_yards: { attempts: 'receptions', noun: 'reception' },
}

/** Reverse map so the fallback can avoid double-emitting. */
const LONG_TO_ATTEMPT: Record<string, { attempts: string }> = {
  rushing_long: { attempts: 'rushing_attempts' },
  receiving_long: { attempts: 'receptions' },
}

/** Longest-gain stats — the fallback path. */
const LONG_STATS: Record<string, string> = {
  rushing_long: 'rush',
  receiving_long: 'reception',
  passing_long: 'pass',
}

export type DetectOptions = {
  /** Yards at or above which a long gain is worth an alert. */
  bigPlayYards?: number
}

function statOf(line: PlayerStatLine | undefined, key: string): number {
  const v = line?.stats?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Diff two snapshots of the same game into events.
 *
 * ⚠ NEGATIVE DELTAS ARE IGNORED, NOT EMITTED. Providers issue in-game stat
 * corrections that revise a number DOWNWARD; treating that as an event would fire
 * "touchdown!" in reverse. A correction is a data update, not a play.
 */
export function detectEvents(
  prev: GameSnapshot | null,
  next: GameSnapshot,
  opts: DetectOptions = {}
): LiveEvent[] {
  const bigPlayYards = opts.bigPlayYards ?? 20
  const events: LiveEvent[] = []

  /*
   * ⚠ NO PREVIOUS SNAPSHOT MEANS NO EVENTS — NEVER "EVERYTHING AT ONCE".
   * On first poll every counter looks like it just went from nothing to its
   * current value. Emitting from that would fire a notification for every
   * touchdown already scored, which for a game joined at half-time is a burst of
   * stale alerts. The first snapshot establishes the baseline and nothing more.
   */
  if (!prev) return events

  const prevById = new Map(prev.players.map((p) => [p.playerId, p]))

  for (const cur of next.players) {
    const before = prevById.get(cur.playerId)

    const push = (type: LiveEventType, stat: string, delta: number, value: number, detail: string) => {
      events.push({
        gameId: next.gameId,
        playerId: cur.playerId,
        playerName: cur.playerName,
        team: cur.team,
        type,
        stat,
        delta,
        value,
        detectedAt: next.capturedAt,
        // Keyed on the resulting VALUE, not the timestamp — a retry that sees the
        // same state produces the same key and dedupes cleanly.
        idempotencyKey: `${next.gameId}|${cur.playerId}|${stat}|${value}`,
        detail,
      })
    }

    // ── Scoring counters: exact, one event per increment.
    for (const [stat, meta] of Object.entries(TOUCHDOWN_STATS)) {
      const d = statOf(cur, stat) - statOf(before, stat)
      if (d > 0) {
        push(meta.type, stat, d, statOf(cur, stat),
          d === 1 ? `${cur.playerName} — ${meta.label}` : `${cur.playerName} — ${d} ${meta.label}s`)
      }
    }

    // ── Turnovers.
    for (const [stat, label] of Object.entries(TURNOVER_STATS)) {
      const d = statOf(cur, stat) - statOf(before, stat)
      if (d > 0) push('TURNOVER', stat, d, statOf(cur, stat), `${cur.playerName} ${label}`)
    }

    // ── Field goals.
    const fgDelta = statOf(cur, 'field_goals_made') - statOf(before, 'field_goals_made')
    if (fgDelta > 0) {
      push('FIELD_GOAL', 'field_goals_made', fgDelta, statOf(cur, 'field_goals_made'),
        `${cur.playerName} — field goal`)
    }

    /*
     * ── Big plays, detected TWO ways.
     *
     * ⚠ SINGLE-ATTEMPT INFERENCE IS WHAT MAKES A SECOND BIG PLAY VISIBLE, AND IT
     * IS EXACT RATHER THAN A HEURISTIC. If a player's carries rise by EXACTLY ONE
     * between polls and his rushing yards jump 25, then that one carry WAS a
     * 25-yard run — arithmetic, not inference. It works regardless of an earlier
     * 40-yarder, which is precisely the case `rushing_long` cannot see.
     *
     * At a 12-second cadence most intervals contain zero or one touch per player,
     * so this covers the large majority of big plays. When two or more attempts
     * land in one interval the yards cannot be attributed to a single play and we
     * deliberately stay silent rather than guess.
     */
    for (const [yardStat, cfg] of Object.entries(ATTEMPT_STATS)) {
      const attemptsDelta = statOf(cur, cfg.attempts) - statOf(before, cfg.attempts)
      const yardsDelta = statOf(cur, yardStat) - statOf(before, yardStat)
      if (attemptsDelta === 1 && yardsDelta >= bigPlayYards) {
        push('BIG_PLAY', yardStat, yardsDelta, statOf(cur, yardStat),
          `${cur.playerName} — ${yardsDelta} yard ${cfg.noun}`)
      }
    }

    /*
     * Longest-gain fallback. Catches a big play in an interval that contained
     * several touches (where the exact path above stays silent), at the cost of
     * only ever firing when the player's personal best INCREASES.
     *
     * ⚠ DEDUPED AGAINST THE EXACT PATH. Without the guard, one 40-yard run in a
     * single-carry interval raises both `rushing_yards` by 40 and `rushing_long`
     * to 40, emitting the same play twice.
     */
    for (const [stat, noun] of Object.entries(LONG_STATS)) {
      const wasLong = statOf(before, stat)
      const nowLong = statOf(cur, stat)
      if (nowLong <= wasLong || nowLong < bigPlayYards) continue
      const cfg = LONG_TO_ATTEMPT[stat]
      if (cfg) {
        const attemptsDelta = statOf(cur, cfg.attempts) - statOf(before, cfg.attempts)
        // Already emitted precisely by the single-attempt path.
        if (attemptsDelta === 1) continue
      }
      push('BIG_PLAY', stat, nowLong - wasLong, nowLong,
        `${cur.playerName} — ${nowLong} yard ${noun}`)
    }
  }

  return events
}

/**
 * End-to-end latency budget, from the provider's own stated SLA.
 *
 * ⚠ THE PROVIDER IS ~60s BEHIND REALITY AND THAT DOMINATES EVERYTHING WE DO.
 * Rolling Insights describes itself as a MEDIUM-LATENCY provider, targeting "live
 * data within approximately one minute of the information becoming publicly
 * available — better than some competitors but not as fast as the official feeds."
 *
 *     total user-visible lag  =  ~60s provider  +  0..pollInterval detection
 *
 * So our polling choice moves a ~60s floor by at most a few seconds. Two things
 * follow, and the second matters more than the first:
 *
 *   1. Polling faster than ~15s buys almost nothing. At 12s we add ≤12s to a 60s
 *      floor; at 30s we would add ≤30s, a 50% increase in OUR contribution but
 *      only ~25% end to end. 15s keeps our share small without hammering a feed
 *      that cannot reward it.
 *
 *   2. ⚠ THE UI MUST NOT CALL THIS "LIVE". A user watching the broadcast sees the
 *      touchdown roughly a minute before our notification arrives. Framed as a
 *      live alert, that reads as a broken product; framed as a score update, it
 *      reads as normal. The lag is the provider's, but the disappointment would be
 *      ours to own.
 */
export const PROVIDER_LATENCY_SECONDS = 60

/**
 * Poll cadence for a game, in seconds.
 *
 * ⚠ COST SCALES WITH CHANGE, NOT FREQUENCY, BECAUSE THE PROVIDER RETURNS 304 WHEN
 * NOTHING HAS MOVED — but only if the caller honours 304 and skips the parse and
 * the diff. A poller that re-parses an unchanged body every interval throws the
 * entire advantage away.
 */
export function pollIntervalSeconds(status: string): number {
  const s = status.toLowerCase()
  // 15s: our detection adds at most 15s to the provider's ~60s floor, and polling
  // faster cannot outrun data that only refreshes once a minute.
  if (s.includes('progress') || s.includes('live') || s.includes('halftime')) return 15
  if (s.includes('final') || s.includes('complete') || s.includes('closed')) return 0 // stop
  return 60 // scheduled / pre-game
}

/**
 * Cap and prioritise events before they become notifications.
 *
 * ⚠ THE CONSTRAINT IS ATTENTION, NOT THROUGHPUT. A Sunday with 13 games produces
 * hundreds of qualifying plays. An uncapped feed is indistinguishable from spam,
 * and a user who mutes notifications once has muted them permanently — so the cap
 * protects the feature's existence, not the server.
 *
 * Scoring plays outrank long gains: a touchdown always matters, a 21-yard gain
 * usually does not.
 */
const TYPE_PRIORITY: Record<LiveEventType, number> = {
  TOUCHDOWN: 0,
  DEFENSIVE_SCORE: 1,
  SPECIAL_TEAMS_SCORE: 1,
  TURNOVER: 2,
  FIELD_GOAL: 3,
  BIG_PLAY: 4,
}

export function selectNotifiable(
  events: LiveEvent[],
  opts: { rosteredPlayerIds: Set<string>; maxPerWindow: number }
): LiveEvent[] {
  return events
    // Default scope is the user's own players. League-wide is opt-in, because
    // "someone, somewhere scored" is not news to most people.
    .filter((e) => opts.rosteredPlayerIds.has(e.playerId))
    .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type])
    .slice(0, Math.max(0, opts.maxPerWindow))
}
