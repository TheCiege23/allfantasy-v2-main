import Link from "next/link"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getPlayoffBracketView } from "@/lib/playoffs/playoffService"
import PlayoffBracketShell from "@/components/brackets/playoffs/PlayoffBracketShell"
import { BracketLeagueShell } from "./BracketLeagueShell"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

function isMissingPlayoffTablesError(err: unknown): boolean {
  if (!err) return false
  const errObj = err as any
  const errStr = String(err)
  return (
    errObj?.code === "P2021" ||
    (errObj?.meta?.cause && String(errObj.meta.cause).includes("does not exist")) ||
    (errObj?.message && errObj.message.includes("does not exist in the current database")) ||
    errStr.includes("does not exist in the current database") ||
    errStr.includes("playoff_bracket_challenges") ||
    (errObj?.name && errObj.name.includes("PrismaClientKnownRequestError") && errStr.includes("does not exist"))
  )
}

function isExpectedPlayoffRouteError(err: unknown): boolean {
  if (!err) return false
  if (isMissingPlayoffTablesError(err)) return true
  const errObj = err as any
  const errStr = String(err)
  return (
    errObj?.code === "P2025" ||
    errObj?.name === "PrismaClientValidationError" ||
    errStr.includes("PrismaClientValidationError") ||
    errStr.includes("Unknown field") ||
    errStr.includes("playoffBracketChallenge.findUnique")
  )
}

function isRedirectControlFlow(err: unknown): boolean {
  const errStr = String(err ?? "")
  return errStr.includes("NEXT_REDIRECT")
}

function EmergencyPoolFallback() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl border border-slate-300 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Pool dashboard is temporarily unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">
          We could not load this pool right now. You can still create or join pools from Brackets home.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <Link href="/brackets" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            Back to Brackets
          </Link>
          <Link href="/brackets/leagues/new" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
            Create Pool
          </Link>
          <Link href="/brackets/join" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            Join Pool
          </Link>
        </div>
      </div>
    </main>
  )
}

export async function generateMetadata({ params }: { params: { leagueId: string } }): Promise<Metadata> {
  let session: { user?: SessionUser } | null = null
  try {
    session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  } catch (err) {
    console.warn("[brackets/leagues] metadata session lookup failed", { leagueId: params.leagueId, error: String(err) })
  }
  try {
    console.warn("[brackets/leagues] checking playoff challenge", { leagueId: params.leagueId, phase: "metadata" })
    const playoffView = await getPlayoffBracketView({
      challengeId: params.leagueId,
      user: session?.user ?? null,
    })
    if (playoffView) {
      return { title: playoffView.challenge.name }
    }
  } catch (err) {
    if (!isExpectedPlayoffRouteError(err)) {
      console.warn("[brackets/leagues] metadata fallback due to unexpected error", {
        leagueId: params.leagueId,
        error: String(err),
      })
      return { title: "Bracket Pool" }
    }
    console.warn("[brackets/leagues] metadata fallback due to expected error", {
      leagueId: params.leagueId,
      error: String(err),
    })
  }
  return { title: "Bracket Pool" }
}

export default async function BracketLeagueDetailPage({
  params,
  searchParams,
}: {
  params: { leagueId: string }
  searchParams?: { entryId?: string }
}) {
  console.warn("[brackets/leagues] loading leagueId", { leagueId: params.leagueId })

  let session: { user?: SessionUser } | null = null
  try {
    console.warn("[brackets/leagues] loading session", { leagueId: params.leagueId })
    session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  } catch (err) {
    console.warn("[brackets/leagues] session lookup failed", { leagueId: params.leagueId, error: String(err) })
  }

  try {
    let playoffView: Awaited<ReturnType<typeof getPlayoffBracketView>> = null
    let playoffTableMissing = false
    try {
      console.warn("[brackets/leagues] checking playoff challenge", { leagueId: params.leagueId })
      playoffView = await getPlayoffBracketView({
        challengeId: params.leagueId,
        user: session?.user ?? null,
        requestedEntryId: searchParams?.entryId ?? null,
      })
    } catch (err) {
      if (isExpectedPlayoffRouteError(err)) {
        console.warn("[brackets/leagues] expected playoff load error", {
          leagueId: params.leagueId,
          error: String(err),
        })
        playoffTableMissing = true
      } else {
        throw err
      }
    }

    if (playoffTableMissing) {
      return (
        <main className="mx-auto max-w-3xl p-6">
          <div className="rounded-xl border border-slate-300 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Playoff pools are being prepared</h1>
            <p className="mt-2 text-sm text-slate-600">
              The playoff bracket system is being set up. Please check back shortly.
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link href="/brackets" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Back to Brackets
              </Link>
            </div>
          </div>
        </main>
      )
    }

    if (playoffView) {
      console.warn("[brackets/leagues] rendering dashboard", {
        route: "/brackets/leagues/[leagueId]",
        leagueId: params.leagueId,
        challengeId: playoffView.challenge.id,
      })
      if (process.env.NODE_ENV !== "production") {
        console.info("[brackets] loaded dashboard id", {
          route: "/brackets/leagues/[leagueId]",
          leagueId: params.leagueId,
          challengeId: playoffView.challenge.id,
        })
      }
      return <PlayoffBracketShell initialView={playoffView} />
    }

    console.warn("[brackets/leagues] checking legacy league", { leagueId: params.leagueId })
    const existingLeague = await (prisma as any).bracketLeague.findUnique({
      where: { id: params.leagueId },
      select: { id: true, scoringRules: true },
    })

    if (existingLeague?.id) {
      // Check if this is a legacy NBA/NHL playoff pool — show recovery UI instead of broken shell
      const rules = (existingLeague.scoringRules ?? {}) as Record<string, unknown>
      const legacySport = String(rules.sport ?? "").toLowerCase()
      const legacyBracketType = String(rules.bracketType ?? rules.challengeType ?? "")
      const isLegacyPlayoffPool =
        (legacySport === "nba" || legacySport === "nhl") &&
        legacyBracketType === "playoff_challenge"

      if (isLegacyPlayoffPool) {
        const sportLabel = legacySport.toUpperCase()
        console.warn("[brackets/leagues] legacy NBA/NHL playoff pool — showing recovery UI", {
          leagueId: params.leagueId,
          sport: legacySport,
        })
        return (
          <main className="mx-auto max-w-3xl p-6">
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center shadow-sm">
              <div className="mb-3 text-3xl">🏆</div>
              <h1 className="text-xl font-semibold text-white">
                Create a new {sportLabel} Playoff Pool
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                This pool was created with an older format that isn&apos;t compatible with the
                full playoff bracket experience. Create a new {sportLabel} pool to get the
                interactive bracket, live standings, and team logos.
              </p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <Link
                  href={`/brackets/leagues/new?sport=${sportLabel}&challengeType=playoff_challenge`}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 transition"
                >
                  Create New {sportLabel} Pool
                </Link>
                <Link
                  href="/brackets"
                  className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-slate-400 transition"
                >
                  Back to Brackets
                </Link>
              </div>
            </div>
          </main>
        )
      }

      console.warn("[brackets/leagues] rendering legacy BracketLeague shell", {
        leagueId: params.leagueId,
      })
      return (
        <BracketLeagueShell
          leagueId={params.leagueId}
          userId={session?.user?.id ?? null}
        />
      )
    }

    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-slate-300 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Pool not found</h1>
          <p className="mt-2 text-sm text-slate-600">
            We could not find a pool with that id. It may have been removed or the link is invalid.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link href="/brackets" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              Back to Brackets
            </Link>
            <Link href="/brackets/leagues/new" className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
              Create Pool
            </Link>
          </div>
        </div>
      </main>
    )
  } catch (err) {
    if (isRedirectControlFlow(err)) {
      throw err
    }
    if (isExpectedPlayoffRouteError(err)) {
      console.warn("[brackets/leagues] emergency fallback for expected route error", {
        leagueId: params.leagueId,
        error: String(err),
      })
      return <EmergencyPoolFallback />
    }
    console.warn("[brackets/leagues] emergency fallback for unexpected route error", {
      leagueId: params.leagueId,
      error: String(err),
    })
    return <EmergencyPoolFallback />
  }
}
