/**
 * Read-only audit of experience signals in `sports_players` JSON + resolved rookie/veteran (no external APIs).
 *
 * Usage:
 *   npm run data:audit-player-experience -- --sport NFL --limit 20
 *   npm run data:audit-player-experience -- --sport NBA --provider thesportsdb --missing experience --limit 20
 *   npm run data:audit-player-experience -- --sport MLB --provider clearsports --json --limit 10
 */

import type { LeagueSport } from '@prisma/client'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import {
  extractExperienceSignalsFromProviderPayload,
  getExperienceSignalsFromSportsPlayer,
  inferExperienceSourceFromDataSource,
} from '@/lib/player-data/providerExperienceFields'
import { resolvePlayerExperience } from '@/lib/player-data/playerExperience'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

type ProviderArg = 'all' | 'thesportsdb' | 'clearsports' | 'rolling_insights'
type MissingArg = 'none' | 'experience' | 'draftYear' | 'class'

function readYearsExpLoose(o: Record<string, unknown>): number | null {
  const lowerMap = new Map<string, string>()
  for (const k of Object.keys(o)) {
    lowerMap.set(k.toLowerCase().replace(/\s+/g, '_'), k)
  }
  for (const want of ['yearsexp', 'years_exp', 'yearsexperience']) {
    const orig = lowerMap.get(want)
    if (orig !== undefined && o[orig] != null) {
      const n = Number(o[orig])
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null
    }
  }
  return null
}

function flattenMerged(stats: unknown, projections: unknown, news: unknown): Record<string, unknown> {
  const a =
    stats && typeof stats === 'object' && !Array.isArray(stats) ? (stats as Record<string, unknown>) : {}
  const b =
    projections && typeof projections === 'object' && !Array.isArray(projections)
      ? (projections as Record<string, unknown>)
      : {}
  const c = news && typeof news === 'object' && !Array.isArray(news) ? (news as Record<string, unknown>) : {}
  return { ...a, ...b, ...c }
}

function stubEntry(sport: LeagueSport, merged: Record<string, unknown>, displayName: string): NormalizedDraftEntry {
  return {
    name: displayName,
    position: 'QB',
    team: null,
    yearsExp: readYearsExpLoose(merged),
    display: {
      playerId: 'audit',
      displayName,
      sport,
      assets: { headshotUrl: null, teamLogoUrl: null },
      stats: {},
      metadata: {
        position: 'QB',
        teamAbbreviation: null,
        byeWeek: null,
        injuryStatus: null,
        sport,
        classYearLabel: typeof merged.class === 'string' ? merged.class : null,
      },
    },
  } as unknown as NormalizedDraftEntry
}

function parseArgs(argv: string[]) {
  let sport: LeagueSport | null = null
  let limit = 50
  let provider: ProviderArg = 'all'
  let missing: MissingArg = 'none'
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--sport' && argv[i + 1]) {
      sport = normalizeToSupportedSport(argv[++i]) as LeagueSport
    } else if (a === '--limit' && argv[i + 1]) {
      limit = Math.min(5000, Math.max(1, Number(argv[++i]) || 50))
    } else if (a === '--provider' && argv[i + 1]) {
      const p = String(argv[++i]).toLowerCase()
      if (p === 'thesportsdb' || p === 'clearsports' || p === 'rolling_insights') provider = p as ProviderArg
      else if (p === 'all') provider = 'all'
    } else if (a === '--missing' && argv[i + 1]) {
      const m = argv[++i] as MissingArg
      if (m === 'experience' || m === 'draftYear' || m === 'class' || m === 'none') missing = m
    } else if (a === '--json') {
      json = true
    }
  }
  return { sport, limit, provider, missing, json }
}

function providerMatches(rowDs: string, want: ProviderArg): boolean {
  if (want === 'all') return true
  return inferExperienceSourceFromDataSource(rowDs) === want
}

function hasServiceTimeHint(merged: Record<string, unknown>): boolean {
  const sig = extractExperienceSignalsFromProviderPayload(merged, 'unknown')
  const flat = JSON.stringify(merged).toLowerCase()
  return (
    Boolean(sig.field?.toLowerCase().includes('service')) ||
    flat.includes('service_time') ||
    flat.includes('servicetime')
  )
}

function passesMissingFilter(
  sport: LeagueSport,
  missing: MissingArg,
  resolved: ReturnType<typeof resolvePlayerExperience>,
): boolean {
  if (missing === 'none') return true
  if (missing === 'experience') return resolved.status === 'unknown'
  if (missing === 'draftYear') return resolved.draftYear == null
  if (missing === 'class') return sport === 'NCAAF' && resolved.collegeClassBucket === 'unknown'
  return true
}

async function main() {
  const { sport, limit, provider, missing, json } = parseArgs(process.argv.slice(2))
  void json
  if (!sport) {
    console.error('Pass --sport NFL|NBA|MLB|NHL|NCAAFB|NCAABB|...')
    process.exitCode = 1
    return
  }

  const rows = await prisma.sportsPlayerRecord.findMany({
    where: { sport },
    take: limit,
    orderBy: { lastUpdated: 'desc' },
  })

  const filtered = rows.filter((r) => providerMatches(r.dataSource, provider))

  let riTaggedWithSignal = 0
  let tsdbTaggedWithSignal = 0
  let clearTaggedWithSignal = 0
  let labeledRi = 0
  let labeledTsdb = 0
  let labeledClear = 0
  let anySleeperYearsExp = 0
  let anyDraftYear = 0
  let anyDebutYear = 0
  let anyServiceTime = 0

  let rookies = 0
  let veterans = 0
  let unknownExp = 0

  let matchingMissing = 0
  const samplesOk: Array<{ id: string; dataSource: string; field: string | null; reason: string }> = []
  const samplesMissing: Array<{ id: string; dataSource: string; reason: string }> = []

  for (const row of filtered) {
    const merged = flattenMerged(row.stats, row.projections, row.news)
    const loose = extractExperienceSignalsFromProviderPayload(merged, 'unknown')
    const fromRow = getExperienceSignalsFromSportsPlayer({
      stats: row.stats,
      projections: row.projections,
      news: row.news,
      dataSource: row.dataSource,
    })
    const bucket = inferExperienceSourceFromDataSource(row.dataSource)
    const hasSignal = loose.reason !== 'no_matching_fields'

    if (bucket === 'rolling_insights' && hasSignal) riTaggedWithSignal++
    if (bucket === 'thesportsdb' && hasSignal) tsdbTaggedWithSignal++
    if (bucket === 'clearsports' && hasSignal) clearTaggedWithSignal++

    if (fromRow.source === 'rolling_insights' && fromRow.reason !== 'no_matching_fields') labeledRi++
    if (fromRow.source === 'thesportsdb' && fromRow.reason !== 'no_matching_fields') labeledTsdb++
    if (fromRow.source === 'clearsports' && fromRow.reason !== 'no_matching_fields') labeledClear++

    if (readYearsExpLoose(merged) != null) anySleeperYearsExp++
    if (loose.draftYear != null) anyDraftYear++
    if (loose.debutYear != null) anyDebutYear++
    if (hasServiceTimeHint(merged)) anyServiceTime++

    const statsObj = row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats)
      ? (row.stats as Record<string, unknown>)
      : undefined
    const projObj =
      row.projections && typeof row.projections === 'object' && !Array.isArray(row.projections)
        ? (row.projections as Record<string, unknown>)
        : undefined

    const resolved = resolvePlayerExperience({
      sport,
      entry: stubEntry(sport, merged, row.name),
      statsJson: statsObj,
      projectionsJson: projObj,
      dataSource: row.dataSource,
    })

    if (resolved.status === 'rookie') rookies++
    else if (resolved.status === 'veteran') veterans++
    else unknownExp++

    const missOk = passesMissingFilter(sport, missing, resolved)
    if (missOk) {
      matchingMissing++
      if (samplesOk.length < 5 && resolved.status !== 'unknown') {
        samplesOk.push({
          id: row.id,
          dataSource: row.dataSource,
          field: fromRow.field,
          reason: `${resolved.source}: ${resolved.reason}`,
        })
      }
      if (samplesMissing.length < 5 && resolved.status === 'unknown') {
        samplesMissing.push({ id: row.id, dataSource: row.dataSource, reason: resolved.reason })
      }
    }
  }

  const report = {
    sport,
    providerFilter: provider,
    missingFilter: missing,
    scannedRowsAfterProviderFilter: filtered.length,
    rowsMatchingMissingFilter: matchingMissing,
    taggedRowsWithSignalsInMergedJson: {
      rollingInsightsTagged: riTaggedWithSignal,
      theSportsDbTagged: tsdbTaggedWithSignal,
      clearSportsTagged: clearTaggedWithSignal,
    },
    signalsFromRowExtractionByDataSourceLabel: {
      rollingInsights: labeledRi,
      theSportsDb: labeledTsdb,
      clearSports: labeledClear,
    },
    fieldPresenceInMergedJson: {
      sleeperStyleYearsExp: anySleeperYearsExp,
      draftYear: anyDraftYear,
      debutYear: anyDebutYear,
      serviceTimeHints: anyServiceTime,
    },
    resolvedCountsOverAllScannedRows: { rookies, veterans, unknownExperience: unknownExp },
    sampleRowsMatchingFilters: samplesOk,
    sampleUnknownExperienceMatchingFilters: samplesMissing,
  }

  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
