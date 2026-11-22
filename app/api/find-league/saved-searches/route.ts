import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { MAX_SAVED_SEARCHES, canonicalSearchQuery } from "@/lib/public-discovery/savedSearchAlerts"

export const dynamic = "force-dynamic"

/**
 * /api/find-league/saved-searches — "Alert me when new leagues match".
 *
 *   GET            → { searches: [{ id, label, query, createdAt, lastAlertedAt }] }
 *   POST           { query, label } → saves (or keeps) the search; up to 5 per player
 *   DELETE ?id=…   → removes one
 *
 * The daily check that sends the alerts is lib/public-discovery/runSavedSearchAlerts.ts.
 */

async function viewer(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const SELECT = { id: true, label: true, query: true, createdAt: true, lastAlertedAt: true } as const

export async function GET() {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ searches: [] })
  const searches = await prisma.savedLeagueSearch.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: SELECT })
  return NextResponse.json({ searches }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: "Sign in to get alerts." }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { query?: unknown; label?: unknown } | null
  const query = canonicalSearchQuery(typeof body?.query === "string" ? body.query : "")
  if (!query) {
    return NextResponse.json({ error: "Pick at least one filter first, so the alert means something." }, { status: 400 })
  }
  const label = (typeof body?.label === "string" ? body.label.trim() : "").slice(0, 160) || "My league search"

  const existing = await prisma.savedLeagueSearch.findUnique({ where: { userId_query: { userId, query } }, select: SELECT })
  if (existing) return NextResponse.json({ ok: true, search: existing, alreadySaved: true })

  const count = await prisma.savedLeagueSearch.count({ where: { userId } })
  if (count >= MAX_SAVED_SEARCHES) {
    return NextResponse.json(
      { error: `You have ${MAX_SAVED_SEARCHES} saved searches. Remove one to add another.` },
      { status: 409 }
    )
  }
  const search = await prisma.savedLeagueSearch.create({ data: { userId, query, label }, select: SELECT })
  return NextResponse.json({ ok: true, search })
}

export async function DELETE(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 })
  const id = req.nextUrl.searchParams.get("id") ?? ""
  // Scoped by owner: someone else's id deletes nothing.
  const removed = await prisma.savedLeagueSearch.deleteMany({ where: { id, userId } })
  return NextResponse.json({ ok: removed.count > 0 })
}
