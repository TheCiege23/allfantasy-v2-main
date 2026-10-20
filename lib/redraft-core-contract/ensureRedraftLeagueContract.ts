import { Prisma } from '@prisma/client'
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  buildRedraftSettingsSnapshot,
  getRedraftEngineDraftType,
  isFootballRedraftDefaultsSport,
  normalizeRedraftDraftType,
  resolveRedraftScoringPreset,
} from '@/lib/league-concepts/redraftDefaults'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { firstPositive, hasSavedRosterLayout, readSavedRosterLayout } from './savedRosterLayout'

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

/*
 * 🛑 A LEAGUE THAT HAS SAVED ANY ROSTER LAYOUT KEEPS EXACTLY THAT LAYOUT (owner, 2026-10-20).
 *
 * This repair runs on every load of the draft page. It used to `deepMergeMissing` the full default
 * snapshot into the saved settings, and that merge recurses into objects — so every default starter key
 * a saved `starter_slots` map lacked was ADDED: a league saved with QB, RB, WR, WR, TE, DEF silently
 * gained FLX and K, and a custom map spelled FLEX / DST gained a second flex (FLX) and a second defense
 * (DEF). `starter_slot_order` is an array, so the merge left it alone and the two then disagreed. It
 * also rewrote the known legacy map to the canonical one, which for NCAAF dropped a saved DEF.
 *
 * "Has a saved layout" is defined once, in ./savedRosterLayout, and shared with the read paths.
 */

/**
 * Default-snapshot keys that describe the roster layout, or are sized from it. None of them may be
 * merged into a league that has a saved layout: each would describe the DEFAULT roster beside the
 * league's own (a 15-player `roster_size`, `lineupValidationRules.requiredPositions` naming FLX and K,
 * a `rosterTemplate` / `rosterSettings` carrying the default starters, 15 draft rounds for a 12-player
 * roster).
 */
const ROSTER_LAYOUT_KEYS = [
  'starter_slots',
  'starter_slot_order',
  'roster_slot_order',
  'compact_roster_slot_order',
  'bench_slots',
  'ir_slots',
  'taxi_slots',
  'roster_size',
  'rosterSize',
  'rosterTemplate',
  'rosterSettings',
  'lineupValidationRules',
  'draft_rounds',
  'rounds',
] as const

function withoutRosterLayout(defaults: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...defaults }
  for (const key of ROSTER_LAYOUT_KEYS) delete out[key]
  if (isRecord(out.draftSettings)) {
    const { rounds: _rounds, fallbackRounds: _fallbackRounds, ...draftSettings } = out.draftSettings
    out.draftSettings = draftSettings
  }
  return out
}

/**
 * Draft rounds for a league WITH a saved layout but no saved round count: its own starters + bench,
 * the same rule the default contract uses (rounds = draftable roster). Null when that cannot be read,
 * and the caller then keeps the previous behaviour (the default round count).
 */
function savedLayoutDraftRounds(sport: 'NFL' | 'NCAAF', settings: JsonRecord): number | null {
  const layout = readSavedRosterLayout(sport, settings)
  if (!layout || layout.starterOrder.length === 0 || layout.benchSlots == null) return null
  return layout.starterOrder.length + layout.benchSlots
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
  // A saved layout is never merged into (see hasSavedRosterLayout); a league with none gets the full
  // default layout filled in, key by key, without overwriting anything it does have.
  const savedLayout = hasSavedRosterLayout(sport, incoming)
  let nextSettings = deepMergeMissing(savedLayout ? withoutRosterLayout(defaults) : defaults, incoming)

  nextSettings = normalizeScoringIfKnown(sport, nextSettings)

  const savedDraftSettings = isRecord(nextSettings.draftSettings) ? nextSettings.draftSettings : {}
  const fallbackRounds = numberOr(
    savedLayout ? savedLayoutDraftRounds(sport, incoming) : null,
    numberOr(defaults.draft_rounds, 15),
  )
  const rounds = numberOr(
    nextSettings.draft_rounds,
    numberOr(nextSettings.rounds, numberOr(savedDraftSettings.rounds, fallbackRounds)),
  )
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
      draftSessions: { orderBy: CURRENT_DRAFT_SESSION_ORDER, take: 1 },
      rosters: { select: { id: true } },
      teams: { select: { ownerName: true, teamName: true } },
    },
  })
  if (!league) return { ok: false, repaired: [], skippedReason: 'league_not_found' }

  // The league's current draft. A league with only a completed draft still HAS one here, so
  // the repair plan below never reads that as "no draft" and creates a second beside it.
  const currentDraftSession = league.draftSessions[0] ?? null

  const plan = buildRedraftContractRepairPlan({
    sport: league.sport,
    leagueType: league.leagueType,
    isDynasty: league.isDynasty,
    teamCount: league.leagueSize,
    settings: isRecord(league.settings) ? league.settings : {},
    draftSession: currentDraftSession,
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
          // A league with a saved layout no longer gets the default `rosterSize` merged into settings, so
          // leave the column alone rather than write 0 when neither it nor settings carry a size.
          rosterSize: league.rosterSize ?? firstPositive(settings.rosterSize, settings.roster_size) ?? undefined,
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
    } else if (plan.draftSession.shouldUpdate && currentDraftSession) {
      await tx.draftSession.update({
        where: { id: currentDraftSession.id },
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
