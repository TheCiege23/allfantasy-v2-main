import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  formatPickLabel,
  getSlotInRoundForOverall,
  getUpcomingPickOwners,
} from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftType } from '@/lib/live-draft-engine/types'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import type { RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import { decideDraftPickForRoster, type PickDecisionDeps } from '@/lib/shared-services/draft/pickDecision'
import type { DraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'
import type { AuctionAdvice, AuctionPrice } from '@/lib/draft-helper/auctionAdvice'
import { parseSlotOrder } from '@/lib/competitive-edge/liveDraftManagersFacts'

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

/**
 * The auction card's advice as prompt lines: the price for the player up for bid, the best value targets, what to
 * nominate, and the user's legal maximum. Null on timeout or error — an absent block is the honest answer.
 */
export async function buildAuctionAdviceLines(
  leagueId: string,
  rosterId: string,
  deps: {
    decide?: (args: { leagueId: string; rosterId: string }) => Promise<{ advice: AuctionAdvice; scoringWindowInsight: string | null }>
    budgetMs?: number
  } = {},
): Promise<string[] | null> {
  const decide =
    deps.decide ??
    (async (args: { leagueId: string; rosterId: string }) => (await import('@/lib/shared-services/draft/auctionDecision')).buildAuctionDecision(args))
  let out: { advice: AuctionAdvice; scoringWindowInsight: string | null } | null
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deps.budgetMs ?? DRAFT_OS_BUDGET_MS)
    })
    out = await Promise.race([decide({ leagueId, rosterId }), timeout])
    if (timer) clearTimeout(timer)
  } catch {
    return null
  }
  if (!out) return null
  const { advice } = out
  const usd = (n: number) => '$' + String(n)
  const price = (p: AuctionPrice) =>
    `${p.playerName} (${p.position}${p.team ? `, ${p.team}` : ''}): market ${usd(p.marketPrice)}, worth ${usd(p.yourPrice)} to this user — ${p.reason}`
  const lines = [
    `AUCTION ADVICE for THIS USER — the same prices their draft room's card shows. Their legal maximum bid right now: ${usd(advice.maxLegalBid)}.`,
    advice.summary,
  ]
  const n = advice.nominated
  if (n) {
    const verdict =
      n.verdict === 'bid' ? `BID, up to ${usd(n.bidUpTo)}` : n.verdict === 'cannot_afford' ? 'CANNOT AFFORD — let it go' : 'LET IT GO'
    lines.push(`Up for bid now: ${price(n)}. Current bid ${n.currentBid != null ? usd(n.currentBid) : 'none yet'}. Verdict: ${verdict}.`)
  }
  if (advice.targets.length) lines.push(`Best value targets: ${advice.targets.slice(0, ALTERNATIVES).map(price).join('; ')}.`)
  if (advice.nominate) lines.push(`Nominate: ${price(advice.nominate)} (others spend on him, this user does not need him).`)
  if (out.scoringWindowInsight) lines.push(out.scoringWindowInsight)
  if (advice.caveats.length) lines.push(`Caveats: ${advice.caveats.join(' ')}`)
  lines.push('Quote ONLY these dollar figures; never invent a price. AllFantasy never bids for the user.')
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
  let viewerRosterId: string | null = null
  try {
    viewerRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  } catch {
    // Keep league context usable without guessing ownership when lookup fails.
  }
  const mine = slotOrder.find((e) => e.rosterId === viewerRosterId)
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
   * An AUCTION: the prices the draft card shows (`buildAuctionDecision`, the same call as the card's route), so
   * Chimmy can say what to bid. It used to say nothing — an auction draft got the board and no advice at all.
   */
  if (isAuction && viewerRosterId && !paused && nextOverall <= totalPicks) {
    const auctionLines = await buildAuctionAdviceLines(leagueId, viewerRosterId)
    if (auctionLines) lines.push(...auctionLines)
  }

  /*
   * The managers on the clock before this user's next pick: what each has taken in THIS draft, and —
   * only for a plan with Competitive Edge — their history in this league's past drafts. Facts the
   * user can check, under the Competitive Edge contract (lib/competitive-edge/liveDraftManagersFacts.ts).
   */
  if (mine && !isAuction && !paused && nextOverall <= totalPicks) {
    const { loadManagersAhead } = await import('@/lib/competitive-edge/liveDraftManagers')
    const ahead = await loadManagersAhead({ leagueId, userId }).catch(() => null)
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
