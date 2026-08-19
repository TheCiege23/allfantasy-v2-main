import { NextRequest, NextResponse } from 'next/server'
import type { LeagueSport } from '@prisma/client'
import { requireUserId, requireLeagueWarRoom } from '@/lib/war-room/war-room-api'
import { logAiRecommendation, upsertManagerTendency } from '@/lib/war-room/war-room-persist'
import { listProfilesByLeague } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { resolveProfileAccess, presentProfile } from '@/lib/psychological-profiles/ProfileAccess'
import { filterLabelsByDimension } from '@/lib/psychological-profiles/ProfileLabelResolver'
import type { ProfileLabel } from '@/lib/psychological-profiles/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/war-room/opponent-tendencies — store inferred manager draft tendencies for intel panel.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : undefined
  const gate = await requireLeagueWarRoom(leagueId, auth.userId, 'tendency')
  if (!gate.ok) return gate.response

  const rosterId = typeof body.rosterId === 'string' ? body.rosterId : ''
  const season = typeof body.season === 'number' ? body.season : undefined
  if (!rosterId || season === undefined) {
    return NextResponse.json({ error: 'rosterId and season are required' }, { status: 400 })
  }

  const tendenciesJson =
    body.tendencies && typeof body.tendencies === 'object' ? body.tendencies : { note: 'client_computed' }

  const row = await upsertManagerTendency({
    leagueId: gate.ctx.leagueId,
    season,
    rosterId,
    sport: gate.ctx.sport as unknown as LeagueSport,
    label: typeof body.label === 'string' ? body.label : null,
    tendenciesJson,
    samplePicks: typeof body.samplePicks === 'number' ? body.samplePicks : undefined,
  })

  const log = await logAiRecommendation({
    userId: auth.userId,
    leagueId: gate.ctx.leagueId,
    feature: 'war_room_opponent_tendencies',
    inputJson: body as object,
    outputJson: { tendencyId: row.id } as object,
  })

  return NextResponse.json({
    ok: true,
    tendencyId: row.id,
    updatedAt: row.updatedAt.toISOString(),
    logId: log.id,
  })
}

/**
 * GET /api/war-room/opponent-tendencies — how the other managers in this league
 * actually draft, computed on the server from recorded picks.
 *
 * Added as a method on the existing route rather than a new one.
 *
 * The POST above stores whatever the client sends, defaulting the payload to
 * `{ note: 'client_computed' }`. That is fine as a scratchpad for the draft UI,
 * but it means the intel panel's "opponent tendencies" have never been anything
 * the server could vouch for. This returns the profile engine's view instead:
 * built only from picks that exist, gated by the same asymmetry as every other
 * psychology surface — your own read is free, your leaguemates' is premium — and
 * explicit about managers it has not observed enough to characterise.
 *
 * Draft-dimension labels ONLY. How someone trades is a real observation and
 * belongs in a trade context; quoting it in a draft room is padding.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const leagueId = url.searchParams.get('leagueId') ?? undefined
  const gate = await requireLeagueWarRoom(leagueId, auth.userId, 'tendency')
  if (!gate.ok) return gate.response

  const access = await resolveProfileAccess(gate.ctx.leagueId)
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: access.status })
  }

  const profiles = await listProfilesByLeague(gate.ctx.leagueId, { limit: 32 }).catch(() => [])

  const managers = profiles.map((profile) => {
    const presented = presentProfile(profile, access)
    const locked = 'locked' in presented
    const draft = profile.evidenceSummary?.dimensions.draft
    const labels = locked
      ? []
      : filterLabelsByDimension(profile.profileLabels as ProfileLabel[], 'draft')

    return {
      managerId: profile.managerId,
      isYou: access.ownManagerIds.has(profile.managerId),
      locked,
      labels,
      // Coverage is shown even when locked: "44 picks observed" says how much we
      // watched without saying what it revealed.
      picksObserved: draft?.evidenceCount ?? 0,
      confidence: draft?.confidence ?? null,
      // Said out loud rather than rendered as a bland tendency. A manager we have
      // not watched draft is not an average drafter.
      shortfall:
        draft && !draft.sufficient
          ? draft.evidenceCount === 0
            ? 'No drafts recorded for this manager yet.'
            : `Only ${draft.evidenceCount} pick${draft.evidenceCount === 1 ? '' : 's'} on record — not enough to read a pattern.`
          : null,
    }
  })

  return NextResponse.json({
    leagueId: gate.ctx.leagueId,
    source: 'server_computed_profiles',
    opponentsLocked: !access.canSeeOpponents,
    managers,
  })
}
