import { createHash } from 'node:crypto'
import { classifyStrategy } from '@/lib/shared-services/league-hub/generators/strategyRecommendations'
import type { UserOsTeamStanding } from '@/lib/shared-services/league-hub/userOsContext'
import { readStrategy, recordStrategyObservation, type StrategyScope, type StrategyStorePort } from './strategyStore'

export interface StrategyEvidenceFacts {
  leagueId: string; userId: string; season: number; sport: string; isDynasty: boolean
  teamCount: number | null; ownerTeamId: string | null; teamIds: string[]
  currentPeriod: number; periodSource: string; loadedAt: string; lastSyncedAt: string | null
  results: { id: string; teamId: string; season: number; week: number; points: number; result: string | null }[]
}
export interface StrategyEvidencePort { load(scope: StrategyScope): Promise<StrategyEvidenceFacts | null> }

/** Results-only strategy signal; deliberately not a dynasty-window or calibrated probability model. */
export function strategyObservationFromFacts(scope: StrategyScope, facts: StrategyEvidenceFacts | null, now: Date) {
  const unavailable = (gap: string) => ({ observation: null, completedWeek: null, gaps: [gap] })
  if (!facts || facts.userId !== scope.userId || facts.leagueId !== scope.leagueId || facts.season !== scope.season) return unavailable('strategy_scope_unresolved')
  if (facts.sport.toUpperCase() !== 'NFL' || facts.periodSource !== 'sleeper_state_nfl' ||
    !Number.isInteger(facts.currentPeriod) || facts.currentPeriod < 4 || facts.currentPeriod > 18) return unavailable('completed_week_unverified')
  const synced = facts.lastSyncedAt ? Date.parse(facts.lastSyncedAt) : NaN
  const loaded = Date.parse(facts.loadedAt)
  if (!Number.isFinite(+now) || !Number.isFinite(synced) || synced > +now || +now - synced > 48 * 3600000 ||
    !Number.isFinite(loaded) || loaded > +now || +now - loaded > 60000) return unavailable('strategy_facts_stale')
  if (!facts.ownerTeamId || !facts.teamCount || facts.teamCount < 2 || !Number.isInteger(facts.teamCount) ||
    facts.teamIds.length !== facts.teamCount || new Set(facts.teamIds).size !== facts.teamCount || !facts.teamIds.includes(facts.ownerTeamId)) return unavailable('standings_coverage_incomplete')
  const week = facts.currentPeriod - 1
  const standings: UserOsTeamStanding[] = facts.teamIds.map(teamId => ({ teamId, teamName: '', wins: 0, losses: 0, ties: 0,
    pointsFor: 0, pointsAgainst: 0, currentRank: null, isViewerTeam: teamId === facts.ownerTeamId }))
  const byTeam = new Map(standings.map(s => [s.teamId, s]))
  const seen = new Set<string>(), ids = new Set<string>()
  for (const row of facts.results) {
    if (row.season !== scope.season || row.week < 1 || row.week > week || !Number.isInteger(row.week) ||
      !row.id || ids.has(row.id) || !Number.isFinite(row.points) || !['W', 'L', 'T'].includes(row.result ?? '') || !byTeam.has(row.teamId)) return unavailable('completed_results_invalid')
    const key = `${row.teamId}:${row.week}`
    if (seen.has(key)) return unavailable('completed_results_ambiguous')
    seen.add(key); ids.add(row.id)
    const team = byTeam.get(row.teamId)!
    team.pointsFor += row.points
    if (row.result === 'W') team.wins++
    else if (row.result === 'L') team.losses++
    else team.ties++
  }
  if (seen.size !== facts.teamCount * week) return unavailable('completed_results_incomplete')
  if (standings.some(team => !Number.isFinite(team.pointsFor))) return unavailable('completed_results_invalid')
  const viewerTeam = byTeam.get(facts.ownerTeamId)!
  const tied = standings.some(t => t.teamId !== viewerTeam.teamId && t.wins === viewerTeam.wins && t.pointsFor === viewerTeam.pointsFor)
  const classification = classifyStrategy({ viewerTeam, standings, currentWeek: week, isDynasty: facts.isDynasty })
  if (!classification || classification.classification === 'insufficient_evidence') return unavailable('strategy_signal_unavailable')
  const strategy = !tied && ['strong_contender', 'contender'].includes(classification.classification) ? 'win-now' as const
    : !tied && classification.classification === 'rebuild' && facts.isDynasty ? 'rebuild' as const : 'balanced' as const
  const evidence = createHash('sha256').update(JSON.stringify({ ownerTeamId: facts.ownerTeamId, isDynasty: facts.isDynasty,
    results: facts.results.map(r => [r.id, r.teamId, r.week, r.points, r.result])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))) })).digest('hex')
  return { observation: { strategy, week, evidenceId: `results-v1:${scope.season}:${week}:${evidence}`, materialChange: true },
    completedWeek: week, gaps: [] }
}

export async function refreshStrategyFromEvidence(scope: StrategyScope, evidence: StrategyEvidencePort, store: StrategyStorePort, now?: Date) {
  const facts = await evidence.load(scope)
  const observedAt = now ?? new Date()
  const signal = strategyObservationFromFacts(scope, facts, observedAt)
  const previous = await readStrategy(scope, store)
  // Corrected history or a newly claimed team must establish a fresh sequence.
  const historyMatches = !previous?.pending || !!facts && previous.pending.evidenceIds.every((id, index) => {
    const week = previous.pending!.firstWeek + index
    if (!signal.completedWeek || week > signal.completedWeek) return false
    return strategyObservationFromFacts(scope, { ...facts, currentPeriod: week + 1,
      results: facts.results.filter(r => r.week <= week) }, observedAt).observation?.evidenceId === id
  })
  const state = signal.observation ? await recordStrategyObservation(scope,
    { ...signal.observation, restartSequence: !historyMatches }, store) : previous
  const canConfirm = !!(state?.pending && state.pending.observations >= 3 && signal.observation &&
    historyMatches &&
    state.pending.lastWeek === signal.completedWeek && state.pending.strategy === signal.observation.strategy &&
    state.pending.evidenceIds.at(-1) === signal.observation.evidenceId)
  return { state, completedWeek: signal.completedWeek, gaps: signal.gaps, canConfirm }
}
