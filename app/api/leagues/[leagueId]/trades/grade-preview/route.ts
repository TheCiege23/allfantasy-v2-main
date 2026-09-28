import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import {
  composerGradeInputs,
  suggestionGradeFrom,
  type ComposerAsset,
} from '@/lib/league-trade-engine/proposalPackageGrades'

export const dynamic = 'force-dynamic'

/**
 * POST — THE grade for the deal a manager is composing in "Propose a Trade" (2026-09-28), before it is
 * sent. The composer had none: a manager could send an offer every other screen would grade a D
 * without ever seeing a letter.
 *
 * A PREVIEW: `gradeDeal` on the league's own grader, from the viewer's side (they are the one sending
 * `give`), exactly as a pending offer or a partner suggestion is graded — no receipt is written per
 * checkbox. The proposal itself is still graded and receipted by the trade engine when it is sent.
 *
 * Membership is checked here (`assertLeagueMember`), which is what `createLeagueTradeGrader` requires
 * of its caller. Two-team deals only; the composer says so for three.
 */

const MAX_ASSETS_PER_SIDE = 12

function readAssets(raw: unknown): ComposerAsset[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ASSETS_PER_SIDE) return null
  const out: ComposerAsset[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const a = item as Record<string, unknown>
    if (a.kind === 'player' && typeof a.id === 'string' && a.id.trim() && typeof a.name === 'string') {
      out.push({ kind: 'player', id: a.id.trim(), name: a.name.trim() })
    } else if (a.kind === 'pick' && typeof a.label === 'string') {
      const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)
      out.push({ kind: 'pick', season: n(a.season), round: n(a.round), label: a.label.trim() || 'a draft pick' })
    } else if (a.kind === 'faab' && typeof a.amount === 'number' && Number.isFinite(a.amount) && a.amount >= 0) {
      out.push({ kind: 'faab', amount: Math.floor(a.amount) })
    } else {
      return null
    }
  }
  return out
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const body = (await req.json().catch(() => null)) as { give?: unknown; get?: unknown } | null
  const give = readAssets(body?.give)
  const get = readAssets(body?.get)
  if (!give || !get) return NextResponse.json({ error: 'Invalid assets' }, { status: 400 })
  if (give.length === 0 || get.length === 0) {
    return NextResponse.json({ grade: { graded: false, reason: 'Add something to both sides to see the grade.' } })
  }

  try {
    const grader = await createLeagueTradeGrader({ leagueId, userId }).catch(() => null)
    const g = await gradeDeal(grader, { give: composerGradeInputs(give), get: composerGradeInputs(get), viewerSide: true })
    return NextResponse.json({ grade: suggestionGradeFrom(g) })
  } catch {
    return NextResponse.json({ grade: { graded: false, reason: 'This trade could not be graded just now.' } })
  }
}
