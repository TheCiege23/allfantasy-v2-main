/**
 * Fan predictions on the public watch page: a fan calls who goes home at the open Tribal Council,
 * and a fan leaderboard counts the calls that were right. Pure, so tests can drive every rule.
 *
 *  - Only the latest council, only while its votes are open (before the deadline, not closed, not
 *    published). One call per fan per council; a fan can change it until the deadline.
 *  - The choices are castaways still in the game who attend: before the merge the attending tribe,
 *    after it everyone still in. A choice is sent as the castaway's opaque key and display name,
 *    never a user id.
 *  - A call scores only once that council's read is complete, so the leaderboard cannot spoil a
 *    read in progress.
 */
import { isCouncilReadComplete } from '@/lib/survivor/survivorRevealGate'
import { WATCH_OUT_STATES, type WatchCouncilRow } from './watchModel'

export type FanCouncilRow = WatchCouncilRow & { id: string }
export type FanCastawayRow = { id: string; userId: string; displayName: string; tribeId: string | null; playerState: string }
export type FanPredictionRow = { councilId: string; fanUserId: string; pickedUserId: string }
export type FanChoice = { key: string; name: string }
export type FanLeaderRow = { fanUserId: string; correct: number; calls: number }

/** The council fans can call now, or null when votes are not open. */
export function openFanCouncil(councils: readonly FanCouncilRow[], now: Date): FanCouncilRow | null {
  const latest = [...councils].sort((a, b) => b.week - a.week || b.councilNumber - a.councilNumber)[0]
  if (!latest || latest.isRevealed || latest.closedAt || latest.status === 'closed') return null
  return now.getTime() < latest.voteDeadlineAt.getTime() ? latest : null
}

/** Who a fan may call at this council: castaways still in, on the attending tribe before the merge. */
export function fanChoices(council: FanCouncilRow, players: readonly FanCastawayRow[], pendingOut: ReadonlySet<string>): FanChoice[] {
  return players
    .filter(p => !WATCH_OUT_STATES.includes(p.playerState) || pendingOut.has(p.userId))
    .filter(p => !council.attendingTribeId || p.tribeId === council.attendingTribeId)
    .map(p => ({ key: p.id, name: p.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Each fan's right calls and total calls, counting only councils whose read is complete. */
export function fanLeaderboard(predictions: readonly FanPredictionRow[], councils: readonly FanCouncilRow[], revealMode: string | null | undefined, now: Date): FanLeaderRow[] {
  const settled = new Map(councils.filter(c => isCouncilReadComplete(c, revealMode, now)).map(c => [c.id, c.eliminatedUserId]))
  const byFan = new Map<string, FanLeaderRow>()
  for (const p of predictions) {
    if (!settled.has(p.councilId)) continue
    const row = byFan.get(p.fanUserId) ?? { fanUserId: p.fanUserId, correct: 0, calls: 0 }
    row.calls += 1
    if (settled.get(p.councilId) === p.pickedUserId) row.correct += 1
    byFan.set(p.fanUserId, row)
  }
  return [...byFan.values()].sort((a, b) => b.correct - a.correct || a.calls - b.calls || a.fanUserId.localeCompare(b.fanUserId))
}
