import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getWorldCupChallengeView } from "@/lib/world-cup"
import { hasWorldCupAdminPageSession } from "@/lib/world-cup/adminPage"
import WorldCupBracketShell from "@/components/brackets/world-cup/WorldCupBracketShell"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

export default async function WorldCupBracketLeaderboardPage(
  props: {
    params: Promise<{ bracketId: string }>
  }
) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const view = await getWorldCupChallengeView({
    challengeId: params.bracketId,
    user: session?.user ?? null,
    isAdmin: await hasWorldCupAdminPageSession(),
  })

  if (!view) notFound()

  return <WorldCupBracketShell initialView={view} defaultTab="leaderboard" />
}
