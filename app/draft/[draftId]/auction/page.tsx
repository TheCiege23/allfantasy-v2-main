import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { DraftBoard } from '@/components/draft/DraftBoard'
import { loadDraftRoomLeagueFacts } from '@/lib/draft-room/loadDraftRoomLeagueFacts'
import { normalizeLeagueConcept } from '@/lib/draft-room/leagueAccent'
import { SeasonDraftAssistant } from '@/components/tournament/SeasonDraftAssistant'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default async function AuctionDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/draft/${draftId}/auction`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) redirect('/core')

  if (context.kind === 'mock') {
    redirect(`/mock-draft?draftId=${encodeURIComponent(context.draftId)}`)
  }

  // Room v2 league note (an auction has no slot salaries). Never fails the page.
  const leagueFacts = await loadDraftRoomLeagueFacts({
    leagueId: context.leagueId,
    concept: normalizeLeagueConcept(context.leagueType, { isDynasty: context.isDynasty }),
    draftType: context.draftType,
    rounds: context.rounds,
    teamCount: context.teamCount,
  }).catch(() => null)

  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <SeasonDraftAssistant leagueId={context.leagueId} userId={userId} />
      </Suspense>
      <DraftBoard
        kind="live"
        draftId={context.draftId}
        leagueId={context.leagueId}
        leagueName={context.leagueName}
        sport={context.sport}
        isDynasty={context.isDynasty}
        isCommissioner={context.isCommissioner}
        formatType={context.formatType}
        leagueType={context.leagueType}
        leagueFacts={leagueFacts}
      />
    </div>
  )
}
