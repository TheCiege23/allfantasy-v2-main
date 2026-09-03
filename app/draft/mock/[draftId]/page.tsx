import { redirect } from 'next/navigation'
import nextDynamic from 'next/dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sessionKeyMock } from '@/lib/draft/session-key'

// This file is a Server Component, so `ssr: false` isn't allowed here — plain
// dynamic() still splits the framer-motion-heavy draft room (via DraftShell)
// into its own chunk instead of the main page bundle.
const DraftRoom = nextDynamic(() => import('../../components/DraftRoom').then((m) => m.DraftRoom))

export const dynamic = 'force-dynamic'

export default async function MockDraftByDraftIdPage({ params }: { params: { draftId: string } }) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; name?: string | null }
  } | null
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/dashboard')
  }

  const room = await prisma.mockDraftRoom.findUnique({
    where: { id: params.draftId },
    select: { id: true, inviteCode: true, createdById: true },
  })
  if (!room) {
    redirect('/dashboard')
  }

  return (
    <DraftRoom
      mode="mock"
      sessionId={sessionKeyMock(room.id)}
      roomId={room.id}
      leagueId={null}
      userId={session.user.id}
      userName={session.user.name ?? 'Manager'}
      inviteCode={room.inviteCode}
      isCommissioner={room.createdById === session.user.id}
    />
  )
}
