/**
 * "Your week" for one league: your matchup, when your lineup locks, what is wrong with your
 * starters, and when waivers run. Pure — the strip fetches the existing endpoints and hands the
 * payloads here, so every rule below is testable without a network.
 *
 * Every source is optional. A league with no opponent this week (guillotine, survivor) still gets
 * its lineup and waiver lines; a league with no stored game times gets no lock line rather than a
 * guessed one. Nothing here invents a time or a number the payload did not carry.
 */
import { lockState, type LockState } from '@/lib/core-app/lineupLock'
import type { MatchupCenterPayload, MatchupPlayerSlot } from '@/lib/matchup-center/types'

export type LineupIssue = { code: string; severity?: string; playerName?: string | null; slotType?: string | null }

export type YourWeekInput = {
  matchup?: MatchupCenterPayload | null
  /** NFL only (certified evidence): this week's games with their scheduled start. */
  games?: { scheduledStart: string; final?: boolean; status?: string }[] | null
  lineupIssues?: LineupIssue[] | null
  waiverNextRunAt?: string | null
  now: string
}

export type YourWeekMatchup = {
  you: { name: string; points: number; projected: number | null }
  them: { name: string; points: number; projected: number | null } | null
  status: MatchupCenterPayload['matchupStatus']
  yetToPlay: number
  /** "Winning by 12.4", "Down 3.0", "Tied", or the projection before kickoff. */
  headline: string
}

export type YourWeek = {
  week: number | null
  matchup: YourWeekMatchup | null
  lock: LockState | null
  emptySlots: number
  /** Starters whose team is on bye this week. */
  onBye: { name: string }[]
  /** Other lineup errors the validator would block on (illegal slot, overflow, ineligible position…). */
  otherErrors: number
  injured: { name: string; status: string; out: boolean }[]
  waivers: { at: string } | null
  /** Nothing to show at all. */
  empty: boolean
}

const OUT_STATUSES = new Set(['OUT', 'IR', 'INJURED RESERVE', 'SUSPENDED', 'PUP', 'NFI', 'O'])
const RISK_STATUSES = new Set(['QUESTIONABLE', 'DOUBTFUL', 'Q', 'D', 'GTD', 'DAY-TO-DAY', 'DTD'])

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

function noOpponent(name: string): boolean {
  return /^no opponent$/i.test(name.trim())
}

function matchupFrom(p: MatchupCenterPayload): YourWeekMatchup {
  const opp = noOpponent(p.right.teamName) ? null : p.right
  // A projection that leans on the flat per-position fallback is not a projection worth quoting.
  const proj = (side: typeof p.left) => (side.projectedTotalIncludesFallback ? null : side.projectedTotal)
  const you = { name: p.left.teamName, points: p.left.totalPoints, projected: proj(p.left) }
  const them = opp ? { name: opp.teamName, points: opp.totalPoints, projected: proj(opp) } : null
  let headline: string
  if (!them) headline = `${round1(you.points)} pts this week`
  else if (p.matchupStatus === 'upcoming') {
    headline =
      you.projected != null && them.projected != null
        ? `Projected ${round1(you.projected)} – ${round1(them.projected)}`
        : 'Not started yet'
  } else {
    const diff = you.points - them.points
    const verb = p.matchupStatus === 'final' ? (diff > 0 ? 'Won by' : diff < 0 ? 'Lost by' : '') : diff > 0 ? 'Winning by' : diff < 0 ? 'Down' : ''
    headline = diff === 0 ? (p.matchupStatus === 'final' ? 'Tied' : 'All square') : `${verb} ${round1(Math.abs(diff))}`
  }
  return { you, them, status: p.matchupStatus, yetToPlay: p.left.remainingStarters, headline }
}

/** The week's next kickoff that has not started — the moment the next starters lock. */
export function nextKickoff(games: YourWeekInput['games'], now: string): string | null {
  const t = new Date(now).getTime()
  const upcoming = (games ?? [])
    .filter((g) => !g.final && Number.isFinite(new Date(g.scheduledStart).getTime()) && new Date(g.scheduledStart).getTime() > t)
    .map((g) => g.scheduledStart)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
  return upcoming[0] ?? null
}

function injuredFrom(issues: LineupIssue[] | null | undefined, starters: MatchupPlayerSlot[] | undefined) {
  // Prefer the lineup validator: it already decided what counts, per slot.
  if (issues && issues.length) {
    return issues
      .filter((i) => i.code === 'starter_ineligible_injury' || i.code === 'starter_injury_risk')
      .map((i) => ({ name: i.playerName?.trim() || 'A starter', status: i.code === 'starter_ineligible_injury' ? 'Out' : 'Questionable', out: i.code === 'starter_ineligible_injury' }))
  }
  return (starters ?? [])
    .filter((s) => s.gameStatus !== 'final' && s.injuryStatus)
    .map((s) => ({ status: String(s.injuryStatus).trim(), name: s.name }))
    .filter((s) => OUT_STATUSES.has(s.status.toUpperCase()) || RISK_STATUSES.has(s.status.toUpperCase()))
    .map((s) => ({ ...s, out: OUT_STATUSES.has(s.status.toUpperCase()) }))
}

export function buildYourWeek(input: YourWeekInput): YourWeek {
  /*
   * No head-to-head opponent (guillotine, survivor): matchup-center returns a bye whose week comes
   * from a settings field those formats do not keep current — measured on a week-5 guillotine
   * league it read "Week 1 · 0.0 pts". The stakes card carries those formats with the right week,
   * so the strip shows no matchup and no week for them rather than contradict it.
   */
  const headToHead = input.matchup && !noOpponent(input.matchup.right.teamName) ? input.matchup : null
  const matchup = headToHead ? matchupFrom(headToHead) : null
  const kickoff = nextKickoff(input.games, input.now)
  const lock = kickoff ? lockState(kickoff, input.now) : null
  const issues = input.lineupIssues ?? []
  const emptySlots = issues.filter((i) => i.code === 'missing_starter_slot' || i.code === 'missing_required_position').length
  const onBye = issues.filter((i) => i.code === 'starter_on_bye').map((i) => ({ name: i.playerName?.trim() || 'A starter' }))
  const counted = new Set(['missing_starter_slot', 'missing_required_position', 'starter_on_bye', 'starter_ineligible_injury', 'starter_injury_risk'])
  // Errors only (warnings are advice), and only ones not already counted above.
  const otherErrors = issues.filter((i) => !counted.has(i.code) && (i.severity ?? 'error') === 'error').length
  const injured = injuredFrom(input.lineupIssues, input.matchup?.left.starters)
  const waiverMs = input.waiverNextRunAt ? new Date(input.waiverNextRunAt).getTime() : NaN
  const waivers = Number.isFinite(waiverMs) && waiverMs > new Date(input.now).getTime() ? { at: input.waiverNextRunAt as string } : null
  return {
    week: headToHead?.week ?? null,
    matchup,
    lock,
    emptySlots,
    onBye,
    otherErrors,
    injured,
    waivers,
    empty: !matchup && !lock && emptySlots === 0 && onBye.length === 0 && otherErrors === 0 && injured.length === 0 && !waivers,
  }
}
