/**
 * Chimmy in the /mock-draft room — stage 3 of drafts (2026-11-16).
 *
 * The room runs in the browser and sends its board with each question (`lib/mock-draft/mockChimmyBoard.ts`).
 * This file is the server half: it re-validates that snapshot, writes it as prompt lines, answers the
 * AF Pro "who's likely gone before my pick" read from it, and turns "queue X" into a proposal the room
 * applies only when the user taps Confirm.
 *
 * Owner's spec, carried over from live drafts: their picks, their queue, time left, who's likely gone;
 * basics free and the outlook AF Pro; a one-line pick-first answer when the clock is short; queue edits
 * behind Confirm, and never a pick.
 *
 * PURE: no database, no network. The mock's other teams are bots, so there is no league history here.
 */
import { randomUUID } from 'crypto'
import { formatPickLabel } from '@/lib/live-draft-engine/DraftOrderService'
import {
  SHORT_CLOCK_SECONDS,
  auctionRoomLines,
  formatDuration,
  pickOutlookLines,
  viewerPicksLine,
  viewerQueueLine,
  type OutlookTarget,
} from '@/lib/chimmy/draftViewerFacts'
import { matchByName } from '@/lib/chimmy/actions/queuePlan'
import {
  MOCK_BOARD_AVAILABLE_MAX,
  MOCK_BOARD_QUEUE_MAX,
  MOCK_BOARD_VERSION,
  applyQueueIdOps,
  type MockBoardAuction,
  type MockBoardPlayer,
  type MockDraftBoard,
  type MockQueueProposal,
} from '@/lib/mock-draft/mockChimmyBoard'

/* ── Parsing: the snapshot is a form field, so every value is checked and capped ─────────────── */

/** A post larger than this is not a mock board. 300 players is ~30 KB. */
const MAX_RAW_CHARS = 120_000
const MAX_TEAMS = 32
const MAX_ROUNDS = 60

/** One line of plain text: no newlines or control characters (they would restructure the prompt), capped. */
function clean(v: unknown, max = 60): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return s || null
}
const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function readPlayer(v: unknown): MockBoardPlayer | null {
  const r = rec(v)
  if (!r) return null
  const id = clean(r.id, 80)
  const name = clean(r.name)
  if (!id || !name) return null
  const adp = num(r.adp)
  return { id, name, position: clean(r.position, 8) ?? '', team: clean(r.team, 8), adp: adp != null && adp > 0 ? adp : null }
}

function readAuction(v: unknown): MockBoardAuction | null {
  const r = rec(v)
  if (!r) return null
  const n = rec(r.nomination)
  const nominationName = n ? clean(n.name) : null
  return {
    nomination: n && nominationName ? { name: nominationName, position: clean(n.position, 8) ?? '', team: clean(n.team, 8) } : null,
    currentBid: int(r.currentBid, 0, 100_000) ?? 0,
    highBidderName: clean(r.highBidderName),
    minNextBid: int(r.minNextBid, 0, 100_000) ?? 1,
    bidSecondsLeft: int(r.bidSecondsLeft, 0, 3600),
    teams: arr(r.teams)
      .slice(0, MAX_TEAMS)
      .map(rec)
      .filter((t): t is Record<string, unknown> => t != null)
      .map((t) => ({
        name: clean(t.name) ?? 'a team',
        budget: int(t.budget, 0, 100_000) ?? 0,
        openSlots: int(t.openSlots, 0, 200) ?? 0,
        isViewer: t.isViewer === true,
      })),
  }
}

/** The room's snapshot, or null when the field is absent or not a board this version understands. */
export function parseMockDraftBoard(raw: unknown): MockDraftBoard | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RAW_CHARS) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const r = rec(json)
  if (!r || r.v !== MOCK_BOARD_VERSION) return null
  const draftType = r.draftType === 'snake' || r.draftType === 'linear' || r.draftType === 'auction' ? r.draftType : null
  const teamCount = int(r.teamCount, 2, MAX_TEAMS)
  const rounds = int(r.rounds, 1, MAX_ROUNDS)
  if (!draftType || !teamCount || !rounds) return null
  const total = teamCount * rounds
  const userSlot = int(r.userSlot, 1, MAX_TEAMS)
  const currentPick = int(r.currentPick, 1, total + 1)
  if (!userSlot || !currentPick) return null

  const teams = arr(r.teams)
    .slice(0, MAX_TEAMS)
    .map(rec)
    .filter((t): t is Record<string, unknown> => t != null)
    .map((t) => ({
      slot: int(t.slot, 1, MAX_TEAMS) ?? 0,
      name: clean(t.name) ?? 'a team',
      isUser: t.isUser === true,
      positions: arr(t.positions).slice(0, MAX_ROUNDS).map((p) => clean(p, 8) ?? '?'),
      needs: arr(t.needs).slice(0, 12).map((p) => clean(p, 8)).filter((p): p is string => p != null),
    }))
    .filter((t) => t.slot > 0)

  return {
    v: MOCK_BOARD_VERSION,
    sport: clean(r.sport, 12) ?? 'NFL',
    scoring: clean(r.scoring, 20) ?? '',
    draftType,
    teamCount,
    rounds,
    superflex: r.superflex === true,
    status: clean(r.status, 16) ?? 'drafting',
    currentPick,
    userSlot,
    secondsLeft: int(r.secondsLeft, 0, 86_400),
    perPickSeconds: int(r.perPickSeconds, 0, 86_400) ?? 0,
    upcomingSlots: arr(r.upcomingSlots).slice(0, MAX_TEAMS * 2 + 1).map((s) => int(s, 1, MAX_TEAMS)).filter((s): s is number => s != null),
    teams,
    myPicks: arr(r.myPicks)
      .slice(0, MAX_ROUNDS)
      .map(rec)
      .filter((p): p is Record<string, unknown> => p != null)
      .map((p) => ({ overall: int(p.overall, 1, total) ?? 0, name: clean(p.name) ?? '', position: clean(p.position, 8) ?? '' }))
      .filter((p) => p.overall > 0 && p.name),
    queue: arr(r.queue).slice(0, MOCK_BOARD_QUEUE_MAX).map(readPlayer).filter((p): p is MockBoardPlayer => p != null),
    available: arr(r.available).slice(0, MOCK_BOARD_AVAILABLE_MAX).map(readPlayer).filter((p): p is MockBoardPlayer => p != null),
    auction: draftType === 'auction' ? readAuction(r.auction) : null,
  }
}

/* ── The board, as prompt lines ───────────────────────────────────────────────────────────────── */

const playerLabel = (p: MockBoardPlayer) =>
  `${p.name} (${[p.position, p.team, p.adp != null ? `ADP ${Math.round(p.adp * 10) / 10}` : null].filter(Boolean).join(', ')})`

const teamName = (board: MockDraftBoard, slot: number) => board.teams.find((t) => t.slot === slot)?.name ?? `slot ${slot}`

/**
 * The user's turns ahead (the pick on the clock now included), as overall picks, from the room's own order.
 */
function userTurnOveralls(board: MockDraftBoard): number[] {
  return board.upcomingSlots.flatMap((slot, i) => (slot === board.userSlot ? [board.currentPick + i] : []))
}

export const BEST_AVAILABLE_SHOWN = 15

/** Who else is in the room: all bots on /mock-draft; a league mock room can also hold invited people. */
function otherTeamsPhrase(board: MockDraftBoard): string {
  const others = board.teamCount - 1
  const humans = (board.otherHumans ?? []).filter(Boolean)
  if (humans.length === 0) return `the other ${others} teams are AI bots`
  const bots = Math.max(0, others - humans.length)
  return `${humans.join(', ')} ${humans.length === 1 ? 'is another person' : 'are other people'} practicing in this room${
    bots > 0 ? `; the other ${bots} team${bots === 1 ? ' is an AI bot' : 's are AI bots'}` : ''
  }`
}

export function mockDraftBoardLines(board: MockDraftBoard): string[] {
  const lines = [
    `THE USER IS ASKING FROM INSIDE A PRACTICE MOCK DRAFT ON ALLFANTASY — not a league draft; nothing here counts and ${otherTeamsPhrase(board)}. This board is the whole truth about the mock: answer from it, not from a league's tools, and never call get_current_draft_board for it.`,
    `SETUP: ${board.teamCount} teams, ${board.rounds} rounds, ${[board.sport, board.scoring, board.superflex ? 'superflex' : null, board.draftType].filter(Boolean).join(' ')}.`,
  ]

  if (board.status === 'complete') {
    lines.push('STATUS: the mock is FINISHED. Talk about the team they drafted.')
    lines.push(viewerPicksLine(board.myPicks.map((p) => ({ overall: p.overall, playerName: p.name, position: p.position })), board.teamCount))
    return lines
  }

  const onClockSlot = board.upcomingSlots[0] ?? null
  const userOnClock = board.draftType !== 'auction' && onClockSlot === board.userSlot && board.status === 'drafting'
  if (board.draftType !== 'auction') {
    lines.push(
      `STATUS: pick ${formatPickLabel(board.currentPick, board.teamCount)} (#${board.currentPick}) is on the clock — ${
        onClockSlot == null ? 'nobody' : userOnClock ? 'THIS USER' : teamName(board, onClockSlot)
      }.${board.status === 'paused' ? ' The mock is PAUSED.' : board.status === 'waiting' ? ' The mock has NOT STARTED yet.' : ''}`,
    )
  } else if (board.status === 'paused') {
    lines.push('STATUS: the mock auction is PAUSED.')
  }

  if (userOnClock) {
    if (board.secondsLeft != null && board.perPickSeconds > 0) {
      lines.push(
        board.secondsLeft <= SHORT_CLOCK_SECONDS
          ? `🛑 THIS USER IS ON THE CLOCK WITH ${formatDuration(board.secondsLeft)} LEFT. Answer pick-first in ONE line — "Take <player>. Backup: <player>." — from BEST AVAILABLE below, respecting their queue order unless the board gives a reason. No preamble; give reasoning only if they ask. If the clock runs out the room auto-picks for them.`
          : 'THIS USER IS ON THE CLOCK NOW: lead with the pick, then the reason.',
      )
    } else {
      lines.push('THIS USER IS ON THE CLOCK NOW (no timer): lead with the pick, then the reason.')
    }
  }

  lines.push(viewerPicksLine(board.myPicks.map((p) => ({ overall: p.overall, playerName: p.name, position: p.position })), board.teamCount))
  lines.push(viewerQueueLine(board.queue.map((p) => ({ playerName: p.name, position: p.position, team: p.team }))))

  if (board.draftType !== 'auction') {
    const turns = userTurnOveralls(board)
    const next = userOnClock ? turns[1] : turns[0]
    if (next != null) {
      const away = next - board.currentPick
      lines.push(`THIS USER'S NEXT PICK${userOnClock ? ' AFTER THIS ONE' : ''}: ${formatPickLabel(next, board.teamCount)} (#${next}), ${away} pick${away === 1 ? '' : 's'} away.`)
      const between = board.upcomingSlots.slice(userOnClock ? 1 : 0, next - board.currentPick).filter((s) => s !== board.userSlot)
      const before = [...new Set(between)].map((slot) => board.teams.find((t) => t.slot === slot)).filter((t) => t != null)
      if (before.length > 0) {
        lines.push(
          `BOTS PICKING BEFORE THAT: ${before
            .map((t) => `${t!.name} (${t!.needs.length ? `still needs ${t!.needs.join(', ')}` : 'starters filled'})`)
            .join('; ')}. These are the room's roster-needs reads, not predictions of a pick.`,
        )
      }
    } else if (!userOnClock) {
      lines.push('THIS USER HAS NO PICKS LEFT in this mock.')
    }
  }

  if (board.auction) lines.push(...auctionRoomLines({ ...board.auction, nomination: board.auction.nomination && { playerName: board.auction.nomination.name, position: board.auction.nomination.position, team: board.auction.nomination.team }, budgetsAssumed: false }))

  if (board.available.length > 0) {
    lines.push(`BEST AVAILABLE BY MARKET ADP: ${board.available.slice(0, BEST_AVAILABLE_SHOWN).map((p, i) => `${i + 1}. ${playerLabel(p)}`).join('; ')}.`)
  }
  lines.push(
    'To queue, unqueue or reorder players use propose_draft_queue_change — it shows a Confirm card in this chat and the room changes only when they tap it; never say a player was queued or drafted. For "will X make it back to me" use get_draft_pick_outlook.',
  )
  return lines
}

/** The board as one prompt block — the route's grounding and the `get_current_draft_board` tool share it. */
export function mockDraftBoardText(board: MockDraftBoard): string {
  return mockDraftBoardLines(board).join('\n')
}

/* ── AF Pro: who is likely gone before their next pick ───────────────────────────────────────── */

const OUTLOOK_TARGETS = 8

export function mockPickOutlook(board: MockDraftBoard): string {
  if (board.status === 'complete') return 'The mock is finished; there is no next pick to judge.'
  if (board.draftType === 'auction') return 'The pick outlook is for snake and linear drafts. In an auction, use the auction room on this board: budgets and the player on the block.'
  const turns = userTurnOveralls(board)
  const userOnClock = board.upcomingSlots[0] === board.userSlot
  const target = userOnClock ? turns[1] : turns[0]
  if (target == null) return 'This user has no pick left in this mock (or not within the next two rounds).'

  const queued = new Set(board.queue.map((p) => p.id))
  const targets: OutlookTarget[] = [
    ...board.queue.map((p) => ({ ...p, from: 'queue' as const })),
    ...board.available.filter((p) => !queued.has(p.id)).map((p) => ({ ...p, from: 'draft_os' as const })),
  ]
    .slice(0, OUTLOOK_TARGETS)
    .map((p) => ({ name: p.name, position: p.position, team: p.team, adp: p.adp, adpIsReal: p.adp != null, from: p.from }))

  const between = board.upcomingSlots.slice(userOnClock ? 1 : 0, target - board.currentPick).filter((s) => s !== board.userSlot)
  const before = [...new Set(between)].map((slot) => board.teams.find((t) => t.slot === slot)).filter((t) => t != null)
  const openSlotsLine = before.length
    ? `Open starting needs of the bots picking first (the room's read): ${before.map((t) => `${t!.name}: ${t!.needs.join(', ') || 'none'}`).join('; ')}.`
    : null

  return pickOutlookLines({ targets, nextOverall: board.currentPick, myNextOverall: target, teamCount: board.teamCount, openSlotsLine, historyLines: [] })
    .join('\n')
}

/* ── A queue change, applied in the room only on Confirm ─────────────────────────────────────── */

const MAX_NAMES = 8
const names = (v: unknown): string[] => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, MAX_NAMES)

export type MockQueueOutcome = { ok: true; proposal: MockQueueProposal; text: string } | { ok: false; text: string }

export function proposeMockQueueChange(board: MockDraftBoard, args: { add?: unknown; remove?: unknown; position?: unknown }): MockQueueOutcome {
  if (board.status === 'complete') return { ok: false, text: 'The mock is finished, so there is no queue to change.' }
  const addAt = args.position === 'top' ? 'top' : 'bottom'
  const problems: string[] = []
  const add: MockBoardPlayer[] = []
  for (const name of names(args.add)) {
    const m = matchByName(name, board.available, (p) => p.name)
    if (m.ok) {
      if (!add.some((p) => p.id === m.item.id)) add.push(m.item)
    } else if (m.reason === 'ambiguous') {
      problems.push(`"${name}" matches more than one player (${m.candidates.map(playerLabel).join(' / ')}) — ask which one`)
    } else {
      problems.push(`"${name}" is not available in this mock (already drafted, or outside the ${MOCK_BOARD_AVAILABLE_MAX} best-ADP players Chimmy can see — they can add him from the Players list)`)
    }
  }
  const remove: MockBoardPlayer[] = []
  for (const name of names(args.remove)) {
    const m = matchByName(name, board.queue, (p) => p.name)
    if (m.ok) {
      if (!remove.some((p) => p.id === m.item.id)) remove.push(m.item)
    } else {
      problems.push(m.reason === 'ambiguous' ? `"${name}" matches more than one queued player — ask which one` : `"${name}" is not in their queue`)
    }
  }
  const problemText = problems.length ? ` Not included: ${problems.join('; ')}.` : ''
  if (add.length === 0 && remove.length === 0) {
    return { ok: false, text: `No queue change was prepared.${problemText} Tell the user plainly; do not say anything was queued.` }
  }

  const baseQueueIds = board.queue.map((p) => p.id)
  const resulting = applyQueueIdOps(baseQueueIds, { addIds: add.map((p) => p.id), addAt, removeIds: remove.map((p) => p.id) })
  const byId = new Map([...board.queue, ...board.available].map((p) => [p.id, p]))
  const card = (p: MockBoardPlayer) => ({ id: p.id, name: p.name, position: p.position, team: p.team })
  const proposal: MockQueueProposal = {
    id: randomUUID(),
    add: add.map(card),
    addAt,
    remove: remove.map(card),
    baseQueueIds,
    resultingTop: resulting.slice(0, 5).map((id) => byId.get(id)?.name ?? '').filter(Boolean),
  }
  return {
    ok: true,
    proposal,
    text: `A Confirm card is ready in the chat: ${[
      add.length ? `add ${add.map((p) => p.name).join(', ')} at the ${addAt}` : null,
      remove.length ? `take off ${remove.map((p) => p.name).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; ')}. NOTHING has changed yet — their queue changes only when they tap Confirm, and it never makes a pick. Say exactly that.${problemText}`,
  }
}
