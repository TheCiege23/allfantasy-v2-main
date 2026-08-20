import Link from "next/link"
import { getServerSession } from "next-auth"
import { ArrowLeft, Plus, Trophy } from "lucide-react"
import { authOptions } from "@/lib/auth"
import { getWorldCupChallengeView } from "@/lib/world-cup"
import { hasWorldCupAdminPageSession } from "@/lib/world-cup/adminPage"
import WorldCupBracketShell from "@/components/brackets/world-cup/WorldCupBracketShell"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

function WorldCupPoolNotFound() {
  return (
    <main className="min-h-screen bg-[#05070b] px-4 py-10 text-white">
      <section className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center shadow-2xl shadow-black/30">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-300/10 text-cyan-200">
          <Trophy className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-2xl font-black">World Cup pool not found</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">
          World Cup pool not found. This pool may have been created in the old bracket system or deleted.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/brackets/world-cup"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-bold text-white/75 hover:bg-white/[0.09]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to World Cup Pools
          </Link>
          <Link
            href="/brackets/world-cup/create"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-black"
          >
            <Plus className="h-4 w-4" />
            Create New World Cup Pool
          </Link>
        </div>
      </section>
    </main>
  )
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

  if (!view) return <WorldCupPoolNotFound />

  const tab = searchParams?.tab
  const defaultTab =
    tab === "home" ||
    tab === "leaderboard" ||
    tab === "rules" ||
    tab === "invite" ||
    tab === "picks" ||
    tab === "settings" ||
    tab === "commissioner"
      ? tab
      : searchParams?.guided === "1" || searchParams?.entry
        ? "picks"
        : "home"

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
