import 'server-only'

import { fetchAllFFCFormats } from '@/lib/adp-data'
import { loadMultiPlatformADP } from '@/lib/multi-platform-adp'
import { prisma } from '@/lib/prisma'
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizePlayerName, normalizePosition, normalizeTeamAbbrev } from '@/lib/team-abbrev'

function currentSeason(): number {
  return new Date().getFullYear()
}

function currentWeekOfYear(): number {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, Math.ceil((diffDays + start.getUTCDay() + 1) / 7))
}

function buildPlayerId(sport: string, name: string, position?: string | null, team?: string | null): string {
  const slug = normalizePlayerName(name).replace(/\s+/g, '-')
  return `${sport}:${slug}:${normalizePosition(position) ?? 'FLEX'}:${normalizeTeamAbbrev(team) ?? team ?? 'FA'}`
}

type AdpRow = {
  sport: string
  format: string
  scoring: string
  playerId: string
  playerName: string
  position: string
  team: string
  adp: number
  adpChange: number | null
  providerCount?: number | null
  adpSpread?: number | null
  confidenceScore?: number | null
  providerBreakdown?: Record<string, number>
  week: number
  season: number
  source: string
}

const SOURCE_WEIGHTS: Record<string, number> = {
  fantrax: 1.0,
  sleeper: 0.95,
  espn: 0.9,
  mfl: 0.88,
  nffc: 0.9,
  ffc: 0.9,
  rolling_insights: 0.92,
  ai_adp: 0.85,
}

function sourceWeight(source: string): number {
  return SOURCE_WEIGHTS[source] ?? 0.8
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function confidenceForConsensus(providerCount: number, spread: number): number {
  // More independent providers with tighter spread => higher confidence.
  const providerScore = clamp(providerCount / 4, 0, 1)
  const spreadPenalty = clamp(spread / 60, 0, 1)
  const raw = 0.3 + providerScore * 0.55 - spreadPenalty * 0.25
  return Number(clamp(raw, 0.2, 0.98).toFixed(3))
}

function buildConsensusRows(input: {
  sport: string
  season: number
  week: number
  rows: AdpRow[]
  previousMap: Map<string, number>
}): AdpRow[] {
  const { sport, season, week, rows, previousMap } = input
  const grouped = new Map<string, AdpRow[]>()

  for (const row of rows) {
    if (row.source === 'consensus') continue
    const key = `${row.sport}:${row.format}:${row.scoring}:${row.playerId}`
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }

  const consensusRows: AdpRow[] = []

  for (const bucket of grouped.values()) {
    if (!bucket.length) continue
    const weighted = bucket.map((row) => ({
      row,
      weight: sourceWeight(row.source),
    }))
    const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0)
    if (weightSum <= 0) continue

    const consensusAdp = weighted.reduce((sum, item) => sum + item.row.adp * item.weight, 0) / weightSum
    const values = bucket.map((row) => row.adp)
    const spread = values.length >= 2 ? Math.max(...values) - Math.min(...values) : 0
    const providerBreakdown = Object.fromEntries(bucket.map((row) => [row.source, Number(row.adp.toFixed(2))]))
    const providerCount = Object.keys(providerBreakdown).length

    const base = bucket[0]
    const key = `${sport}:${base.format}:${base.scoring}:${base.playerId}:consensus`
    const adpValue = Number(consensusAdp.toFixed(2))

    consensusRows.push({
      sport,
      format: base.format,
      scoring: base.scoring,
      playerId: base.playerId,
      playerName: base.playerName,
      position: base.position,
      team: base.team,
      adp: adpValue,
      adpChange: previousMap.has(key) ? Number((adpValue - Number(previousMap.get(key))).toFixed(2)) : null,
      providerCount,
      adpSpread: Number(spread.toFixed(2)),
      confidenceScore: confidenceForConsensus(providerCount, spread),
      providerBreakdown,
      week,
      season,
      source: 'consensus',
    })
  }

  return consensusRows
}

async function loadPreviousMap(sport: string): Promise<Map<string, number>> {
  const rows = await prisma.adpDataRecord.findMany({
    where: { sport },
    orderBy: [{ season: 'desc' }, { week: 'desc' }, { createdAt: 'desc' }],
    take: 4000,
  })

  const map = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.sport}:${row.format}:${row.scoring}:${row.playerId}:${row.source}`
    if (!map.has(key)) map.set(key, row.adp)
  }
  return map
}

export async function runAdpImporter(options?: {
  sports?: string[]
}): Promise<{
  imported: number
  sports: string[]
  season: number
  week: number
  providerRowsRead: number
  providerRowsWritten: number
  consensusRowsAttempted: number
  consensusRowsWritten: number
  skippedRows: number
  providerRowsReadBySport: Record<string, number>
  providerRowsWrittenBySport: Record<string, number>
  consensusRowsAttemptedBySport: Record<string, number>
  consensusRowsBySport: Record<string, number>
}> {
  const season = currentSeason()
  const week = currentWeekOfYear()
  const sports = Array.from(
    new Set((options?.sports?.length ? options.sports : SUPPORTED_SPORTS).map((sport) => normalizeToSupportedSport(sport)))
  )

  let imported = 0
  let providerRowsRead = 0
  let providerRowsWritten = 0
  let consensusRowsAttempted = 0
  let consensusRowsWritten = 0
  const providerRowsReadBySport: Record<string, number> = {}
  const providerRowsWrittenBySport: Record<string, number> = {}
  const consensusRowsAttemptedBySport: Record<string, number> = {}
  const consensusRowsBySport: Record<string, number> = {}
  for (const sport of sports) {
    const previousMap = await loadPreviousMap(sport)
    const rows: AdpRow[] = []

    if (sport === 'NFL') {
      /*
       * 🛑 `fantrax` / `sleeper` / `espn` / `mfl` / `nffc` BELOW ARE NOT PROVIDER CALLS. They are
       * COLUMNS of one committed CSV — `data/nfl-adp-multiplatform.csv`, read here through
       * `loadMultiPlatformADP()` (fs.readFileSync, cached in-process). A row landing in
       * `AdpDataRecord` with `source: 'espn'` did not come from ESPN; it came from the ESPN
       * column of that file, whenever that file was last hand-updated.
       *
       * ⚠ THIS CRON THEREFORE REPUBLISHES A STATIC FILE DAILY AND LOOKS HEALTHY DOING IT.
       * Measured 2026-08-28: the CSV was last changed 2026-03-08, before the April draft, so
       * every 2026 draft entrant is absent — yet `AdpDataRecord` held 93,622 rows for season
       * 2026 with `createdAt` of that morning. Freshness monitors key on `createdAt` and see
       * green. Rookies present by source made the split unmistakable:
       *
       *     ffc 28 (a LIVE fetch)   espn 1   sleeper 4   fantrax 0   mfl 0
       *
       * `scripts/check-static-data-freshness.mjs` dates the CSV against the newest class in
       * `data/nfl-draft-capital.json` for exactly this reason. It is not guarding a legacy
       * fallback — this file is the primary source for most of the NFL ADP stack.
       */
      const multi = loadMultiPlatformADP()
      for (const player of multi) {
        const shared = {
          sport,
          playerId: buildPlayerId(sport, player.name, player.position, player.team),
          playerName: player.name,
          position: normalizePosition(player.position) ?? 'FLEX',
          team: normalizeTeamAbbrev(player.team) ?? player.team ?? 'FA',
          week,
          season,
        }

        const candidates: Array<{ format: string; scoring: string; source: string; adp: number | null }> = [
          { format: 'redraft', scoring: 'standard', source: 'fantrax', adp: player.redraft.fantrax },
          { format: 'redraft', scoring: 'standard', source: 'sleeper', adp: player.redraft.sleeper },
          { format: 'redraft', scoring: 'standard', source: 'espn', adp: player.redraft.espn },
          { format: 'redraft', scoring: 'standard', source: 'mfl', adp: player.redraft.mfl },
          { format: 'redraft', scoring: '2qb', source: 'sleeper', adp: player.twoQB.sleeper },
          { format: 'dynasty', scoring: 'standard', source: 'sleeper', adp: player.dynasty.sleeper },
          { format: 'dynasty', scoring: 'superflex', source: 'sleeper', adp: player.dynasty2QB.sleeper },
        ]

        for (const candidate of candidates) {
          if (candidate.adp == null || !Number.isFinite(candidate.adp)) continue
          const key = `${sport}:${candidate.format}:${candidate.scoring}:${shared.playerId}:${candidate.source}`
          rows.push({
            ...shared,
            format: candidate.format,
            scoring: candidate.scoring,
            source: candidate.source,
            adp: Number(candidate.adp),
            adpChange: previousMap.has(key) ? Number((Number(candidate.adp) - Number(previousMap.get(key))).toFixed(2)) : null,
          })
        }
      }

      const ffc = await fetchAllFFCFormats(12).catch(() => ({} as Awaited<ReturnType<typeof fetchAllFFCFormats>>))
      const ffcFormats = [
        ['standard', 'redraft', 'standard'],
        ['ppr', 'redraft', 'ppr'],
        ['half-ppr', 'redraft', 'halfPPR'],
        ['2qb', 'redraft', '2qb'],
        ['dynasty', 'dynasty', 'standard'],
      ] as const

      for (const [ffcKey, format, scoring] of ffcFormats) {
        const payload = ffc[ffcKey]
        for (const player of payload?.players ?? []) {
          const playerId = buildPlayerId(sport, player.name, player.position, player.team)
          const key = `${sport}:${format}:${scoring}:${playerId}:ffc`
          rows.push({
            sport,
            format,
            scoring,
            playerId,
            playerName: player.name,
            position: normalizePosition(player.position) ?? 'FLEX',
            team: normalizeTeamAbbrev(player.team) ?? player.team ?? 'FA',
            adp: player.adp,
            adpChange: previousMap.has(key) ? Number((player.adp - Number(previousMap.get(key))).toFixed(2)) : null,
            week,
            season,
            source: 'ffc',
          })
        }
      }
    } else {
      const snapshots = await prisma.aiAdpSnapshot.findMany({
        where: { sport },
        select: { leagueType: true, formatKey: true, snapshotData: true },
      })

      for (const snapshot of snapshots) {
        const entries = Array.isArray(snapshot.snapshotData) ? snapshot.snapshotData : []
        for (const entry of entries as Array<Record<string, unknown>>) {
          const name = String(entry.playerName ?? entry.name ?? '').trim()
          if (!name) continue
          const playerId = buildPlayerId(sport, name, String(entry.position ?? ''), String(entry.team ?? ''))
          const key = `${sport}:${snapshot.leagueType}:${snapshot.formatKey}:${playerId}:ai_adp`
          rows.push({
            sport,
            format: snapshot.leagueType,
            scoring: snapshot.formatKey,
            playerId,
            playerName: name,
            position: normalizePosition(String(entry.position ?? '')) ?? 'FLEX',
            team: normalizeTeamAbbrev(String(entry.team ?? '')) ?? String(entry.team ?? 'FA'),
            adp: Number(entry.adp ?? 999),
            adpChange: previousMap.has(key) ? Number((Number(entry.adp ?? 999) - Number(previousMap.get(key))).toFixed(2)) : null,
            week,
            season,
            source: 'ai_adp',
          })
        }
      }
    }

    if (rows.length === 0) continue
    providerRowsRead += rows.length
    providerRowsReadBySport[sport] = (providerRowsReadBySport[sport] ?? 0) + rows.length

    const consensusRows = buildConsensusRows({
      sport,
      season,
      week,
      rows,
      previousMap,
    })
    consensusRowsAttempted += consensusRows.length
    consensusRowsAttemptedBySport[sport] = (consensusRowsAttemptedBySport[sport] ?? 0) + consensusRows.length

    const providerInsert = await prisma.adpDataRecord.createMany({
      data: rows,
      skipDuplicates: true,
    })
    const consensusInsert = await prisma.adpDataRecord.createMany({
      data: consensusRows,
      skipDuplicates: true,
    })
    providerRowsWritten += providerInsert.count
    consensusRowsWritten += consensusInsert.count
    providerRowsWrittenBySport[sport] = (providerRowsWrittenBySport[sport] ?? 0) + providerInsert.count
    consensusRowsBySport[sport] = (consensusRowsBySport[sport] ?? 0) + consensusInsert.count
    imported += providerInsert.count + consensusInsert.count
  }

  return {
    imported,
    sports,
    season,
    week,
    providerRowsRead,
    providerRowsWritten,
    consensusRowsAttempted,
    consensusRowsWritten,
    providerRowsReadBySport,
    providerRowsWrittenBySport,
    consensusRowsAttemptedBySport,
    consensusRowsBySport,
    skippedRows:
      providerRowsRead + consensusRowsAttempted - providerRowsWritten - consensusRowsWritten,
  }
}
