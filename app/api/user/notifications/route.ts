import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getSettingsProfile, updateUserProfile } from "@/lib/user-settings"

export const dynamic = "force-dynamic"

const DEFAULT_DASHBOARD_TOGGLES = {
  waiverWireCloses: true,
  tradeActivity: true,
  leagueChatMessages: true,
  draftReminders: true,
  injuryAlerts: true,
} as const

/**
 * GET /api/user/notifications
 * Query: `unread=true` (only unread), `limit` (default 20, max 50).
 * `unreadCount` = unread rows in this page; `unreadTotal` = total unread for badge.
 */
export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string }
    } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const unreadOnly = searchParams?.get("unread") === "true"
    const limitRaw = Number(searchParams?.get("limit") ?? 20)
    const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20))

    const userId = session.user.id

    const [items, unreadTotal] = await Promise.all([
      prisma.platformNotification.findMany({
        where: {
          userId,
          ...(unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.platformNotification.count({
        where: { userId, readAt: null },
      }),
    ])

    const notifications = items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      product: n.productType,
      severity: n.severity,
      read: n.readAt != null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      meta: (n.meta as Record<string, unknown> | null) ?? undefined,
    }))

    const unreadCount = items.filter((n) => n.readAt == null).length

    return NextResponse.json({ notifications, unreadCount, unreadTotal })
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error("[notifications GET]", e.message, e.stack)
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 })
  }
}

/**
 * PATCH /api/user/notifications
 * Body: `{ ids: 'all' | string[] }` — marks platform notifications read for the current user.
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string }
    } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; leagueId?: unknown }
    const { ids } = body
    if (body.leagueId !== undefined && (typeof body.leagueId !== 'string' || !body.leagueId.trim())) {
      return NextResponse.json({ error: 'leagueId must be a nonempty string' }, { status: 400 })
    }
    const scope = typeof body.leagueId === 'string' ? { leagueId: body.leagueId.trim() } : {}
    const userId = session.user.id
    const now = new Date()

    if (ids === "all") {
      await prisma.platformNotification.updateMany({
        where: { userId, readAt: null, ...scope },
        data: { readAt: now },
      })
    } else if (Array.isArray(ids)) {
      const idList = ids.map(String).filter(Boolean)
      if (idList.length === 0) {
        return NextResponse.json({ error: "ids array required" }, { status: 400 })
      }
      await prisma.platformNotification.updateMany({
        where: { id: { in: idList }, userId, ...scope },
        data: { readAt: now },
      })
    } else {
      return NextResponse.json({ error: "ids must be 'all' or an array of ids" }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error("[notifications PATCH]", e.message, e.stack)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

/**
 * PUT /api/user/notifications
 * Merges `dashboardToggles` into `UserProfile.notificationPreferences` JSON.
 */
export async function PUT(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    dashboardToggles?: Partial<Record<keyof typeof DEFAULT_DASHBOARD_TOGGLES, boolean>>
  }

  const current = await getSettingsProfile(session.user.id)
  const prev = (current?.notificationPreferences as Record<string, unknown>) ?? {}
  const prevToggles =
    (prev.dashboardToggles as Record<string, boolean> | undefined) ?? {}

  const nextToggles = {
    ...DEFAULT_DASHBOARD_TOGGLES,
    ...prevToggles,
    ...(body.dashboardToggles && typeof body.dashboardToggles === "object"
      ? body.dashboardToggles
      : {}),
  }

  const merged: Record<string, unknown> = {
    ...prev,
    dashboardToggles: nextToggles,
  }

  const result = await updateUserProfile(session.user.id, {
    notificationPreferences: merged,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to save notifications" },
      { status: 400 }
    )
  }

  return NextResponse.json({ ok: true, dashboardToggles: nextToggles })
}

