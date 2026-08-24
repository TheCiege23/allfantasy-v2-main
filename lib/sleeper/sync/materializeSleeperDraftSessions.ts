/**
 * Materialize DraftSessions for Sleeper leagues entering draft state.
 *
 * `backfillSleeperDraftIds` deliberately refused to CREATE sessions — that was a real
 * write decision left visible rather than made silently. This is that decision, made
 * narrowly: only leagues whose stored `League.status` (Sleeper's own `league.status`,
 * refreshed by the exec-sync collector) says `pre_draft` or `drafting` get a session,
 * so a league entering draft state grows a board without anyone ever visiting
 * `/league/[leagueId]/draft`.
 *
 * ⚠ NEVER seats rosters or invents slots. `getOrCreateDraftSession` writes the session
 * row only; the draft-tick mirror (`mirrorActiveSleeperDrafts`) supplies the true order
 * and picks once `sleeperDraftId` is linked. Compare the resolver at
 * app/league/[leagueId]/draft/page.tsx, which skips `autoMaterializeDraftForLeague` for
 * mirrored drafts for exactly this reason.
 *
 * Id-linking is scoped to draft-state leagues on purpose: linking dormant or completed
 * leagues stays a manual decision (scripts/backfill-sleeper-draft-ids.ts).
 */
import { prisma } from '@/lib/prisma'
import { getOrCreateDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { backfillSleeperDraftIds } from '@/lib/sleeper/sync/backfillSleeperDraftIds'

export type MaterializeSleeperDraftSessionsResult = {
  /** Sleeper leagues in pre_draft/drafting with no DraftSession at the start of this run. */
  leaguesMissingSession: number
  sessionsCreated: number
  /** Sessions that received a sleeperDraftId in the id-link pass. */
  idsLinked: number
  /** League is in draft state here but has no draft object upstream yet — normal, retried next tick. */
  noDraftUpstream: number
  failed: number
  failures: Array<{ leagueId: string; reason: string }>
}

export async function materializeSleeperDraftSessions(
  opts: { maxLeagues?: number } = {},
): Promise<MaterializeSleeperDraftSessionsResult> {
  const take = Math.min(Math.max(opts.maxLeagues ?? 25, 1), 100)

  const missing = await prisma.league.findMany({
    where: {
      platform: 'sleeper',
      status: { in: ['pre_draft', 'drafting'] },
      draftSessions: { is: null },
    },
    select: { id: true },
    take,
  })

  const result: MaterializeSleeperDraftSessionsResult = {
    leaguesMissingSession: missing.length,
    sessionsCreated: 0,
    idsLinked: 0,
    noDraftUpstream: 0,
    failed: 0,
    failures: [],
  }

  for (const league of missing) {
    try {
      const { created } = await getOrCreateDraftSession(league.id)
      if (created) result.sessionsCreated += 1
    } catch (e) {
      // One league's bad settings must not stop the rest.
      result.failed += 1
      result.failures.push({
        leagueId: league.id,
        reason: e instanceof Error ? e.message.slice(0, 120) : 'session create failed',
      })
    }
  }

  // Link sleeperDraftId for every drafting/pre-draft session still missing one —
  // including the rows just created above. One Sleeper request per missing id.
  const activeDraftLeagues = await prisma.league.findMany({
    where: { platform: 'sleeper', status: { in: ['pre_draft', 'drafting'] } },
    select: { id: true },
    take: 200,
  })

  if (activeDraftLeagues.length > 0) {
    const linked = await backfillSleeperDraftIds({
      maxLeagues: take,
      leagueIds: activeDraftLeagues.map((l) => l.id),
    })
    result.idsLinked = linked.resolved
    result.noDraftUpstream = linked.noDraftUpstream
    result.failed += linked.failed
    result.failures.push(...linked.failures)
  }

  return result
}
