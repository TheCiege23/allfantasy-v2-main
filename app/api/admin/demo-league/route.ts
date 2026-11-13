import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { clearDemoSourceConfig, getDemoSourceConfig, setDemoSourceConfig } from '@/lib/demo-league/config'
import { resetDemoCache } from '@/lib/demo-league/service'

export const dynamic = 'force-dynamic'

/**
 * Admin-only: which of the admin's own leagues feeds the public demo.
 *
 * Three gates, all required to WRITE:
 *   1. `requireAdmin()` — the platform admin check (mutations never take the bearer variant).
 *   2. A real signed-in admin USER (an id), not only the shared admin password cookie —
 *      the next gate needs to know whose league it is.
 *   3. That user commissions the league. You can only publish a league you run.
 * Optionally narrowed further by DEMO_LEAGUE_ADMIN_EMAILS (comma-separated): when set,
 * only those admin emails may write, even among admins.
 */
function allowedEmail(email: string | undefined): boolean {
  const raw = (process.env.DEMO_LEAGUE_ADMIN_EMAILS ?? '').trim()
  if (!raw) return true
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return Boolean(email && list.includes(email.trim().toLowerCase()))
}

/**
 * Accept either id an operator is likely to have in hand: our `League.id` (a uuid), or the
 * PROVIDER's league id (`League.platformLeagueId` — the long number in a Sleeper URL, an ESPN
 * league id, …). The provider id is what a commissioner sees every day, and it is what was
 * pasted the first time this page was used.
 *
 * A provider id can match several rows: Sleeper gives each season its own league id, but other
 * providers keep one id across seasons, and two users can each import the same league. So: keep
 * only rows this user commissions, then take the newest season — that is the league that is
 * still syncing, which is the whole point of a live demo.
 */
async function resolveCommissionedLeague(
  input: string,
  userId: string,
): Promise<{ kind: 'ok'; id: string } | { kind: 'not_found' } | { kind: 'not_commissioner' }> {
  const byId = await prisma.league.findUnique({ where: { id: input }, select: { id: true } })
  const candidates = byId
    ? [{ id: byId.id, season: 0 }]
    : await prisma.league.findMany({
        where: { platformLeagueId: input },
        select: { id: true, season: true },
        orderBy: { season: 'desc' },
        take: 20,
      })
  if (candidates.length === 0) return { kind: 'not_found' }
  for (const c of candidates) {
    if (isCommissionerRole(await getLeagueRole(c.id, userId))) return { kind: 'ok', id: c.id }
  }
  return { kind: 'not_commissioner' }
}

async function describe() {
  const cfg = await getDemoSourceConfig()
  if (!cfg) return { configured: false as const }
  const league = await prisma.league.findUnique({ where: { id: cfg.leagueId }, select: { id: true, name: true, platform: true, sport: true, season: true } })
  return { configured: true as const, source: cfg, league }
}

export async function GET() {
  const a = await requireAdmin()
  if (!a.ok) return a.res
  return NextResponse.json(await describe())
}

export async function PUT(req: Request) {
  const a = await requireAdmin()
  if (!a.ok) return a.res
  const userId = a.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in with your admin account (not only the admin password) to set the demo league.' }, { status: 403 })
  if (!allowedEmail(a.user?.email)) return NextResponse.json({ error: 'This admin account may not change the demo league.' }, { status: 403 })

  let leagueId = ''
  try {
    const body = (await req.json()) as { leagueId?: unknown }
    leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Send JSON: { "leagueId": "..." }' }, { status: 400 })
  }
  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })

  const resolved = await resolveCommissionedLeague(leagueId, userId)
  if (resolved.kind === 'not_found') {
    return NextResponse.json(
      { error: 'No league with that ID. Use the AllFantasy league ID, or the ID from Sleeper, ESPN, Fantrax or another provider.' },
      { status: 404 },
    )
  }
  if (resolved.kind === 'not_commissioner') {
    return NextResponse.json({ error: 'You can only use a league you commission as the demo source.' }, { status: 403 })
  }

  await setDemoSourceConfig(resolved.id, userId)
  resetDemoCache()
  console.info('[admin/demo-league] demo source changed', { by: userId })
  return NextResponse.json(await describe())
}

export async function DELETE() {
  const a = await requireAdmin()
  if (!a.ok) return a.res
  if (!a.user?.id || !allowedEmail(a.user?.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await clearDemoSourceConfig()
  resetDemoCache()
  return NextResponse.json({ configured: false })
}
