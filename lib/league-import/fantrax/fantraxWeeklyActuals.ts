import { parse } from 'csv-parse/sync'
import type { FantraxTeamRoster } from './fantraxApi'

export type FantraxActual = { playerId: string; name: string; points: number; isStarter: boolean }
export type VerifiedFantraxActuals = { sourceTeamId: string; players: FantraxActual[]; starterTotal: number }

/** CSV exports carry neither season nor period. Bind them to an independently fetched
 * period roster and source team total before treating their points as source actuals. */
export function verifyFantraxWeeklyActuals(input: {
  csv: string; sourceTeamId: string; roster: FantraxTeamRoster; sourceTotal: number
}): VerifiedFantraxActuals {
  if (!Number.isFinite(input.sourceTotal)) throw new Error('Source team total unavailable')
  if (Buffer.byteLength(input.csv, 'utf8') > 2_000_000) throw new Error('CSV exceeds limit')
  const lines: string[][] = parse(input.csv, { bom: true, skip_empty_lines: true, relax_column_count: true })
  const headerAt = lines.findIndex(row => row[0] === 'ID' && row.includes('Fantasy Points'))
  if (headerAt < 0) throw new Error('Actual-score CSV header missing')
  const header = lines[headerAt]!
  // Full category stats distinguish Stats exports from trends/schedule/points-only views.
  for (const column of ['ID', 'Player', 'Status', 'Opponent', 'Fantasy Points', 'YDS-Pa', 'TD-Pa', 'YDS-Ru', 'TDRu', 'REC', 'YDS-RC', 'TD-Rc']) {
    if (header.filter(h => h === column).length !== 1) throw new Error(`Missing or duplicate column: ${column}`)
  }
  const expected = new Map(input.roster.rosterItems.map(p => [p.id, p]))
  if (!expected.size || expected.size !== input.roster.rosterItems.length) throw new Error('Period roster missing or duplicated')
  const players: FantraxActual[] = []
  const seen = new Set<string>()
  for (const row of lines.slice(headerAt + 1)) {
    const cell = (key: string) => String(row[header.indexOf(key)] ?? '').trim()
    const rawId = cell('ID')
    if (!rawId) continue // section labels and empty roster slots
    const playerId = rawId.replace(/^\*|\*$/g, '')
    if (!/^[a-zA-Z0-9]+$/.test(playerId) || seen.has(playerId)) throw new Error('Invalid or duplicate player ID')
    seen.add(playerId)
    const item = expected.get(playerId)
    const status = cell('Status').toUpperCase()
    const normalizedStatus = ({ ACT: 'ACTIVE', RES: 'RESERVE', IR: 'INJURED_RESERVE' } as Record<string, string>)[status]
    // Fantrax uses IR or INJURED_RESERVE depending on API capture.
    const expectedStatus = item?.status.toUpperCase().replace(/^IR$/, 'INJURED_RESERVE')
    if (!item || !normalizedStatus || normalizedStatus !== expectedStatus) throw new Error('CSV does not match the selected period roster')
    const rawPoints = cell('Fantasy Points')
    if (!/^-?\d+(?:\.\d+)?$/.test(rawPoints)) throw new Error('Actual points missing or malformed')
    const points = Number(rawPoints)
    if (!Number.isFinite(points)) throw new Error('Non-finite points')
    const opponent = cell('Opponent')
    if (opponent !== 'Bye' && !/\sF(?:\s|$)/.test(opponent)) throw new Error('CSV contains unfinished games or projections')
    players.push({ playerId, name: cell('Player'), points, isStarter: normalizedStatus === 'ACTIVE' })
  }
  if (seen.size !== expected.size) throw new Error('CSV omits period roster players')
  const starterTotal = players.filter(p => p.isStarter).reduce((sum, p) => sum + p.points, 0)
  if (Math.abs(starterTotal - input.sourceTotal) > 0.001) throw new Error('CSV starter total differs from the source period total')
  return { sourceTeamId: input.sourceTeamId, players, starterTotal }
}

/** Missing calculations stay missing, never silently become scoreless games. */
export function compareFantraxActuals(actuals: FantraxActual[], calculated: Map<string, number>) {
  return actuals.map(p => {
    const value = calculated.get(p.playerId)
    const available = value != null && Number.isFinite(value)
    return { ...p, calculatedPoints: available ? value : null, delta: available ? Number((value - p.points).toFixed(6)) : null,
      status: !available ? 'missing_calculation' as const : Math.abs(value - p.points) <= 0.001 ? 'matched' as const : 'discrepancy' as const }
  })
}

export function fantraxActualWriteDecision(
  next: { points: number; rosterId: number; isStarter: boolean },
  prior?: { points: number; rosterId: number | null; isStarter: boolean; source: string; isFinalized: boolean } | null,
): 'write' | 'unchanged' {
  if (prior && prior.source !== 'fantrax') throw new Error('Existing actuals belong to another source')
  if (prior && prior.points === next.points && prior.rosterId === next.rosterId && prior.isStarter === next.isStarter) return 'unchanged'
  if (prior?.isFinalized) throw new Error('Finalized source actual requires explicit reconciliation')
  return 'write'
}
