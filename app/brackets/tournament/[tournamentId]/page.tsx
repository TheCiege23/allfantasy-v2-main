import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { notFound } from "next/navigation"
import { BracketologySpotlight } from "@/components/bracket/BracketologySpotlight"
import { ChaosMeter } from "@/components/bracket/ChaosMeter"

export default async function TournamentPage({
  params,
}: {
  params: { tournamentId: string }
}) {
  let session: { user?: { id?: string } } | null = null
  try {
    session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string }
    } | null
  } catch (e) {
    console.error("[brackets/tournament] session error:", e)
  }

  const t = await (prisma as any).bracketTournament.findUnique({
    where: { id: params.tournamentId },
    select: { id: true, name: true, season: true, sport: true },
  })

  if (!t) notFound()

  const nodeCount = await (prisma as any).bracketNode.count({
    where: { tournamentId: t.id },
  })

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 text-white">
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <Link
          href="/brackets"
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition"
        >
          &larr; Back to Brackets
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t.name}</h1>
            <div className="text-sm text-gray-400 mt-1">
              {t.season} &bull; {t.sport} &bull; {nodeCount} games
            </div>
          </div>

          <div className="flex gap-2">
            {session?.user?.id ? (
              <Link
                className="rounded-xl bg-white text-black px-4 py-2 text-sm font-medium hover:bg-gray-200 transition-colors"
                href="/brackets/leagues/new"
              >
                Create league
              </Link>
            ) : (
              <Link
                className="rounded-xl bg-white text-black px-4 py-2 text-sm font-medium hover:bg-gray-200 transition-colors"
                href={`/login?callbackUrl=/brackets/tournament/${t.id}`}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        <BracketologySpotlight />

        <ChaosMeter tournamentId={t.id} />

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-semibold text-gray-300 mb-3">How it works</div>
          <ul className="list-disc pl-5 text-sm text-gray-400 space-y-2">
            <li>Create a league and share the invite code with friends.</li>
            <li>Each person creates one or more bracket entries.</li>
            <li>Fill out your picks through the championship game.</li>
            <li>Scoring updates live as games are played.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
