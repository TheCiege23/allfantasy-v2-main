import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { DraftBoard } from '@/components/draft/DraftBoard'

export const dynamic = 'force-dynamic'

/**
 * Canonical "draft room" URL — deep links from league home / notifications.
 * Live snake drafts redirect to /drafts/[draftId]; mock drafts render inline.
 */
export default async function DraftRoomPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/draft/room/${draftId}`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) redirect('/core')

  if (context.kind === 'live') {
    redirect(`/drafts/${encodeURIComponent(context.draftId)}`)
  }

  /*
   * Mock draft — render inline. A solid room ground and `.af-draft-dark` (2026-11-05): the board is
   * translucent black over whatever sits behind it, so in light mode it drew white text on a light
   * page. On its own dark ground it can opt out of the light-mode clamp like the other rooms do.
   */
  return (
    <div className="af-draft-dark min-h-screen bg-[#070b16] text-white">
      <div className="mx-auto max-w-6xl p-4">
        <DraftBoard kind="mock" draftId={context.draftId} canManage />
      </div>
    </div>
  )
}
