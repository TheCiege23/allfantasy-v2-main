import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { ensureZombieSeasonActivated } from './activateNativeZombieLeague'

/**
 * Activate every zombie league that has finished its draft but is still in `setup` / `registering`.
 *
 * 🛑 ACTIVATION USED TO RUN ONLY WHEN SOMEONE OPENED THE LEAGUE. `ensureZombieSeasonActivated` is
 * called from `runPostDraftFinalizationArtifacts`, which runs when the draft completes and then on
 * roster / draft-room requests. A league whose activation failed once (Zombie Chimmy Test,
 * 2026-11-22: the Whisperer draw refused its AI seats) stayed in `setup` after the fix deployed,
 * because nothing retried until a manager happened to open the roster page. The scheduled resolver
 * only reads `active` leagues, so until then no week could resolve.
 *
 * Called from the five-minute score-sync tick. Activation is idempotent: it flips the status only
 * from `setup` / `registering`, never re-picks a Whisperer, and a league that already moved on is
 * skipped by the status filter below.
 */
export async function activateDraftedZombieLeagues(): Promise<{
  checked: number
  activated: number
  failures: Array<{ leagueId: string; error: string }>
}> {
  const pending = await prisma.zombieLeague.findMany({
    where: { status: { in: ['setup', 'registering'] } },
    select: { leagueId: true },
  })

  let checked = 0
  let activated = 0
  const failures: Array<{ leagueId: string; error: string }> = []

  for (const { leagueId } of pending) {
    // The league's current draft must be finished: a league still drafting starts when it completes.
    const draft = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { status: true },
    })
    if (draft?.status !== 'completed') continue
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!season) continue

    checked++
    try {
      const result = await ensureZombieSeasonActivated({ leagueId, redraftSeasonId: season.id })
      if (result.ok && result.activated) activated++
    } catch (error) {
      // Reported, not thrown: one league's refusal (e.g. an unfilled seat) must not stop the others.
      failures.push({ leagueId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { checked, activated, failures }
}
