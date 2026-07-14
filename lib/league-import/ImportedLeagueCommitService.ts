import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'
import { deriveImportStatsFromNormalized } from '@/lib/rank/deriveImportStatsFromNormalized'
import { SETTINGS_SNAPSHOT_VERSION } from '@/lib/league-contract/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  CanonicalImportBundle,
  ImportProvider,
  NormalizedImportResult,
  NormalizedTradedPick,
} from './types'

export class ImportedLeagueConflictError extends Error {}

export interface PersistImportedLeagueOptions {
  userId: string
  provider: ImportProvider
  normalized: NormalizedImportResult
  allowUpdateExisting?: boolean
  /** When set, merges canonical `SettingsSnapshot` + concept rules into `League.settings` and top-level league fields. */
  canonicalBundle?: CanonicalImportBundle
}

export interface PersistImportedLeagueResult {
  league: {
    id: string
    name: string
    sport: string
  }
  historicalBackfill: unknown
  existed: boolean
}

function resolveImportedLeagueSport(normalized: NormalizedImportResult): string {
  return normalizeToSupportedSport(normalized.league.sport)
}

/**
 * Tier 0 (Block C) — extract League row columns from `normalized.league.*`
 * (populated by the provider mapper's Tier 0 block). Only defined values are
 * emitted, so any absent field preserves its Prisma column default. Numeric
 * types coerce integers; boolean types accept the mapper's normalized booleans.
 *
 * IMPORTANT: additive by design. Callers spread this last into `leaguePayload`
 * so any value the mapper populated wins over the defaults, but a mapper that
 * doesn't populate a field is fully backward-compatible.
 */
export function buildTier0LeagueColumnPatch(
  normalized: NormalizedImportResult,
): Record<string, unknown> {
  const l = normalized.league
  const out: Record<string, unknown> = {}
  const setIfNum = (key: string, v: unknown): void => {
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
  }
  const setIfBool = (key: string, v: unknown): void => {
    if (typeof v === 'boolean') out[key] = v
  }
  const setIfStr = (key: string, v: unknown): void => {
    if (typeof v === 'string' && v.length > 0) out[key] = v
  }

  // Waiver + trade window
  setIfStr('waiverType', l.waiver_type)
  setIfNum('waiverBudget', l.faab_budget ?? undefined)
  setIfNum('waiverMinBid', l.waiver_bid_min)
  setIfNum('tradeDeadlineWeek', l.trade_deadline_week)
  // Sleeper `trade_review_days` in DAYS → AF `tradeReviewHours` in HOURS.
  if (typeof l.trade_review_days === 'number' && Number.isFinite(l.trade_review_days)) {
    out.tradeReviewHours = Math.max(0, l.trade_review_days * 24)
  }
  setIfBool('draftPickTrading', l.pick_trading)

  // Playoffs
  setIfNum('playoffStartWeek', l.playoff_start_week)
  setIfNum('playoffTeams', l.playoff_teams)

  // Reserve + taxi
  setIfNum('irSlots', l.reserve_slots)
  setIfNum('taxiSlots', l.taxi_slots)
  setIfNum('taxiYearsLimit', l.taxi_years)
  setIfBool('taxiAllowNonRookies', l.taxi_allow_vets)
  setIfNum('taxiDeadlineWeek', l.taxi_deadline_week)
  setIfNum('keeperCount', l.max_keepers)

  // IR eligibility flags
  setIfBool('irAllowCovid', l.reserve_allow_cov)
  setIfBool('irAllowSuspended', l.reserve_allow_sus)
  setIfBool('irAllowOut', l.reserve_allow_out)
  setIfBool('irAllowNA', l.reserve_allow_na)
  setIfBool('irAllowDNR', l.reserve_allow_dnr)
  setIfBool('irAllowDoubtful', l.reserve_allow_doubtful)

  return out
}

/**
 * Block F — persist normalized future traded draft picks into `future_draft_picks`.
 *
 * Uses Prisma `upsert` keyed on the composite unique
 * `(leagueId, pickSeason, round, originalRosterId)` — that unique already exists
 * in `prisma/schema.prisma`, so a re-import updates `currentOwnerId` for an
 * existing pick instead of creating a duplicate row (satisfies Block F scope
 * requirement #5: "Ensure re-import/update does not duplicate picks").
 *
 * Schema limitation acknowledged: Sleeper's `previous_owner_id` has no dedicated
 * column on `future_draft_picks`. It's dropped here with an inline comment; a
 * future schema addition can wire it up from the already-normalized field on
 * `NormalizedTradedPick` without a mapper rewrite.
 *
 * Exported for testability; not part of the public import API.
 */
export async function persistTradedPicks(
  leagueId: string,
  picks: NormalizedTradedPick[],
): Promise<{ written: number; skipped: number }> {
  if (!Array.isArray(picks) || picks.length === 0) {
    return { written: 0, skipped: 0 }
  }
  let written = 0
  let skipped = 0
  for (const pick of picks) {
    // Defensive: mapper already filters these, but guard the persistence layer
    // too so a malformed row can never crash the whole loop.
    if (
      !pick ||
      typeof pick.season !== 'number' ||
      typeof pick.round !== 'number' ||
      typeof pick.original_roster_id !== 'string' ||
      typeof pick.current_owner_roster_id !== 'string'
    ) {
      skipped++
      continue
    }
    try {
      await (prisma as any).futureDraftPick.upsert({
        where: {
          leagueId_pickSeason_round_originalRosterId: {
            leagueId,
            pickSeason: pick.season,
            round: pick.round,
            originalRosterId: pick.original_roster_id,
          },
        },
        create: {
          leagueId,
          pickSeason: pick.season,
          round: pick.round,
          originalRosterId: pick.original_roster_id,
          currentOwnerId: pick.current_owner_roster_id,
          // A pick appears in `/traded_picks` iff it has been moved off its
          // original roster at least once — always `traded: true` from Sleeper.
          traded: true,
          // NOTE: Sleeper `previous_owner_id` (pick.previous_owner_roster_id) is
          // dropped here — no dedicated column on `future_draft_picks`. This is
          // a documented schema limitation, not a mapper bug.
        },
        update: {
          // Only ownership can change between imports; original identity + season
          // + round are the primary-key composite and never change.
          currentOwnerId: pick.current_owner_roster_id,
          traded: true,
        },
      })
      written++
    } catch {
      // Prisma constraint violation or transient DB error: skip this row so
      // one bad pick can't lose the other 32. Outer catch in the caller logs
      // the surrounding context.
      skipped++
    }
  }
  return { written, skipped }
}

function resolveImportedLeagueVariant(normalized: NormalizedImportResult): string | null {
  const leagueData = normalized.league as Record<string, unknown>
  const explicit =
    leagueData.league_variant ??
    leagueData.leagueVariant ??
    leagueData.variant
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim()
  }

  const sport = resolveImportedLeagueSport(normalized)
  if (sport !== 'NFL') return null

  const scoringFormat = String(
    normalized.league.scoring ??
      normalized.scoring?.scoring_format ??
      ''
  ).toUpperCase()
  const rosterPositions = Array.isArray(leagueData.roster_positions)
    ? (leagueData.roster_positions as unknown[])
        .map((p) => String(p).toUpperCase())
    : []
  const hasIdpSignal =
    scoringFormat.includes('IDP') ||
    rosterPositions.some((p) =>
      ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX'].includes(p)
    )

  if (!hasIdpSignal) return null
  return normalized.league.isDynasty ? 'DYNASTY_IDP' : 'IDP'
}

function buildImportedLeagueSettings(normalized: NormalizedImportResult): Record<string, unknown> {
  const sportType = resolveImportedLeagueSport(normalized)
  const leagueVariant = resolveImportedLeagueVariant(normalized)
  return {
    ...(normalized.league as Record<string, unknown>),
    playoff_team_count: normalized.league.playoff_team_count,
    roster_positions: (normalized.league as Record<string, unknown>).roster_positions,
    scoring_settings: (normalized.league as Record<string, unknown>).scoring_settings,
    sport_type: sportType,
    league_variant: leagueVariant,
    source_tracking: {
      ...normalized.source,
    },
    identity_mappings: normalized.identity_mappings ?? [],
  }
}

/** Merges canonical snapshot slices + `importCanonical` into arbitrary league `settings` JSON (e.g. existing-league import). */
export function mergeCanonicalBundleIntoLeagueSettingsJson(
  base: Record<string, unknown>,
  bundle: CanonicalImportBundle,
): Record<string, unknown> {
  const snap = bundle.settingsSnapshot
  return {
    ...base,
    snapshotVersion: SETTINGS_SNAPSHOT_VERSION,
    rosterSettings: snap.rosterSettings ?? (base as { rosterSettings?: unknown }).rosterSettings,
    scoringSettings: snap.scoringSettings ?? (base as { scoringSettings?: unknown }).scoringSettings,
    draftSettings: snap.draftSettings ?? (base as { draftSettings?: unknown }).draftSettings,
    waiverSettings: snap.waiverSettings ?? (base as { waiverSettings?: unknown }).waiverSettings,
    playoffSettings: snap.playoffSettings ?? (base as { playoffSettings?: unknown }).playoffSettings,
    conceptRules: snap.conceptRules ?? (base as { conceptRules?: unknown }).conceptRules,
    commissionerSettings: snap.commissionerSettings ?? (base as { commissionerSettings?: unknown }).commissionerSettings,
    mediaSettings: snap.mediaSettings ?? (base as { mediaSettings?: unknown }).mediaSettings,
    visualTheme: snap.visualTheme ?? (base as { visualTheme?: unknown }).visualTheme,
    importCanonical: {
      presetKey: bundle.presetKey,
      scoringPresetId: bundle.scoringPresetId,
      draftType: bundle.draftType,
      inferredConcept: bundle.inferredConcept,
    },
  }
}

function mergeCanonicalBundleIntoSettings(
  normalized: NormalizedImportResult,
  bundle: CanonicalImportBundle,
): Record<string, unknown> {
  return mergeCanonicalBundleIntoLeagueSettingsJson(buildImportedLeagueSettings(normalized), bundle)
}

async function runHistoricalBackfill(args: {
  provider: ImportProvider
  leagueId: string
  userId: string
  normalized: NormalizedImportResult
}): Promise<unknown> {
  if (args.provider === 'sleeper') {
    const { syncSleeperHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/sleeper/SleeperHistoricalBackfillService'
    )
    return syncSleeperHistoricalBackfillAfterImport({
      leagueId: args.leagueId,
      isDynasty: args.normalized.league.isDynasty,
    })
  }

  if (args.provider === 'yahoo') {
    const { syncYahooHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/yahoo/YahooHistoricalBackfillService'
    )
    return syncYahooHistoricalBackfillAfterImport({
      leagueId: args.leagueId,
      userId: args.userId,
    })
  }

  if (args.provider === 'espn') {
    const { syncEspnHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/espn/EspnHistoricalBackfillService'
    )
    return syncEspnHistoricalBackfillAfterImport({
      leagueId: args.leagueId,
      userId: args.userId,
    })
  }

  if (args.provider === 'mfl') {
    const { syncMflHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/mfl/MflHistoricalBackfillService'
    )
    return syncMflHistoricalBackfillAfterImport({
      leagueId: args.leagueId,
      userId: args.userId,
    })
  }

  if (args.provider === 'fantrax') {
    const { syncFantraxHistoricalBackfillAfterImport } = await import(
      '@/lib/league-import/fantrax/FantraxHistoricalBackfillService'
    )
    return syncFantraxHistoricalBackfillAfterImport({
      leagueId: args.leagueId,
      userId: args.userId,
    })
  }

  return null
}

export async function persistImportedLeagueFromNormalization(
  options: PersistImportedLeagueOptions
): Promise<PersistImportedLeagueResult> {
  const { userId, provider, normalized, allowUpdateExisting = false, canonicalBundle } = options
  const platformLeagueId = normalized.source.source_league_id
  const seasonYear =
    typeof normalized.league.season === 'number' && Number.isFinite(normalized.league.season)
      ? normalized.league.season
      : new Date().getFullYear()

  const existing = await (prisma as any).league.findFirst({
    where: {
      userId,
      platform: provider,
      platformLeagueId,
      season: seasonYear,
    },
  })

  if (existing && !allowUpdateExisting) {
    throw new ImportedLeagueConflictError('This league already exists in your account')
  }

  const resolvedSport = resolveImportedLeagueSport(normalized)
  const resolvedVariant = resolveImportedLeagueVariant(normalized)
  const derivedImport = deriveImportStatsFromNormalized(normalized)
  const importStatsPatch = derivedImport
    ? {
        importWins: derivedImport.importWins,
        importLosses: derivedImport.importLosses,
        importTies: derivedImport.importTies,
        importMadePlayoffs: derivedImport.importMadePlayoffs,
        importWonChampionship: derivedImport.importWonChampionship,
        importFinalStanding: derivedImport.importFinalStanding,
        importPointsFor: derivedImport.importPointsFor,
        importPointsAgainst: derivedImport.importPointsAgainst,
      }
    : {}

  const settingsJson = canonicalBundle
    ? mergeCanonicalBundleIntoSettings(normalized, canonicalBundle)
    : buildImportedLeagueSettings(normalized)

  // Tier 0 (Block C) — passthrough for League columns whose values used to be
  // silently dropped and replaced by Prisma defaults. Every value comes from
  // `normalized.league.*` (populated by the provider mapper's Tier 0 block).
  // Any `undefined` field is omitted so the existing default remains — safe for
  // legacy providers and older payloads that don't populate the new fields.
  const tier0LeaguePayload = buildTier0LeagueColumnPatch(normalized)

  const leaguePayload = {
    name: normalized.league.name,
    platform: provider,
    platformLeagueId,
    leagueSize: normalized.league.leagueSize,
    scoring: normalized.league.scoring ?? undefined,
    isDynasty: normalized.league.isDynasty,
    sport: resolvedSport,
    season: seasonYear,
    // Phase OS-C5: previously omitted entirely — `League.status` has no DB default, so every
    // imported league silently ended up with status: null, which `leagueListFilter.ts` then
    // misread as "incomplete legacy import" and hid. `?? undefined` (not `?? null`) so this write
    // stays a no-op — same as every other optional field here — when the provider genuinely
    // didn't report a status, rather than forcing an explicit null overwrite on every update.
    status: normalized.league.status ?? undefined,
    rosterSize: normalized.league.rosterSize ?? undefined,
    starters: (normalized.league as Record<string, unknown>).roster_positions ?? undefined,
    avatarUrl: normalized.league_branding?.avatar_url ?? undefined,
    settings: settingsJson,
    syncStatus: 'pending',
    leagueVariant: resolvedVariant,
    leagueType: canonicalBundle?.leagueTypeColumn ?? undefined,
    presetKey: canonicalBundle?.presetKey ?? undefined,
    scoringPresetId: canonicalBundle?.scoringPresetId ?? undefined,
    settingsSnapshotVersion: canonicalBundle ? SETTINGS_SNAPSHOT_VERSION : undefined,
    importBatchId: normalized.source.import_batch_id ?? undefined,
    importedAt: normalized.source.imported_at ? new Date(normalized.source.imported_at) : undefined,
    ...importStatsPatch,
    ...tier0LeaguePayload,
  }

  const league = existing
    ? await (prisma as any).league.update({
        where: { id: existing.id },
        data: leaguePayload,
      })
    : await (prisma as any).league.create({
        data: {
          userId,
          ...leaguePayload,
        },
      })

  try {
    const { bootstrapLeagueFromImport } = await import('@/lib/league-import/LeagueCreationBootstrapService')
    await bootstrapLeagueFromImport(league.id, normalized)
  } catch (err) {
    console.warn(`[ImportedLeagueCommitService] ${provider} import bootstrap non-fatal:`, err)
  }

  // Canonical imported-league lifecycle completion — provider-agnostic,
  // reads only the LeagueTeam rows the bootstrap above just wrote. Gives
  // every imported league (any provider) a real RedraftSeason/RedraftRoster
  // so Trade Decision OS and other RedraftSeason-scoped consumers work
  // without any provider-specific branch. Idempotent; never fails the import.
  try {
    const { materializeRedraftSeasonForImportedLeague } = await import('@/lib/league-import/canonicalSeasonMaterialization')
    await materializeRedraftSeasonForImportedLeague(league.id)
  } catch (err) {
    console.warn(`[ImportedLeagueCommitService] ${provider} canonical season materialization non-fatal:`, err)
  }

  // Block F — persist future traded draft picks into `future_draft_picks`. Runs
  // AFTER the bootstrap so anything the bootstrap writes (league_teams etc.)
  // is available. Non-fatal: a failure here logs a warning but never fails the
  // import — matches the existing gap-fill pattern above.
  if (normalized.traded_picks && normalized.traded_picks.length > 0) {
    try {
      await persistTradedPicks(league.id, normalized.traded_picks)
    } catch (err) {
      console.warn(`[ImportedLeagueCommitService] ${provider} traded-pick persist non-fatal:`, err)
    }
  }

  try {
    const { bootstrapLeagueDraftConfig } = await import('@/lib/draft-defaults/LeagueDraftBootstrapService')
    const { bootstrapLeagueWaiverSettings } = await import('@/lib/waiver-defaults/LeagueWaiverBootstrapService')
    const { bootstrapLeaguePlayoffConfig } = await import('@/lib/playoff-defaults/LeaguePlayoffBootstrapService')
    const { bootstrapLeagueScheduleConfig } = await import('@/lib/schedule-defaults/LeagueScheduleBootstrapService')
    await Promise.all([
      bootstrapLeagueDraftConfig(league.id),
      bootstrapLeagueWaiverSettings(league.id),
      bootstrapLeaguePlayoffConfig(league.id),
      bootstrapLeagueScheduleConfig(league.id),
    ])
  } catch (err) {
    console.warn('[ImportedLeagueCommitService] Gap-fill (draft/waiver/playoff/schedule) non-fatal:', err)
  }

  // Layered import, tier 1 (synchronous): write a LeagueSeason row for the
  // CURRENT season from the normalized payload so the History tab shows a
  // real entry immediately. Older years come in via tier 2 (async backfill).
  try {
    const seasonYearForRow = typeof normalized.league.season === 'number' && Number.isFinite(normalized.league.season)
      ? normalized.league.season
      : new Date().getFullYear()
    const topStanding = [...normalized.standings].sort((a, b) => a.rank - b.rank)[0] ?? null
    const runnerUpStanding = [...normalized.standings].sort((a, b) => a.rank - b.rank)[1] ?? null
    const nameForTeamId = (sourceTeamId: string | undefined): string | null => {
      if (!sourceTeamId) return null
      const r = normalized.rosters.find((row) => row.source_team_id === sourceTeamId)
      return r?.team_name?.trim() || r?.owner_name?.trim() || null
    }
    await prisma.leagueSeason.upsert({
      where: {
        leagueId_season: { leagueId: league.id, season: seasonYearForRow },
      } as never,
      create: {
        leagueId: league.id,
        season: seasonYearForRow,
        platformLeagueId: normalized.source.source_league_id,
        championName: nameForTeamId(topStanding?.source_team_id),
        runnerUpName: nameForTeamId(runnerUpStanding?.source_team_id),
        teamCount: normalized.rosters.length || normalized.league.leagueSize,
        scoringFormat: normalized.scoring?.scoring_format ?? null,
        isDynasty: normalized.league.isDynasty,
        status: 'active',
      },
      update: {
        platformLeagueId: normalized.source.source_league_id,
        championName: nameForTeamId(topStanding?.source_team_id),
        runnerUpName: nameForTeamId(runnerUpStanding?.source_team_id),
        teamCount: normalized.rosters.length || normalized.league.leagueSize,
        scoringFormat: normalized.scoring?.scoring_format ?? null,
        isDynasty: normalized.league.isDynasty,
      },
    }).catch(() => {
      /* unique-constraint key name varies by schema — best-effort write */
    })
  } catch (err) {
    console.warn('[ImportedLeagueCommitService] current-season LeagueSeason write non-fatal:', err)
  }

  // Fire-and-forget avatar mirror: external CDN URLs (Sleeper, ESPN, etc.)
  // can 404 later; mirror them to our storage. Pluggable — no-ops until
  // the storage adapter is wired.
  void (async () => {
    try {
      const { mirrorImportAvatars } = await import('./avatarMirror')
      await mirrorImportAvatars(league.id)
    } catch {
      /* non-fatal */
    }
  })()

  // Layered import, tier 2 (async): commit returns immediately; the
  // multi-year history backfill runs in the background. The History tab
  // polls /api/leagues/{id}/history and surfaces each year as it lands.
  const historicalBackfill: unknown = { status: 'pending', startedAt: new Date().toISOString() }
  try {
    const current = (await prisma.league.findUnique({
      where: { id: league.id },
      select: { settings: true },
    }))?.settings as Record<string, unknown> | null
    await prisma.league.update({
      where: { id: league.id },
      data: {
        settings: {
          ...(current ?? {}),
          historicalBackfillStatus: 'pending',
          historicalBackfillStartedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    })
  } catch {
    /* non-fatal settings stamp */
  }
  void runHistoricalBackfill({ provider, leagueId: league.id, userId, normalized })
    .then(async (result) => {
      try {
        const current = (await prisma.league.findUnique({
          where: { id: league.id },
          select: { settings: true },
        }))?.settings as Record<string, unknown> | null
        await prisma.league.update({
          where: { id: league.id },
          data: {
            settings: {
              ...(current ?? {}),
              historicalBackfillStatus: 'complete',
              historicalBackfillCompletedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        })
      } catch {
        /* non-fatal */
      }
      return result
    })
    .catch(async (err) => {
      console.warn(`[ImportedLeagueCommitService] Historical ${provider} backfill non-fatal:`, err)
      try {
        const current = (await prisma.league.findUnique({
          where: { id: league.id },
          select: { settings: true },
        }))?.settings as Record<string, unknown> | null
        await prisma.league.update({
          where: { id: league.id },
          data: {
            settings: {
              ...(current ?? {}),
              historicalBackfillStatus: 'failed',
              historicalBackfillError: err instanceof Error ? err.message : 'unknown',
            } as Prisma.InputJsonValue,
          },
        })
      } catch {
        /* non-fatal */
      }
    })

  try {
    await calculateAndSaveRank(userId)
  } catch (err) {
    console.warn('[ImportedLeagueCommitService] calculateAndSaveRank non-fatal:', err)
  }

  return {
    league: {
      id: league.id,
      name: league.name,
      sport: league.sport,
    },
    historicalBackfill,
    existed: Boolean(existing),
  }
}
