import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { getLeagueScoringConfig } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { replaceLeagueScoringOverrides } from '@/lib/scoring-defaults/ScoringOverrideService'
import { normalizeScoringStatKey } from '@/lib/scoring-defaults/ScoringKeyAliasResolver'
import { queueLeagueScoringRecalcAfterRulesChange } from '@/lib/scoring-defaults/queueLeagueScoringRecalc'

type IncomingRule = {
  statKey?: unknown
  pointsValue?: unknown
  enabled?: unknown
}

export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gate = await assertLeagueMember(params.leagueId, userId)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.status === 404 ? 'League not found' : 'Forbidden' }, { status: gate.status })
  }

  const type = req.nextUrl.searchParams?.get('type') || 'settings'
  if (type !== 'settings') {
    return NextResponse.json({ error: 'Unsupported type' }, { status: 400 })
  }

  const config = await getLeagueScoringConfig(params.leagueId)
  if (!config) {
    return NextResponse.json(
      { error: 'League or scoring config not found' },
      { status: 404 }
    )
  }

  return NextResponse.json(config)
}

export async function PUT(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = await getLeagueRole(params.leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const config = await getLeagueScoringConfig(params.leagueId)
  if (!config) {
    return NextResponse.json(
      { error: 'League or scoring config not found' },
      { status: 404 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as {
    rules?: IncomingRule[]
  }
  if (!Array.isArray(body.rules)) {
    return NextResponse.json(
      { error: 'rules array is required' },
      { status: 400 }
    )
  }

  const templateRuleByKey = new Map(
    config.rules.map((rule) => [rule.statKey, rule])
  )
  const nextRuleByKey = new Map(
    config.rules.map((rule) => [
      rule.statKey,
      { statKey: rule.statKey, pointsValue: rule.pointsValue, enabled: rule.enabled },
    ])
  )

  for (const row of body.rules) {
    const inputStatKey =
      typeof row.statKey === 'string' ? row.statKey.trim() : ''
    if (!inputStatKey) continue
    const statKey = normalizeScoringStatKey(inputStatKey, {
      sportType: config.sport,
      templateRuleKeys: templateRuleByKey.keys(),
    })
    if (!templateRuleByKey.has(statKey)) {
      return NextResponse.json(
        { error: `Unknown stat key: ${inputStatKey}` },
        { status: 400 }
      )
    }
    const rawPv = row.pointsValue
    const pointsValue =
      rawPv === '' || rawPv === null || rawPv === undefined ? 0 : Number(rawPv)
    if (!Number.isFinite(pointsValue)) {
      return NextResponse.json(
        { error: `Invalid points value for ${statKey}` },
        { status: 400 }
      )
    }
    nextRuleByKey.set(statKey, {
      statKey,
      pointsValue,
      enabled: row.enabled !== false,
    })
  }

  const overrides = config.rules
    .map((templateRule) => {
      const next = nextRuleByKey.get(templateRule.statKey) ?? {
        statKey: templateRule.statKey,
        pointsValue: templateRule.pointsValue,
        enabled: templateRule.enabled,
      }
      const hasPointsDiff =
        Math.abs(next.pointsValue - templateRule.defaultPointsValue) > 0.0001
      const hasEnabledDiff = next.enabled !== templateRule.defaultEnabled
      if (!hasPointsDiff && !hasEnabledDiff) return null
      return {
        statKey: next.statKey,
        pointsValue: next.pointsValue,
        enabled: next.enabled,
      }
    })
    .filter((v): v is { statKey: string; pointsValue: number; enabled: boolean } => v !== null)

  await replaceLeagueScoringOverrides(params.leagueId, overrides)

  queueLeagueScoringRecalcAfterRulesChange(params.leagueId)

  revalidatePath(`/league/${params.leagueId}`)

  const refreshed = await getLeagueScoringConfig(params.leagueId)
  return NextResponse.json(refreshed ?? { ok: true })
}
