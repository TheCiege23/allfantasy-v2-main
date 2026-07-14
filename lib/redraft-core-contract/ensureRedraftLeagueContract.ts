import { Prisma } from '@prisma/client'
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  buildRedraftSettingsSnapshot,
  getRedraftEngineDraftType,
  isFootballRedraftDefaultsSport,
  isKnownLegacyRedraftStarterMap,
  normalizeRedraftDraftType,
  resolveRedraftScoringPreset,
} from '@/lib/league-concepts/redraftDefaults'

type JsonRecord = Record<string, unknown>

export type RedraftContractRepairPlan = {
  eligible: boolean
  reason?: string
  nextSettings: JsonRecord
  settingsChanged: boolean
  draftSession: {
    shouldCreate: boolean
    shouldUpdate: boolean
    data: {
      status: 'pre_draft'
      draftType: 'snake' | 'linear' | 'auction'
      rounds: number
      teamCount: number
      timerSeconds: number
      slotOrder: Array<{ slot: number; rosterId: string; displayName: string }>
      auctionBudgetPerTeam: number | null
      sportType: string
      sessionKind: 'live'
      cpuAutoPick: boolean
      aiAutoPick: boolean
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function deepMergeMissing(defaults: JsonRecord, incoming: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...incoming }
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const incomingValue = out[key]
    if (incomingValue === undefined || incomingValue === null) {
      out[key] = defaultValue
      continue
    }
    if (isRecord(defaultValue) && isRecord(incomingValue)) {
      out[key] = deepMergeMissing(defaultValue, incomingValue)
    }
  }
  return out
}

function jsonStable(value: unknown): string {
  return JSON.stringify(value)
}

function readStarterSlots(settings: JsonRecord): unknown {
  if (isRecord(settings.starter_slots)) return settings.starter_slots
  if (isRecord(settings.rosterTemplate) && isRecord(settings.rosterTemplate.starterSlots)) {
    return settings.rosterTemplate.starterSlots
  }
  if (isRecord(settings.rosterSettings) && isRecord(settings.rosterSettings.starterSlots)) {
    return settings.rosterSettings.starterSlots
  }
  return null
}

function shouldRepairRosterDefaults(sport: 'NFL' | 'NCAAF', settings: JsonRecord): boolean {
  const current = readStarterSlots(settings)
  return !current || isKnownLegacyRedraftStarterMap(sport, current)
}

function scoringInput(settings: JsonRecord): string | null {
  if (typeof settings.scoring_preset_id === 'string') return settings.scoring_preset_id
  if (typeof settings.scoringPreset === 'string') return settings.scoringPreset
  if (isRecord(settings.scoringSettings) && typeof settings.scoringSettings.scoringPresetId === 'string') {
    return settings.scoringSettings.scoringPresetId
  }
  return null
}

function normalizeScoringIfKnown(sport: 'NFL' | 'NCAAF', settings: JsonRecord): JsonRecord {
  const raw = scoringInput(settings)
  if (!raw) return settings
  const normalized = resolveRedraftScoringPreset({ sport, presetId: raw })
  if (!normalized) return settings
  const allowed = new Set([normalized.presetId, ...normalized.aliases].map((v) => v.toLowerCase()))
  if (!allowed.has(raw.toLowerCase()) && !raw.toLowerCase().includes('ppr') && !raw.toLowerCase().includes('standard')) {
    return settings
  }
  const scoringSettings = isRecord(settings.scoringSettings) ? { ...settings.scoringSettings } : {}
  scoringSettings.preset = normalized.presetId
  scoringSettings.scoringPresetId = normalized.presetId
  scoringSettings.scoringTemplateId = normalized.templateId
  return {
    ...settings,
    scoring_preset_id: normalized.presetId,
    scoringPreset: normalized.presetId,
    scoring_template_id: normalized.templateId,
    scoringSettings,
  }
}

export function buildRedraftDraftSlotOrder(input: {
  teamCount: number
  rosters?: Array<{ id: string }> | null
  teams?: Array<{ ownerName?: string | null; teamName?: string | null }> | null
}): Array<{ slot: number; rosterId: string; displayName: string }> {
  const teamCount = Math.max(2, Math.floor(input.teamCount || 12))
  const rosters = input.rosters ?? []
  const teams = input.teams ?? []
  const out: Array<{ slot: number; rosterId: string; displayName: string }> = []

  for (let i = 0; i < teamCount; i += 1) {
    const roster = rosters[i]
    out.push({
      slot: i + 1,
      rosterId: roster?.id ?? `placeholder-${i + 1}`,
      displayName: teams[i]?.ownerName || teams[i]?.teamName || `Team ${i + 1}`,
    })
  }

  return out
}

function isCompleteSlotOrder(slotOrder: unknown, teamCount: number): boolean {
  if (!Array.isArray(slotOrder) || slotOrder.length < teamCount) return false
  const slots = new Set<number>()
  for (const entry of slotOrder) {
    if (!isRecord(entry)) return false
    const slot = Number(entry.slot)
    const rosterId = entry.rosterId
    if (!Number.isInteger(slot) || slot < 1 || slot > teamCount) return false
    if (typeof rosterId !== 'string' || rosterId.length === 0) return false
    slots.add(slot)
  }
  return slots.size === teamCount
}

export function buildRedraftContractRepairPlan(input: {
  sport: LeagueSport | string
  leagueType?: string | null
  isDynasty?: boolean | null
  teamCount?: number | null
  settings?: JsonRecord | null
  draftSession?: { status?: string | null; slotOrder?: unknown; rounds?: number | null; timerSeconds?: number | null } | null
  rosters?: Array<{ id: string }> | null
  teams?: Array<{ ownerName?: string | null; teamName?: string | null }> | null
}): RedraftContractRepairPlan {
  const sportRaw = String(input.sport ?? '').trim().toUpperCase()
  const leagueType = String(input.leagueType ?? 'redraft').trim().toLowerCase()
  if (!isFootballRedraftDefaultsSport(sportRaw) || leagueType !== 'redraft' || input.isDynasty) {
    return {
      eligible: false,
      reason: 'not_football_redraft',
      nextSettings: input.settings ?? {},
      settingsChanged: false,
      draftSession: {
        shouldCreate: false,
        shouldUpdate: false,
        data: {
          status: 'pre_draft',
          draftType: 'snake',
          rounds: 15,
          teamCount: numberOr(input.teamCount, 12),
          timerSeconds: 90,
          slotOrder: [],
          auctionBudgetPerTeam: null,
          sportType: sportRaw || 'NFL',
          sessionKind: 'live',
          cpuAutoPick: true,
          aiAutoPick: false,
        },
      },
    }
  }

  const sport = sportRaw
  const incoming = input.settings ?? {}
  const teamCount = numberOr(input.teamCount ?? incoming.default_team_count ?? incoming.teams, 12)
  const draftType = normalizeRedraftDraftType(incoming.requested_draft_type ?? incoming.draft_type ?? 'snake')
  const defaults = buildRedraftSettingsSnapshot({
    sport,
    draftType,
    scoringPresetId: scoringInput(incoming),
    teamCount,
  }) ?? {}
  let nextSettings = deepMergeMissing(defaults, incoming)

  if (shouldRepairRosterDefaults(sport, incoming)) {
    const rosterTemplate = defaults.rosterTemplate
    nextSettings = {
      ...nextSettings,
      starter_slots: defaults.starter_slots,
      starter_slot_order: defaults.starter_slot_order,
      roster_slot_order: defaults.roster_slot_order,
      compact_roster_slot_order: defaults.compact_roster_slot_order,
      bench_slots: defaults.bench_slots,
      ir_slots: defaults.ir_slots,
      rosterTemplate,
      rosterSettings: defaults.rosterSettings,
      roster_size: defaults.roster_size,
      rosterSize: defaults.rosterSize,
    }
  } else if (isRecord(incoming.starter_slots)) {
    // A present, non-legacy slot map is a DELIBERATE commissioner customization
    // (e.g. NCAAF WR3 with no kicker). Contract repair must preserve it EXACTLY —
    // `deepMergeMissing` would otherwise back-fill default positions (a kicker,
    // an extra slot) the commissioner intentionally removed, silently overwriting
    // their roster shape. Keeping this atomic is what lets future league concepts
    // build off the same base without redraft's default lineup leaking back in.
    nextSettings = { ...nextSettings, starter_slots: incoming.starter_slots }
  }

  nextSettings = normalizeScoringIfKnown(sport, nextSettings)

  const rounds = numberOr(nextSettings.draft_rounds, numberOr(defaults.draft_rounds, 15))
  const timerSeconds = numberOr(nextSettings.draft_timer_seconds, 90)
  const engineDraftType = getRedraftEngineDraftType(draftType)
  const slotOrder = buildRedraftDraftSlotOrder({ teamCount, rosters: input.rosters, teams: input.teams })
  const status = String(input.draftSession?.status ?? '').toLowerCase()
  const activeOrComplete = status === 'in_progress' || status === 'paused' || status === 'completed'
  const sessionMissing = !input.draftSession
  const sessionIncomplete = !isCompleteSlotOrder(input.draftSession?.slotOrder, teamCount)

  return {
    eligible: true,
    nextSettings,
    settingsChanged: jsonStable(nextSettings) !== jsonStable(incoming),
    draftSession: {
      shouldCreate: sessionMissing,
      shouldUpdate: !sessionMissing && !activeOrComplete && sessionIncomplete,
      data: {
        status: 'pre_draft',
        draftType: engineDraftType,
        rounds,
        teamCount,
        timerSeconds,
        slotOrder,
        auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
        sportType: sport,
        sessionKind: 'live',
        cpuAutoPick: true,
        aiAutoPick: draftType === 'auto',
      },
    },
  }
}

export async function ensureRedraftLeagueContract(leagueId: string): Promise<{
  ok: boolean
  repaired: string[]
  skippedReason?: string
}> {
  if (!leagueId) return { ok: false, repaired: [], skippedReason: 'missing_league_id' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      leagueSettings: true,
      waiverSettings: true,
      redraftExtendedSettings: true,
      redraftDraftProfile: true,
      redraftHomepageState: true,
      draftSessions: true,
      rosters: { select: { id: true } },
      teams: { select: { ownerName: true, teamName: true } },
    },
  })
  if (!league) return { ok: false, repaired: [], skippedReason: 'league_not_found' }

  const plan = buildRedraftContractRepairPlan({
    sport: league.sport,
    leagueType: league.leagueType,
    isDynasty: league.isDynasty,
    teamCount: league.leagueSize,
    settings: isRecord(league.settings) ? league.settings : {},
    draftSession: league.draftSessions,
    rosters: league.rosters,
    teams: league.teams,
  })
  if (!plan.eligible) return { ok: true, repaired: [], skippedReason: plan.reason }

  const repaired: string[] = []
  const settings = plan.nextSettings
  const draftSettings = isRecord(settings.draftSettings) ? settings.draftSettings : {}
  const waiverSettings = isRecord(settings.waiverSettings) ? settings.waiverSettings : {}
  const tradeSettings = isRecord(settings.tradeSettings) ? settings.tradeSettings : {}
  const playoffSettings = isRecord(settings.playoffSettings) ? settings.playoffSettings : {}
  const timerSeconds = numberOr(draftSettings.timerSeconds, plan.draftSession.data.timerSeconds)
  const rounds = numberOr(draftSettings.rounds, plan.draftSession.data.rounds)
  const timezone = stringOr(league.timezone, 'America/New_York')
  const draftType = plan.draftSession.data.draftType

  await prisma.$transaction(async (tx) => {
    if (plan.settingsChanged) {
      await tx.league.update({
        where: { id: leagueId },
        data: {
          settings: settings as Prisma.InputJsonValue,
          rosterSize: league.rosterSize ?? numberOr(settings.rosterSize, numberOr(settings.roster_size, 0)),
          scoring: league.scoring ?? stringOr(settings.scoring_format, 'half_ppr'),
          scoringPresetId: league.scoringPresetId ?? stringOr(settings.scoring_preset_id, 'fb_half_ppr'),
          playoffTeams: league.playoffTeams ?? numberOr(playoffSettings.playoffTeams, 6),
          playoffStartWeek: league.playoffStartWeek ?? numberOr(playoffSettings.playoffStartWeek, 15),
          playoffWeeksPerRound: league.playoffWeeksPerRound ?? numberOr(playoffSettings.playoffWeeksPerRound, 1),
          playoffSeedingRule: league.playoffSeedingRule ?? stringOr(playoffSettings.seedingRule, 'record_then_points'),
          playoffLowerBracket: league.playoffLowerBracket ?? stringOr(playoffSettings.lowerBracket, 'consolation'),
        },
      })
      repaired.push('league.settings')
    }

    if (!league.leagueSettings) {
      await tx.leagueSettings.create({
        data: {
          leagueId,
          timezone,
          draftType,
          rounds,
          pickTimerPreset: timerSeconds === 90 ? '90s' : 'custom',
          pickTimerCustomValue: timerSeconds === 90 ? null : timerSeconds,
          cpuAutoPick: true,
          aiAutoPick: Boolean(plan.draftSession.data.aiAutoPick),
          draftOrderMethod: 'manual',
        },
      })
      repaired.push('leagueSettings')
    }

    if (!league.waiverSettings) {
      await tx.leagueWaiverSettings.create({
        data: {
          leagueId,
          waiverType: stringOr(waiverSettings.waiverType, 'faab'),
          processingDayOfWeek: numberOr(waiverSettings.processingDayOfWeek, 2),
          processingTimeUtc: stringOr(waiverSettings.processingTimeUtc, '10:00'),
          claimLimitPerPeriod: 10,
          faabBudget: numberOr(waiverSettings.faabBudget, 100),
          tiebreakRule: 'faab_highest',
          lockType: 'game_time',
          instantFaAfterClear: true,
          waiverEngineConfig: waiverSettings as Prisma.InputJsonValue,
        },
      })
      repaired.push('waiverSettings')
    }

    if (!league.redraftExtendedSettings) {
      await tx.redraftLeagueExtendedSettings.create({
        data: {
          leagueId,
          commissionerTradeReviewType: stringOr(tradeSettings.reviewMode, 'commissioner'),
          languageCode: stringOr(league.language, 'en'),
          scoringTypeDefault: stringOr(settings.scoring_template_id, 'default-NFL-HALF_PPR'),
          waiverTypeDefault: stringOr(waiverSettings.waiverType, 'faab'),
          rosterPresetKey: `default-${String(league.sport)}-redraft-v2`,
          playoffPresetKey: 'default-redraft-v2',
          draftTimerSecondsDefault: timerSeconds,
          isPublic: false,
          allowInviteLinks: true,
          settingsJson: {
            tradeSettings,
            playoffSettings,
            commissionerSettings: settings.commissionerSettings,
          } as Prisma.InputJsonValue,
        },
      })
      repaired.push('redraftExtendedSettings')
    }

    if (!league.redraftDraftProfile) {
      await tx.redraftLeagueDraftProfile.create({
        data: {
          leagueId,
          draftType: stringOr(settings.requested_draft_type, draftType),
          isOffline: settings.requested_draft_type === 'offline',
          isAuto: settings.requested_draft_type === 'auto',
          rounds,
          timerSeconds,
          orderMode: draftType,
          auctionBudget: draftType === 'auction' ? 200 : null,
          draftStatus: 'pre_draft',
          configJson: {
            coreDraftSessionType: draftType,
            redraftCoreContractVersion: 2,
            mockDraftEntryAvailable: true,
            liveDraftSetupAvailable: true,
          } as Prisma.InputJsonValue,
        },
      })
      repaired.push('redraftDraftProfile')
    }

    if (!league.redraftHomepageState) {
      await tx.redraftLeagueHomepageState.create({
        data: {
          leagueId,
          activeTab: 'overview',
          onboardingComplete: false,
          chatEnabled: true,
          draftRoomEnabled: settings.requested_draft_type !== 'offline',
          paymentEnabled: false,
          homepageConfigJson: settings.dashboardSettings as Prisma.InputJsonValue,
        },
      })
      repaired.push('redraftHomepageState')
    }

    if (plan.draftSession.shouldCreate) {
      await tx.draftSession.create({
        data: {
          leagueId,
          ...plan.draftSession.data,
          slotOrder: plan.draftSession.data.slotOrder as Prisma.InputJsonValue,
        },
      })
      repaired.push('draftSession')
    } else if (plan.draftSession.shouldUpdate && league.draftSessions) {
      await tx.draftSession.update({
        where: { id: league.draftSessions.id },
        data: {
          teamCount: plan.draftSession.data.teamCount,
          rounds: plan.draftSession.data.rounds,
          timerSeconds: plan.draftSession.data.timerSeconds,
          draftType: plan.draftSession.data.draftType,
          slotOrder: plan.draftSession.data.slotOrder as Prisma.InputJsonValue,
          sportType: plan.draftSession.data.sportType,
          version: { increment: 1 },
        },
      })
      repaired.push('draftSession.slotOrder')
    }
  })

  return { ok: true, repaired }
}
