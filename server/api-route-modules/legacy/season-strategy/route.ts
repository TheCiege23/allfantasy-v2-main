import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getOrComputeStrategy, getStrategyHistory } from '@/lib/season-strategy'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

const PostSchema = z.object({
  league_id: z.string().min(1).max(64),
  roster_id: z.number().int().positive(),
  sleeper_username: z.string().min(1).max(40).optional(),
  force_refresh: z.boolean().optional().default(false),
})

export const POST = withApiUsage({ endpoint: "/api/legacy/season-strategy", tool: "LegacySeasonStrategy" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const parsed = PostSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { league_id, roster_id, force_refresh } = parsed.data

    // Was `requireAuthOrOrigin` — open to any caller sending an Origin header.
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: parsed.data.sleeper_username ?? null,
      rateLimit: { action: 'season_strategy', maxRequests: 3, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response

    const result = await getOrComputeStrategy(league_id, roster_id, gate.identity.sleeperUsername, force_refresh)

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    console.error('Season strategy error:', error)
    const message = error instanceof Error ? error.message : 'Failed to compute season strategy'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})

const GetSchema = z.object({
  league_id: z.string().min(1).max(64),
  roster_id: z.coerce.number().int().positive(),
})

export const GET = withApiUsage({ endpoint: "/api/legacy/season-strategy", tool: "LegacySeasonStrategy" })(async (req: NextRequest) => {
  /*
   * No username in this request — it is league+roster scoped — so there is nothing to
   * compare. It still needs a real session: it returns a league's strategy history, and
   * `requireAuthOrOrigin` left that readable by anyone.
   */
  const gate = await requireLegacySleeperIdentity(req, {
    rateLimit: { action: 'season_strategy_get', maxRequests: 30, windowMs: 60_000 },
  })
  if (!gate.ok) return gate.response

  const url = new URL(req.url)
  const parsed = GetSchema.safeParse({
    league_id: url.searchParams?.get('league_id'),
    roster_id: url.searchParams?.get('roster_id'),
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Missing league_id or roster_id query parameters' },
      { status: 400 },
    )
  }

  try {
    const history = await getStrategyHistory(parsed.data.league_id, parsed.data.roster_id)

    if (history.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No strategy snapshots found. Compute one first via POST.' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      ok: true,
      history,
    })
  } catch (error) {
    console.error('Season strategy GET error:', error)
    return NextResponse.json({ error: 'Failed to retrieve strategy history' }, { status: 500 })
  }
})

