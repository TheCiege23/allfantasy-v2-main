import Link from "next/link"
import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getPlayoffBracketView } from "@/lib/playoffs/playoffService"
import PlayoffBracketEntryShell from "@/components/brackets/playoffs/PlayoffBracketEntryShell"

export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

function isExpectedPlayoffEntryError(err: unknown): boolean {
  if (!err) return false
  const errObj = err as any
  const errStr = String(err)
  return (
    errObj?.code === "P2021" ||
    errObj?.code === "P2025" ||
    errObj?.name === "PrismaClientValidationError" ||
    errStr.includes("PrismaClientValidationError") ||
    errStr.includes("does not exist in the current database") ||
    errStr.includes("Unknown field")
  )
}

function EntryNotFound({ leagueId }: { leagueId: string }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl border border-slate-300 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Bracket entry not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          We could not find that bracket entry for this pool, or you do not have access to it.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <Link href={`/brackets/leagues/${leagueId}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            Back to Pool Dashboard
          </Link>
          <Link href="/brackets" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            Back to Brackets
          </Link>
        </div>
      </div>
    </main>
  )
}

function EntryUnavailable({ leagueId }: { leagueId: string }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl border border-slate-300 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Bracket entry is temporarily unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">
          We could not load this bracket entry right now. Please try again shortly.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <Link href={`/brackets/leagues/${leagueId}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            Back to Pool Dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}

export async function generateMetadata(props: { params: Promise<{ leagueId: string; entryId: string }> }): Promise<Metadata> {
  const params = await props.params
  let session: { user?: SessionUser } | null = null
  try {
    session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  } catch {
    session = null
  }

  try {
    const view = await getPlayoffBracketView({
      challengeId: params.leagueId,
      user: session?.user ?? null,
      requestedEntryId: params.entryId,
    })

    if (view?.activeEntry?.id === params.entryId && view.activeEntry.userId === view.viewerUserId) {
      return { title: `${view.activeEntry.name} | ${view.challenge.name}` }
    }
  } catch {
    return { title: "Bracket Entry" }
  }

  return { title: "Bracket Entry" }
}

export default async function PlayoffBracketEntryPage(
  props: {
    params: Promise<{ leagueId: string; entryId: string }>
  }
) {
  const params = await props.params
  let session: { user?: SessionUser } | null = null
  try {
    session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  } catch {
    session = null
  }

  try {
    const view = await getPlayoffBracketView({
      challengeId: params.leagueId,
      user: session?.user ?? null,
      requestedEntryId: params.entryId,
    })

    if (
      !view ||
      !view.viewerUserId ||
      !view.activeEntry ||
      view.activeEntry.id !== params.entryId ||
      view.activeEntry.userId !== view.viewerUserId ||
      view.challenge.id !== params.leagueId
    ) {
      return <EntryNotFound leagueId={params.leagueId} />
    }

    return <PlayoffBracketEntryShell initialView={view} />
  } catch (err) {
    if (isExpectedPlayoffEntryError(err)) {
      return <EntryUnavailable leagueId={params.leagueId} />
    }
    return <EntryUnavailable leagueId={params.leagueId} />
  }
}