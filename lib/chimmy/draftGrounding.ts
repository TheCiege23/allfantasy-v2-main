import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  formatPickLabel,
  getUpcomingPickOwners,
} from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftType, QueueEntry } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import type { RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import { decideDraftPickForRoster, type PickDecisionDeps } from '@/lib/shared-services/draft/pickDecision'
import type { DraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'
import { parseSlotOrder } from '@/lib/competitive-edge/liveDraftManagersFacts'
import { resolveViewerDraftIdentity, type ViewerDraftIdentity } from '@/lib/draft-room/viewerDraftIdentity'
import {
  dedupeQueueEntries,
  normalizeDraftedNameSet,
  removeDraftedPlayersFromQueue,
} from '@/lib/draft-queue-engine/queue-utils'
import { getAuctionStateFromSession, getBudgetsFromSession } from '@/lib/live-draft-engine/auction/AuctionEngine'
import {
  auctionAdviceLines,
  auctionRoomLines,
  pickClockLines,
  secondsLeftOnPick,
  viewerNextOverall,
  viewerPicksLine,
  viewerQueueLine,
  type QueuedPlayer,
} from '@/lib/chimmy/draftViewerFacts'

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

/**
 * Draft OS has to answer inside a chat turn. It assembles the league's pool (up to 800 players),
 * the AF ADP snapshot and the roster template; past this budget Chimmy answers from board state
 * alone rather than making the user wait.
 */
const DRAFT_OS_BUDGET_MS = 2500
const ALTERNATIVES = 3

/**
 * The draft room's DECISION for one roster, as prompt lines — the same decision the draft card shows.
 *
 * 🛑 THIS USED TO READ THE RECOMMENDER'S TOP CHOICE DIRECTLY, AND THE CARD DID NOT. The card runs the recommender
 * through `runDraftPickDecision`, which gates the top choice through the live pick rules (roster fit, the clock, a
 * completed roster): a player the room would refuse becomes "Skip X; consider Y". Chimmy said "take X" regardless.
 * Both now go through `decideDraftPickForRoster` (lib/shared-services/draft/pickDecision.ts), and Chimmy relays the
 * decision's own "what to do".
 *
 * Null on timeout, error, or no recommendation: an absent block is the honest answer.
 */
export async function buildDraftOsRecommendationLines(
  leagueId: string,
  rosterId: string,
  deps: {
    /** The asker — recorded on the decision. */
    userId?: string
    buildContext?: (input: { leagueId: string; rosterId: string }) => Promise<DraftDecisionContext>
    recommend?: (input: unknown) => RecommendationResult
    snapshot?: PickDecisionDeps['snapshot']
    validateRosterFit?: PickDecisionDeps['validateRosterFit']
    budgetMs?: number
  } = {},
): Promise<string[] | null> {
  let outcome: Awaited<ReturnType<typeof decideDraftPickForRoster>> | null
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deps.budgetMs ?? DRAFT_OS_BUDGET_MS)
    })
    const work = decideDraftPickForRoster(
      { leagueId, userId: deps.userId ?? '', rosterId },
      {
        ...(deps.buildContext ? { context: deps.buildContext } : {}),
        ...(deps.recommend ? { recommend: deps.recommend as PickDecisionDeps['recommend'] } : {}),
        ...(deps.snapshot ? { snapshot: deps.snapshot } : {}),
        ...(deps.validateRosterFit ? { validateRosterFit: deps.validateRosterFit } : {}),
      },
    )
    outcome = await Promise.race([work, timeout])
    if (timer) clearTimeout(timer)
  } catch {
    return null
  }
  if (!outcome || !outcome.ok) return null
  const { decision, engineResult: result } = outcome
  const top = decision.recommended_actions[0]
  if (!top) return null

  const describe = (p: { playerName: string; position: string; team?: string | null; adp?: number | null }) =>
    `${p.playerName} (${p.position}${p.team ? `, ${p.team}` : ''}${p.adp != null ? `, ADP ${Math.round(p.adp * 10) / 10}` : ''})`
  const a = decision.four_answers
  const lines = [
    `DRAFT DECISION for THIS USER's pick — the same decision their draft room's card shows (ranked by the draft engine, then checked against the live pick rules).`,
    `What to do: ${a.what_to_do}`,
    `Why: ${a.why_it_matters}`,
    `Ranked: ${decision.recommended_actions.slice(0, 1 + ALTERNATIVES).map((x) => `${x.rank}. ${describe(x)} — ${x.reason}`).join('; ')}.`,
  ]
  const refused = decision.rule_verdicts.filter((v) => v.verdict === 'illegal')
  if (refused.length > 0) {
    lines.push(`🛑 The room would REFUSE ${top.playerName} for this user right now: ${refused[0]!.message} Do NOT tell them to take ${top.playerName}; relay "What to do" above.`)
  }
  lines.push(`Confidence: ${a.how_confident}`)
  // This draft's specifics (2026-11-14): the scoring window, a live position run, the teams ahead.
  for (const line of [result?.scoringWindowInsight, result?.runInsight, result?.teamsAheadInsight]) {
    if (line) lines.push(line)
  }
  if (result?.teamsAheadInsight) {
    lines.push('The teams-ahead line counts open roster slots only; do not describe any manager\'s personality or predict a specific manager\'s pick.')
  }
  const notes = [result?.scarcityInsight, result?.reachWarning, result?.valueWarning, result?.byeNote].filter(
    (n): n is string => Boolean(n && n.trim()),
  )
  if (notes.length > 0) lines.push(`Draft OS notes: ${notes.join(' ')}`)
  if (top.adpIsReal === false) {
    lines.push('Market ADP is missing for this player, so do not describe the pick as a reach or a value against ADP.')
  }
  lines.push('Present this as a recommendation the user can take or leave; they make the pick.')
  return lines
}

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
  sleeperDraftId?: string | null
  pausedRemainingSeconds?: number | null
  overnightFrozenPickSeconds?: number | null
  auctionState?: unknown
  auctionBudgets?: unknown
  auctionBudgetPerTeam?: number | null
}

/**
 * The viewer's queue for this draft — the `DraftQueue` row the draft room saves — with drafted players
 * removed IN MEMORY. ⚠ READ ONLY: `loadDraftQueueForUser` prunes by UPDATING the row, and a question
 * to Chimmy must never change draft state (same rule as `loadPreparedQueue` in lib/core-app/draftHq.ts,
 * through the same queue-utils). Null when the read fails, so a broken read is never "empty queue".
 */
export async function readViewerDraftQueue(
  sessionId: string,
  userId: string,
  draftedNames: ReadonlyArray<{ playerName: string }>,
): Promise<QueuedPlayer[] | null> {
  try {
    const row = await prisma.draftQueue.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
      select: { order: true },
    })
    const raw = Array.isArray(row?.order) ? (row!.order as unknown as QueueEntry[]) : []
    const named = raw.filter((e) => typeof e?.playerName === 'string' && e.playerName.trim().length > 0)
    const { queue } = removeDraftedPlayersFromQueue(dedupeQueueEntries(named), normalizeDraftedNameSet([...draftedNames]))
    return queue.map((e) => ({ playerName: e.playerName.trim(), position: e.position?.trim() || null, team: e.team ?? null }))
  } catch {
    return null
  }
}

/** Every pick in the session, the few columns the viewer's side needs. Empty on a failed read. */
async function readAllPicks(sessionId: string): Promise<Array<{ overall: number; rosterId: string; playerName: string; position: string | null }>> {
  try {
    const rows = await prisma.draftPick.findMany({
      where: { sessionId },
      select: { overall: true, rosterId: true, playerName: true, position: true },
    })
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

const AUCTION_BUDGET_MS = 2500

/** Draft OS's auction read for the viewer's roster, inside a chat-sized budget. Null on timeout or error. */
async function auctionAdviceWithin(leagueId: string, rosterId: string): Promise<string[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), AUCTION_BUDGET_MS)
    })
    const work = (async () => {
      const { buildAuctionDecision } = await import('@/lib/shared-services/draft/auctionDecision')
      return (await buildAuctionDecision({ leagueId, rosterId })).advice
    })()
    const advice = await Promise.race([work, timeout])
    return advice ? auctionAdviceLines(advice) : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}


/**
 * Draft state for the league in scope. Returns null when the league has no draft
 * session at all, so the prompt gains no empty section.
 */
export async function buildDraftContext(leagueId: string, userId: string): Promise<string | null> {
  if (!leagueId || !userId) return null

  let session: SessionRow | null
  try {
    session = (await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
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
        sleeperDraftId: true,
        pausedRemainingSeconds: true,
        overnightFrozenPickSeconds: true,
        auctionState: true,
        auctionBudgets: true,
        auctionBudgetPerTeam: true,
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

  /*
   * Who the viewer is in THIS draft, resolved once — native and Sleeper-mirrored alike (see
   * lib/draft-room/viewerDraftIdentity.ts for why a roster-id match alone failed every Sleeper draft).
   */
  const identity: ViewerDraftIdentity = await resolveViewerDraftIdentity({
    leagueId,
    userId,
    slotOrder,
    isSleeperMirror: Boolean(session.sleeperDraftId),
  }).catch(() => ({ rosterId: null, slotEntry: null, pickIds: [] }))
  const mine = identity.slotEntry
  const ownIds = new Set(identity.pickIds)
  const allPicks = await readAllPicks(session.id)
  const myPicks = allPicks.filter((p) => ownIds.has(p.rosterId))

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
    if (mine) lines.push(`THIS USER drafts from slot ${mine.slot}.`)
    const queue = await readViewerDraftQueue(session.id, userId, allPicks)
    if (queue && queue.length > 0) lines.push(viewerQueueLine(queue))
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
    if (myPicks.length > 0) lines.push(viewerPicksLine(myPicks, session.teamCount))
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

  let viewerOnClock = false
  if (isAuction) {
    /*
     * A serpentine board does not describe an auction, and guessing a clock here
     * would be a confident invention.
     */
    lines.push(
      'This is an AUCTION: there is no pick order and nobody is "on the clock" in the snake sense. Do not state whose turn it is or predict the next pick slot.',
    )
    /*
     * The room itself (owner's spec, 2026-11-16): who is on the block, the bid, everyone's money and
     * open spots — read from the session the auction engine writes, through its own parsers.
     */
    const state = getAuctionStateFromSession(session)
    const budgets = getBudgetsFromSession(session)
    const rawBudgets = session.auctionBudgets
    const picksBy = new Map<string, number>()
    for (const p of allPicks) picksBy.set(p.rosterId, (picksBy.get(p.rosterId) ?? 0) + 1)
    const nameOf = (rosterId: string | null) => (rosterId ? slotOrder.find((e) => e.rosterId === rosterId)?.displayName || null : null)
    const bidEnd = state?.bidTimerEndAt ? Date.parse(state.bidTimerEndAt) : NaN
    lines.push(
      ...auctionRoomLines({
        nomination: state?.currentNomination
          ? { playerName: state.currentNomination.playerName, position: state.currentNomination.position, team: state.currentNomination.team ?? null }
          : null,
        currentBid: state?.currentBid ?? 0,
        highBidderName: nameOf(state?.currentBidderRosterId ?? null),
        minNextBid: state?.minNextBid ?? 0,
        bidSecondsLeft: Number.isFinite(bidEnd) && !paused ? Math.max(0, Math.ceil((bidEnd - Date.now()) / 1000)) : null,
        teams: slotOrder
          .map((e) => ({
            name: e.displayName,
            budget: Number(budgets[e.rosterId] ?? session.auctionBudgetPerTeam ?? 0),
            openSlots: Math.max(0, session.rounds - (picksBy.get(e.rosterId) ?? 0)),
            isViewer: ownIds.has(e.rosterId),
          }))
          .sort((a, b) => b.budget - a.budget),
        budgetsAssumed: !rawBudgets || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets),
      }),
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
      viewerOnClock = Boolean(mine && onClock.slot === mine.slot)
      lines.push(
        `ON THE CLOCK: ${viewerOnClock ? 'THIS USER' : onClock.displayName} at ${formatPickLabel(nextOverall, session.teamCount)}.`,
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

  // ── The pick clock: time left, slow-draft and overnight states, and the short-answer rule ────
  if (!isAuction) {
    lines.push(
      ...pickClockLines({
        status: session.status,
        timerSeconds: session.timerSeconds,
        timerEndAt: session.timerEndAt ? new Date(session.timerEndAt) : null,
        pausedRemainingSeconds: session.pausedRemainingSeconds ?? null,
        overnightFrozenPickSeconds: session.overnightFrozenPickSeconds ?? null,
        now: new Date(),
        viewerOnClock,
      }),
    )
  }

  // ── The viewer's own next turn ─────────────────────────────────────────────
  const viewerRosterId = identity.rosterId
  if (mine && !isAuction && nextOverall <= totalPicks) {
    const theirNext = viewerNextOverall({
      fromOverall: nextOverall,
      totalPicks,
      slot: mine.slot,
      teamCount: session.teamCount,
      draftType: session.draftType,
      thirdRoundReversal: session.thirdRoundReversal,
    })
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

  // ── The viewer's side: their picks and their queue (owner's spec, 2026-11-16) ───────────────
  if (mine || myPicks.length > 0) lines.push(viewerPicksLine(myPicks, session.teamCount))
  const queue = await readViewerDraftQueue(session.id, userId, allPicks)
  if (queue) lines.push(viewerQueueLine(queue))

  /* The auction engine's read for this user: max legal bid, the call on the player up, targets. */
  if (isAuction && !paused && viewerRosterId && (mine || myPicks.length > 0)) {
    const advice = await auctionAdviceWithin(leagueId, viewerRosterId)
    if (advice) lines.push(...advice)
  }

  /*
   * Who to take. Only for a running snake/linear draft and a matched roster: an auction needs
   * budget logic this engine does not apply, a paused draft has no pick to make, and an unmatched
   * viewer would be advised from someone else's roster.
   */
  if (mine && viewerRosterId && !isAuction && !paused && nextOverall <= totalPicks) {
    const draftOsLines = await buildDraftOsRecommendationLines(leagueId, viewerRosterId, { userId })
    if (draftOsLines) lines.push(...draftOsLines)
  }

  /*
   * The managers on the clock before this user's next pick: what each has taken in THIS draft, and —
   * only for a plan with Competitive Edge — their history in this league's past drafts. Facts the
   * user can check, under the Competitive Edge contract (lib/competitive-edge/liveDraftManagersFacts.ts).
   */
  if (mine && !isAuction && !paused && nextOverall <= totalPicks) {
    const { loadManagersAhead } = await import('@/lib/competitive-edge/liveDraftManagers')
    const ahead = await loadManagersAhead({ leagueId, userId, viewerSlot: mine.slot }).catch(() => null)
    if (ahead && ahead.managers.length > 0) {
      lines.push(
        `MANAGERS PICKING BEFORE THIS USER'S NEXT TURN (facts only — never label a manager's style or say what they will pick; state the facts and let the user decide): ${ahead.managers
          .map((m) => `${m.name}: ${m.thisDraft}${m.history.length ? ` Past drafts in this league: ${m.history.join(' ')}` : ''}`)
          .join(' | ')}`,
      )
      if (ahead.history === 'locked') {
        lines.push("Their history in this league's past drafts is part of Competitive Edge, which this user's plan does not include. Do not describe it.")
      }
    }
  }

  lines.push(
    'RULES: use ONLY the picks above when saying who has been taken. AllFantasy never makes a pick for the user — recommend, then point them at their draft room.',
  )

  return lines.join('\n')
}
