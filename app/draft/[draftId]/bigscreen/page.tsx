import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { BigScreenBoard } from '@/components/draft/BigScreenBoard'

export const dynamic = 'force-dynamic'

export default async function DraftBigScreenPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/draft/${draftId}/bigscreen`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) redirect('/core')
  if (context.kind === 'mock') {
    redirect(`/mock-draft/${encodeURIComponent(context.draftId)}/replay`)
  }

  return <BigScreenBoard draftId={context.draftId} />
}
