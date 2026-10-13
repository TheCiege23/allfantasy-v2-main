/**
 * /api/leagues/[leagueId]/specialty-settings — the Specialty tab of league settings.
 *
 * GET   → which gated formats this league runs, whether the caller may edit them and why, the token
 *         price of a one-season unlock, the Guillotine config when the league is Guillotine, the
 *         Salary Cap settings (with every team's cap position) when it is Salary Cap, and the
 *         tournament's rules when it is a feeder league of a TournamentShell.
 * POST  → `{ confirmTokenSpend }` — unlock THIS league for THIS season with AF Tokens. A commish
 *         whose plan already covers it gets `{ ok: true, alreadyCovered: true }` and pays nothing.
 * PATCH → `{ guillotine: {...} }` — Guillotine rules (GuillotineLeagueConfig + the endgame).
 *         `{ salaryCap: {...} }` — Salary Cap rules (SalaryCapLeagueConfig); rules in
 *         lib/salary-cap/salaryCapSettingsPatch.ts. Logged to the cap event log.
 *         `{ tournament: {...} }` — the tournament's cut, bubble, tiebreaker, name and conference
 *         names, applied by lib/tournament/updateTournamentSettings.ts (which also audits). Only the
 *         TOURNAMENT's commish may save; a league co-commish sees the rules read-only.
 *         `{ legacyTournament: {...} }` — the same for a LEGACY tournament (`LegacyTournament`), rules in
 *         lib/tournament-mode/legacyTournamentEditor.ts. Its creator or staff with settings permission
 *         may save (canEditHubSettings, the hub's own rule).
 *         `{ zombie: {...} }` — Zombie rules: per-league overrides of the sport's bash/maul/weapon/serum
 *         rules (`League.settings.zombie_rules`, read by the live engines via getZombieRulesForLeague),
 *         plus the Whisperer and infection columns the engines already read. `null` on an override
 *         key puts it back to the sport's rule.
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
import { updateTournamentSettings } from '@/lib/tournament/updateTournamentSettings'
import { parseTournamentEditorPatch, type TournamentEditorValue } from '@/lib/tournament/tournamentEditorPatch'
import { canEditHubSettings, getLegacyTournamentAccess } from '@/lib/tournament/legacyTournamentAccess'
import { getZombieRulesForLeague, getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import {
  ZOMBIE_RULES_SETTINGS_KEY,
  ZOMBIE_RULE_LIMITS,
  parseZombieRulesPatch,
  readZombieRuleOverrides,
  type ZombieRuleOverrides,
} from '@/lib/zombie/zombieLeagueRules'
import { upsertZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { logAuditEntry } from '@/lib/zombie/auditService'
import { logTournamentAudit } from '@/lib/tournament-mode/TournamentAuditService'
import {
  LEGACY_LIVE_STATUSES,
  legacyTournamentEditorValue,
  parseLegacyTournamentPatch,
  type LegacyTournamentEditorValue,
} from '@/lib/tournament-mode/legacyTournamentEditor'
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

type TournamentState = {
  tournamentId: string
  /** Only the tournament's commish can change tournament-wide rules (updateTournamentSettings enforces it). */
  canEdit: boolean
  value: TournamentEditorValue
  conferences: Array<{ id: string; name: string; isActive: boolean }>
  overview: {
    sport: string
    status: string
    currentRoundNumber: number
    totalRounds: number
    conferenceCount: number
    leaguesPerConference: number
    teamsPerLeague: number
    thisLeague: { roundLabel: string; conferenceName: string | null }
  }
  /** True once an advancement has run: a new cut changes the line from here, it moves nobody. */
  alreadyAdvanced: boolean
}

/** The tournament this feeder league belongs to, as the editor shows it. Null for a legacy tournament. */
async function loadTournamentState(leagueId: string, userId: string): Promise<TournamentState | null> {
  const link = await prisma.tournamentLeague.findUnique({
    where: { leagueId },
    select: {
      round: { select: { roundLabel: true } },
      conference: { select: { name: true } },
      tournament: {
        select: {
          id: true, name: true, sport: true, status: true, commissionerId: true,
          currentRoundNumber: true, totalRounds: true, conferenceCount: true, leaguesPerConference: true,
          teamsPerLeague: true, advancersPerLeague: true, wildcardCount: true, bubbleEnabled: true,
          bubbleSize: true, tiebreakerMode: true,
          conferences: { select: { id: true, name: true, isActive: true }, orderBy: { conferenceNumber: 'asc' } },
        },
      },
    },
  })
  if (!link) return null
  const t = link.tournament
  const alreadyAdvanced = (await prisma.tournamentAdvancementGroup.count({ where: { tournamentId: t.id } })) > 0
  return {
    tournamentId: t.id,
    canEdit: t.commissionerId === userId,
    value: {
      name: t.name,
      advancersPerLeague: t.advancersPerLeague,
      wildcardCount: t.wildcardCount,
      bubbleEnabled: t.bubbleEnabled,
      bubbleSize: t.bubbleSize,
      tiebreakerMode: t.tiebreakerMode,
    },
    conferences: t.conferences,
    overview: {
      sport: t.sport,
      status: t.status,
      currentRoundNumber: t.currentRoundNumber,
      totalRounds: t.totalRounds,
      conferenceCount: t.conferenceCount,
      leaguesPerConference: t.leaguesPerConference,
      teamsPerLeague: t.teamsPerLeague,
      thisLeague: { roundLabel: link.round.roundLabel, conferenceName: link.conference?.name ?? null },
    },
    alreadyAdvanced,
  }
}

type LegacyTournamentState = {
  tournamentId: string
  canEdit: boolean
  value: LegacyTournamentEditorValue
  conferences: Array<{ id: string; name: string }>
  overview: { sport: string; season: number; status: string; phase: string; roundIndex: number; conferenceName: string; leagueCount: number }
  /** Name and description are frozen once the tournament is locked. */
  locked: boolean
  /** Draft type and the bubble week are frozen once the elimination rounds start. */
  live: boolean
}

/** The legacy tournament this league feeds, as the editor shows it. Null when it is not one. */
async function loadLegacyTournamentState(leagueId: string, userId: string): Promise<LegacyTournamentState | null> {
  const link = await prisma.legacyTournamentLeague.findUnique({
    where: { leagueId },
    select: {
      phase: true,
      roundIndex: true,
      conference: { select: { name: true } },
      tournament: {
        select: {
          id: true, name: true, sport: true, season: true, status: true, settings: true, hubSettings: true, lockedAt: true,
          conferences: { select: { id: true, name: true }, orderBy: { orderIndex: 'asc' } },
          _count: { select: { leagues: true } },
        },
      },
    },
  })
  if (!link) return null
  const t = link.tournament
  const settings = (t.settings ?? {}) as Record<string, unknown>
  const access = await getLegacyTournamentAccess(userId, t.id)
  return {
    tournamentId: t.id,
    canEdit: canEditHubSettings(access),
    value: legacyTournamentEditorValue(t),
    conferences: t.conferences,
    overview: {
      sport: t.sport,
      season: t.season,
      status: t.status,
      phase: link.phase,
      roundIndex: link.roundIndex,
      conferenceName: link.conference.name,
      leagueCount: t._count.leagues,
    },
    locked: Boolean(t.lockedAt) || Boolean(settings.locked),
    live: (LEGACY_LIVE_STATUSES as readonly string[]).includes(t.status),
  }
}

const ZOMBIE_RULE_KEYS = [...Object.keys(ZOMBIE_RULE_LIMITS), 'bombEnabled', 'whispererDefeatRule'] as const
const WHISPERER_SELECTIONS = ['random', 'veteran_priority'] as const

type ZombieState = {
  value: {
    bashingThreshold: number
    maulingThreshold: number
    bashDecisionHours: number
    weaponShieldThreshold: number
    weaponAmbushThreshold: number
    bombEnabled: boolean
    reviveThreshold: number
    serumMaxHold: number
    whispererDefeatRule: string
    whispererSelection: string
    whispererAmbushCount: number
    infectionLossToWhisperer: boolean
    infectionLossToZombie: boolean
  }
  /** The sport's numbers, so the editor can show what a reset goes back to. */
  sportDefaults: { bashingThreshold: number; maulingThreshold: number; weaponShieldThreshold: number; weaponAmbushThreshold: number; reviveThreshold: number; serumMaxHold: number }
  overridden: string[]
  /** Promotion and relegation belong to the universe (every league in it), so they are shown, not edited. */
  universe: { name: string; promotionEnabled: boolean; promotionCount: number; relegationEnabled: boolean; relegationCount: number } | null
}

async function loadZombieState(leagueId: string): Promise<ZombieState | null> {
  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: { sport: true, whispererAmbushCount: true, universeId: true },
  })
  if (!z) return null
  const [rules, sportRules, cfg, universe] = await Promise.all([
    getZombieRulesForLeague(leagueId, z.sport),
    getZombieRulesForSport(z.sport),
    prisma.zombieLeagueConfig.findUnique({
      where: { leagueId },
      select: { whispererSelection: true, infectionLossToWhisperer: true, infectionLossToZombie: true },
    }),
    z.universeId
      ? prisma.zombieUniverse.findUnique({
          where: { id: z.universeId },
          select: { name: true, promotionEnabled: true, promotionCount: true, relegationEnabled: true, relegationCount: true },
        })
      : Promise.resolve(null),
  ])
  return {
    value: {
      bashingThreshold: rules.bashingThreshold,
      maulingThreshold: rules.maulingThreshold,
      bashDecisionHours: rules.bashDecisionHours,
      weaponShieldThreshold: rules.weaponShieldThreshold,
      weaponAmbushThreshold: rules.weaponAmbushThreshold,
      bombEnabled: rules.bombEnabled,
      reviveThreshold: rules.reviveThreshold,
      serumMaxHold: rules.serumMaxHold,
      whispererDefeatRule: rules.whispererDefeatRule,
      // The activation engine honours random and veteran_priority only (activateNativeZombieLeague).
      whispererSelection: cfg?.whispererSelection === 'veteran_priority' ? 'veteran_priority' : 'random',
      whispererAmbushCount: z.whispererAmbushCount,
      infectionLossToWhisperer: cfg?.infectionLossToWhisperer ?? true,
      infectionLossToZombie: cfg?.infectionLossToZombie ?? true,
    },
    sportDefaults: {
      bashingThreshold: sportRules.bashingThreshold,
      maulingThreshold: sportRules.maulingThreshold,
      weaponShieldThreshold: sportRules.weaponShieldThreshold,
      weaponAmbushThreshold: sportRules.weaponAmbushThreshold,
      reviveThreshold: sportRules.reviveThreshold,
      serumMaxHold: sportRules.serumMaxHold,
    },
    overridden: rules.overridden,
    universe,
  }
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
  const tournament = formats.includes('tournament') ? await loadTournamentState(leagueId, user.id) : null
  const legacyTournament =
    formats.includes('tournament') && !tournament ? await loadLegacyTournamentState(leagueId, user.id) : null
  const zombie = formats.includes('zombie') ? await loadZombieState(leagueId) : null

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
    tournament,
    legacyTournament,
    zombie,
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

  const body = (await req.json().catch(() => ({}))) as {
    guillotine?: unknown
    salaryCap?: unknown
    tournament?: unknown
    legacyTournament?: unknown
    zombie?: unknown
  }
  if (body.zombie !== undefined) return patchZombie(leagueId, user.id, body.zombie)
  if (body.legacyTournament !== undefined) return patchLegacyTournament(leagueId, user.id, body.legacyTournament)
  if (body.salaryCap !== undefined) return patchSalaryCap(leagueId, user.id, body.salaryCap)
  if (body.tournament !== undefined) return patchTournament(leagueId, user.id, body.tournament)
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

async function patchTournament(leagueId: string, userId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'tournament settings object required' }, { status: 400 })
  }
  const state = await loadTournamentState(leagueId, userId)
  if (!state) {
    return NextResponse.json({ error: 'This league is not part of a tournament that can be edited here.' }, { status: 409 })
  }
  if (!state.canEdit) {
    return NextResponse.json({ error: "Only the tournament's commish can change tournament rules." }, { status: 403 })
  }
  const parsed = parseTournamentEditorPatch(raw as Record<string, unknown>, state.value)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const result = await updateTournamentSettings({
    tournamentId: state.tournamentId,
    commissionerUserId: userId,
    patch: parsed.patch,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, tournament: await loadTournamentState(leagueId, userId) })
}

async function patchLegacyTournament(leagueId: string, userId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'legacyTournament settings object required' }, { status: 400 })
  }
  const state = await loadLegacyTournamentState(leagueId, userId)
  if (!state) {
    return NextResponse.json({ error: 'This league is not part of a tournament that can be edited here.' }, { status: 409 })
  }
  if (!state.canEdit) {
    return NextResponse.json({ error: "Only the tournament's commish or its settings staff can change tournament rules." }, { status: 403 })
  }
  const parsed = parseLegacyTournamentPatch(raw as Record<string, unknown>, { locked: state.locked, live: state.live })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { name, description, settings, conferenceNames = [] } = parsed.patch

  // ⚠ SCOPED TO THIS TOURNAMENT: conference ids come from the request body.
  if (conferenceNames.length > 0) {
    const owned = await prisma.legacyTournamentConference.count({
      where: { tournamentId: state.tournamentId, id: { in: conferenceNames.map((c) => c.id) } },
    })
    if (owned !== new Set(conferenceNames.map((c) => c.id)).size) {
      return NextResponse.json({ error: 'One of those conferences is not in this tournament.' }, { status: 404 })
    }
  }

  const changed = [
    ...(name !== undefined && name !== state.value.name ? ['name'] : []),
    ...(description !== undefined && description !== state.value.description ? ['description'] : []),
    ...Object.entries(settings)
      .filter(([k, v]) => JSON.stringify((state.value as Record<string, unknown>)[k]) !== JSON.stringify(v))
      .map(([k]) => k),
    ...conferenceNames
      .filter((c) => state.conferences.find((x) => x.id === c.id)?.name !== c.name)
      .map((c) => `conference:${c.id}`),
  ]
  if (changed.length > 0) {
    // Read-merge-write the JSON in one transaction so a concurrent hub save is not overwritten
    // with a stale copy of the keys this editor does not touch.
    await prisma.$transaction(async (tx) => {
      const row = await tx.legacyTournament.findUnique({
        where: { id: state.tournamentId },
        select: { settings: true, hubSettings: true },
      })
      const prevSettings = (row?.settings ?? {}) as Record<string, unknown>
      const prevHub = (row?.hubSettings ?? {}) as Record<string, unknown>
      await tx.legacyTournament.update({
        where: { id: state.tournamentId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(Object.keys(settings).length > 0 ? { settings: { ...prevSettings, ...settings } as Prisma.InputJsonValue } : {}),
          ...(description !== undefined ? { hubSettings: { ...prevHub, description } as Prisma.InputJsonValue } : {}),
        },
      })
      for (const c of conferenceNames) {
        await tx.legacyTournamentConference.update({ where: { id: c.id }, data: { name: c.name } })
      }
    })
    await logTournamentAudit(state.tournamentId, 'bulk_update', {
      actorId: userId,
      metadata: { fields: changed, source: 'league_settings_specialty_tab' },
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true, legacyTournament: await loadLegacyTournamentState(leagueId, userId) })
}

async function patchZombie(leagueId: string, userId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'zombie settings object required' }, { status: 400 })
  }
  const formats = await detectGatedSpecialtyFormats(leagueId)
  const state = formats.includes('zombie') ? await loadZombieState(leagueId) : null
  if (!state) return NextResponse.json({ error: 'This is not a Zombie league.' }, { status: 409 })
  const body = raw as Record<string, unknown>

  // Rule overrides: `null` resets a key to the sport's rule; a value is validated on the effective set.
  const resets = ZOMBIE_RULE_KEYS.filter((k) => body[k] === null)
  const ruleRaw = Object.fromEntries(ZOMBIE_RULE_KEYS.filter((k) => body[k] !== undefined && body[k] !== null).map((k) => [k, body[k]]))
  const effective = {
    ...state.value,
    ...Object.fromEntries(resets.map((k) => [k, (state.sportDefaults as Record<string, unknown>)[k] ?? (k === 'bashDecisionHours' ? 48 : k === 'bombEnabled' ? true : 'commissioner_decides')])),
  } as Parameters<typeof parseZombieRulesPatch>[1]
  const parsed = parseZombieRulesPatch(ruleRaw, effective)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // Columns the engines already read.
  const cfgPatch: { whispererSelection?: string; infectionLossToWhisperer?: boolean; infectionLossToZombie?: boolean } = {}
  if (body.whispererSelection !== undefined) {
    if (!(WHISPERER_SELECTIONS as readonly unknown[]).includes(body.whispererSelection)) {
      return NextResponse.json({ error: `whispererSelection must be one of: ${WHISPERER_SELECTIONS.join(', ')}` }, { status: 400 })
    }
    cfgPatch.whispererSelection = body.whispererSelection as string
  }
  for (const key of ['infectionLossToWhisperer', 'infectionLossToZombie'] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return NextResponse.json({ error: `${key} must be true or false` }, { status: 400 })
    cfgPatch[key] = body[key] as boolean
  }
  let ambushCount: number | undefined
  if (body.whispererAmbushCount !== undefined) {
    const n = body.whispererAmbushCount
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) {
      return NextResponse.json({ error: 'whispererAmbushCount must be a whole number from 0 to 10' }, { status: 400 })
    }
    ambushCount = n
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const note = (k: string, to: unknown) => {
    const from = (state.value as Record<string, unknown>)[k]
    if (from !== to) changes[k] = { from, to }
  }
  for (const [k, v] of Object.entries(parsed.patch)) note(k, v)
  for (const k of resets) if (state.overridden.includes(k)) changes[k] = { from: (state.value as Record<string, unknown>)[k], to: 'sport default' }
  for (const [k, v] of Object.entries(cfgPatch)) note(k, v)
  if (ambushCount !== undefined) note('whispererAmbushCount', ambushCount)

  if (Object.keys(changes).length > 0) {
    const ruleKeysTouched = Object.keys(parsed.patch).length > 0 || resets.length > 0
    if (ruleKeysTouched) {
      // Read-merge-write in one transaction so a concurrent settings save is not overwritten.
      await prisma.$transaction(async (tx) => {
        const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
        const prev = (league?.settings ?? {}) as Record<string, unknown>
        const merged: ZombieRuleOverrides = { ...readZombieRuleOverrides(prev), ...parsed.patch }
        for (const k of resets) delete (merged as Record<string, unknown>)[k]
        await tx.league.update({
          where: { id: leagueId },
          data: { settings: { ...prev, [ZOMBIE_RULES_SETTINGS_KEY]: merged } as Prisma.InputJsonValue },
        })
      })
    }
    if (Object.keys(cfgPatch).length > 0) await upsertZombieLeagueConfig(leagueId, cfgPatch)
    if (ambushCount !== undefined || cfgPatch.whispererSelection !== undefined) {
      // whispererSelectionMode mirrors the config for the rules page; the ambush count is copied onto
      // the Whisperer when one is chosen, so a change applies from the next selection.
      await prisma.zombieLeague.update({
        where: { leagueId },
        data: {
          ...(ambushCount !== undefined ? { whispererAmbushCount: ambushCount } : {}),
          ...(cfgPatch.whispererSelection !== undefined ? { whispererSelectionMode: cfgPatch.whispererSelection } : {}),
        },
      })
    }
    const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { id: true } })
    if (z) {
      await logAuditEntry(z.id, {
        category: 'commissioner_override',
        action: 'RULES_CHANGED',
        description: `Zombie rules changed: ${Object.keys(changes).join(', ')}`,
        actorUserId: userId,
        actorRole: 'commissioner',
        previousState: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.from])) as Prisma.InputJsonValue,
        newState: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to])) as Prisma.InputJsonValue,
      }).catch(() => {})
    }
  }
  return NextResponse.json({ ok: true, zombie: await loadZombieState(leagueId) })
}
