import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  formatPickLabel,
  getSlotInRoundForOverall,
  getUpcomingPickOwners,
} from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftType, SlotOrderEntry } from '@/lib/live-draft-engine/types'

/**
 * THE DRAFT — live, scheduled, or finished.
 *
 * ⚠ THIS IS LIVE DATA RIGHT NOW, not a future feature. Measured 2026-08-25:
 * 7 sessions `in_progress`, 2 `paused`, 26 `pre_draft`, 27 `completed`, over
 * 3,093 picks — and 3,084 of those picks (99.7%) carry the drafting manager's
 * name. Drafts are the one surface where the data is rich AND the season has not
 * started, so it is what Chimmy can be most useful about today.
 *
 * ⚠ ORDER MATH IS BORROWED, NEVER REIMPLEMENTED. Snake reversal and
 * third-round reversal already live in `DraftOrderService`, which the live draft
 * room itself runs on. A second implementation here would drift from the room and
 * put Chimmy and the board on different picks.
 *
 * ⚠ AUCTION HAS NO PICK ORDER. `getSlotInRoundForOverall` describes a serpentine
 * board; an auction has nominations and budgets instead. For auctions this block
 * reports what has been bought and stays silent on "who is next", rather than
 * inventing a clock nobody is on.
 */

/** Enough to establish where the board is without flooding the prompt. */
const RECENT_PICKS = 8
const UPCOMING = 4

type SessionRow = {
  id: string
  status: string
  draftType: string
  rounds: number
  teamCount: number
  thirdRoundReversal: boolean
  currentRoundNum: number
  timerSeconds: number | null
  timerEndAt: Date | null
  slotOrder: unknown
}

function parseSlotOrder(value: unknown): SlotOrderEntry[] {
  if (!Array.isArray(value)) return []
  const out: SlotOrderEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const { slot, rosterId, displayName } = raw as Record<string, unknown>
    if (typeof slot !== 'number' || typeof rosterId !== 'string') continue
    out.push({ slot, rosterId, displayName: typeof displayName === 'string' ? displayName : rosterId })
  }
  return out
}

/**
 * Draft state for the league in scope. Returns null when the league has no draft
 * session at all, so the prompt gains no empty section.
 */
export async function buildDraftContext(leagueId: string, userId: string): Promise<string | null> {
  if (!leagueId || !userId) return null

  let session: SessionRow | null
  try {
    session = (await prisma.draftSession.findUnique({
      where: { leagueId },
      select: {
        id: true,
        status: true,
        draftType: true,
        rounds: true,
        teamCount: true,
        thirdRoundReversal: true,
        currentRoundNum: true,
        timerSeconds: true,
        timerEndAt: true,
        slotOrder: true,
      },
    })) as unknown as SessionRow | null
  } catch {
    return null
  }
  if (!session) return null

  const isAuction = session.draftType === 'auction'
  const slotOrder = parseSlotOrder(session.slotOrder)
  const totalPicks = session.rounds * session.teamCount

  let picks: Array<{
    overall: number
    round: number
    slot: number
    rosterId: string
    displayName: string | null
    playerName: string
    position: string
    team: string | null
  }> = []
  try {
    picks = await prisma.draftPick.findMany({
      where: { sessionId: session.id },
      orderBy: { overall: 'desc' },
      take: RECENT_PICKS,
      select: {
        overall: true,
        round: true,
        slot: true,
        rosterId: true,
        displayName: true,
        playerName: true,
        position: true,
        team: true,
      },
    })
  } catch {
    picks = []
  }

  let madeCount = 0
  try {
    madeCount = await prisma.draftPick.count({ where: { sessionId: session.id } })
  } catch {
    madeCount = picks.length
  }

  const lines: string[] = []

  // ── Scheduled but not started ──────────────────────────────────────────────
  if (session.status === 'pre_draft') {
    lines.push('DRAFT: scheduled, NOT STARTED. No pick has been made.')
    lines.push(
      `Format: ${session.draftType}, ${session.rounds} rounds, ${session.teamCount} teams${
        session.thirdRoundReversal ? ', third-round reversal ON' : ''
      }${session.timerSeconds ? `, ${session.timerSeconds}s per pick` : ''}.`,
    )
    if (slotOrder.length > 0) {
      lines.push(
        `Draft order: ${slotOrder
          .slice()
          .sort((a, b) => a.slot - b.slot)
          .map((e) => `${e.slot}. ${e.displayName}`)
          .join(', ')}.`,
      )
    } else {
      lines.push('Draft order has not been set yet — do not state anyone\'s pick position.')
    }
    lines.push(
      'Answer questions about settings, order and scheduling. Do NOT recommend specific picks as though the draft were underway.',
    )
    return lines.join('\n')
  }

  // ── Finished ───────────────────────────────────────────────────────────────
  if (session.status === 'completed') {
    lines.push(`DRAFT: COMPLETED. ${madeCount} picks made over ${session.rounds} rounds.`)
    if (picks.length > 0) {
      lines.push(
        `Final picks: ${picks
          .slice()
          .reverse()
          .map((p) => `${formatPickLabel(p.overall, session.teamCount)} ${p.displayName ?? 'a manager'} took ${p.playerName} (${p.position})`)
          .join('; ')}.`,
      )
    }
    lines.push('This draft is over. Do NOT suggest who to draft next.')
    return lines.join('\n')
  }

  // ── Live (in_progress / paused) ────────────────────────────────────────────
  const nextOverall = madeCount + 1
  const paused = session.status === 'paused'
  lines.push(
    `DRAFT IS ${paused ? 'PAUSED' : 'LIVE RIGHT NOW'} — ${session.draftType}, round ${session.currentRoundNum} of ${session.rounds}, ${madeCount} of ${totalPicks} picks made.`,
  )
  if (paused) {
    lines.push('It is PAUSED: nobody is on the clock and no pick can be made until it resumes.')
  }

  if (picks.length > 0) {
    lines.push(
      `Most recent picks (newest first): ${picks
        .map((p) => `${formatPickLabel(p.overall, session.teamCount)} ${p.displayName ?? 'a manager'} — ${p.playerName} (${p.position}${p.team ? `, ${p.team}` : ''})`)
        .join('; ')}.`,
    )
  }

  if (isAuction) {
    /*
     * A serpentine board does not describe an auction, and guessing a clock here
     * would be a confident invention.
     */
    lines.push(
      'This is an AUCTION: there is no pick order and nobody is "on the clock" in the snake sense. Do not state whose turn it is or predict the next pick slot.',
    )
  } else if (!paused && slotOrder.length > 0 && nextOverall <= totalPicks) {
    const upcoming = getUpcomingPickOwners(
      nextOverall,
      UPCOMING,
      session.teamCount,
      session.draftType as DraftType,
      session.thirdRoundReversal,
      slotOrder,
      totalPicks,
    )
    if (upcoming.length > 0) {
      const [onClock, ...onDeck] = upcoming
      lines.push(
        `ON THE CLOCK: ${onClock.displayName} at ${formatPickLabel(nextOverall, session.teamCount)}.`,
      )
      if (onDeck.length > 0) {
        lines.push(
          `Then: ${onDeck
            .map((o, i) => `${formatPickLabel(nextOverall + i + 1, session.teamCount)} ${o.displayName}`)
            .join(', ')}.`,
        )
      }
    }
  } else if (!paused && slotOrder.length === 0) {
    lines.push('Draft order is not on file, so do NOT say who is on the clock.')
  }

  // ── The viewer's own next turn ─────────────────────────────────────────────
  const mine = slotOrder.find((e) => e.rosterId === userId)
  if (mine && !isAuction && nextOverall <= totalPicks) {
    let theirNext: number | null = null
    for (let o = nextOverall; o <= totalPicks; o += 1) {
      const slot = getSlotInRoundForOverall({
        overall: o,
        teamCount: session.teamCount,
        draftType: session.draftType as DraftType,
        thirdRoundReversal: session.thirdRoundReversal,
      })
      if (slot === mine.slot) {
        theirNext = o
        break
      }
    }
    if (theirNext != null) {
      lines.push(
        `THIS USER drafts at slot ${mine.slot}; their next pick is ${formatPickLabel(theirNext, session.teamCount)} (${theirNext - nextOverall} picks away).`,
      )
    }
  } else if (!mine) {
    /*
     * The slot order is keyed by roster id, which is not always the viewer's user
     * id. Saying nothing beats attributing somebody else's slot to them.
     */
    lines.push('This user could not be matched to a draft slot, so do not tell them when they pick.')
  }

  lines.push(
    'RULES: use ONLY the picks above when saying who has been taken. AllFantasy never makes a pick for the user — recommend, then point them at their draft room.',
  )

  return lines.join('\n')
}
