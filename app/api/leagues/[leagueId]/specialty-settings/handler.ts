/**
 * /api/leagues/[leagueId]/specialty-settings — the Specialty tab of league settings.
 *
 * GET   → which gated formats this league runs, whether the caller may edit them and why, the token
 *         price of a one-season unlock, the Guillotine config when the league is Guillotine, and the
 *         Salary Cap settings (with every team's cap position) when it is Salary Cap.
 * POST  → `{ confirmTokenSpend }` — unlock THIS league for THIS season with AF Tokens. A commish
 *         whose plan already covers it gets `{ ok: true, alreadyCovered: true }` and pays nothing.
 * PATCH → `{ guillotine: {...} }` — Guillotine rules (GuillotineLeagueConfig + the endgame).
 *         `{ salaryCap: {...} }` — Salary Cap rules (SalaryCapLeagueConfig); rules in
 *         lib/salary-cap/salaryCapSettingsPatch.ts. Logged to the cap event log.
 *
 * Commish and co-commish only. Every other format's editor writes through its own route, and each
 * of those routes calls `specialtySettingsEditRefusal` itself.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { getGuillotineConfig, upsertGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { resolveGuillotineEndgame } from '@/lib/guillotine/endgameRules'
import { getSalaryCapConfig, upsertSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { getCurrentCapYear, getEffectiveCap, getTotalCapHitForRoster } from '@/lib/salary-cap/CapCalculationService'
import {
  capComplianceRow,
  parseSalaryCapSettingsPatch,
  salaryCapSettingsValue,
  type CapComplianceRow,
  type SalaryCapSettingsValue,
} from '@/lib/salary-cap/salaryCapSettingsPatch'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import {
  GUILLOTINE_ENDGAME_THRESHOLD,
  SPECIALTY_SETTINGS_FEATURE_ID,
  SPECIALTY_SETTINGS_TOKEN_RULE,
  SPECIALTY_UNLOCK_SETTINGS_KEY,
  detectGatedSpecialtyFormats,
  parseGuillotineSettingsPatch,
  resolveSpecialtySettingsAccess,
  specialtySettingsEditRefusal,
  specialtyUnlockIdempotencyKey,
  type SpecialtyUnlockRecord,
} from '@/lib/league/specialty-settings-access'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUser(): Promise<{ id: string; email: string | null } | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  const id = session?.user?.id
  return id ? { id, email: session?.user?.email ?? null } : null
}

async function leagueIdFrom(ctx: Ctx): Promise<string> {
  const p = await ctx.params
  return (p?.leagueId ?? '').trim()
}

type SalaryCapState = {
  value: SalaryCapSettingsValue
  /** True once any contract exists: the startup draft is over and its settings are frozen. */
  startupLocked: boolean
  capYear: number
  teams: CapComplianceRow[]
}

/** The editor's view of a Salary Cap league: its settings, and where every team stands this cap year. */
async function loadSalaryCapState(leagueId: string): Promise<SalaryCapState | null> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return null
  const capYear = getCurrentCapYear()
  const [contracts, rosters, labels, ledgers] = await Promise.all([
    prisma.playerContract.count({ where: { leagueId } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
    buildRosterLabelMap(leagueId),
    config.configId
      ? prisma.salaryCapTeamLedger.findMany({ where: { configId: config.configId, capYear }, select: { rosterId: true, rolloverUsed: true } })
      : Promise.resolve([] as { rosterId: string; rolloverUsed: number }[]),
  ])
  const rollover = new Map(ledgers.map((l) => [l.rosterId, l.rolloverUsed]))
  const floor = config.capFloorEnabled ? config.capFloorAmount : null
  const teams = config.configId
    ? await Promise.all(
        rosters.map(async (r) => {
          const hit = await getTotalCapHitForRoster(config.configId, r.id, capYear)
          return capComplianceRow({
            rosterId: r.id,
            name: labels.get(r.id) ?? `Team ${r.id.slice(0, 6)}`,
            cap: getEffectiveCap(config, capYear, rollover.get(r.id) ?? 0),
            floor,
            ...hit,
          })
        }),
      )
    : []
  teams.sort((a, b) => a.capSpace - b.capSpace || a.name.localeCompare(b.name))
  return { value: salaryCapSettingsValue(config), startupLocked: contracts > 0, capYear, teams }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = await leagueIdFrom(ctx)
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const access = await resolveSpecialtySettingsAccess(leagueId, user.id, user.email)
  if (!access) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!access.isCommish) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can view these settings.' }, { status: 403 })
  }

  const formats = await detectGatedSpecialtyFormats(leagueId)
  let guillotine: Record<string, unknown> | null = null
  if (formats.includes('guillotine')) {
    const [config, league] = await Promise.all([
      getGuillotineConfig(leagueId),
      prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineEndgame: true } }),
    ])
    guillotine = config
      ? { ...config, endgame: resolveGuillotineEndgame(league ?? {}).format }
      : null
  }
  const salaryCap = formats.includes('salary_cap') ? await loadSalaryCapState(leagueId) : null

  return NextResponse.json({
    formats,
    canEdit: access.canEdit,
    coveredBySubscription: access.coveredBySubscription,
    unlock: access.unlock,
    season: access.season,
    tokenCost: access.tokenCost,
    paywallLive: access.paywallLive,
    paywallStartsAt: access.paywallStartsAt,
    featureId: SPECIALTY_SETTINGS_FEATURE_ID,
    upgradePath: `/commissioner-upgrade?feature=${SPECIALTY_SETTINGS_FEATURE_ID}`,
    guillotine,
    salaryCap,
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = await leagueIdFrom(ctx)
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { confirmTokenSpend?: unknown }
  const access = await resolveSpecialtySettingsAccess(leagueId, user.id, user.email)
  if (!access) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!access.isCommish) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can unlock these settings.' }, { status: 403 })
  }
  if (access.coveredBySubscription) return NextResponse.json({ ok: true, alreadyCovered: true, unlock: null })
  // Nothing is sold before the paywall launch — there is nothing to unlock yet.
  if (!access.paywallLive) return NextResponse.json({ ok: true, prelaunch: true, unlock: null })
  if (access.unlock) return NextResponse.json({ ok: true, alreadyUnlocked: true, unlock: access.unlock })

  // Token path only: the plan check above already answered "covered". Idempotent per league and
  // season, so a double tap or a retried request returns the first charge instead of a second.
  const gate = await requireFeatureEntitlement({
    userId: user.id,
    userEmail: user.email,
    featureId: SPECIALTY_SETTINGS_FEATURE_ID,
    allowTokenFallback: true,
    tokenRuleCode: SPECIALTY_SETTINGS_TOKEN_RULE,
    confirmTokenSpend: body.confirmTokenSpend === true,
    tokenSourceType: 'specialty_settings_unlock',
    tokenSourceId: `${leagueId}:${access.season}`,
    tokenDescription: `Specialty league settings unlock — ${access.season} season`,
    tokenMetadata: { leagueId, season: access.season },
    tokenIdempotencyKey: specialtyUnlockIdempotencyKey(leagueId, access.season),
  })
  if (!gate.ok) return gate.response

  const unlock: SpecialtyUnlockRecord = {
    season: access.season,
    unlockedByUserId: user.id,
    unlockedAt: new Date().toISOString(),
    tokenLedgerId: gate.tokenSpend?.id ?? null,
  }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const prev = (league?.settings as Record<string, unknown> | null) ?? {}
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...prev, [SPECIALTY_UNLOCK_SETTINGS_KEY]: unlock } as Prisma.InputJsonValue },
  })
  return NextResponse.json({ ok: true, unlock, tokenSpend: gate.tokenSpend })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = await leagueIdFrom(ctx)
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const refusal = await specialtySettingsEditRefusal(leagueId, user.id, user.email)
  if (refusal) return refusal

  const body = (await req.json().catch(() => ({}))) as { guillotine?: unknown; salaryCap?: unknown }
  if (body.salaryCap !== undefined) return patchSalaryCap(leagueId, user.id, body.salaryCap)
  if (!body.guillotine || typeof body.guillotine !== 'object' || Array.isArray(body.guillotine)) {
    return NextResponse.json({ error: 'guillotine settings object required' }, { status: 400 })
  }
  const formats = await detectGatedSpecialtyFormats(leagueId)
  if (!formats.includes('guillotine')) {
    return NextResponse.json({ error: 'This is not a Guillotine league.' }, { status: 409 })
  }

  const parsed = parseGuillotineSettingsPatch(body.guillotine as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { endgame, ...configPatch } = parsed.patch

  if (endgame) {
    // `resolveGuillotineEndgame` reads `settings.guillotineEndgame` BEFORE the column — writing only
    // the column would be a save that changes nothing.
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const prev = (league?.settings as Record<string, unknown> | null) ?? {}
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        guillotineEndgame: endgame,
        guillotineEndgameThreshold: GUILLOTINE_ENDGAME_THRESHOLD[endgame],
        settings: { ...prev, guillotineEndgame: endgame } as Prisma.InputJsonValue,
      },
    })
  }

  const config = Object.keys(configPatch).length > 0
    ? await upsertGuillotineConfig(leagueId, configPatch)
    : await getGuillotineConfig(leagueId)
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineEndgame: true } })
  return NextResponse.json({
    ok: true,
    guillotine: config ? { ...config, endgame: resolveGuillotineEndgame(league ?? {}).format } : null,
  })
}

async function patchSalaryCap(leagueId: string, actorUserId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'salaryCap settings object required' }, { status: 400 })
  }
  const formats = await detectGatedSpecialtyFormats(leagueId)
  if (!formats.includes('salary_cap')) {
    return NextResponse.json({ error: 'This is not a Salary Cap league.' }, { status: 409 })
  }
  const before = await getSalaryCapConfig(leagueId)
  if (!before) return NextResponse.json({ error: 'Salary Cap settings not found.' }, { status: 404 })
  const current = salaryCapSettingsValue(before)
  const startupLocked = (await prisma.playerContract.count({ where: { leagueId } })) > 0

  const parsed = parseSalaryCapSettingsPatch(raw as Record<string, unknown>, current, { startupLocked })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [k, v] of Object.entries(parsed.patch)) {
    const from = (current as Record<string, unknown>)[k]
    if (k !== 'weightedLotteryEnabled' && from !== v) changes[k] = { from, to: v }
  }
  if (Object.keys(changes).length > 0) {
    const after = await upsertSalaryCapConfig(leagueId, parsed.patch)
    if (after?.configId) {
      await prisma.salaryCapEventLog.create({
        data: {
          leagueId,
          configId: after.configId,
          eventType: 'settings_changed',
          metadata: { actorUserId, changes } as Prisma.InputJsonValue,
        },
      })
    }
  }
  return NextResponse.json({ ok: true, salaryCap: await loadSalaryCapState(leagueId) })
}
