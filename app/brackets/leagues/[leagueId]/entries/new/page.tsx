import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Server-side entry-creation redirect for legacy BracketLeague pools (UUID IDs).
 *
 * The pool dashboard (BracketLeagueShell) links "Create Entry" to this route.
 * We create a BracketEntry record here and immediately redirect to the
 * legacy bracket fill page at /bracket/[tournamentId]/entry/[entryId].
 *
 * Error paths redirect back to the pool dashboard so the user sees
 * a meaningful UI rather than a blank page.
 */
export default async function NewBracketEntryPage({
  params,
}: {
  params: { leagueId: string }
}) {
  const { leagueId } = params

  // Auth check
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/brackets/leagues/${leagueId}`)
  }

  const userId = session.user.id

  // Load league + membership in parallel
  const [league, member] = await Promise.all([
    (prisma as any).bracketLeague
      .findUnique({
        where: { id: leagueId },
        select: {
          tournamentId: true,
          scoringRules: true,
          tournament: { select: { lockAt: true } },
        },
      })
      .catch(() => null),
    (prisma as any).bracketLeagueMember
      .findUnique({
        where: { leagueId_userId: { leagueId, userId } },
        select: { leagueId: true },
      })
      .catch(() => null),
  ])

  // Pool not found or user is not a member — send back to dashboard
  if (!league || !member) {
    redirect(`/brackets/leagues/${leagueId}`)
  }

  // Tournament locked
  const lockAt = league.tournament?.lockAt as Date | null | undefined
  if (lockAt && new Date(lockAt) <= new Date()) {
    redirect(`/brackets/leagues/${leagueId}`)
  }

  // Entry-limit check
  const scoringRules = (league.scoringRules || {}) as Record<string, unknown>
  const maxEntriesPerUser = Math.min(
    25,
    Math.max(1, Number(scoringRules?.maxEntriesPerUser ?? 1))
  )
  const existingCount: number = await (prisma as any).bracketEntry.count({
    where: { leagueId, userId },
  })

  if (existingCount >= maxEntriesPerUser) {
    redirect(`/brackets/leagues/${leagueId}`)
  }

  // Create the entry with a sensible default name
  const entryLabel =
    existingCount === 0 ? "My Bracket" : `My Bracket ${existingCount + 1}`

  const entry = await (prisma as any).bracketEntry.create({
    data: {
      leagueId,
      userId,
      name: entryLabel,
      status: "DRAFT",
    },
    select: { id: true },
  })

  // Redirect to the legacy bracket fill page
  redirect(`/bracket/${league.tournamentId}/entry/${entry.id}`)
}
