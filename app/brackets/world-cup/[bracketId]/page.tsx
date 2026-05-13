import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getWorldCupChallengeView } from "@/lib/world-cup"
import { hasWorldCupAdminPageSession } from "@/lib/world-cup/adminPage"
import WorldCupBracketShell from "@/components/brackets/world-cup/WorldCupBracketShell"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

export async function generateMetadata({
  params,
}: {
  params: { bracketId: string }
}): Promise<Metadata> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: params.bracketId },
    select: {
      name: true,
      seasonYear: true,
      _count: { select: { participants: true } },
    },
  })

  if (!challenge) {
    return { title: "Bracket Not Found | AllFantasy" }
  }

  const title = `${challenge.name} — FIFA World Cup ${challenge.seasonYear} Bracket | AllFantasy`
  const description = `Join the "${challenge.name}" World Cup bracket pool on AllFantasy. ${challenge._count.participants} participant${challenge._count.participants === 1 ? "" : "s"} competing.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export default async function WorldCupBracketChallengePage({
  params,
  searchParams,
}: {
  params: { bracketId: string }
  searchParams?: { tab?: string; guided?: string; entry?: string }
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const isAdmin = hasWorldCupAdminPageSession()
  const view = await getWorldCupChallengeView({
    challengeId: params.bracketId,
    user: session?.user ?? null,
    isAdmin,
  })

  if (!view) notFound()

  const tab = searchParams?.tab
  const defaultTab =
    tab === "leaderboard" ||
    tab === "rules" ||
    tab === "invite" ||
    tab === "picks" ||
    tab === "settings" ||
    tab === "commissioner"
      ? tab
      : "picks"

  const initialGuidedOpen = searchParams?.guided === "1"
  const initialEntryId = searchParams?.entry?.trim() || null

  return (
    <WorldCupBracketShell
      initialView={view}
      defaultTab={defaultTab}
      initialGuidedOpen={initialGuidedOpen}
      initialEntryId={initialEntryId}
    />
  )
}
