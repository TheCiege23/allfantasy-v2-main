import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { survivorClipFromAuditEntry, survivorClipFromAuditLog } from '@/lib/survivor/videoAssets'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return new Response('leagueId required', { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return new Response('Forbidden', { status: 403 })

  const sinceRaw = req.nextUrl.searchParams.get('since')
  const sinceDate = sinceRaw ? new Date(sinceRaw) : null
  const sinceOk = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : new Date(Date.now() - 60_000)

  /*
   * 🛑 THE TIMERS OUTLIVED THE VIEWER. This stream had no `cancel()` and never looked at the
   * request's abort signal, so when a tab left a Survivor league — navigation, close, EventSource
   * giving up — both intervals kept running for the full 300 s: two audit-table queries every 4 s
   * against a stream nobody was reading, and a heartbeat that threw `ERR_INVALID_STATE: Controller
   * is already closed` as an uncaughtException every 5 s (63 of them from ONE tab in a dev session,
   * 2026-09-26). Every reopen stacked another orphaned pair.
   *
   * Now any of the three ways a stream ends — the client cancels, the request aborts, a write
   * fails — stops the timers at once, and a failed database read ends that tick instead of
   * surfacing as an unhandled rejection. Same write guard `app/api/zombie/animations` uses.
   */
  let shutdown: () => void = () => {}

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      let iv: ReturnType<typeof setInterval> | null = null
      let hb: ReturnType<typeof setInterval> | null = null
      let endTimer: ReturnType<typeof setTimeout> | null = null
      shutdown = () => {
        if (closed) return
        closed = true
        if (iv) clearInterval(iv)
        if (hb) clearInterval(hb)
        if (endTimer) clearTimeout(endTimer)
        req.signal.removeEventListener('abort', shutdown)
      }
      req.signal.addEventListener('abort', shutdown)
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          shutdown()
        }
      }
      send({ type: 'connected', leagueId })

      const seen = new Set<string>()
      const tick = async () => {
        if (closed) return
        const [entries, logs] = await Promise.all([
          prisma.survivorAuditEntry.findMany({
            where: { leagueId, createdAt: { gte: sinceOk } },
            orderBy: { createdAt: 'asc' },
            take: 40,
            select: {
              id: true,
              category: true,
              action: true,
              createdAt: true,
            },
          }),
          prisma.survivorAuditLog.findMany({
            where: { leagueId, createdAt: { gte: sinceOk } },
            orderBy: { createdAt: 'asc' },
            take: 40,
            select: { id: true, eventType: true, createdAt: true },
          }),
        ])

        for (const row of entries) {
          const sid = `e:${row.id}`
          if (seen.has(sid)) continue
          const clip = survivorClipFromAuditEntry(row)
          if (!clip) {
            seen.add(sid)
            continue
          }
          seen.add(sid)
          send({
            type: 'survivor_moment',
            id: sid,
            source: 'audit_entry' as const,
            clipUrl: clip.url,
            clipType: clip.type,
            label: clip.label,
            durationMs: 10_000,
            category: row.category,
            action: row.action,
          })
        }

        for (const row of logs) {
          const sid = `l:${row.id}`
          if (seen.has(sid)) continue
          const clip = survivorClipFromAuditLog(row)
          if (!clip) {
            seen.add(sid)
            continue
          }
          seen.add(sid)
          send({
            type: 'survivor_moment',
            id: sid,
            source: 'audit_log' as const,
            clipUrl: clip.url,
            clipType: clip.type,
            label: clip.label,
            durationMs: 10_000,
            eventType: row.eventType,
          })
        }
      }

      const safeTick = () => {
        tick().catch(() => {
          /* One failed read skips one tick; the next one retries. */
        })
      }
      safeTick()
      iv = setInterval(safeTick, 4000)
      hb = setInterval(() => send({ type: 'heartbeat', t: Date.now() }), 5000)
      endTimer = setTimeout(() => {
        shutdown()
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      }, 300_000)
      if (req.signal.aborted) shutdown()
    },
    cancel() {
      shutdown()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
