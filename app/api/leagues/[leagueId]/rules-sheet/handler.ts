/**
 * The league rules sheet (lib/league-rules/rulesSheet.ts): every rule the commissioner has set and
 * what it means, for any team in the league or its commissioner.
 *
 *   GET ?lang=es   the sheet in the viewer's language (English otherwise)
 *
 * Read-only. Rules are changed through the league settings, and the sheet reads them fresh each
 * time, so it always describes what the league plays now.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readRulesSheet } from '@/lib/league-rules/rulesSheetService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const lang = req.nextUrl.searchParams.get('lang') === 'es' ? 'es' : 'en'
  const r = await readRulesSheet(leagueId, userId, lang)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}
