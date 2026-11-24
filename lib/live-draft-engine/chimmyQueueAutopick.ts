import 'server-only'

import { prisma } from '@/lib/prisma'
import { rosterManagerKey } from '@/lib/league/rosterManager'
import { getViewerAutopickPreference } from '@/lib/live-draft-engine/LiveDraftAutopickPreferenceService'

/**
 * "Chimmy Queue" auto-pick (`LiveDraftAutopickPreference.mode = 'ai_queue'`, AF Pro) for the manager
 * of this roster in this draft.
 *
 * Until 2026-11-23 the mode was stored, Pro-gated and announced ("Chimmy queue autopick is enabled")
 * but nothing at pick time read it, so a Pro manager who chose it got exactly the Standard pick.
 * What it does now: the manager's queue still goes first, unchanged; when the queue gives no pick,
 * Chimmy picks for this team's needs (the draft helper's need-based recommendation) instead of the
 * league's plain best-available-by-ADP fallback.
 *
 * Pro lapsing is handled by `getViewerAutopickPreference`, which reads a Pro mode back as `standard`.
 */
export async function personalChimmyQueueOn(draftSessionId: string, rosterId: string): Promise<boolean> {
  return (await chimmyQueueManagerFor(draftSessionId, rosterId)) !== null
}

/**
 * The manager whose Chimmy Queue is on for this roster in this draft, or null. The pick is then the Draft OS
 * decision for that manager's roster (`draftOsChimmyQueuePick`), the one the draft card and Chimmy show.
 */
export async function chimmyQueueManagerFor(draftSessionId: string, rosterId: string): Promise<string | null> {
  const roster = await prisma.roster.findUnique({ where: { id: rosterId }, select: { platformUserId: true, managerUserId: true } })
  const userId = (roster ? rosterManagerKey(roster) : null) ?? ''
  if (!userId || userId.startsWith('orphan-') || userId.startsWith('ai-manager-')) return null
  const pref = await getViewerAutopickPreference(draftSessionId, userId)
  return pref.enabled && pref.mode === 'ai_queue' ? userId : null
}

/**
 * A Draft OS read on the draft clock gets this long; past it the clock picks from the existing recommender.
 * Chimmy's chat budget for the same decision is 2.5s (lib/chimmy/draftGrounding.ts).
 */
export const CHIMMY_QUEUE_DRAFT_OS_BUDGET_MS = 3000

export type ChimmyQueueBoardEntry = { playerName: string; position: string }

export type DraftOsChimmyQueuePick<T extends ChimmyQueueBoardEntry> = {
  entry: T
  reason: string
  /** 1 = the decision's own pick (what the card says to do); higher = a later player in the decision's ranking. */
  decisionRank: number
}

type DecideFn = typeof import('@/lib/shared-services/draft/pickDecision').decideDraftPickForRoster
type EffectiveFn = typeof import('@/lib/shared-services/draft/pickDecision').engineResultForDecision

const norm = (v: string) => v.trim().toLowerCase()

/** The board row for a player the decision named: name and position, or name alone when only one row has it. */
function onBoard<T extends ChimmyQueueBoardEntry>(board: readonly T[], name: string, position: string): T | null {
  const byName = board.filter((e) => norm(e.playerName) === norm(name))
  return byName.find((e) => e.position.trim().toUpperCase() === position.trim().toUpperCase()) ?? (byName.length === 1 ? byName[0]! : null)
}

/**
 * CHIMMY QUEUE PICKS WHAT THE DRAFT CARD SAYS (2026-11-24).
 *
 * 🛑 THE CLOCK COULD PICK A DIFFERENT PLAYER THAN CHIMMY HAD RECOMMENDED. `af4f5527c` made Chimmy Queue's timeout
 * pick run the recommender itself, with its own roster slots, and label the result "Chimmy's pick for your team" —
 * while the draft card (`DraftDecisionOsCard`) and Chimmy's chat answer read `decideDraftPickForRoster`, whose
 * context reads the league rules through Draft OS (`readDraftRosterRules`), carries this draft's projections, byes
 * and runs, and gates the top choice through the live pick rules. Same label, two engines' inputs, two players.
 *
 * Now the pick is the decision's: the player the card would say to draft (`engineResultForDecision` — "Skip X;
 * consider Y" means Y), taken from `board`, the clock's own vetted pool (undrafted, unrostered, eligible, the starter
 * guard). If that player is not on `board`, the next one in the decision's ranking that is (a top choice the live
 * rules refused is never taken).
 *
 * Null — and the caller keeps its existing recommender — on an auction, no decision, a decision with no player on
 * `board`, any error, or past `budgetMs`. Never throws.
 */
export async function draftOsChimmyQueuePick<T extends ChimmyQueueBoardEntry>(
  args: { leagueId: string; userId: string; rosterId: string; draftType: string; board: readonly T[] },
  deps: { decide?: DecideFn; effective?: EffectiveFn; budgetMs?: number } = {},
): Promise<DraftOsChimmyQueuePick<T> | null> {
  if (String(args.draftType).toLowerCase() === 'auction' || args.board.length === 0) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const mod = deps.decide && deps.effective ? null : await import('@/lib/shared-services/draft/pickDecision')
    const decide = deps.decide ?? mod!.decideDraftPickForRoster
    const effective = deps.effective ?? mod!.engineResultForDecision
    // Read-only work: past the budget it is left to finish on its own; its result and any error are dropped.
    const work = decide({ leagueId: args.leagueId, userId: args.userId, rosterId: args.rosterId }).catch(() => null)
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deps.budgetMs ?? CHIMMY_QUEUE_DRAFT_OS_BUDGET_MS)
    })
    const outcome = await Promise.race([work, timeout])
    if (!outcome || !outcome.ok) return null
    const result = effective(outcome)
    if (!result?.recommendation) return null
    // The card's pick first, then its ranking. A top choice the rules refused is already gone from `result`.
    const ranked = [result.recommendation, ...result.alternatives].map((r) => ({ name: r.player.name, position: r.player.position, reason: r.reason }))
    const seen = new Set<string>()
    let rank = 0
    for (const r of ranked) {
      const key = `${norm(r.name)}|${norm(r.position)}`
      if (seen.has(key)) continue
      seen.add(key)
      rank += 1
      const entry = onBoard(args.board, r.name, r.position)
      if (entry) return { entry, reason: r.reason, decisionRank: rank }
    }
    return null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
