/**
 * Rivalry-week pairings for a league that plays on another platform: read-only, for a member.
 *
 *   GET  { ok, platform, pairs: [{ homeName, awayName, rivalry, reasons }] }
 *
 * A league that plays here sets its rivalry week through `/api/redraft/schedule`, which can also
 * rewrite the week. This one only reads (lib/schedule-runtime/importedRivalryWeek.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { previewImportedRivalryWeek } from '@/lib/schedule-runtime/importedRivalryWeek'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  try {
    await assertLeagueMember(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const out = await previewImportedRivalryWeek(leagueId)
  if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status })
  return NextResponse.json({ ok: true, platform: out.platform, pairs: out.pairs }, { headers: { 'Cache-Control': 'no-store' } })
}
