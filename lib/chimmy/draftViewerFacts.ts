/**
 * The viewer's side of a live draft, as prompt lines for Chimmy — their picks so far, their queue, the
 * pick clock, the auction room, and (AF Pro) which of their targets are likely gone before their next
 * pick. Owner's spec, 2026-11-16: "my picks so far, my queue, time left on my clock, who's likely
 * gone", a short pick-first answer when time is short, and the auction room.
 *
 * PURE: every function takes data already read and returns lines, so `draftGrounding.ts` and the
 * outlook tool share one wording and the tests need no database.
 *
 * ⚠ FACTS, NEVER A READ ON A PERSON. Like `lib/competitive-edge/liveDraftManagersFacts.ts`, nothing
 * here says what a manager "likes" or "will do": positions taken, open starting slots, market ADP.
 */
import { formatPickLabel, getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftType } from '@/lib/live-draft-engine/types'
import { thisDraftFact } from '@/lib/competitive-edge/liveDraftManagersFacts'
import type { AuctionAdvice } from '@/lib/draft-helper/auctionAdvice'

/* ── Time ─────────────────────────────────────────────────────────────────────────────────── */

/** 45s · 2m 14s · 1h 5m · 2d 3h. Whole seconds; never negative. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r ? `${m}m ${r}s` : `${m}m`
  }
  if (s < 86_400) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return m ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3600)
  return h ? `${d}d ${h}h` : `${d}d`
}

/** At or under this many seconds left on THEIR pick, Chimmy answers pick-first in one line. */
export const SHORT_CLOCK_SECONDS = 60

/** A per-pick clock this long or longer is a slow draft — the same draft, a longer clock. */
const SLOW_CLOCK_SECONDS = 3600

export type PickClockInput = {
  status: string
  timerSeconds: number | null
  timerEndAt: Date | null
  pausedRemainingSeconds?: number | null
  overnightFrozenPickSeconds?: number | null
  now: Date
  /** True when the viewer is the one on the clock right now. */
  viewerOnClock: boolean
}

/** Seconds left on the pick being made now, or null when no clock is running. */
export function secondsLeftOnPick(input: Pick<PickClockInput, 'status' | 'timerEndAt' | 'now'>): number | null {
  if (input.status !== 'in_progress' || !input.timerEndAt) return null
  return Math.max(0, Math.ceil((input.timerEndAt.getTime() - input.now.getTime()) / 1000))
}

export function pickClockLines(input: PickClockInput): string[] {
  const perPick = input.timerSeconds && input.timerSeconds > 0
    ? ` (${formatDuration(input.timerSeconds)} per pick${input.timerSeconds >= SLOW_CLOCK_SECONDS ? ' — a slow draft' : ''})`
    : ''
  const lines: string[] = []
  if (input.status === 'paused') {
    if (input.pausedRemainingSeconds != null && input.pausedRemainingSeconds > 0) {
      lines.push(`PICK CLOCK: stopped while paused, with ${formatDuration(input.pausedRemainingSeconds)} left on the pick${perPick}.`)
    }
    return lines
  }
  const left = secondsLeftOnPick(input)
  if (left == null) {
    if (input.status === 'in_progress' && input.overnightFrozenPickSeconds != null && input.overnightFrozenPickSeconds > 0) {
      lines.push(`PICK CLOCK: frozen for the league's overnight window; ${formatDuration(input.overnightFrozenPickSeconds)} will be left on the pick when it resumes${perPick}.`)
    }
    return lines
  }
  lines.push(left > 0 ? `PICK CLOCK: ${formatDuration(left)} left on this pick${perPick}.` : `PICK CLOCK: time has run out on this pick${perPick}.`)
  if (input.viewerOnClock) {
    lines.push(
      left > 0 && left <= SHORT_CLOCK_SECONDS
        ? `🛑 THIS USER IS ON THE CLOCK WITH ${formatDuration(left)} LEFT. Answer pick-first in ONE line — "Take <player>. Backup: <player>." — from the Draft OS recommendation below. No preamble; give reasoning only if they ask.`
        : 'THIS USER IS ON THE CLOCK NOW: lead with the pick, then the reason.',
    )
  }
  return lines
}

/* ── The viewer's next pick ─────────────────────────────────────────────────────────────────── */

/** The overall number of the viewer's next pick at or after `fromOverall`, or null when none is left. */
export function viewerNextOverall(args: {
  fromOverall: number
  totalPicks: number
  slot: number
  teamCount: number
  draftType: string
  thirdRoundReversal: boolean
}): number | null {
  for (let o = args.fromOverall; o <= args.totalPicks; o += 1) {
    const slot = getSlotInRoundForOverall({
      overall: o,
      teamCount: args.teamCount,
      draftType: args.draftType as DraftType,
      thirdRoundReversal: args.thirdRoundReversal,
    })
    if (slot === args.slot) return o
  }
  return null
}

/* ── Picks and queue ────────────────────────────────────────────────────────────────────────── */

export type ViewerPick = { overall: number; playerName: string; position: string | null }

export function viewerPicksLine(picks: readonly ViewerPick[], teamCount: number): string {
  if (picks.length === 0) return "THIS USER'S PICKS SO FAR: none yet."
  const sorted = [...picks].sort((a, b) => a.overall - b.overall)
  const list = sorted.map((p) => `${formatPickLabel(p.overall, teamCount)} ${p.playerName}${p.position ? ` (${p.position})` : ''}`).join(', ')
  return `THIS USER'S PICKS SO FAR (${sorted.length}): ${list}. ${thisDraftFact(sorted.map((p) => p.position ?? ''))}`
}

export type QueuedPlayer = { playerName: string; position: string | null; team: string | null }
export const QUEUE_SHOWN = 8

export function viewerQueueLine(queue: readonly QueuedPlayer[]): string {
  if (queue.length === 0) return "THIS USER'S QUEUE: empty (or every queued player is already drafted)."
  const shown = queue.slice(0, QUEUE_SHOWN)
  const more = queue.length > shown.length ? `, +${queue.length - shown.length} more` : ''
  return `THIS USER'S QUEUE (their own order, drafted players removed): ${shown
    .map((p, i) => `${i + 1}. ${p.playerName}${p.position || p.team ? ` (${[p.position, p.team].filter(Boolean).join(', ')})` : ''}`)
    .join('; ')}${more}. Respect their order unless the board gives a reason; say what the reason is.`
}

/* ── Auction ─────────────────────────────────────────────────────────────────────────────────── */

export type AuctionRoomInput = {
  nomination: { playerName: string; position: string; team: string | null } | null
  currentBid: number
  highBidderName: string | null
  minNextBid: number
  bidSecondsLeft: number | null
  /** Each team's money left and open roster spots, viewer included, largest budget first. */
  teams: ReadonlyArray<{ name: string; budget: number; openSlots: number; isViewer: boolean }>
  budgetsAssumed: boolean
}

export function auctionRoomLines(room: AuctionRoomInput): string[] {
  const lines: string[] = []
  if (room.nomination) {
    const n = room.nomination
    lines.push(
      `ON THE BLOCK: ${n.playerName} (${[n.position, n.team].filter(Boolean).join(', ')}), ${
        room.currentBid > 0 ? `high bid $${room.currentBid}${room.highBidderName ? ` by ${room.highBidderName}` : ''}` : 'no bid yet'
      }; next bid at least $${room.minNextBid}${room.bidSecondsLeft != null ? `, ${formatDuration(room.bidSecondsLeft)} left on the bid clock` : ''}.`,
    )
  } else {
    lines.push('Nobody is on the block right now.')
  }
  const me = room.teams.find((t) => t.isViewer)
  if (me) lines.push(`THIS USER: $${me.budget} left for ${me.openSlots} open roster spot${me.openSlots === 1 ? '' : 's'}.`)
  const others = room.teams.filter((t) => !t.isViewer).slice(0, 12)
  if (others.length > 0) {
    lines.push(`Money left: ${others.map((t) => `${t.name || 'a manager'} $${t.budget} (${t.openSlots} open)`).join(', ')}.`)
  }
  if (room.budgetsAssumed) lines.push('Budgets are the league default; spending so far is not on file, so do not quote anyone\'s exact money as fact.')
  return lines
}

/** Draft OS's auction advice (`buildAuctionAdvice`) as lines: the legal max, the call on the player up, targets. */
export function auctionAdviceLines(advice: AuctionAdvice): string[] {
  const lines = [`DRAFT OS AUCTION READ (the same engine as their draft room): max legal bid right now $${advice.maxLegalBid}.`]
  const n = advice.nominated
  if (n) {
    const call =
      n.verdict === 'bid' ? `bid up to $${n.bidUpTo}`
        : n.verdict === 'cannot_afford' ? 'they cannot afford him at this price'
          : 'let him go at this price'
    lines.push(`${n.playerName}: worth about $${n.yourPrice} to this user against roughly $${n.marketPrice} to the room — ${call}. ${n.reason}`)
  }
  if (advice.targets.length > 0) {
    lines.push(`Best values they can afford: ${advice.targets.slice(0, 3).map((t) => `${t.playerName} (${t.position}) ~$${t.marketPrice}, worth $${t.yourPrice} to them`).join('; ')}.`)
  }
  if (advice.nominate) lines.push(`A player to NOMINATE so others spend: ${advice.nominate.playerName} (${advice.nominate.position}) — ${advice.nominate.reason}`)
  for (const c of advice.caveats) lines.push(`Caveat: ${c}`)
  lines.push('Present bids as recommendations; the user places every bid.')
  return lines
}

/* ── AF Pro: who is likely gone before the viewer's next pick ─────────────────────────────── */

export type OutlookStatus = 'likely_gone' | 'toss_up' | 'likely_there' | 'no_adp'

/**
 * One target against the viewer's next pick, by MARKET ADP only. The margin widens with the room
 * (a 16-team round is longer than an 8-team one). A missing or synthetic ADP is `no_adp` — never a
 * guess dressed as a judgement.
 */
export function classifyByAdp(args: { adp: number | null; adpIsReal: boolean; myNextOverall: number; teamCount: number }): OutlookStatus {
  if (!args.adpIsReal || args.adp == null || !Number.isFinite(args.adp)) return 'no_adp'
  const margin = Math.max(2, Math.round(args.teamCount / 4))
  if (args.adp < args.myNextOverall - margin) return 'likely_gone'
  if (args.adp > args.myNextOverall + margin) return 'likely_there'
  return 'toss_up'
}

export type OutlookTarget = {
  name: string
  position: string
  team: string | null
  adp: number | null
  adpIsReal: boolean
  from: 'queue' | 'draft_os'
}

const STATUS_HEAD: Record<OutlookStatus, string> = {
  likely_gone: 'Likely GONE before their pick',
  toss_up: 'Toss-up',
  likely_there: 'Likely still THERE',
  no_adp: 'No market ADP (cannot judge)',
}

export function pickOutlookLines(args: {
  targets: readonly OutlookTarget[]
  nextOverall: number
  myNextOverall: number
  teamCount: number
  /** `describeOpenSlotsAhead` for the teams picking first, or null. */
  openSlotsLine: string | null
  /** Per-manager league-history lines, only when the viewer's plan includes them. */
  historyLines: readonly string[]
}): string[] {
  const picksAway = args.myNextOverall - args.nextOverall
  const lines = [
    `PICK OUTLOOK (AF Pro): this user's next pick is ${formatPickLabel(args.myNextOverall, args.teamCount)}, ${picksAway} pick${picksAway === 1 ? '' : 's'} away. Judged by market ADP against that pick and the open starting slots of the teams picking first — a guide, not a promise.`,
  ]
  const groups = new Map<OutlookStatus, string[]>()
  for (const t of args.targets) {
    const status = classifyByAdp({ adp: t.adp, adpIsReal: t.adpIsReal, myNextOverall: args.myNextOverall, teamCount: args.teamCount })
    const label = `${t.name} (${t.position}${t.adp != null && t.adpIsReal ? `, ADP ${Math.round(t.adp * 10) / 10}` : ''}${t.from === 'queue' ? ', queued' : ''})`
    groups.set(status, [...(groups.get(status) ?? []), label])
  }
  for (const status of ['likely_gone', 'toss_up', 'likely_there', 'no_adp'] as const) {
    const names = groups.get(status)
    if (names?.length) lines.push(`${STATUS_HEAD[status]}: ${names.join('; ')}.`)
  }
  if (args.openSlotsLine) lines.push(args.openSlotsLine)
  if (args.historyLines.length > 0) {
    lines.push(`League history of the managers picking first (facts only — never say what a manager WILL pick): ${args.historyLines.join(' | ')}`)
  }
  lines.push('If a queued player is likely gone, say so plainly and name the best fallback still likely there.')
  return lines
}
