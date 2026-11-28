import { NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { getStatTableLayouts, setStatTableDensity, setStatTableLayout } from '@/lib/table-layout/statTableLayoutStore'
import { isTableId, sanitizeDensity, sanitizeLayout } from '@/lib/table-layout/statTableLayout'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * GET  /api/user/table-layout             → { density, tables: { [tableId]: { order, hidden } } }
 * PUT  /api/user/table-layout  { density }                       set the stat tables' density
 * PUT  /api/user/table-layout  { tableId, layout: {order,hidden} | null }   save / reset one table
 *
 * The signed-in user's own preferences only (lib/table-layout). Values are bounded and sanitized
 * before they are stored; an unknown shape is refused rather than coerced into something surprising.
 */
export async function GET() {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  return NextResponse.json(await getStatTableLayouts(user.appUserId), { headers: NO_STORE })
}

export async function PUT(req: Request) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: NO_STORE })

  try {
    if ('density' in body) {
      if (body.density !== 'compact' && body.density !== 'comfortable') {
        return NextResponse.json({ error: 'density must be compact or comfortable' }, { status: 400, headers: NO_STORE })
      }
      await setStatTableDensity(user.appUserId, sanitizeDensity(body.density))
      return NextResponse.json({ status: 'ok' }, { headers: NO_STORE })
    }
    if (!isTableId(body.tableId)) return NextResponse.json({ error: 'tableId required' }, { status: 400, headers: NO_STORE })
    const layout = body.layout == null ? null : sanitizeLayout(body.layout)
    await setStatTableLayout(user.appUserId, body.tableId, layout)
    return NextResponse.json({ status: 'ok' }, { headers: NO_STORE })
  } catch (e) {
    console.warn('[table-layout] write failed:', e instanceof Error ? e.name : 'unknown')
    return NextResponse.json({ error: 'Could not save that right now.' }, { status: 503, headers: NO_STORE })
  }
}
