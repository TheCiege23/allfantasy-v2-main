import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'

export const dynamic = 'force-dynamic'

/**
 * Fields that exist for the surfaces that genuinely need a league's rulebook, and that every
 * other caller pays for anyway.
 *
 * ⚠ MEASURED, NOT GUESSED. On the account used to check this the response is 5.28 MB across
 * 557 leagues, and `settings` alone is 3.90 MB of it (74%) with `rosters` another 1.06 MB
 * (20%). Everything a picker actually renders — id, name, sport, season, scoring, size,
 * avatar — is the remaining 6%.
 */
const HEAVY_LIST_FIELDS = ['settings', 'rosters'] as const

/**
 * `?summary=1` drops those two and nothing else.
 *
 * ⚠ OPT-IN RATHER THAN THE NEW DEFAULT, DELIBERATELY. Twelve-plus surfaces read this endpoint
 * and at least some of them do use `settings`; changing the default shape to save bytes would
 * be a silent breaking change across all of them. A caller that knows it only needs the
 * scalars asks for less; everyone else is byte-for-byte unaffected.
 */
export async function GET(request: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await getDashboardLeagueListForUser(userId)

    let summary = false
    try {
      summary = new URL(request.url).searchParams.get('summary') === '1'
    } catch {
      /* A malformed URL is not a reason to fail the request; serve the full shape. */
    }
    if (summary && payload && Array.isArray((payload as { leagues?: unknown[] }).leagues)) {
      const p = payload as { leagues: Array<Record<string, unknown>> }
      return NextResponse.json({
        ...p,
        leagues: p.leagues.map((l) => {
          const out: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(l)) {
            if (!(HEAVY_LIST_FIELDS as readonly string[]).includes(k)) out[k] = v
          }
          return out
        }),
      })
    }

    return NextResponse.json(payload)
  } catch (error: unknown) {
    console.error('[League List]', error)
    return NextResponse.json({ error: 'Failed to fetch leagues' }, { status: 500 })
  }
}
