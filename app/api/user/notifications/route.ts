import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from '@prisma/client'
import { z } from 'zod'

export const dynamic = "force-dynamic"

const DEFAULT_DASHBOARD_TOGGLES = {
  waiverWireCloses: true,
  tradeActivity: true,
  leagueChatMessages: true,
  draftReminders: true,
  injuryAlerts: true,
} as const

const togglesSchema = z.object({
  waiverWireCloses: z.boolean().optional(), tradeActivity: z.boolean().optional(),
  leagueChatMessages: z.boolean().optional(), draftReminders: z.boolean().optional(),
  injuryAlerts: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0)
const requestSchema = z.object({ dashboardToggles: togglesSchema }).strict()
const receiptSchema = z.object({
  ids: z.union([z.literal('all'), z.array(z.string().trim().min(1)).min(1).max(1000)]),
  leagueId: z.string().trim().min(1).optional(),
}).strict()

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
    const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20))

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

    const parsed = receiptSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid notification receipt' }, { status: 400 })
    const body = parsed.data
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
      const idList = [...new Set(ids)]
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

  const parsed = requestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid notification preferences' }, { status: 400 })
  try {
    // This write needs a verified row read, not a display loader's empty fallback.
    const current = await prisma.userProfile.findUnique({ where: { userId: session.user.id }, select: { notificationPreferences: true } })
    const previous = z.record(z.unknown()).safeParse(current?.notificationPreferences ?? {})
    if (!previous.success) return NextResponse.json({ error: 'Could not verify saved preferences. Reload before retrying.' }, { status: 503 })
    const oldToggles = z.record(z.boolean()).safeParse(previous.data.dashboardToggles ?? {})
    if (!oldToggles.success) return NextResponse.json({ error: 'Could not verify saved preferences. Reload before retrying.' }, { status: 503 })
    const nextToggles = { ...DEFAULT_DASHBOARD_TOGGLES, ...oldToggles.data, ...parsed.data.dashboardToggles }
    const merged = { ...previous.data, dashboardToggles: nextToggles } as Prisma.InputJsonObject
    if (current) {
      const result = await prisma.userProfile.updateMany({
        where: { userId: session.user.id, notificationPreferences: { equals: current.notificationPreferences ?? Prisma.AnyNull } },
        data: { notificationPreferences: merged },
      })
      if (result.count !== 1) return NextResponse.json({ error: 'Preferences changed while saving. Reload before retrying.' }, { status: 409 })
    } else {
      await prisma.userProfile.create({ data: { userId: session.user.id, notificationPreferences: merged } })
    }
    return NextResponse.json({ ok: true, dashboardToggles: nextToggles })
  } catch (error) {
    const conflict = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
    return NextResponse.json({ error: conflict ? 'Preferences changed while saving. Reload before retrying.' : 'Could not verify saved preferences. Reload before retrying.' }, { status: conflict ? 409 : 503 })
  }
}

