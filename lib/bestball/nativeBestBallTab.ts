/**
 * The Best Ball tab's lineup cards for a league AllFantasy hosts, built from what native scoring stores.
 *
 * 🛑 THE TAB READ TABLES NATIVE SCORING NEVER WRITES. `/api/leagues/:id/bestball` listed weeks from
 * `teamWeekResult` and lineups from `weeklyScore`, which only the legacy weekly processor fills. Native
 * best ball scoring (`scoreRosterBestBall`, lib/redraft/scoringEngine.ts) writes the started lineup into
 * `RedraftMatchup.lineupSnapshots.redraftScoring.{home,away}.bestBall` and per-player points into
 * `league_player_weekly_scores`. So for every league we host the tab showed nothing — the one screen
 * meant to show members how the automatic lineup works.
 *
 * Pure: the handler loads rows, this shapes them. Every sentence a member reads about why a player did or
 * did not count is decided here, so it is testable without a database.
 */
import { frozenBestBallPositions, frozenBestBallSlots, readBestBallRuleStamp } from '@/lib/bestball/resultRuleStamp'

type SnapshotAssignment = { slot: string; seat?: number; playerId: string; playerName?: string | null; points: number }

/** Daily best ball: one player's points summed across the days he was in the counted lineup. */
type SnapshotDailyCounted = { playerId: string; playerName?: string | null; points: number; days: number }

type SnapshotSide = {
  points?: number
  allFinal?: boolean
  missingPlayerIds?: string[]
  bestBall?: {
    assignments?: SnapshotAssignment[]
    unfilledSlots?: Array<{ slot: string; seat?: number }>
    /** `daily` for a daily best ball league (lib/bestball/dailyBestBall.ts); absent for weekly. */
    period?: 'daily'
    counted?: SnapshotDailyCounted[]
  }
}

type WeekRosterPlayer = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  /** This week's slot: `ir`, `taxi`, `devy` and `reserve` never count in best ball. */
  slotType: string | null
}

/** `count`: how many seats of this slot; present when known (the stored stamp, `buildBestBallSlots`). */
type SlotEligibility = { slot: string; eligible: readonly string[]; count?: number }

type LineupStatus = 'final' | 'provisional'

export type NativeLineupCard = {
  rosterId: string
  teamName: string
  totalPoints: number
  /** `daily` when each day's best lineup was summed; absent for weekly best ball (one weekly lineup). */
  scoringPeriod?: 'daily'
  status: LineupStatus
  /** Head-to-head result once the week is final; null while provisional or with no opponent. */
  winLoss: string | null
  /** Daily: `slot` is how many days he counted ("3 days"), `points` his counted points summed over them. */
  /**
   * `position` is the position the player was SEATED AND SCORED at: for a sealed week with stored
   * positions, the stored one. `positionNow` is set only when his current position differs from it.
   */
  starters: Array<{ playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number; slot: string; days?: number }>
  bench: Array<{ playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number | null; reason: string }>
  unfilledSlots: string[]
  /** Players whose stats have not arrived yet; the total can still move. */
  awaitingStats: number
  /**
   * Set when this week was SEALED on seats that differ from the league's current ones (a commissioner
   * changed the roster seats after it was scored): which seats it was scored on. Absent otherwise.
   */
  sealedSeatsNote?: string
}

/** "QB, 2 WR, FLEX" — the seats a lineup is scored on, in their stored order. */
function describeSeats(slots: readonly SlotEligibility[]): string {
  return slots
    .filter((s) => (s.count ?? 1) > 0)
    .map((s) => ((s.count ?? 1) > 1 ? `${s.count} ${s.slot}` : s.slot))
    .join(', ')
}

/**
 * What makes two seat lists the same for scoring: each seat's name, count and eligible positions.
 *
 * ⚠ ORDER IS LEFT OUT ON PURPOSE (both the array order and `slotOrder`), because it cannot change a best
 * ball result. `computeOptimalLineup` (lib/lineup-optimizer/optimalLineup.ts) sorts seats by
 * `slotOrder` then name before matching, and the players it keeps are the greedy basis of a transversal
 * matroid taken in points-then-playerId order: whether a player can be added depends only on WHICH seats
 * exist, never on their order. So the counted players and the total are identical for any seat order;
 * at most the seat label a dual-eligible starter is reported under can differ, and the card reads that
 * label from the stored snapshot, not from a re-run. Pinned in
 * __tests__/bestball/best-ball-tab-sealed-positions.test.tsx. A note for an order-only difference would
 * tell members "the seats changed" when nothing about their score did.
 */
const seatKey = (slots: readonly SlotEligibility[]) =>
  slots
    .filter((s) => (s.count ?? 1) > 0)
    .map((s) => `${s.slot}:${s.count ?? 1}:${[...s.eligible].map((e) => e.toUpperCase()).sort().join('/')}`)
    .sort()
    .join('|')

/**
 * The seats a week's lineup card is read against.
 *
 * 🛑 A SEALED WEEK IS SCORED ON ITS STORED SEATS, SO ITS CARD MUST BE READ ON THEM TOO. Scoring freezes a
 * final week's slots in `lineupSnapshots.redraftScoring.bestBallRules` (lib/bestball/resultRuleStamp.ts),
 * but the tab read every week against the league's CURRENT seats. After a commissioner dropped a FLEX
 * seat, a sealed week's FLEX starter matched no current slot, and a benched RB was told "No lineup slot
 * takes a RB" — false for the week he was benched in. A week sealed under a stamp now uses the stamp's
 * slots; a legacy-stamped or unstamped week keeps the current seats, exactly as before (its original
 * seats are unknown, which is also why scoring does not freeze it).
 */
export function lineupSlotsForWeek(
  lineupSnapshots: unknown,
  currentSlots: readonly SlotEligibility[],
): { slots: SlotEligibility[]; sealedSeatsNote?: string } {
  const frozen = frozenBestBallSlots(readBestBallRuleStamp(lineupSnapshots))
  if (!frozen) return { slots: [...currentSlots] }
  const slots: SlotEligibility[] = frozen.map((s) => ({ slot: s.slot, eligible: [...s.eligible], count: s.count }))
  if (seatKey(slots) === seatKey(currentSlots)) return { slots }
  return {
    slots,
    sealedSeatsNote: `Scored on the seats this week was sealed with (${describeSeats(slots)}); the league's seats have changed since.`,
  }
}

/**
 * The positions a week's lineup card is read at: the ones stored when the week was sealed, else null
 * (every player at his current position).
 *
 * 🛑 A SEALED WEEK SEATS AND SCORES ITS PLAYERS AT THE POSITIONS STORED AT THE SEAL
 * (`bestBallRules.sealedPositions`, lib/bestball/resultRuleStamp.ts; `bestBallPositionOf` in
 * lib/redraft/scoringEngine.ts). The tab read today's position, so an RB re-listed as a WR after the
 * week was sealed was told "No lineup slot takes a WR" for a week he was seated and scored as an RB.
 * Same rule as scoring: a player IN the map is at the stored position (a stored null is no position); a
 * player absent from it (no stat row at the seal) is at his current one. An open, legacy or unstamped
 * week, or a stamp sealed before positions were recorded, has none.
 */
export function lineupPositionsForWeek(lineupSnapshots: unknown): Record<string, string | null> | null {
  return frozenBestBallPositions(readBestBallRuleStamp(lineupSnapshots))
}

/** The week roster at the positions this week was seated at, with `positionNow` where that differs. */
function atSealedPositions(
  roster: readonly WeekRosterPlayer[],
  sealed: Readonly<Record<string, string | null>> | null | undefined,
): Array<WeekRosterPlayer & { positionNow?: string }> {
  if (!sealed) return [...roster]
  return roster.map((p) => {
    if (!Object.prototype.hasOwnProperty.call(sealed, p.playerId)) return p
    const stored = sealed[p.playerId] ?? ''
    const sameAsNow = stored.trim().toUpperCase() === String(p.position ?? '').trim().toUpperCase()
    return sameAsNow ? { ...p, position: stored } : { ...p, position: stored, positionNow: p.position }
  })
}

const RESERVE = new Set(['ir', 'injured_reserve', 'taxi', 'devy', 'reserve'])

function positionsOf(position: string): string[] {
  return String(position ?? '')
    .toUpperCase()
    .split(/[/,\s]+/)
    .filter(Boolean)
}

function fits(position: string, slot: SlotEligibility): boolean {
  const eligible = slot.eligible.map((e) => e.toUpperCase())
  if (eligible.includes('*')) return true
  return positionsOf(position).some((p) => eligible.includes(p))
}

/** Two decimals, like every score on the tab, so a reason never reads "21" beside "31.20". */
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/**
 * Why a rostered player did not count this week, in one sentence.
 *
 * The comparison is against the LOWEST-scoring starter in a slot he could have filled: if he had beaten
 * that player, the optimizer would have started him there. Equal points lose on the optimizer's
 * deterministic tiebreak (player id), which the sentence says rather than hides.
 */
export function benchReason(
  player: WeekRosterPlayer,
  points: number | null,
  starters: readonly SnapshotAssignment[],
  slots: readonly SlotEligibility[],
  missing: ReadonlySet<string>,
): string {
  if (RESERVE.has(String(player.slotType ?? '').toLowerCase())) {
    return 'On IR / reserve this week, so he cannot count.'
  }
  if (points == null || missing.has(player.playerId)) return 'No stats yet for this week.'
  const reachable = starters.filter((a) => {
    const slot = slots.find((s) => s.slot === a.slot)
    return slot ? fits(player.position, slot) : false
  })
  if (reachable.length === 0) return `No lineup slot takes a ${player.position || 'player at his position'}.`
  const weakest = [...reachable].sort((a, b) => a.points - b.points)[0]!
  const who = weakest.playerName || 'the starter'
  if (points === weakest.points) {
    return `Tied with ${who} (${fmt(weakest.points)}) for ${weakest.slot}; ties are broken by a fixed order, so ${who} counted.`
  }
  // The optimal lineup never benches a player who outscores a starter he could replace. When the numbers
  // say otherwise, his points arrived after the lineup was last scored; say so rather than contradict it.
  if (points > weakest.points) {
    return `Scored ${fmt(points)} after the lineup was last updated; the next scoring run will reconsider him.`
  }
  return `Scored ${fmt(points)}; ${who} scored ${fmt(weakest.points)} at ${weakest.slot}, so ${who} counted.`
}

export function buildNativeLineupCard(args: {
  rosterId: string
  teamName: string
  side: SnapshotSide | null | undefined
  /** `final` once the matchup row is final. */
  matchupFinal: boolean
  opponentPoints: number | null
  weekRoster: readonly WeekRosterPlayer[]
  /** playerId → that week's points, from `league_player_weekly_scores`. */
  pointsByPlayer: ReadonlyMap<string, number>
  slots: readonly SlotEligibility[]
  /** A sealed week's stored positions (`lineupPositionsForWeek`); absent or null: current positions. */
  sealedPositions?: Readonly<Record<string, string | null>> | null
}): NativeLineupCard {
  if (args.side?.bestBall?.period === 'daily') return buildDailyLineupCard(args)
  const assignments = args.side?.bestBall?.assignments ?? []
  const missing = new Set(args.side?.missingPlayerIds ?? [])
  const weekRoster = atSealedPositions(args.weekRoster, args.sealedPositions)
  const byId = new Map(weekRoster.map((p) => [p.playerId, p]))
  const startedIds = new Set(assignments.map((a) => a.playerId))
  const status: LineupStatus = args.matchupFinal && args.side?.allFinal !== false ? 'final' : 'provisional'
  const total = typeof args.side?.points === 'number' ? args.side.points : assignments.reduce((s, a) => s + a.points, 0)

  const starters = assignments.map((a) => {
    const p = byId.get(a.playerId)
    return {
      playerId: a.playerId,
      name: a.playerName || p?.playerName || a.playerId,
      position: p?.position ?? '',
      ...(p?.positionNow !== undefined ? { positionNow: p.positionNow } : {}),
      team: p?.team ?? null,
      points: a.points,
      slot: a.slot,
    }
  })

  const bench = weekRoster
    .filter((p) => !startedIds.has(p.playerId))
    .map((p) => {
      const points = args.pointsByPlayer.has(p.playerId) ? args.pointsByPlayer.get(p.playerId)! : null
      return {
        playerId: p.playerId,
        name: p.playerName,
        position: p.position,
        ...(p.positionNow !== undefined ? { positionNow: p.positionNow } : {}),
        team: p.team,
        points,
        reason: benchReason(p, points, assignments, args.slots, missing),
      }
    })
    // Highest first, players without stats last.
    .sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.name.localeCompare(b.name))

  let winLoss: string | null = null
  if (status === 'final' && args.opponentPoints != null) {
    winLoss = total > args.opponentPoints ? 'W' : total < args.opponentPoints ? 'L' : 'T'
  }

  return {
    rosterId: args.rosterId,
    teamName: args.teamName,
    totalPoints: Math.round(total * 100) / 100,
    status,
    winLoss,
    starters,
    bench,
    unfilledSlots: (args.side?.bestBall?.unfilledSlots ?? []).map((u) => u.slot),
    awaitingStats: missing.size,
  }
}

/**
 * DAILY BEST BALL'S CARD. There is no one weekly lineup: each day's best lineup counted on its own, so a
 * player is "counted" with his points summed across the days he was in it, and a player who never made a
 * day's lineup "didn't count". Nobody is compared against a single starter, because the comparison that
 * decided each day was against THAT day's lineup.
 */
function buildDailyLineupCard(args: Parameters<typeof buildNativeLineupCard>[0]): NativeLineupCard {
  const counted = args.side?.bestBall?.counted ?? []
  const missing = new Set(args.side?.missingPlayerIds ?? [])
  const weekRoster = atSealedPositions(args.weekRoster, args.sealedPositions)
  const byId = new Map(weekRoster.map((p) => [p.playerId, p]))
  const countedIds = new Set(counted.map((c) => c.playerId))
  const status: LineupStatus = args.matchupFinal && args.side?.allFinal !== false ? 'final' : 'provisional'
  const total = typeof args.side?.points === 'number' ? args.side.points : counted.reduce((s, c) => s + c.points, 0)

  const starters = counted.map((c) => {
    const p = byId.get(c.playerId)
    return {
      playerId: c.playerId,
      name: c.playerName || p?.playerName || c.playerId,
      position: p?.position ?? '',
      ...(p?.positionNow !== undefined ? { positionNow: p.positionNow } : {}),
      team: p?.team ?? null,
      points: c.points,
      slot: `${c.days} day${c.days === 1 ? '' : 's'}`,
      days: c.days,
    }
  })

  const bench = weekRoster
    .filter((p) => !countedIds.has(p.playerId))
    .map((p) => {
      const points = args.pointsByPlayer.has(p.playerId) ? args.pointsByPlayer.get(p.playerId)! : null
      let reason: string
      if (RESERVE.has(String(p.slotType ?? '').toLowerCase())) reason = 'On IR / reserve this week, so he cannot count.'
      else if (points == null || missing.has(p.playerId)) reason = 'No stats yet for this week.'
      else if (points === 0) reason = 'No points on any day he was on the roster this week.'
      else reason = `Scored ${fmt(points)} this week, but on every day he played a higher scorer filled each slot he fits.`
      return {
        playerId: p.playerId,
        name: p.playerName,
        position: p.position,
        ...(p.positionNow !== undefined ? { positionNow: p.positionNow } : {}),
        team: p.team,
        points,
        reason,
      }
    })
    .sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.name.localeCompare(b.name))

  let winLoss: string | null = null
  if (status === 'final' && args.opponentPoints != null) {
    winLoss = total > args.opponentPoints ? 'W' : total < args.opponentPoints ? 'L' : 'T'
  }

  return {
    rosterId: args.rosterId,
    teamName: args.teamName,
    totalPoints: Math.round(total * 100) / 100,
    scoringPeriod: 'daily',
    status,
    winLoss,
    starters,
    bench,
    unfilledSlots: [],
    awaitingStats: missing.size,
  }
}

/**
 * What the tab says when a league AllFantasy hosts has no native season yet because its draft is still
 * open. Without it the tab read "No scored weeks yet. Lineups appear here once the first games are
 * played." — which is false while the draft runs: games can be played and still nothing is scored,
 * because no team has a roster until the draft finishes. Null once the draft is completed (or there is
 * no draft to speak of), so the ordinary empty state stands.
 *
 * `showingSeason`: the tab is showing an OLDER native season (a renewed league whose new season's draft
 * is still open — its newest native season is last year's). The notice then also says which season the
 * lineups below belong to, so last year's cards are not read as this year's.
 */
export function draftPendingNotice(draftStatus: string | null | undefined, showingSeason?: number | null): string | null {
  const status = String(draftStatus ?? '').trim().toLowerCase()
  if (!status || status === 'completed') return null
  const lead =
    status === 'in_progress' || status === 'paused'
      ? 'The draft is still running.'
      : 'The draft has not started yet.'
  const base = `${lead} Best ball scores begin after the draft finishes, because no team has a roster until then.`
  return showingSeason != null && Number.isFinite(showingSeason)
    ? `${base} The lineups below are from the ${showingSeason} season.`
    : base
}

/**
 * Whether the league's CURRENT season has no native season yet, given the newest native season the tab
 * found (null: none at all). Only then can an open draft explain an empty — or last year's — tab. Pure.
 */
export function currentSeasonAwaitsDraft(leagueSeason: number | null | undefined, newestNativeSeason: number | null): boolean {
  if (newestNativeSeason == null) return true
  if (leagueSeason == null || !Number.isFinite(leagueSeason)) return false
  return newestNativeSeason < leagueSeason
}

/** The matchup snapshot's side for one roster, or null when the row was never scored. */
export function snapshotSide(lineupSnapshots: unknown, side: 'home' | 'away'): SnapshotSide | null {
  if (!lineupSnapshots || typeof lineupSnapshots !== 'object' || Array.isArray(lineupSnapshots)) return null
  const scoring = (lineupSnapshots as Record<string, unknown>).redraftScoring
  if (!scoring || typeof scoring !== 'object' || Array.isArray(scoring)) return null
  const value = (scoring as Record<string, unknown>)[side]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as SnapshotSide) : null
}
