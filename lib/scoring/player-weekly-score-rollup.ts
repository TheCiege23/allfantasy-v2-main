/**
 * Phase 7E / 7F — Derived rollup: compute `PlayerWeeklyScore` rows from `PlayerGameStat`
 * using a **single league's** scoring rules. Read-heavy; writes only when explicitly allowed.
 *
 * **Global row caveat:** `PlayerWeeklyScore` is unique on `(playerId, week, season, sport)` —
 * not per league. `computePlayerFantasyPoints` uses **that league's** template + overrides
 * (`getLeagueScoringRules`), so League A and League B can legitimately disagree on the same
 * player-week. A write from A can overwrite B's semantically correct row — see Phase 7F in
 * `docs/stat-substrate-ownership.md`. **Writes require `allowGlobalOverwrite`**; leagues with
 * per-league scoring deviation (overrides or non-default format) also require
 * `allowCustomScoringWrite`. **Do not schedule** writes from cron until schema/policy resolves
 * cross-league truth.
 */
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computePlayerFantasyPoints } from '@/lib/multi-sport/MultiSportMatchupScoringService'
import {
  getLeagueSettingsForScoring,
  resolveFormatTypeFromLeagueSettings,
} from '@/lib/multi-sport/MultiSportScoringResolver'
import { resolveSportConfigForLeague } from '@/lib/multi-sport/SportConfigResolver'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { PlayerStatsRecord } from '@/lib/scoring-defaults/types'

const ROLLUP_VERSION = 1 as const
const EPS_SKIP = 0.01

export function mergeNormalizedStatMaps(
  maps: Array<Record<string, unknown> | null | undefined>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of maps) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      out[k] = (out[k] ?? 0) + n
    }
  }
  return out
}

export type RollupCandidateRow = {
  playerId: string
  sport: string
  computedFantasyPts: number
  existingFantasyPts: number | null
  existingId: string | null
  existingIsFinalized: boolean
  gamesMerged: number
  action: 'create' | 'update' | 'skip'
  delta: number | null
}

export type RollupMissingPlayer = {
  playerId: string
  sport: string
  reason: string
}

export type PlayerWeeklyScoreRollupInput = {
  leagueId: string
  season: number
  week: number
  /** When false (default), no DB writes. */
  write?: boolean
  /**
   * Required when `write: true`. Operator attestation: understands `PlayerWeeklyScore` is
   * global per `(playerId, week, season, sport)` and last writer wins across leagues.
   */
  allowGlobalOverwrite?: boolean
  /**
   * Required when `write: true` and this league has scoring deviation (overrides or
   * non-default format vs sport baseline). Acknowledges writing those rules into shared rows.
   */
  allowCustomScoringWrite?: boolean
  jobName?: string
}

export type LeagueScoringRiskAssessment = {
  risky: boolean
  reasons: string[]
}

export type PlayerWeeklyScoreRollupResult = {
  leagueId: string
  season: number
  week: number
  write: boolean
  allowGlobalOverwrite: boolean
  allowCustomScoringWrite: boolean
  /** True only when a write transaction ran (guards passed and candidates existed). */
  writeApplied: boolean
  /** Present when a write was requested and global overwrite was allowed (used for guard UI). */
  scoringRisk?: LeagueScoringRiskAssessment
  candidateRows: RollupCandidateRow[]
  missingPlayers: RollupMissingPlayer[]
  changedScores: number
  unchangedScores: number
  wouldCreate: number
  wouldUpdate: number
  wouldSkip: number
  writtenCreate: number
  writtenUpdate: number
  notes: string[]
}

const GLOBAL_ROW_COLLISION_NOTE =
  'PlayerWeeklyScore rows are global (playerId+week+season+sport); another league with different rules may need a different fantasyPts for the same keys'

/**
 * Pure helper for tests — compares override count and resolved format to sport default.
 */
export function evaluateScoringDeviationsFromSignals(input: {
  leagueScoringOverrideCount: number
  effectiveFormat: string
  defaultFormat: string
}): LeagueScoringRiskAssessment {
  const reasons: string[] = []
  if (input.leagueScoringOverrideCount > 0) {
    reasons.push('league_scoring_overrides')
  }
  const eff = String(input.effectiveFormat).trim().toLowerCase()
  const def = String(input.defaultFormat).trim().toLowerCase()
  if (eff !== def) {
    reasons.push('non_default_scoring_format')
  }
  return { risky: reasons.length > 0, reasons }
}

/**
 * Detect league-specific scoring (overrides or format ≠ sport default) for rollup write policy.
 */
export async function assessLeagueSpecificScoringRiskForRollup(
  leagueId: string,
  leagueSport: LeagueSport,
): Promise<LeagueScoringRiskAssessment> {
  const leagueScoringOverrideCount = await prisma.leagueScoringOverride.count({ where: { leagueId } })
  const leagueSettings = await getLeagueSettingsForScoring(leagueId)
  const config = resolveSportConfigForLeague(leagueSport)
  const effectiveFormat =
    resolveFormatTypeFromLeagueSettings(leagueSport, leagueSettings) ?? config.defaultFormat
  return evaluateScoringDeviationsFromSignals({
    leagueScoringOverrideCount,
    effectiveFormat,
    defaultFormat: config.defaultFormat,
  })
}

function logRollup(event: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      event,
      subsystem: 'player_weekly_score_rollup',
      ...payload,
    }),
  )
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function resolveFormatType(leagueVariant: string | null, settings: Record<string, unknown>): string | undefined {
  const variant = String(settings.league_variant ?? leagueVariant ?? '').trim()
  if (variant) return variant
  const formatId = String(settings.format_id ?? settings.league_type ?? '').trim()
  return formatId || undefined
}

async function starterPlayersForMatchupWeek(
  leagueId: string,
  seasonYear: number,
  week: number,
): Promise<{ playerId: string; sport: string }[]> {
  const seasonRow = await prisma.redraftSeason.findFirst({
    where: { leagueId, season: seasonYear },
    select: { id: true },
  })
  if (!seasonRow) return []

  const matchups = await prisma.redraftMatchup.findMany({
    where: { leagueId, seasonId: seasonRow.id, week },
    select: { homeRosterId: true, awayRosterId: true },
  })
  const rosterIds = new Set<string>()
  for (const m of matchups) {
    rosterIds.add(m.homeRosterId)
    if (m.awayRosterId) rosterIds.add(m.awayRosterId)
  }

  const dedupe = new Map<string, { playerId: string; sport: string }>()
  for (const rosterId of rosterIds) {
    const starters = await prisma.redraftRosterPlayer.findMany({
      where: {
        rosterId,
        droppedAt: null,
        slotType: { notIn: ['bench', 'taxi', 'devy'] },
      },
      select: { playerId: true, sport: true },
    })
    for (const s of starters) {
      const k = `${s.playerId}\0${s.sport}`
      dedupe.set(k, { playerId: s.playerId, sport: s.sport })
    }
  }
  return [...dedupe.values()]
}

export function classifyRollupRowAction(
  existingPts: number | null,
  existingId: string | null,
  computed: number,
): Pick<RollupCandidateRow, 'action' | 'delta'> {
  if (existingId == null) {
    const delta = computed
    return { action: 'create', delta }
  }
  const ex = existingPts ?? 0
  const delta = Math.round((computed - ex) * 100) / 100
  if (Math.abs(computed - ex) <= EPS_SKIP) return { action: 'skip', delta: 0 }
  return { action: 'update', delta }
}

export async function runPlayerWeeklyScoreRollup(
  input: PlayerWeeklyScoreRollupInput,
): Promise<PlayerWeeklyScoreRollupResult> {
  const write = Boolean(input.write)
  const allowGlobalOverwrite = Boolean(input.allowGlobalOverwrite)
  const allowCustomScoringWrite = Boolean(input.allowCustomScoringWrite)
  const jobName = input.jobName ?? 'player_weekly_score_rollup'
  const notes: string[] = [
    'rollup_uses_league_scoring_rules_on_global_player_weekly_score_rows_see_module_docstring',
  ]

  const empty = (): PlayerWeeklyScoreRollupResult => ({
    leagueId: input.leagueId,
    season: input.season,
    week: input.week,
    write,
    allowGlobalOverwrite,
    allowCustomScoringWrite,
    writeApplied: false,
    candidateRows: [],
    missingPlayers: [],
    changedScores: 0,
    unchangedScores: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    wouldSkip: 0,
    writtenCreate: 0,
    writtenUpdate: 0,
    notes,
  })

  logRollup('pws_rollup_started', {
    jobName,
    leagueId: input.leagueId,
    season: input.season,
    week: input.week,
    write,
    allowGlobalOverwrite,
    allowCustomScoringWrite,
  })

  try {
    const league = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: { id: true, sport: true, leagueVariant: true, settings: true },
    })
    if (!league) {
      notes.push('league_not_found')
      const r = empty()
      r.notes = notes
      logRollup('pws_rollup_failed', { jobName, reason: 'league_not_found' })
      return r
    }

    let scoringRisk: LeagueScoringRiskAssessment | undefined
    let canApplyWrites = false
    if (write) {
      if (!allowGlobalOverwrite) {
        notes.push('write_blocked_missing_allowGlobalOverwrite')
        logRollup('pws_rollup_write_blocked', {
          jobName,
          leagueId: input.leagueId,
          reason: 'missing_allowGlobalOverwrite',
        })
      } else {
        const leagueSportForRisk = league.sport as LeagueSport
        scoringRisk = await assessLeagueSpecificScoringRiskForRollup(input.leagueId, leagueSportForRisk)
        if (scoringRisk.risky && !allowCustomScoringWrite) {
          notes.push('write_blocked_scoring_risk_missing_allowCustomScoringWrite')
          logRollup('pws_rollup_write_blocked', {
            jobName,
            leagueId: input.leagueId,
            reason: 'scoring_risk_missing_allowCustomScoringWrite',
            scoringRiskReasons: scoringRisk.reasons,
          })
        } else {
          canApplyWrites = true
        }
      }
    }

    const leagueSport = league.sport as LeagueSport
    const settings = toJsonRecord(league.settings)
    const formatType = resolveFormatType(league.leagueVariant, settings)

    const candidatesIn = await starterPlayersForMatchupWeek(input.leagueId, input.season, input.week)
    if (candidatesIn.length === 0) {
      notes.push('no_matchup_starters_found_for_week')
      const r = empty()
      r.notes = notes
      r.scoringRisk = scoringRisk
      logRollup('pws_rollup_completed', {
        jobName,
        leagueId: input.leagueId,
        write,
        writeApplied: false,
        candidateCount: 0,
        wouldCreate: 0,
        wouldUpdate: 0,
        wouldSkip: 0,
      })
      return r
    }

    const candidateRows: RollupCandidateRow[] = []
    const missingPlayers: RollupMissingPlayer[] = []

    for (const c of candidatesIn) {
      const sportKey = normalizeToSupportedSport(c.sport).toUpperCase() as LeagueSport
      const pgsRows = await prisma.playerGameStat.findMany({
        where: {
          playerId: c.playerId,
          sportType: sportKey,
          season: input.season,
          weekOrRound: input.week,
        },
        select: { normalizedStatMap: true, fantasyPoints: true },
      })

      if (pgsRows.length === 0) {
        missingPlayers.push({
          playerId: c.playerId,
          sport: c.sport,
          reason: 'no_player_game_stat_for_week',
        })
        continue
      }

      const merged = mergeNormalizedStatMaps(pgsRows.map((r) => r.normalizedStatMap as Record<string, unknown>))
      let computed: number
      if (Object.keys(merged).length > 0) {
        computed = await computePlayerFantasyPoints(
          input.leagueId,
          leagueSport,
          merged as PlayerStatsRecord,
          formatType,
        )
      } else {
        computed = pgsRows.reduce((s, r) => s + (r.fantasyPoints != null ? Number(r.fantasyPoints) : 0), 0)
      }
      computed = Math.round(computed * 100) / 100

      const existing = await prisma.playerWeeklyScore.findUnique({
        where: {
          playerId_week_season_sport: {
            playerId: c.playerId,
            week: input.week,
            season: input.season,
            sport: c.sport,
          },
        },
        select: { id: true, fantasyPts: true, isFinalized: true },
      })

      const { action, delta } = classifyRollupRowAction(
        existing?.fantasyPts != null ? Number(existing.fantasyPts) : null,
        existing?.id ?? null,
        computed,
      )

      candidateRows.push({
        playerId: c.playerId,
        sport: c.sport,
        computedFantasyPts: computed,
        existingFantasyPts: existing?.fantasyPts != null ? Number(existing.fantasyPts) : null,
        existingId: existing?.id ?? null,
        existingIsFinalized: Boolean(existing?.isFinalized),
        gamesMerged: pgsRows.length,
        action,
        delta,
      })
    }

    let wouldCreate = 0
    let wouldUpdate = 0
    let wouldSkip = 0
    for (const row of candidateRows) {
      if (row.action === 'create') wouldCreate++
      else if (row.action === 'update') wouldUpdate++
      else wouldSkip++
    }
    const changedScores = wouldCreate + wouldUpdate
    const unchangedScores = wouldSkip

    let writtenCreate = 0
    let writtenUpdate = 0
    let writeApplied = false

    if (canApplyWrites && candidateRows.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const row of candidateRows) {
          if (row.action === 'skip') continue

          const statsPayload = {
            rollupVersion: ROLLUP_VERSION,
            source: 'player_weekly_score_rollup',
            leagueId: input.leagueId,
            gamesMerged: row.gamesMerged,
            jobName,
          }

          await tx.playerWeeklyScore.upsert({
            where: {
              playerId_week_season_sport: {
                playerId: row.playerId,
                week: input.week,
                season: input.season,
                sport: row.sport,
              },
            },
            create: {
              playerId: row.playerId,
              week: input.week,
              season: input.season,
              sport: row.sport,
              fantasyPts: row.computedFantasyPts,
              stats: statsPayload,
              isFinalized: false,
            },
            update: {
              fantasyPts: row.computedFantasyPts,
              stats: statsPayload,
              ...(row.existingIsFinalized ? { isFinalized: true } : {}),
            },
          })
          if (row.action === 'create') writtenCreate += 1
          else if (row.action === 'update') writtenUpdate += 1
        }
      })
      writeApplied = true
      logRollup('pws_rollup_write_completed', {
        jobName,
        leagueId: input.leagueId,
        writtenCreate,
        writtenUpdate,
        skipped: wouldSkip,
        globalRowCollisionRiskAcknowledged: true,
        globalRowCollisionNote: GLOBAL_ROW_COLLISION_NOTE,
        scoringRisk,
      })
    } else if (write) {
      logRollup('pws_rollup_write_not_applied', {
        jobName,
        leagueId: input.leagueId,
        wouldCreate,
        wouldUpdate,
        wouldSkip,
        missingPlayers: missingPlayers.length,
        candidateRows: candidateRows.length,
        canApplyWrites,
        scoringRisk,
      })
    } else {
      logRollup('pws_rollup_dry_run_completed', {
        jobName,
        leagueId: input.leagueId,
        wouldCreate,
        wouldUpdate,
        wouldSkip,
        missingPlayers: missingPlayers.length,
        candidateRows: candidateRows.length,
      })
    }

    return {
      leagueId: input.leagueId,
      season: input.season,
      week: input.week,
      write,
      allowGlobalOverwrite,
      allowCustomScoringWrite,
      writeApplied,
      scoringRisk,
      candidateRows,
      missingPlayers,
      changedScores,
      unchangedScores,
      wouldCreate,
      wouldUpdate,
      wouldSkip,
      writtenCreate,
      writtenUpdate,
      notes,
    }
  } catch (err) {
    notes.push('rollup_exception')
    logRollup('pws_rollup_failed', {
      jobName,
      leagueId: input.leagueId,
      reason: err instanceof Error ? err.message : String(err),
    })
    const r = empty()
    r.notes = notes
    return r
  }
}
