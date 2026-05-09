import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function LiveDraftByDraftIdPage({ params }: { params: { draftId: string } }) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/dashboard')
  }

  const uid = session.user.id
  const param = params.draftId

  const leagueAccess = {
    OR: [{ userId: uid }, { teams: { some: { claimedByUserId: uid } } }],
  }

  // Check if param is a DraftSession id the user can access.
  const bySession = await prisma.draftSession.findFirst({
    where: { id: param, league: leagueAccess },
    select: { id: true },
  })

  if (bySession) {
    // param is the canonical DraftSession id — redirect directly.
    redirect(`/drafts/${param}`)
  }

  // Check if param is a League id (legacy callers that pass leagueId).
  const byLeague = await prisma.league.findFirst({
    where: { id: param, ...leagueAccess },
    select: { id: true },
  })

  if (!byLeague) {
    redirect('/dashboard')
  }

  // Resolve the canonical DraftSession for this league.
  const ds = await prisma.draftSession.findFirst({
    where: { leagueId: param },
    select: { id: true },
  })

  if (!ds) {
    redirect('/dashboard')
  }

  redirect(`/drafts/${ds.id}`)
}
