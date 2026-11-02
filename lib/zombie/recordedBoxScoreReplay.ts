import { scoreStatsWithCategories } from '@/lib/scoring-runtime/categoryMath'
import { normalizeNflWeeklyStats } from '@/lib/scoring-runtime/nflStatNormalization'
import { normalizeCfbdGameStats } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'
import { allowedPositionsForSlot, normalizeToken } from '@/lib/redraft/lineupValidation'
import { buildFullNflScoringConfig } from '@/lib/nfl-scoring/NflScoringPresets'
import { buildFullScoringConfig } from '@/lib/nba-scoring/NbaScoringPresets'
import { buildFullNhlScoringConfig } from '@/lib/nhl-scoring/NhlScoringPresets'
import { buildFullMlbScoringConfig } from '@/lib/mlb-scoring/MlbScoringPresets'
import { buildFullNcaafScoringConfig } from '@/lib/ncaaf-scoring/NcaafScoringPresets'
import { buildFullNcaabScoringConfig } from '@/lib/ncaab-scoring/NcaabScoringPresets'
import { buildFullSoccerScoringConfig } from '@/lib/soccer-scoring/SoccerScoringPresets'
import { scoreDistribution, thresholdAtFrequency } from './sportCalibration'
export type ReplayWindow = { period: number; start: string; end: string }
export type RecordedBox = { player: string; game: string; day: string | null; period: number; position: string | null; source: string | null; seasonType: 'regular' | 'pre' | 'post' | null; stats: unknown; identityResolved?: boolean }
export type ReplayPlayer = { id: string; positions: string[]; periodPoints: Map<number, number>; days: Map<string, number> }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function replayScoringProfile(sport: string) {
  const builders: Record<string, () => Record<string, number>> = { NFL: () => buildFullNflScoringConfig('af_default'), NBA: () => buildFullScoringConfig('af_default'), NHL: () => buildFullNhlScoringConfig('af_default'), MLB: () => buildFullMlbScoringConfig('af_default'), NCAAF: () => buildFullNcaafScoringConfig('af_default'), NCAAB: () => buildFullNcaabScoringConfig('af_default'), SOCCER: () => buildFullSoccerScoringConfig('af_default') }
  const builder = builders[sport]; if (!builder) throw Error('Unsupported replay sport')
  const settings = { sportConfig: { scoringPreset: 'HALF_PPR' }, [`${sport.toLowerCase()}_scoring_config`]: { rules: builder(), source: 'AF_DEFAULT' } }
  const resolved = resolveLeagueScoringRules({ sport, settings }); if (!resolved) throw Error('Scoring configuration missing')
  return { ...resolved, label: 'AF default; half-PPR football; untouched NHL gated-key behavior', settings }
}
export function normalizeRecordedBox(sport: string, raw: unknown) {
  if (sport === 'NFL') return { stats: normalizeNflWeeklyStats(raw), unmappedKeys: [] as string[] }
  if (sport === 'NCAAF') {
    const flat = object(raw)
    if (Object.keys(flat).some(k => k.includes('.'))) return normalizeCfbdGameStats(raw)
    return { stats: normalizeNflWeeklyStats(raw), unmappedKeys: [] as string[] }
  }
  const normalizer = getDailySportNormalizer(sport); if (!normalizer) throw Error('Normalizer missing')
  return normalizer(raw)
}
export function replayPositions(raw: string | null, sport: string): string[] {
  const aliases: Record<string, string> = { GOALKEEPER: 'GKP', GK: 'GKP', DEFENDER: 'DEF', MIDFIELDER: 'MID', FORWARD: sport === 'SOCCER' ? 'FWD' : 'F', 'LEFT WING': 'LW', 'RIGHT WING': 'RW', CENTER: 'C', CENTRE: 'C', DEFENSE: 'D', GOALIE: 'G' }
  return [...new Set(String(raw ?? '').toUpperCase().split(/[\/,;]+/).map(p => aliases[p.trim()] ?? normalizeToken(p)).filter(Boolean))]
}
export function replayBoxScores(sport: string, rows: readonly RecordedBox[], windows: readonly ReplayWindow[], asOf: string) {
  const profile = replayScoringProfile(sport), players = new Map<string, ReplayPlayer>(), reasons: Record<string, number> = {}, unmapped = new Map<string, number>(), seen = new Map<string, string>()
  const observedStatKeys = new Set<string>(), diagnosticScores: number[] = [], complete = windows.filter(w => w.end <= asOf.slice(0, 10)), dayWindows = new Map<string, number>()
  for (const window of complete) for (let date = new Date(`${window.start}T00:00:00Z`); date < new Date(`${window.end}T00:00:00Z`); date = new Date(date.getTime() + 86400000)) {
    const day = date.toISOString().slice(0, 10); if (dayWindows.has(day) && !['NFL','NCAAF'].includes(sport)) throw Error('Overlapping replay windows'); dayWindows.set(day, window.period)
  }
  const reject = (why: string) => { reasons[why] = (reasons[why] ?? 0) + 1 }
  // Stable chronological order prevents future position labels from selecting earlier rosters.
  for (const row of [...rows].sort((a, b) => String(a.day ?? '').localeCompare(String(b.day ?? '')) || a.player.localeCompare(b.player) || a.game.localeCompare(b.game))) {
    if (!row.day || row.day >= asOf.slice(0, 10)) { reject('missing_or_current_day'); continue }
    if (row.seasonType !== 'regular') { reject(row.seasonType === null ? 'season_type_unknown' : `excluded_${row.seasonType}`); continue }
    const key = JSON.stringify([row.player, row.game]), fingerprint = JSON.stringify(row.stats)
    if (seen.has(key)) { if (seen.get(key) !== fingerprint) throw Error('Conflicting canonical player-game rows'); reject('duplicate_player_game'); continue } seen.set(key, fingerprint)
    const normalized = normalizeRecordedBox(sport, row.stats)
    normalized.unmappedKeys.forEach(key => unmapped.set(key, (unmapped.get(key) ?? 0) + 1))
    if (!Object.keys(normalized.stats).length) { reject('unmapped_stat_line'); continue }
    Object.keys(normalized.stats).forEach(key => observedStatKeys.add(key))
    const points = scoreStatsWithCategories(profile.categories, normalized.stats, profile.overrides)
    if (!Number.isFinite(points)) throw Error('Nonfinite replay score')
    diagnosticScores.push(points)
    // Unknown provider identities may be re-scored, but must not masquerade as unique draftable players.
    if (row.identityResolved === false) { reject('identity_unresolved_for_roster'); continue }
    const period = ['NFL','NCAAF'].includes(sport) ? complete.find(w => w.period === row.period && row.day! >= w.start && row.day! < w.end)?.period : dayWindows.get(row.day)
    if (period == null) { reject('outside_verified_completed_period'); continue }
    if (['NFL', 'NCAAF'].includes(sport) && row.period !== period) { reject('provider_period_mismatch'); continue }
    let player = players.get(row.player)
    if (!player) { player = { id: row.player, positions: replayPositions(row.position, sport), periodPoints: new Map(), days: new Map() }; players.set(row.player, player) }
    const newPositions = replayPositions(row.position, sport)
    // Conflicting positions are reported rather than granting the union of two possible identities.
    if (player.positions.join(',') !== newPositions.join(',')) reject('position_changed_or_conflicting')
    player.periodPoints.set(period, (player.periodPoints.get(period) ?? 0) + points)
    player.days.set(row.day, (player.days.get(row.day) ?? 0) + points)
  }
  const observedPeriods = new Set([...players.values()].flatMap(p => [...p.periodPoints.keys()]))
  return { players, windows: complete.filter(w => observedPeriods.has(w.period)), profile, diagnostics: { inputRows: rows.length, normalizedRegularRows: diagnosticScores.length, scoredPlayerGames: scoreDistribution(diagnosticScores), playersInCompletedPeriods: players.size,
    enabledScoringKeysNeverObserved: profile.categories.filter(c => (profile.overrides[c.key] ?? c.defaultPoints) !== 0 && !observedStatKeys.has(c.key)).map(c => c.key),
    missingPositionPlayers: [...players.values()].filter(p => !p.positions.length).length, completedCalendarPeriods: complete.length,
    observedPeriods: observedPeriods.size, unobservedCompletedPeriods: complete.filter(w => !observedPeriods.has(w.period)).map(w => w.period), exclusions: reasons,
    unmappedStatKeys: [...unmapped.entries()].map(([key, rows]) => ({ key, rows })).sort((a, b) => b.rows - a.rows) } }
}
function tieKey(id: string, seed: number): number { let h = 2166136261 ^ seed; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0 }
export function replayRosterModel(args: { sport: string; players: ReadonlyMap<string, ReplayPlayer>; windows: readonly ReplayWindow[]; slots: string[]; bench: number; managers: number; seed: number; trainingPeriods?: number; eligibility?: Record<string, string[]> }) {
  const { sport, players, slots, bench, managers, seed } = args, periods = [...new Set(args.windows.map(w => w.period))].sort((a, b) => a - b), trainingCount = args.trainingPeriods ?? 2
  if (periods.length <= trainingCount) return { status: 'insufficient_completed_periods', testedPeriods: 0, matchups: 0, managers, margins: [] as number[], scores: [] as number[] }
  const training = periods.slice(0, trainingCount), testing = periods.slice(trainingCount)
  const rank = (p: ReplayPlayer) => { const observed = training.filter(period => p.periodPoints.has(period)); return observed.length ? observed.reduce((n, period) => n + p.periodPoints.get(period)!, 0) / observed.length : -Infinity }
  const pool = [...players.values()].filter(p => p.positions.length && training.some(period => p.periodPoints.has(period))).sort((a, b) => rank(b) - rank(a) || tieKey(a.id, seed) - tieKey(b.id, seed))
  const rosters: ReplayPlayer[][] = Array.from({ length: managers }, () => []), chosen = new Set<string>()
  const eligibility = slots.map((slot, index) => ({ slot, index, eligible: args.eligibility?.[slot] ?? allowedPositionsForSlot(sport, slot) })).sort((a, b) => a.eligible.length - b.eligible.length || a.index - b.index)
  let shortfall = 0
  const shortfallBySlot: Record<string, number> = {}
  const trainedEligibleBySlot = Object.fromEntries(eligibility.map(seat => [seat.slot, pool.filter(p => p.positions.some(pos => seat.eligible.includes(pos))).length]))
  for (let round = 0; round < eligibility.length + bench; round++) {
    const eligible = eligibility[round]?.eligible ?? [...new Set(eligibility.flatMap(s => s.eligible))]
    for (let pick = 0; pick < managers; pick++) {
      const team = round % 2 ? managers - 1 - pick : pick
      const player = pool.find(p => !chosen.has(p.id) && p.positions.some(pos => eligible.includes(pos)))
      if (!player) { shortfall++; const slot = eligibility[round]?.slot ?? 'BENCH'; shortfallBySlot[slot] = (shortfallBySlot[slot] ?? 0) + 1; continue } chosen.add(player.id); rosters[team].push(player)
    }
  }
  if (shortfall) return { status: 'roster_pool_or_position_shortfall', shortfall, shortfallBySlot, trainedEligibleBySlot, trainedPlayers: pool.length, managers, testedPeriods: 0, matchups: 0, margins: [] as number[], scores: [] as number[] }
  rosters.forEach(roster => roster.sort((a, b) => rank(b) - rank(a) || tieKey(a.id, seed) - tieKey(b.id, seed)))
  const margins: number[] = [], scores: number[] = []; let availableSeats = 0, totalSeats = 0
  for (const period of testing) {
    const days = args.windows.filter(w => w.period === period).flatMap(w => { const list: string[] = []; for (let d = new Date(`${w.start}T00:00:00Z`); d < new Date(`${w.end}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) list.push(d.toISOString().slice(0, 10)); return list })
    const totals = rosters.map(roster => {
      let total = 0
      const keys = ['NFL', 'NCAAF'].includes(sport) ? [String(period)] : days
      for (const key of keys) {
        const taken = new Set<string>()
        for (const seat of eligibility) {
          totalSeats++
          const player = roster.find(p => !taken.has(p.id) && p.positions.some(pos => seat.eligible.includes(pos)) && (['NFL', 'NCAAF'].includes(sport) ? p.periodPoints.has(period) : p.days.has(key)))
          if (!player) continue
          taken.add(player.id); availableSeats++
          total += ['NFL', 'NCAAF'].includes(sport) ? player.periodPoints.get(period)! : player.days.get(key)!
        }
      }
      return Math.round(total * 100) / 100
    })
    for (let team = 0; team < managers / 2; team++) {
      const left = totals[team], right = totals[managers - 1 - team]
      margins.push(Math.abs(left - right)); scores.push(left, right)
    }
  }
  return { status: 'modeled_rosters_replayed', managers, trainedPlayers: pool.length, testedPeriods: testing.length, matchups: margins.length, availableSeatRate: totalSeats ? availableSeats / totalSeats : null, margins, scores,
    diagnosticsOnly: true, limitation: 'Training-only rankings; appearances are known retrospectively. Missing boxes are not proven DNPs. Modeled rosters and dependent observations cannot certify real leagues.' }
}
export function summarizeRosterReplay(model: ReturnType<typeof replayRosterModel>, currentBash: number, currentMaul: number, targetRate: number) {
  const { margins, scores, ...rest } = model
  const decisive = margins.filter(m => m > 0)
  return { ...rest, scoreDistribution: scoreDistribution(scores), marginDistribution: scoreDistribution(decisive),
    currentBashCrossingRate: decisive.length ? decisive.filter(m => m >= currentBash).length / decisive.length : null,
    currentMaulCrossingRate: decisive.length ? decisive.filter(m => m >= currentMaul).length / decisive.length : null,
    rawMarginFrequencyCandidate: decisive.length && model.testedPeriods >= 6 ? thresholdAtFrequency(decisive, targetRate) : null,
    counterfactualItemStress: decisive.length ? { label: 'Hypothetical NFL-sized bonuses, not non-NFL rules', serum10CouldFlip: decisive.filter(m => m < 10).length / decisive.length, bomb35CouldFlip: decisive.filter(m => m < 35).length / decisive.length } : null,
    acceptedCalibration: false }
}