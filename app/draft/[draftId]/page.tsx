import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'

export const dynamic = 'force-dynamic'

export default async function DraftRouterPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/draft/${draftId}`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) {
    redirect('/dashboard')
  }

  if (context.kind === 'mock') {
    redirect(`/mock-draft?draftId=${encodeURIComponent(context.draftId)}`)
  }

  if (context.routeType === 'auction') {
    redirect(`/draft/${encodeURIComponent(context.draftId)}/auction`)
  }

  if (context.routeType === 'lottery') {
    redirect(`/draft/${encodeURIComponent(context.draftId)}/lottery`)
  }

  redirect(`/drafts/${encodeURIComponent(context.draftId)}`)
}
