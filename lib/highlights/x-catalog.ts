import 'server-only'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { xCatalogSchema, type XCatalog } from './x-types'
import { fetchRecentXPosts, xHighlightsEnabled } from './x-provider'

const CATALOG = 'highlights:x:catalog:v1'
const BUDGET = 'highlights:x:budget:v1'
const HOUR = 60 * 60_000
const budgetSchema = z.object({ day: z.string(), used: z.number().int().nonnegative(), nextAt: z.number().finite() })
export function xDailyRequestLimit() {
  const configured = Number(process.env.X_HIGHLIGHTS_DAILY_REQUEST_LIMIT ?? '24')
  return Number.isInteger(configured) && configured >= 1 && configured <= 100 ? configured : 24
}
export async function readXCatalog(): Promise<XCatalog | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: CATALOG }, select: { data: true, expiresAt: true } })
  if (!row || row.expiresAt.getTime() <= Date.now()) return null
  const parsed = xCatalogSchema.safeParse(row.data)
  return parsed.success ? parsed.data : null
}
async function reserveRequest(now: Date): Promise<boolean> {
  // Serializable persistent reservation prevents overlapping cron requests from overspending.
  // Database errors fail closed; page loads never invoke this function.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const row = await tx.sportsDataCache.findUnique({ where: { cacheKey: BUDGET } })
        const parsed = budgetSchema.safeParse(row?.data)
        const day = now.toISOString().slice(0, 10)
        const previous = parsed.success ? parsed.data : null
        if (row && !previous) throw new Error('Invalid X budget state')
        const used = previous?.day === day ? previous.used : 0
        if (used >= xDailyRequestLimit() || (previous && previous.nextAt > now.getTime())) return false
        const data = { day, used: used + 1, nextAt: (Math.floor(now.getTime() / HOUR) + 1) * HOUR }
        await tx.sportsDataCache.upsert({
          where: { cacheKey: BUDGET },
          create: { cacheKey: BUDGET, data, expiresAt: new Date(now.getTime() + 48 * HOUR) },
          update: { data, expiresAt: new Date(now.getTime() + 48 * HOUR) },
        })
        return true
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue
      throw error
    }
  }
  return false
}
export async function refreshXCatalog() {
  if (!xHighlightsEnabled()) return { status: 'disabled' as const, count: 0 }
  const now = new Date()
  if (!await reserveRequest(now)) return { status: 'limited' as const, count: 0 }
  // Count failures as attempted requests too. A failed provider call cannot trigger paid retries.
  const posts = await fetchRecentXPosts(now)
  const previous = await readXCatalog()
  const merged = new Map((previous?.posts ?? []).map(post => [post.id, post]))
  for (const post of posts) merged.set(post.id, post)
  const data = xCatalogSchema.parse({
    posts: [...merged.values()].filter(p => Date.parse(p.publishedAt) > now.getTime() - 24 * HOUR && Date.parse(p.publishedAt) <= now.getTime())
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 200),
    checkedAt: now.toISOString(),
  })
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: CATALOG },
    create: { cacheKey: CATALOG, data, expiresAt: new Date(now.getTime() + 24 * HOUR) },
    update: { data, expiresAt: new Date(now.getTime() + 24 * HOUR) },
  })
  return { status: 'ready' as const, count: data.posts.length }
}

