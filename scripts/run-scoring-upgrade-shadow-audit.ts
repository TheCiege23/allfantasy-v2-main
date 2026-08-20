/**
 * Offline scoring-upgrade shadow audit — READ-ONLY.
 *
 * Runs `lib/scoring/scoring-upgrade-shadow.ts` against either:
 *   1. A JSON file of weekly score samples (preferred, fully offline), or
 *   2. A direct read-only `prisma.leaguePlayerWeeklyScore.findMany(...)` query
 *      scoped to a single league/season/week.
 *
 * Hard guarantees (do not relax):
 *   - Default flag mode is `'off'`. The harness exits inert unless the user
 *     explicitly opts in via `--mode <internal|canary|on>` or
 *     `SCORING_UPGRADE_SHADOW_MODE=...`.
 *   - No DB writes (only `findMany`).
 *   - No realtime emission.
 *   - No imports from canonical scoring engines, brackets, AI, waivers,
 *     trades, drafts, roster, chat, or payments.
 *   - Severity is reported, never used as a process gate (always exits 0
 *     unless the script itself errors on args/IO).
 *
 * Usage:
 *   npx tsx scripts/run-scoring-upgrade-shadow-audit.ts --help
 *   npx tsx scripts/run-scoring-upgrade-shadow-audit.ts \
 *     --samples ./samples.json --mode on --candidate identity
 *   npx tsx scripts/run-scoring-upgrade-shadow-audit.ts \
 *     --leagueId LEAGUE --season 2026 --week 3 --mode on --candidate scale:1.05
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  parseScoringUpgradeShadowMode,
  type ScoringUpgradeShadowMode,
} from '@/lib/scoring/scoring-upgrade-shadow-flag'
import {
  runScoringUpgradeShadow,
  type ScoringUpgradeCandidateFn,
  type ScoringUpgradeShadowDiffRow,
  type WeeklyScoreSample,
} from '@/lib/scoring/scoring-upgrade-shadow'

type CandidateSpec =
  | { kind: 'identity' }
  | { kind: 'scale'; factor: number }

type CliArgs = {
  help: boolean
  samplesPath: string | null
  leagueId: string | null
  season: number | null
  week: number | null
  sport: string | null
  limit: number
  mode: ScoringUpgradeShadowMode | null
  internal: boolean
  canaryLeague: boolean
  candidate: CandidateSpec
}

/** Synthetic leagueId used when reading from the global PlayerWeeklyScore table. */
const SYNTHETIC_GLOBAL_LEAGUE_ID = '__global__'

const HELP_TEXT = `Scoring Upgrade Shadow Audit (read-only)

Usage:
  npx tsx scripts/run-scoring-upgrade-shadow-audit.ts [options]

Sample source (pick one):
  --samples <path.json>         Read samples from a JSON array file. Each item:
                                {leagueId, playerId, season, week, sport, fantasyPts}
  --season <n> --week <n> [--sport <NFL|NBA|...>] [--leagueId <id>]
                                Read existing rows from prisma.playerWeeklyScore
                                (SELECT only; no writes, no realtime).
                                PlayerWeeklyScore is global: leagueId is
                                synthesized as '__global__' unless --leagueId is
                                supplied (used only as a tag in output).

Limits:
  --limit <n>                   Cap samples (default 500).

Flag (default OFF — script exits inert unless explicitly enabled):
  --mode <off|internal|canary|on>
                                Overrides SCORING_UPGRADE_SHADOW_MODE env var.
                                Defaults to 'off'.
  --internal                    Mark request as internal (for mode=internal).
  --canaryLeague                Mark league as canary (for mode=canary).

Candidate (pure function):
  --candidate identity          Returns baseline (zero diffs; harness smoke).
  --candidate scale:<factor>    Returns baseline * factor (e.g. scale:1.05).

  --help                        Show this message.

Guarantees:
  * No database writes.
  * No realtime events.
  * No production scoring behavior modified.
  * Exits 0 regardless of severity (audit, not gate).
`

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    samplesPath: null,
    leagueId: null,
    season: null,
    week: null,
    sport: null,
    limit: 500,
    mode: null,
    internal: false,
    canaryLeague: false,
    candidate: { kind: 'identity' },
  }

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    switch (a) {
      case '--help':
      case '-h':
        args.help = true
        break
      case '--samples':
        args.samplesPath = String(argv[++i] ?? '')
        break
      case '--leagueId':
        args.leagueId = String(argv[++i] ?? '')
        break
      case '--season':
        args.season = Number.parseInt(String(argv[++i] ?? ''), 10)
        break
      case '--week':
        args.week = Number.parseInt(String(argv[++i] ?? ''), 10)
        break
      case '--sport':
        args.sport = String(argv[++i] ?? '').trim() || null
        break
      case '--limit':
        args.limit = Math.max(1, Number.parseInt(String(argv[++i] ?? '500'), 10) || 500)
        break
      case '--mode': {
        const raw = String(argv[++i] ?? '')
        args.mode = parseScoringUpgradeShadowMode(raw)
        break
      }
      case '--internal':
        args.internal = true
        break
      case '--canaryLeague':
        args.canaryLeague = true
        break
      case '--candidate': {
        const raw = String(argv[++i] ?? 'identity').trim()
        if (raw === 'identity') {
          args.candidate = { kind: 'identity' }
        } else if (raw.startsWith('scale:')) {
          const factor = Number.parseFloat(raw.slice('scale:'.length))
          if (!Number.isFinite(factor)) {
            throw new Error(`Invalid --candidate scale factor: ${raw}`)
          }
          args.candidate = { kind: 'scale', factor }
        } else {
          throw new Error(`Unknown --candidate value: ${raw}`)
        }
        break
      }
      default:
        if (a.startsWith('--')) {
          throw new Error(`Unknown argument: ${a}`)
        }
        break
    }
  }

  return args
}

function buildCandidate(spec: CandidateSpec): ScoringUpgradeCandidateFn {
  if (spec.kind === 'identity') {
    return (s) => s.fantasyPts
  }
  const factor = spec.factor
  return (s) => s.fantasyPts * factor
}

function isWeeklyScoreSample(value: unknown): value is WeeklyScoreSample {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.leagueId === 'string' &&
    typeof v.playerId === 'string' &&
    typeof v.season === 'number' &&
    typeof v.week === 'number' &&
    typeof v.sport === 'string' &&
    typeof v.fantasyPts === 'number'
  )
}

async function loadSamplesFromFile(rawPath: string): Promise<WeeklyScoreSample[]> {
  const abs = path.resolve(process.cwd(), rawPath)
  const text = await fs.readFile(abs, 'utf8')
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) {
    throw new Error(`Samples file must be a JSON array: ${abs}`)
  }
  const out: WeeklyScoreSample[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i]
    if (!isWeeklyScoreSample(item)) {
      throw new Error(
        `Sample at index ${i} is missing required fields {leagueId, playerId, season, week, sport, fantasyPts}.`,
      )
    }
    out.push(item)
  }
  return out
}

async function loadSamplesFromDb(args: {
  leagueIdTag: string
  season: number
  week: number
  sport: string | null
  limit: number
}): Promise<WeeklyScoreSample[]> {
  // Lazy import so `--samples` mode and `--help` never touch Prisma.
  const { prisma } = await import('@/lib/prisma')
  // READ-ONLY: SELECT against the global PlayerWeeklyScore table.
  // No upsert / create / update / delete / realtime emission.
  const where: { season: number; week: number; sport?: string } = {
    season: args.season,
    week: args.week,
  }
  if (args.sport) where.sport = args.sport
  const rows = await prisma.playerWeeklyScore.findMany({
    where,
    select: {
      playerId: true,
      season: true,
      week: true,
      sport: true,
      fantasyPts: true,
    },
    take: args.limit,
  })
  return rows.map((r) => ({
    leagueId: args.leagueIdTag,
    playerId: r.playerId,
    season: r.season,
    week: r.week,
    sport: r.sport,
    fantasyPts: typeof r.fantasyPts === 'number' ? r.fantasyPts : Number(r.fantasyPts ?? 0),
  }))
}

function formatDelta(d: number | null): string {
  if (d == null) return '   n/a'
  const sign = d >= 0 ? '+' : '-'
  return `${sign}${Math.abs(d).toFixed(4)}`
}

function diffSeverityLabel(row: ScoringUpgradeShadowDiffRow): string {
  if (row.candidateError) return 'error'
  if (row.missingCandidate) return 'missing'
  if (row.delta == null) return 'n/a'
  const abs = Math.abs(row.delta)
  if (abs > 0.5) return 'critical'
  if (abs > 0.02) return 'warning'
  return 'match'
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  if (args.help) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const mode: ScoringUpgradeShadowMode =
    args.mode ?? parseScoringUpgradeShadowMode(process.env.SCORING_UPGRADE_SHADOW_MODE)

  // Load samples
  let samples: WeeklyScoreSample[]
  let source: 'file' | 'db'
  if (args.samplesPath) {
    samples = await loadSamplesFromFile(args.samplesPath)
    source = 'file'
  } else if (Number.isFinite(args.season) && Number.isFinite(args.week)) {
    samples = await loadSamplesFromDb({
      leagueIdTag: args.leagueId ?? SYNTHETIC_GLOBAL_LEAGUE_ID,
      season: args.season as number,
      week: args.week as number,
      sport: args.sport,
      limit: args.limit,
    })
    source = 'db'
  } else {
    process.stderr.write(
      'ERROR: provide either --samples <path.json> or --season <n> --week <n> [--sport <s>] [--leagueId <id>].\n\n',
    )
    process.stderr.write(HELP_TEXT)
    process.exitCode = 1
    return
  }

  if (samples.length > args.limit) {
    samples = samples.slice(0, args.limit)
  }

  const candidate = buildCandidate(args.candidate)

  // Header
  process.stdout.write('=== Scoring Upgrade Shadow Audit ===\n')
  process.stdout.write(`mode: ${mode}\n`)
  process.stdout.write(`internalRequest: ${args.internal}\n`)
  process.stdout.write(`canaryLeague: ${args.canaryLeague}\n`)
  process.stdout.write(`candidate: ${args.candidate.kind === 'identity' ? 'identity' : `scale:${args.candidate.factor}`}\n`)
  process.stdout.write(`samples loaded: ${samples.length} (source: ${source})\n\n`)

  const result = runScoringUpgradeShadow({
    mode,
    isInternalRequest: args.internal,
    isCanaryLeague: args.canaryLeague,
    samples,
    candidate,
    jobName: 'scoring_upgrade_shadow_audit',
  })

  process.stdout.write('--- Result ---\n')
  process.stdout.write(`enabled: ${result.enabled}\n`)
  if (!result.enabled) {
    process.stdout.write(`reason: ${result.plan.reason}\n`)
    process.stdout.write(`notes: ${result.notes.join(', ') || '(none)'}\n`)
    process.stdout.write('\n(harness disabled — candidate was not invoked; no diffs produced)\n')
    return
  }

  let maxAbsDelta = 0
  for (const r of result.rows) {
    if (r.delta != null) {
      const abs = Math.abs(r.delta)
      if (abs > maxAbsDelta) maxAbsDelta = abs
    }
  }
  const matches =
    result.evaluatedCount -
    result.mismatchedCount -
    result.missingCandidateCount -
    result.candidateErrorCount

  process.stdout.write(`total samples checked: ${result.sampleCount}\n`)
  process.stdout.write(`matches: ${matches}\n`)
  process.stdout.write(`mismatches (warning+critical): ${result.mismatchedCount}\n`)
  process.stdout.write(`missing candidate: ${result.missingCandidateCount}\n`)
  process.stdout.write(`candidate errors: ${result.candidateErrorCount}\n`)
  process.stdout.write(`max |delta|: ${maxAbsDelta.toFixed(4)}\n`)
  process.stdout.write(`overall severity: ${result.severity}\n`)
  process.stdout.write(`durationMs: ${result.durationMs}\n\n`)

  // Top 20 largest diffs (by |delta|, then errors/missing for visibility)
  const ranked = [...result.rows].sort((a, b) => {
    const ad = a.delta == null ? -1 : Math.abs(a.delta)
    const bd = b.delta == null ? -1 : Math.abs(b.delta)
    return bd - ad
  })
  const top = ranked.slice(0, 20)

  process.stdout.write('--- Top 20 largest diffs ---\n')
  if (top.length === 0) {
    process.stdout.write('(no rows)\n')
    return
  }
  for (let i = 0; i < top.length; i += 1) {
    const r = top[i]
    const candStr = r.candidate == null ? 'null' : r.candidate.toFixed(4)
    process.stdout.write(
      `${String(i + 1).padStart(2, ' ')}. league=${r.leagueId} player=${r.playerId} ` +
        `season=${r.season} week=${r.week} sport=${r.sport} ` +
        `baseline=${r.baseline.toFixed(4)} candidate=${candStr} ` +
        `delta=${formatDelta(r.delta)} severity=${diffSeverityLabel(r)}` +
        (r.candidateError ? ` error="${r.candidateError}"` : '') +
        '\n',
    )
  }
}

main().catch((err) => {
  process.stderr.write(`scoring-upgrade-shadow-audit: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
