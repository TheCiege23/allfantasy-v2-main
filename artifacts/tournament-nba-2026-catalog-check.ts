/** Read-only draft identity and prior-season rank audit; points per game are not ADP. */
import { readFileSync, writeFileSync } from 'node:fs'
import { assessSeasonDraftPool, type SeasonDraftPlayer } from '@/lib/tournament/seasonDraftPolicy'

type Catalog = { rows: Array<{ externalId: string; name: string; position: string; team: string | null; status: string }> }
type Stat = { player_id: number; regular_season?: { games_played?: number; points?: number } }
const catalog = JSON.parse(readFileSync('artifacts/tournament-provider-samples/nba-public-catalog-2026.json', 'utf8')) as Catalog
const prior = JSON.parse(readFileSync('artifacts/tournament-provider-samples/rolling-insights-player-stats-2025-NBA.json', 'utf8')) as { rows: Stat[] }
const config = (JSON.parse(readFileSync('artifacts/tournament-provider-samples/nba-2026-pilot-calendar-review.json', 'utf8')) as { config: Parameters<typeof assessSeasonDraftPool>[0] }).config
const previous = new Map(prior.rows.map(row => [String(row.player_id), row.regular_season]))
const measured = catalog.rows.flatMap(row => {
  const stats = previous.get(row.externalId)
  const games = Number(stats?.games_played), points = Number(stats?.points)
  return games > 0 && Number.isFinite(points) ? [{ id: row.externalId, ppg: points / games }] : []
}).sort((a, b) => b.ppg - a.ppg || a.id.localeCompare(b.id))
const ranks = new Map(measured.map((row, index) => [row.id, index + 1]))
const players: SeasonDraftPlayer[] = catalog.rows.map(row => ({
  playerId: row.externalId, playerName: row.name, position: row.position, team: row.team,
  rank: ranks.get(row.externalId) ?? null, adp: null,
  draftIdProvenance: { namespace: 'rolling_insights', sourceRecordId: row.externalId },
}))
const report = assessSeasonDraftPool(config, players, 8)
writeFileSync('artifacts/tournament-provider-samples/nba-2026-pilot-catalog-review.json', JSON.stringify({ source: 'public current Rolling Insights roster identities plus measured 2025–26 points per game; not ADP or a projection', players, report }, null, 2), { flag: 'wx' })
process.stdout.write(JSON.stringify({ ready: report.ready, blockers: report.blockers, currentEligible: players.length, priorSeasonRanked: measured.length, requiredPerLeague: report.required, rankedSlotMatch: report.rankedPlayers, matched: report.matched, rankSource: '2025–26 points per game, not ADP' }) + '\n')
