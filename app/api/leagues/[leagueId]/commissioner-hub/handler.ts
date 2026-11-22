/**
 * /api/leagues/[leagueId]/commissioner-hub — the "Needs you" list on Settings › Commissioner Hub
 * (owner's page review #16, Phase C).
 *
 * GET ?lang=en|es   commissioner / co-commissioner — `{ tasks: { cards, overflow } }`
 *
 * The same queue /core's one-league Commissioner Hub shows (lib/core-app/commissioner/tasks.ts via
 * `getCommissionerHub`), so a league reads the same in both places. /core redirects an AllFantasy
 * league's commissioner to the league page (app/core/(shell)/[[...screen]]/page.tsx), so before this
 * route that queue was never shown for those leagues at all.
 *
 * `issues` is passed empty: the shell's outstanding-issue detectors are a draft with a known date
 * (the hub's own seven-day calendar already lists it) and stale sync (an AllFantasy league has
 * nothing to sync). The access gate and the commissioner-depth gate run inside `getCommissionerHub`.
 *
 * Postgres only; no provider or AI call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { getCommissionerHub } from '@/lib/core-app/commissionerHub'
import { resolveCommissionerOsDepth } from '@/lib/commissioner-ui/commissionerOsDepth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canCommissionerAct(leagueId, userId, 'view'))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const language = req.nextUrl.searchParams.get('lang') === 'es' ? 'es' : 'en'
  const depth = await resolveCommissionerOsDepth().catch(() => null)
  const hub = await getCommissionerHub({ leagueId, userId, issues: [], depth, language }).catch(() => null)
  if (!hub) return NextResponse.json({ error: 'Could not read the commissioner queue' }, { status: 500 })
  if (!hub.allowed) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  return NextResponse.json({ tasks: hub.tasks }, { headers: { 'Cache-Control': 'private, no-store' } })
}
