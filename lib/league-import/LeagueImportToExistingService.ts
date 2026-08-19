/**
 * Apply normalized external league import data to an existing league.
 * Deterministic only: no AI usage.
 */

import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getOrCreateDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import type { CanonicalImportBundle, ImportProvider, NormalizedImportResult } from './types'
import { bootstrapLeagueFromImport } from './LeagueCreationBootstrapService'
import { mergeCanonicalBundleIntoLeagueSettingsJson } from '@/lib/league-import/ImportedLeagueCommitService'
import { SETTINGS_SNAPSHOT_VERSION } from '@/lib/league-contract/types'

export interface ExistingLeagueImportApplyOptions {
  leagueStructure: boolean
  rosters: boolean
  draftPicks: boolean
  scoringRules: boolean
  leagueName: boolean
}

export const DEFAULT_EXISTING_LEAGUE_IMPORT_OPTIONS: ExistingLeagueImportApplyOptions = {
  leagueStructure: true,
  rosters: true,
  draftPicks: true,
  scoringRules: true,
  leagueName: true,
}

export interface ApplyImportedLeagueToExistingResult {
  leagueId: string
  leagueName: string | null
  applied: ExistingLeagueImportApplyOptions
  summary: {
    rostersUpserted: number
    draftPicksImported: number
    draftPicksSkipped: number
  }
}

function toLeagueSport(sport: string): LeagueSport {
  const normalized = normalizeToSupportedSport(sport)
  switch (normalized) {
    case 'NFL':
    case 'NHL':
    case 'NBA':
    case 'MLB':
    case 'NCAAB':
    case 'NCAAF':
    case 'SOCCER':
      return normalized
    default:
      return 'NFL'
  }
}

function resolveImportedLeagueVariant(normalized: NormalizedImportResult): string | null {
  const leagueData = normalized.league as Record<string, unknown>
  const explicit = leagueData.league_variant ?? leagueData.leagueVariant ?? leagueData.variant
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()

  const sport = normalizeToSupportedSport(normalized.league.sport)
  if (sport !== 'NFL') return null

  const scoringFormat = String(
    normalized.league.scoring ?? normalized.scoring?.scoring_format ?? ''
  ).toUpperCase()
  const rosterPositions = Array.isArray(leagueData.roster_positions)
    ? (leagueData.roster_positions as unknown[]).map((p) => String(p).toUpperCase())
    : []
  const hasIdpSignal =
    scoringFormat.includes('IDP') ||
    rosterPositions.some((p) => ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX'].includes(p))
  if (!hasIdpSignal) return null
  return normalized.league.isDynasty ? 'DYNASTY_IDP' : 'IDP'
}

function buildNextLeagueSettings(
  current: Record<string, unknown>,
  normalized: NormalizedImportResult,
  provider: ImportProvider,
  apply: ExistingLeagueImportApplyOptions
): Record<string, unknown> {
  const next = { ...current }
  const leagueData = normalized.league as Record<string, unknown>

  next.source_tracking = {
    ...(typeof next.source_tracking === 'object' && next.source_tracking ? (next.source_tracking as Record<string, unknown>) : {}),
    source_provider: provider,
    source_league_id: normalized.source.source_league_id,
    source_season_id: normalized.source.source_season_id ?? null,
    import_batch_id: normalized.source.import_batch_id ?? null,
    imported_at: normalized.source.imported_at,
  }
  next.identity_mappings = normalized.identity_mappings ?? []
  next.league_import_last_summary = {
    importedAt: normalized.source.imported_at,
    provider,
    sourceLeagueId: normalized.source.source_league_id,
    rosterCount: normalized.rosters.length,
    draftPickCount: normalized.draft_picks.length,
    scoringRuleCount: normalized.scoring?.rules?.length ?? 0,
  }

  if (apply.leagueStructure) {
    next.playoff_team_count = normalized.league.playoff_team_count ?? null
    next.roster_positions = leagueData.roster_positions ?? null
    next.regular_season_length = normalized.league.regular_season_length ?? null
  }
  if (apply.scoringRules) {
    next.scoring_settings = leagueData.scoring_settings ?? normalized.scoring?.raw ?? null
    next.imported_scoring_rules = normalized.scoring?.rules ?? []
  }

  return next
}

function resolveApplyOptions(input: Partial<ExistingLeagueImportApplyOptions> | undefined): ExistingLeagueImportApplyOptions {
  return {
    leagueStructure: input?.leagueStructure !== false,
    rosters: input?.rosters !== false,
    draftPicks: input?.draftPicks !== false,
    scoringRules: input?.scoringRules !== false,
    leagueName: input?.leagueName !== false,
  }
}

async function syncDraftPicksFromNormalized(
  leagueId: string,
  normalized: NormalizedImportResult
): Promise<{ imported: number; skipped: number }> {
  if (!normalized.draft_picks.length) return { imported: 0, skipped: 0 }

  const { session } = await getOrCreateDraftSession(leagueId)
  const [rosters, sessionRecord] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.draftSession.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        sportType: true,
        rounds: true,
        teamCount: true,
        slotOrder: true,
      },
    }),
  ])
  if (!sessionRecord) return { imported: 0, skipped: normalized.draft_picks.length }

  const managerToRosterId = new Map(rosters.map((r) => [r.platformUserId, r.id]))
  const teamToRosterId = new Map<string, string>()
  for (const r of normalized.rosters) {
    const rosterId = managerToRosterId.get(r.source_manager_id)
    if (rosterId) teamToRosterId.set(r.source_team_id, rosterId)
  }

  const slotOrderEntries = Array.isArray(sessionRecord.slotOrder)
    ? (sessionRecord.slotOrder as Array<{ slot?: number; rosterId?: string; displayName?: string }>)
    : []
  const importedSlotOrder = normalized.rosters
    .map((r, idx) => {
      const rosterId = teamToRosterId.get(r.source_team_id)
      if (!rosterId) return null
      return {
        slot: idx + 1,
        rosterId,
        displayName: r.team_name || r.owner_name || `Team ${idx + 1}`,
      }
    })
    .filter((entry): entry is { slot: number; rosterId: string; displayName: string } => Boolean(entry))

  const slotOrder =
    importedSlotOrder.length > 0
      ? importedSlotOrder
      : slotOrderEntries
          .map((entry, idx) => ({
            slot: typeof entry.slot === 'number' ? entry.slot : idx + 1,
            rosterId: typeof entry.rosterId === 'string' ? entry.rosterId : `placeholder-${idx + 1}`,
            displayName: entry.displayName ?? `Team ${idx + 1}`,
          }))
          .filter((entry) => Boolean(entry.rosterId))

  const effectiveTeamCount = Math.max(1, slotOrder.length || sessionRecord.teamCount || 1)
  const validPicks = new Map<number, {
    overall: number
    round: number
    slot: number
    rosterId: string
    displayName: string | null
    playerName: string
    position: string
    team: string | null
    playerId: string | null
  }>()
  let skipped = 0

  const sourceRosterName = new Map(
    normalized.rosters.map((r) => [r.source_team_id, r.team_name || r.owner_name] as const)
  )
  const sortedInput = [...normalized.draft_picks].sort((a, b) => a.pick_no - b.pick_no)
  for (let i = 0; i < sortedInput.length; i += 1) {
    const pick = sortedInput[i]
    const overall = Number.isFinite(pick.pick_no) && pick.pick_no > 0 ? Math.trunc(pick.pick_no) : i + 1
    if (overall <= 0 || validPicks.has(overall)) {
      skipped += 1
      continue
    }
    const round = Number.isFinite(pick.round) && pick.round > 0 ? Math.trunc(pick.round) : Math.ceil(overall / effectiveTeamCount)
    const slot = ((overall - 1) % effectiveTeamCount) + 1
    const resolvedRosterId =
      teamToRosterId.get(pick.source_roster_id) ??
      slotOrder.find((entry) => entry.slot === slot)?.rosterId ??
      `import-slot-${slot}`
    const resolvedDisplayName =
      sourceRosterName.get(pick.source_roster_id) ??
      slotOrder.find((entry) => entry.slot === slot)?.displayName ??
      null
    validPicks.set(overall, {
      overall,
      round,
      slot,
      rosterId: resolvedRosterId,
      displayName: resolvedDisplayName,
      playerName: pick.player_name?.trim() || `Imported Player ${overall}`,
      position: pick.position?.trim() || 'UNK',
      team: pick.team?.trim() || null,
      playerId: pick.source_player_id?.trim() || null,
    })
  }

  const importedPicks = [...validPicks.values()].sort((a, b) => a.overall - b.overall)
  const maxRound = importedPicks.length > 0 ? Math.max(...importedPicks.map((p) => p.round)) : sessionRecord.rounds
  const nextRounds = Math.max(1, maxRound || sessionRecord.rounds || 1)
  const totalPossible = nextRounds * effectiveTeamCount
  const nextStatus =
    importedPicks.length < 1
      ? 'pre_draft'
      : importedPicks.length >= totalPossible
        ? 'completed'
        : 'in_progress'

  await prisma.$transaction(async (tx) => {
    await (tx as any).draftPick.deleteMany({ where: { sessionId: sessionRecord.id } })
    for (const p of importedPicks) {
      await (tx as any).draftPick.create({
        data: {
          sessionId: sessionRecord.id,
          sportType: sessionRecord.sportType ?? null,
          overall: p.overall,
          round: p.round,
          slot: p.slot,
          rosterId: p.rosterId,
          displayName: p.displayName,
          playerName: p.playerName,
          position: p.position,
          team: p.team,
          playerId: p.playerId,
          source: 'import',
        },
      })
    }
    await (tx as any).draftSession.update({
      where: { id: sessionRecord.id },
      data: {
        slotOrder: slotOrder as any,
        teamCount: effectiveTeamCount,
        rounds: nextRounds,
        status: nextStatus,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    })
  })

  return { imported: importedPicks.length, skipped }
}

export async function applyImportedLeagueToExistingLeague(args: {
  leagueId: string
  provider: ImportProvider
  normalized: NormalizedImportResult
  apply?: Partial<ExistingLeagueImportApplyOptions>
  /** When set, merges the same canonical `SettingsSnapshot` layers as native import commit. */
  canonicalBundle?: CanonicalImportBundle
}): Promise<ApplyImportedLeagueToExistingResult> {
  const apply = resolveApplyOptions(args.apply)
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, name: true, settings: true },
  })
  if (!league) throw new Error('League not found')

  const currentSettings = (league.settings as Record<string, unknown>) ?? {}
  let nextSettings = buildNextLeagueSettings(currentSettings, args.normalized, args.provider, apply)
  if (args.canonicalBundle) {
    nextSettings = mergeCanonicalBundleIntoLeagueSettingsJson(nextSettings, args.canonicalBundle)
  }
  const updateData: Record<string, unknown> = {
    settings: nextSettings,
    updatedAt: new Date(),
  }
  if (apply.leagueName) {
    updateData.name = args.normalized.league.name
  }
  if (apply.leagueStructure) {
    const leagueData = args.normalized.league as Record<string, unknown>
    updateData.sport = toLeagueSport(args.normalized.league.sport)
    updateData.season = args.normalized.league.season ?? null
    updateData.leagueSize = args.normalized.league.leagueSize
    updateData.rosterSize = args.normalized.league.rosterSize ?? null
    updateData.isDynasty = args.normalized.league.isDynasty
    updateData.starters = leagueData.roster_positions ?? null
    updateData.leagueVariant = resolveImportedLeagueVariant(args.normalized)
    // Phase OS-C5: same omission as the initial-import path (ImportedLeagueCommitService.ts) —
    // `?? undefined` means Prisma skips this key entirely (leaves the existing value alone) when
    // the provider genuinely has no status for this sync, rather than overwriting it with null.
    updateData.status = args.normalized.league.status ?? undefined
  }
  if (apply.scoringRules) {
    updateData.scoring = args.normalized.league.scoring ?? args.normalized.scoring?.scoring_format ?? null
  }
  if (args.canonicalBundle) {
    const c = args.canonicalBundle
    updateData.presetKey = c.presetKey ?? undefined
    updateData.scoringPresetId = c.scoringPresetId ?? undefined
    updateData.settingsSnapshotVersion = SETTINGS_SNAPSHOT_VERSION
    if (c.leagueTypeColumn) {
      updateData.leagueType = c.leagueTypeColumn
    }
  }
  await (prisma as any).league.update({
    where: { id: league.id },
    data: updateData,
  })

  let rosterSyncCount = 0
  if (apply.rosters) {
    const sync = await bootstrapLeagueFromImport(league.id, args.normalized)
    rosterSyncCount = sync.rostersCreated
  }

  let draftPicksImported = 0
  let draftPicksSkipped = 0
  if (apply.draftPicks) {
    const picksSync = await syncDraftPicksFromNormalized(league.id, args.normalized)
    draftPicksImported = picksSync.imported
    draftPicksSkipped = picksSync.skipped
  }

  const refreshedLeague = await prisma.league.findUnique({
    where: { id: league.id },
    select: { id: true, name: true },
  })
  return {
    leagueId: refreshedLeague?.id ?? league.id,
    leagueName: refreshedLeague?.name ?? null,
    applied: apply,
    summary: {
      rostersUpserted: rosterSyncCount,
      draftPicksImported,
      draftPicksSkipped,
    },
  }
}
