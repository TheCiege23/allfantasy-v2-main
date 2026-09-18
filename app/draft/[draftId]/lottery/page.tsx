import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { LotteryDraw } from '@/components/draft/LotteryDraw'

export const dynamic = 'force-dynamic'

export default async function LotteryDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/draft/${draftId}/lottery`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) redirect('/core')
  if (context.kind === 'mock') {
    redirect(`/mock-draft?draftId=${encodeURIComponent(context.draftId)}`)
  }

  return (
    <div className="min-h-screen bg-[#040915] px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <LotteryDraw draftId={context.draftId} />
      </div>
    </div>
  )
}
