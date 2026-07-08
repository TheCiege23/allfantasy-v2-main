import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { createLiveRuleSettingsDataProvider, type CommissionerRuleSettingsV1 } from '@/lib/decision-os/commissioner-intelligence/rule-settings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/app/leagues/[leagueId]/commissioner/rule-settings
 *
 * INTERNAL, session-authenticated, COMMISSIONER-scoped consumer of the
 * deterministic Rule / Settings aggregator for the Commissioner Intelligence Hub
 * (Phase 6, the "A1" path). Consumes the resolver server-side DIRECTLY — no
 * public keyed API, no API key.
 *
 * Read-only + display-only: one read, zero writes, NO AI/recommendation source,
 * and the body is exactly the user-safe `CommissionerRuleSettingsV1` contract —
 * it DESCRIBES configuration, never judges the rules or recommends changes.
 *
 * Gated by `COMMISSIONER_RULE_SETTINGS_ENABLED=true` (default off → the module
 * renders a quiet "expanding soon" state).
 */
export interface RuleSettingsResponse {
  enabled: boolean
  data?: CommissionerRuleSettingsV1
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params

  if (process.env.COMMISSIONER_RULE_SETTINGS_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false } satisfies RuleSettingsResponse, { status: 200 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Commissioner-scoped: assertCommissioner throws for non-commissioners → 403.
  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = await createLiveRuleSettingsDataProvider().getCommissionerRuleSettings({ leagueId })
    if (!data) {
      // No league row — "enabled, no data" (empty state).
      return NextResponse.json({ enabled: true } satisfies RuleSettingsResponse, { status: 200 })
    }
    return NextResponse.json({ enabled: true, data } satisfies RuleSettingsResponse, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Rule settings are temporarily unavailable.' }, { status: 500 })
  }
}
