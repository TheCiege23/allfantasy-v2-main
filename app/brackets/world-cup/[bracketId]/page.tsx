import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getWorldCupChallengeView } from "@/lib/world-cup"
import { hasWorldCupAdminPageSession } from "@/lib/world-cup/adminPage"
import { normalizeWorldCupBracketTab } from "@/lib/world-cup/worldCupTabs"
import WorldCupBracketShell from "@/components/brackets/world-cup/WorldCupBracketShell"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: { bracketId: string } }): Promise<Metadata> {
  try {
    const row = await prisma.worldCupBracketChallenge.findUnique({
      where: { id: params.bracketId },
      select: { name: true, visibility: true },
    })
    if (!row || row.visibility === "private") {
      return { title: "World Cup Bracket | AllFantasy.AI" }
    }
    const name = row.name ?? "World Cup Bracket"
    return {
      title: `${name} | AF World Cup | AllFantasy.AI`,
      description: `Compete in the "${name}" World Cup bracket pool. Predict every match of FIFA World Cup 2026.`,
      openGraph: {
        title: `${name} | AF World Cup`,
        description: `Compete in "${name}". Predict every match of FIFA World Cup 2026.`,
        images: ["/images/brackets/world-cup/af-world-cup-hero-poster.jpg"],
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: `${name} | AF World Cup`,
        images: ["/images/brackets/world-cup/af-world-cup-hero-poster.jpg"],
      },
    }
  } catch {
    return { title: "World Cup Bracket | AllFantasy.AI" }
  }
}

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

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

  const defaultTab = normalizeWorldCupBracketTab(searchParams?.tab)

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
