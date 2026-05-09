import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { DraftBoard } from '@/components/draft/DraftBoard'

export const dynamic = 'force-dynamic'

export default async function SnakeDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/draft/${draftId}/snake`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) redirect('/dashboard')

  if (context.kind === 'live') {
    redirect(`/drafts/${encodeURIComponent(context.draftId)}`)
  }

  // Mock draft — render inline (unchanged behavior)
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl p-4">
        <DraftBoard kind="mock" draftId={context.draftId} canManage />
      </div>
    </div>
  )
}
