import Link from "next/link"
import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getPlayoffBracketView } from "@/lib/playoffs/playoffService"
import PlayoffBracketShell from "@/components/brackets/playoffs/PlayoffBracketShell"

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
  searchParams?: { entryId?: string; tab?: string }
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
      return <PlayoffBracketShell initialView={playoffView} leaderboardFirst={searchParams?.tab === "leaderboard"} />
    }

    console.warn("[brackets/leagues] checking legacy league", { leagueId: params.leagueId })
    const existingLeague = await (prisma as any).bracketLeague.findUnique({
      where: { id: params.leagueId },
      select: {
        id: true,
        name: true,
        tournament: { select: { sport: true } },
      },
    })

    if (existingLeague?.id) {
      // loop-guard: DO NOT redirect back to /league/[id] here.
      // /league/[id] now calls resolveBracketPoolRedirectUrl() and redirects
      // UUID bracket pools TO /brackets/leagues/[id], so redirecting back would
      // create an infinite loop:  /league → /brackets/leagues → /league → …
      // Instead, render a recovery UI so the user can navigate to Brackets home.
      console.warn("[brackets/leagues] legacy BracketLeague UUID — rendering recovery UI (loop-guard)", {
        leagueId: params.leagueId,
      })

      // Build a smart "Create New Playoff Pool" href that pre-fills the sport
      // when the related tournament has a known sport value.
      const sport = typeof existingLeague.tournament?.sport === "string" ? existingLeague.tournament.sport.toUpperCase() : ""
      const knownSports = ["NBA", "NHL"]
      const createHref = knownSports.includes(sport)
        ? `/brackets/leagues/new?sport=${sport}&challengeType=playoff_challenge`
        : `/brackets/leagues/new?challengeType=playoff_challenge`

      return (
        <main className="mx-auto max-w-3xl p-6">
          <div className="rounded-xl border border-slate-300 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">This pool uses the older bracket format</h1>
            <p className="mt-2 text-sm text-slate-600">
              This pool was created before the new NBA/NHL playoff bracket engine was enabled. Please
              create a new playoff pool to use live scoring, team logos, pick advancement, and the
              trophy bracket.
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link href="/brackets" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Back to My Pools
              </Link>
              <Link href={createHref} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
                Create New Playoff Pool
              </Link>
            </div>
          </div>
        </main>
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
