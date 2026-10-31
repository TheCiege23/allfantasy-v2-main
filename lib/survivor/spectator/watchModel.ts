/**
 * Pure pieces of the public Survivor watch page (spectator mode). No I/O: the privacy rules the page
 * relies on live here so tests can drive them directly.
 *
 *  - Display names only. Never a user id, a roster, an idol, a chat or a private vote.
 *  - Nobody is shown as voted out until their council's read is complete. A manager's state flips
 *    when the council closes, before the read, so the page checks each council rather than trusting
 *    the player row (a spoiler on the public page would ruin the read for every fan watching).
 *  - The live read is `gateRevealPayload`: names voted for and ballot status, released one at a time,
 *    and the verdict only once every ballot is out. Never who cast a ballot.
 */
import { gateRevealPayload, isCouncilReadComplete, type GatedReveal, type RevealStateRow } from '@/lib/survivor/survivorRevealGate'

export const WATCH_OUT_STATES: readonly string[] = ['eliminated', 'exile', 'jury', 'voted_out']

export type WatchPlayerRow = { userId: string; displayName: string; tribeId: string | null; playerState: string; eliminatedWeek: number | null; isJuryMember: boolean }
export type WatchCouncilRow = RevealStateRow & {
  week: number
  councilNumber: number
  status: string
  closedAt: Date | null
  voteDeadlineAt: Date
  attendingTribeId: string | null
  eliminatedUserId: string | null
  eliminatedName: string | null
  isTie: boolean
  tiePhase: string | null
}
export type WatchTribeRow = { id: string; name: string; isMerged: boolean; crestUrl: string | null; color: string | null }

export type WatchCastaway = { name: string; out: boolean; outWeek: number | null }
export type WatchTribe = { name: string; crestUrl: string | null; color: string | null; total: number | null; castaways: WatchCastaway[] }
export type WatchCouncil =
  | { state: 'voting'; week: number; tribeName: string | null; voteDeadlineAt: string }
  | { state: 'waiting'; week: number; tribeName: string | null }
  | ({ state: 'reading' | 'read'; week: number; tribeName: string | null } & Pick<GatedReveal, 'steps' | 'totalSteps' | 'visibleSteps' | 'nextStepAt' | 'eliminatedName' | 'isTie'>)

/** Managers whose elimination has not been read out yet: they still look like they are in the game. */
export function unreadEliminations(councils: readonly WatchCouncilRow[], revealMode: string | null | undefined, now: Date): Set<string> {
  const pending = new Set<string>()
  for (const council of councils) {
    if (council.eliminatedUserId && !isCouncilReadComplete(council, revealMode, now)) pending.add(council.eliminatedUserId)
  }
  return pending
}

/**
 * The cast by tribe. Pre-merge each active tribe lists its members with the week's total; after the
 * merge a single "merged" tribe holds everyone still in. Out castaways stay listed (struck through,
 * with the week), under the tribe they were last on, or under "Out" when that tribe is gone.
 */
export function watchTribes(input: {
  tribes: readonly WatchTribeRow[]
  players: readonly WatchPlayerRow[]
  tribeTotals: Readonly<Record<string, number>>
  pendingOut: ReadonlySet<string>
}): WatchTribe[] {
  const isOut = (p: WatchPlayerRow) => WATCH_OUT_STATES.includes(p.playerState) && !input.pendingOut.has(p.userId)
  const castaway = (p: WatchPlayerRow): WatchCastaway => ({ name: p.displayName, out: isOut(p), outWeek: isOut(p) ? p.eliminatedWeek : null })
  const byOrder = (a: WatchCastaway, b: WatchCastaway) => Number(a.out) - Number(b.out) || a.name.localeCompare(b.name)
  const merged = input.tribes.find(t => t.isMerged)
  const shown = merged ? [merged] : input.tribes.filter(t => !t.isMerged)
  const placed = new Set<string>()
  const out: WatchTribe[] = shown.map(tribe => {
    const members = input.players.filter(p => (merged ? !isOut(p) : p.tribeId === tribe.id))
    for (const p of members) placed.add(p.userId)
    return {
      name: tribe.name,
      crestUrl: tribe.crestUrl,
      color: tribe.color,
      total: merged ? null : input.tribeTotals[tribe.id] ?? null,
      castaways: members.map(castaway).sort(byOrder),
    }
  })
  const rest = input.players.filter(p => !placed.has(p.userId) && isOut(p))
  if (rest.length) out.push({ name: 'Out of the game', crestUrl: null, color: null, total: null, castaways: rest.map(castaway).sort((a, b) => (b.outWeek ?? 0) - (a.outWeek ?? 0) || a.name.localeCompare(b.name)) })
  return out
}

/** The jury, by display name, once each juror's own elimination has been read. */
export function watchJury(players: readonly WatchPlayerRow[], pendingOut: ReadonlySet<string>): string[] {
  return players.filter(p => p.isJuryMember && !pendingOut.has(p.userId)).map(p => p.displayName).sort((a, b) => a.localeCompare(b))
}

/**
 * The council a fan should see now: the latest one of the week. Before votes close it is "voting";
 * closed but not yet published it is "waiting"; once published it is the gated live read.
 */
export function watchCouncil(councils: readonly WatchCouncilRow[], tribeNames: Readonly<Record<string, string>>, revealMode: string | null | undefined, now: Date): WatchCouncil | null {
  const latest = [...councils].sort((a, b) => b.week - a.week || b.councilNumber - a.councilNumber)[0]
  if (!latest) return null
  const tribeName = latest.attendingTribeId ? tribeNames[latest.attendingTribeId] ?? null : null
  const base = { week: latest.week, tribeName }
  if (!latest.isRevealed) {
    return latest.closedAt || latest.status === 'closed' ? { state: 'waiting', ...base } : { state: 'voting', ...base, voteDeadlineAt: latest.voteDeadlineAt.toISOString() }
  }
  const gated = gateRevealPayload({
    isRevealed: latest.isRevealed,
    revealStartsAt: latest.revealStartsAt,
    revealStep: latest.revealStep,
    revealSequence: latest.revealSequence,
    revealMode,
    eliminatedName: latest.eliminatedName,
    isTie: latest.isTie,
    tiePhase: latest.tiePhase,
    now,
  })
  if (!gated.started) return { state: 'waiting', ...base }
  return {
    state: gated.complete ? 'read' : 'reading',
    ...base,
    steps: gated.steps,
    totalSteps: gated.totalSteps,
    visibleSteps: gated.visibleSteps,
    nextStepAt: gated.nextStepAt,
    eliminatedName: gated.eliminatedName,
    isTie: gated.isTie,
  }
}

/** How soon the page should ask again: fast during a read, slow otherwise. */
export function watchPollMs(council: WatchCouncil | null): number {
  if (council?.state === 'reading') return 2_500
  if (council?.state === 'waiting') return 15_000
  return 60_000
}
