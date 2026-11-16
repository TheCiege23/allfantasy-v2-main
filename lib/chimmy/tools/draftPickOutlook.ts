import 'server-only'

/**
 * `get_draft_pick_outlook` (AF Pro): which of the viewer's targets are likely GONE before their next
 * pick in a live snake/linear draft. Owner's spec, 2026-11-16: market ADP plus the open starting slots
 * of the teams picking first, and — for a plan that includes it — those managers' league draft history.
 *
 * Targets are the viewer's own queue (their order) plus Draft OS's shortlist, priced by the SAME
 * rankings the draft room uses (`computeDraftPlayerRankings` over `buildDraftDecisionContext`), so the
 * ADP here is the room's ADP and a synthetic ADP is reported as "cannot judge", never as a judgement.
 *
 * Read-only, and inside a chat-sized budget: past it the outlook says what it could not compute.
 */
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { parseSlotOrder } from '@/lib/competitive-edge/liveDraftManagersFacts'
import { resolveViewerDraftIdentity } from '@/lib/draft-room/viewerDraftIdentity'
import { describeOpenSlotsAhead } from '@/lib/draft-helper/draftContextSignals'
import { readViewerDraftQueue } from '@/lib/chimmy/draftGrounding'
import { pickOutlookLines, QUEUE_SHOWN, viewerNextOverall, type OutlookTarget } from '@/lib/chimmy/draftViewerFacts'

const RANKINGS_BUDGET_MS = 2500
const DRAFT_OS_SHORTLIST = 5

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

type Rankings = {
  scored: Array<{ player: { name: string; position: string; team?: string | null }; adp: number; adpIsReal: boolean; totalScore: number }>
  openAhead: Array<{ position: string; teams: number; of: number }>
}

async function rankingsWithin(leagueId: string, rosterId: string): Promise<Rankings | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), RANKINGS_BUDGET_MS)
    })
    const work = (async () => {
      const { buildDraftDecisionContext } = await import('@/lib/shared-services/draft/DraftContextAssembler')
      const { computeDraftPlayerRankings } = await import('@/lib/draft-helper/RecommendationEngine')
      const ctx = await buildDraftDecisionContext({ leagueId, rosterId })
      return computeDraftPlayerRankings(ctx.engineInput as Parameters<typeof computeDraftPlayerRankings>[0]) as Rankings | null
    })()
    return await Promise.race([work, timeout])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function buildDraftPickOutlook(leagueId: string | null, userId: string | null): Promise<string> {
  if (!leagueId) return 'NO LEAGUE IS SELECTED. Ask which league\'s draft they mean.'
  if (!userId) return 'No signed-in user was verified, so no draft was read.'

  let session: {
    id: string; status: string; draftType: string; rounds: number; teamCount: number
    thirdRoundReversal: boolean; slotOrder: unknown; sleeperDraftId: string | null
  } | null = null
  try {
    session = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { id: true, status: true, draftType: true, rounds: true, teamCount: true, thirdRoundReversal: true, slotOrder: true, sleeperDraftId: true },
    })
  } catch {
    return 'The draft could not be read right now. Say so; do not guess who will be gone.'
  }
  if (!session) return 'This league has no draft on file.'
  if (session.status !== 'in_progress') {
    return session.status === 'paused'
      ? 'The draft is PAUSED, so nobody is picking; the outlook applies once it resumes.'
      : `The draft is ${session.status === 'completed' ? 'over' : 'not running yet'}, so there is no next pick to judge.`
  }
  if (session.draftType === 'auction') return 'This is an AUCTION: there is no pick order, so "gone before my pick" does not apply. Use the auction room read from get_current_draft_board.'

  const slotOrder = parseSlotOrder(session.slotOrder)
  const identity = await resolveViewerDraftIdentity({ leagueId, userId, slotOrder, isSleeperMirror: Boolean(session.sleeperDraftId) })
  if (!identity.slotEntry) return 'This user could not be matched to a draft slot, so their next pick is unknown. Do not guess it.'

  let picks: Array<{ playerName: string }> = []
  try {
    picks = await prisma.draftPick.findMany({ where: { sessionId: session.id }, select: { playerName: true } })
  } catch {
    return 'The picks made so far could not be read, so the outlook cannot be computed. Say so.'
  }
  const teamCount = Math.max(1, session.teamCount)
  const totalPicks = Math.max(0, session.rounds) * teamCount
  const nextOverall = picks.length + 1
  const myNext = viewerNextOverall({
    fromOverall: nextOverall,
    totalPicks,
    slot: identity.slotEntry.slot,
    teamCount,
    draftType: session.draftType,
    thirdRoundReversal: session.thirdRoundReversal,
  })
  if (myNext == null) return 'This user has no picks left in this draft.'
  if (myNext === nextOverall) {
    return 'THIS USER IS ON THE CLOCK NOW — nobody picks before them, so nothing can be taken first. Give the pick from get_current_draft_board.'
  }

  const [queue, rankings] = await Promise.all([
    readViewerDraftQueue(session.id, userId, picks),
    identity.rosterId ? rankingsWithin(leagueId, identity.rosterId) : Promise.resolve(null),
  ])

  const byName = new Map((rankings?.scored ?? []).map((r) => [nameKey(r.player.name), r]))
  const targets: OutlookTarget[] = []
  const seen = new Set<string>()
  for (const q of (queue ?? []).slice(0, QUEUE_SHOWN)) {
    const key = nameKey(q.playerName)
    if (seen.has(key)) continue
    seen.add(key)
    const row = byName.get(key)
    targets.push({ name: q.playerName, position: q.position ?? row?.player.position ?? '—', team: q.team, adp: row?.adp ?? null, adpIsReal: row?.adpIsReal ?? false, from: 'queue' })
  }
  const shortlist = [...(rankings?.scored ?? [])].sort((a, b) => b.totalScore - a.totalScore).slice(0, DRAFT_OS_SHORTLIST)
  for (const r of shortlist) {
    const key = nameKey(r.player.name)
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ name: r.player.name, position: r.player.position, team: r.player.team ?? null, adp: r.adp, adpIsReal: r.adpIsReal, from: 'draft_os' })
  }
  if (targets.length === 0) {
    return 'No targets to judge: the queue is empty and the Draft OS rankings could not be computed in time. Suggest they queue a few players, or ask again.'
  }

  let historyLines: string[] = []
  try {
    const { loadManagersAhead } = await import('@/lib/competitive-edge/liveDraftManagers')
    const ahead = await loadManagersAhead({ leagueId, userId, viewerSlot: identity.slotEntry.slot })
    if (ahead?.history === 'shown') {
      historyLines = ahead.managers.filter((m) => m.history.length > 0).map((m) => `${m.name}: ${m.history.join(' ')}`)
    }
  } catch {
    historyLines = []
  }

  const lines = pickOutlookLines({
    targets,
    nextOverall,
    myNextOverall: myNext,
    teamCount,
    openSlotsLine: rankings ? describeOpenSlotsAhead(rankings.openAhead, myNext - nextOverall) : null,
    historyLines,
  })
  if (!rankings) lines.push('Draft OS rankings did not finish in time, so queued players have no ADP here; say the outlook is partial.')
  return lines.join('\n')
}
