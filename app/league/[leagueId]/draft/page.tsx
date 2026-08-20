import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeague } from '@/lib/draft/access'
import { getDraftIdFromSettings } from '@/app/league/[leagueId]/components/league-settings-modal-utils'
import { getOrCreateDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { autoMaterializeDraftForLeague } from '@/lib/league-setup/autoMaterializeDraftForLeague'
import { ensureRedraftLeagueContract } from '@/lib/redraft-core-contract'
import { triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'
import { fetchDraftIdForLeague } from '@/lib/sleeper/sync/backfillSleeperDraftIds'

export const dynamic = 'force-dynamic'

export default async function LeagueDraftResolverPage({
  params,
}: {
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params
  if (!leagueId) redirect('/dashboard')

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/draft`)}`)
  }

  const canAccess = await canAccessLeague(leagueId, userId)
  if (!canAccess) redirect('/dashboard')

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      leagueSize: true,
      leagueType: true,
      settings: true,
      // Needed to tell a draft we RUN from one we only MIRROR. Without these two the
      // Sleeper branch below reads undefined and silently does nothing.
      platform: true,
      platformLeagueId: true,
    },
  })

  if (!league) redirect('/dashboard')

  /*
   * THE IMPORT NEVER STORED draft_id, SO SETTINGS ALONE CANNOT ANSWER THIS.
   *
   * `getDraftIdFromSettings` reads `draft_id` out of the league's stored settings bundle.
   * The Sleeper importer kept twelve draft_* keys and dropped that one, so on production
   * it returned null for 0 of 56 Sleeper leagues — including all 19 that are drafting.
   *
   * A league whose draft lives on Sleeper would therefore open an empty board forever.
   * When settings cannot answer, ask Sleeper directly, once, on view. The id is then
   * persisted below so this costs one request per league rather than one per visit.
   */
  let sleeperDraftId = getDraftIdFromSettings(league.settings)
  const sleeperHosted = String(league.platform ?? '').toLowerCase() === 'sleeper'

  if (!sleeperDraftId && sleeperHosted && league.platformLeagueId) {
    sleeperDraftId = await fetchDraftIdForLeague(String(league.platformLeagueId)).catch((error) => {
      // A lookup failure must not block the page — the board renders, just unlinked.
      console.warn('[league-draft-resolver] sleeper draft id lookup failed', {
        leagueId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })
  }

  /**
   * True once we know this league's draft is run by Sleeper. Sleeper owns the slots, the
   * order and the picks; we mirror them.
   */
  const mirrorsSleeperDraft = sleeperHosted && Boolean(sleeperDraftId)

  await ensureRedraftLeagueContract(leagueId).catch((error) => {
    console.warn('[league-draft-resolver] redraft contract repair failed', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  const { session: draftSession } = await getOrCreateDraftSession(leagueId)

  const updatedDraftSession = await prisma.draftSession.update({
    where: { id: draftSession.id },
    data: {
      sportType: String(league.sport),
      ...(draftSession.status === 'pre_draft'
        ? {
            teamCount: league.leagueSize ?? draftSession.teamCount,
          }
        : {}),
      ...(sleeperDraftId
        ? {
            sleeperDraftId,
          }
        : {}),
    },
    select: {
      id: true,
      status: true,
    },
  })

  /*
   * ⚠ NEVER MATERIALIZE SLOTS FOR A DRAFT WE ONLY MIRROR.
   *
   * `autoMaterializeDraftForLeague` seats every joined human and then fills the remaining
   * slots with AI-managed ORPHAN ROSTERS. That is right for a draft we run. It is wrong
   * for a Sleeper-hosted one: those slots belong to real managers on Sleeper who simply
   * have no Roster row here yet, so filling them would invent AI teams inside somebody's
   * real league and then render them on the board as though they were participants.
   *
   * The mirror supplies the true order and picks instead.
   */
  if (updatedDraftSession.status === 'pre_draft' && !mirrorsSleeperDraft) {
    await autoMaterializeDraftForLeague(leagueId).catch((error) => {
      console.warn('[league-draft-resolver] auto materialize failed', {
        leagueId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  triggerDraftPoolPrewarmBackground(leagueId)

  redirect(`/drafts/${encodeURIComponent(updatedDraftSession.id)}`)
}
