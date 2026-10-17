import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSessionAndProfile } from "@/lib/auth-guard"
import CreateEntryChooser from "./ui"

export const runtime = "nodejs"

export default async function NewEntryPage(
  props: {
    params: Promise<{ tournamentId: string }>
  }
) {
  const params = await props.params
  const tournamentId = params.tournamentId
  const returnTo = `/bracket/${encodeURIComponent(tournamentId)}/entries/new`
  const { userId, emailVerified, profile } = await getSessionAndProfile()

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`)
  }

  if (!profile?.ageConfirmedAt) {
    redirect(`/verify?error=AGE_REQUIRED&returnTo=${encodeURIComponent(returnTo)}`)
  }

  if (!emailVerified && !profile?.phoneVerifiedAt) {
    redirect(`/verify?error=VERIFICATION_REQUIRED&returnTo=${encodeURIComponent(returnTo)}`)
  }

  const leagues = await (prisma as any).bracketLeague.findMany({
    where: {
      tournamentId,
      members: {
        some: { userId },
      },
    },
    select: {
      id: true,
      name: true,
      joinCode: true,
      ownerId: true,
      tournamentId: true,
      _count: { select: { entries: true, members: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return (
    <CreateEntryChooser
      tournamentId={tournamentId}
      leagues={leagues}
      userId={userId}
    />
  )
}
