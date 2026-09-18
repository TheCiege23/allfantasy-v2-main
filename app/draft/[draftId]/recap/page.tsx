import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { DraftRecap } from '@/components/draft/DraftRecap'

export const dynamic = 'force-dynamic'

export default async function DraftRecapPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/draft/${draftId}/recap`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) redirect('/core')
  if (context.kind === 'mock') {
    redirect(`/mock-draft/${encodeURIComponent(context.draftId)}/replay`)
  }

  return (
    <div className="min-h-screen bg-[#040915] px-4 py-6">
      <div className="mx-auto max-w-6xl">
        <DraftRecap draftId={context.draftId} />
      </div>
    </div>
  )
}
