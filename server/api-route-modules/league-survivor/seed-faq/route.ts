import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import { seedSurvivorFaqToLeagueChat } from '@/lib/survivor/survivorFaq'

export const dynamic = 'force-dynamic'

/**
 * POST: Post Survivor+Exile FAQ into the league's own chat as broadcast + pin — head commissioner
 * or co-commissioner.
 *
 * 🛑 IT WAS HEAD-COMMISSIONER ONLY WHILE THE SCREEN OFFERED IT TO CO-COMMISSIONERS. The button lives
 * in the Survivor settings panel, enabled by `/api/league/settings`'s `canEdit` — commissioner OR
 * co_commissioner — but this route checked `league.userId === userId`, so a co-commissioner got an
 * enabled "Post FAQ" that answered "Commissioner only". Same rule as every league-settings write
 * (`requireCommissionerRole`) and Discord setup (`lib/discord/bridgeAccess.ts`): `getLeagueRole` +
 * `isCommissionerRole`. Head-only stays reserved for destructive actions (`requireCommissionerOnly`);
 * re-posting a FAQ built from the league's own settings is not one.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const role = await getLeagueRole(leagueId, userId)
  if (!isCommissionerRole(role)) {
    return NextResponse.json({ error: 'Only a commissioner or co-commissioner can post the FAQ.' }, { status: 403 })
  }

  const isSurvivor = await isSurvivorLeague(leagueId)
  if (!isSurvivor) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const force = body?.force === true

  const result = await seedSurvivorFaqToLeagueChat({ leagueId, commissionerUserId: userId, force })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true, messageId: result.messageId })
}
