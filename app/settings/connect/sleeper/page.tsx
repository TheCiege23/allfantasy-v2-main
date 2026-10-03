import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ConnectSleeperForm, { ConnectSleeperIntro } from "./ConnectSleeperForm"

export default async function ConnectSleeperPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/settings/connect/sleeper")
  }

  // An existing link is shown, not overwritten: discovery never replaces one (first-write-wins).
  const linked = await prisma.userProfile
    .findUnique({
      where: { userId: session!.user!.id! },
      select: { sleeperUserId: true, sleeperUsername: true },
    })
    .catch(() => null)
  const currentLink = linked?.sleeperUserId
    ? { sleeperUserId: linked.sleeperUserId, sleeperUsername: linked.sleeperUsername ?? null }
    : null

  return (
    <div className="min-h-screen bg-[#07071a] px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        {/* Back link, title and intro — a client component, so they follow the chosen language. */}
        <ConnectSleeperIntro />
        {/*
          ⚠ This page used to say "link your account by importing a league" —
          while the import gate itself REQUIRED the link. The form below breaks
          that circle: it validates the handle against Sleeper and stamps the
          profile in one step.
        */}
        <ConnectSleeperForm currentLink={currentLink} />
      </div>
    </div>
  )
}
