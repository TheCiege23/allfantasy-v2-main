import type { SGConfig, SGMatchup, SGPeriod, SGTeam } from './types'

export interface SGResolution {
  status: 'resolved' | 'commissioner_required'
  immuneTribeId: string | null
  choppedTeamIds: string[]
  savedTeamIds: string[]
  placements: string[]
  reasons: string[]
}

const failure = (reason: string): SGResolution => ({ status: 'commissioner_required', immuneTribeId: null, choppedTeamIds: [], savedTeamIds: [], placements: [], reasons: [reason] })

function compareLow(a: SGTeam, b: SGTeam): number {
  return a.points - b.points || (a.previousPoints !== null && b.previousPoints !== null ? a.previousPoints - b.previousPoints : 0)
}

/** Weekly points, then previous period. An unresolved boundary is never randomly chopped. */
function selectLowest(teams: SGTeam[], count: number): SGTeam[] | null {
  const sorted = [...teams].sort(compareLow)
  if (sorted.length < count) return null
  if (sorted[count] && compareLow(sorted[count - 1], sorted[count]) === 0) return null
  return sorted.slice(0, count)
}

export function validateSGMatchups(teams: SGTeam[], matchups: SGMatchup[]): string[] {
  const errors: string[] = []
  const byId = new Map(teams.map(team => [team.id, team]))
  const tribes = [...new Set(teams.map(team => team.tribeId))]
  const counts = tribes.map(id => teams.filter(team => team.tribeId === id).length)
  const smallest = Math.min(...counts)
  for (const id of tribes) {
    const members = teams.filter(team => team.tribeId === id)
    if (members.filter(team => !team.sitOut).length !== smallest) errors.push(`Tribe ${id} must field ${smallest} teams and sit out its extra members.`)
  }
  for (const team of teams) {
    if (team.sitOut && team.satOutLastPeriod) errors.push(`${team.id} cannot sit out consecutive periods.`)
  }
  const used = new Set<string>()
  for (const matchup of matchups) {
    const a = byId.get(matchup.team1)
    const b = byId.get(matchup.team2)
    if (!a || !b || a.id === b.id || a.tribeId === b.tribeId || a.sitOut || b.sitOut) {
      errors.push('Every matchup must contain two active, non-sitting teams from different tribes.')
      continue
    }
    if (used.has(a.id) || used.has(b.id)) errors.push('A team can play only one matchup per period.')
    used.add(a.id); used.add(b.id)
  }
  if (teams.some(team => !team.sitOut && !used.has(team.id))) errors.push('Every non-sitting team needs a matchup. The commissioner must resolve an unmatched team.')
  return [...new Set(errors)]
}

/**
 * Pure server-domain calculation. Caller supplies finalized scores and verified, sealed immunity.
 * No persistence, provider calls, vote-based elimination, season-points fallback, or randomness.
 */
export function resolveSGPeriod(args: {
  config: SGConfig; period: SGPeriod; teams: SGTeam[]; matchups?: SGMatchup[]
  protectedTeamIds?: string[]; gauntletImmuneTribeId?: string
}): SGResolution {
  const { config, period, teams, matchups = [], protectedTeamIds = [], gauntletImmuneTribeId } = args
  if (new Set(teams.map(team => team.id)).size !== teams.length || teams.length !== period.teamsEntering) return failure('Active team count or identities do not match the schedule.')
  if (teams.some(team => !Number.isFinite(team.points) || (team.previousPoints !== null && !Number.isFinite(team.previousPoints)))) return failure('Finalized weekly scores are required.')
  if (protectedTeamIds.some(id => !teams.some(team => team.id === id))) return failure('An immunity target is not an active manager.')
  if ((period.mode === 'merged' || period.mode === 'final_three') && protectedTeamIds.length) return failure('All powers expire before the merge.')
  const result: SGResolution = { status: 'resolved', immuneTribeId: null, choppedTeamIds: [], savedTeamIds: [], placements: [], reasons: [] }
  if (period.mode === 'off') return result
  if (period.mode === 'final_three') {
    if (teams.length !== 3) return failure('Exactly three managers must enter the finale.')
    const ranked = [...teams].sort((a, b) => compareLow(b, a))
    if (ranked.some((team, i) => i > 0 && compareLow(team, ranked[i - 1]) === 0)) return failure('Final placement tie requires commissioner resolution.')
    result.placements = ranked.map(team => team.id)
    return result
  }
  const tribes = [...new Set(teams.map(team => team.tribeId))]
  if (period.mode === 'gauntlet') {
    if (tribes.length !== 2 || teams.filter(team => team.tribeId === tribes[0]).length !== teams.length / 2) return failure('The Gauntlet requires two equal tribes.')
    if (config.gauntletTribeImmunity) {
      if (!gauntletImmuneTribeId || !tribes.includes(gauntletImmuneTribeId)) return failure('Commissioner must resolve the configured Gauntlet tribe immunity.')
      result.immuneTribeId = gauntletImmuneTribeId
    }
  }
  if (period.mode === 'match_play' || period.mode === 'tribe_champion') {
    if (tribes.length < 2 || tribes.length > 4) return failure('Tribal competition requires two to four tribes.')
    const metrics = new Map(tribes.map(id => [id, 0]))
    if (period.mode === 'match_play') {
      const errors = validateSGMatchups(teams, matchups)
      if (errors.length) return failure(errors.join(' '))
      for (const matchup of matchups) {
        const a = teams.find(team => team.id === matchup.team1)!
        const b = teams.find(team => team.id === matchup.team2)!
        const comparison = compareLow(a, b)
        if (!comparison) return failure('A tied individual matchup requires commissioner resolution.')
        const winner = comparison > 0 ? a : b
        metrics.set(winner.tribeId, metrics.get(winner.tribeId)! + 1)
      }
    } else {
      for (const id of tribes) {
        const champions = teams.filter(team => team.tribeId === id && team.champion)
        if (champions.length !== 1) return failure(`Tribe ${id} must submit exactly one champion.`)
        metrics.set(id, champions[0].points)
      }
    }
    const highest = Math.max(...metrics.values())
    const tied = tribes.filter(id => metrics.get(id) === highest)
    if (tied.length === 1) result.immuneTribeId = tied[0]
    else {
      // Screenshot rule: the tribe containing the lower weekly scorer loses the tie.
      const floors = tied.map(id => ({ id, floor: [...teams.filter(team => team.tribeId === id)].sort(compareLow)[0] }))
        .sort((a, b) => compareLow(b.floor, a.floor))
      if (compareLow(floors[0].floor, floors[1].floor) === 0) return failure('Tribe contest remains tied after weekly and previous-week scores.')
      result.immuneTribeId = floors[0].id
    }
  }
  const unprotected = teams.filter(team => team.tribeId !== result.immuneTribeId)
  const protectedIds = new Set(protectedTeamIds)
  const groups = period.mode === 'gauntlet' && config.gauntletElimination === 'per_tribe' && !result.immuneTribeId
    ? tribes.map(id => unprotected.filter(team => team.tribeId === id)) : [unprotected]
  for (const group of groups) {
    const count = groups.length === 2 ? 1 : period.chops
    const eligible = group.filter(team => !protectedIds.has(team.id))
    const chopped = selectLowest(eligible, count)
    if (!chopped) return failure('Insufficient unprotected teams or an unresolved elimination tie; commissioner resolution required.')
    result.choppedTeamIds.push(...chopped.map(team => team.id))
    // Only immunity above the actual chop line appears as a save in the ceremony.
    const line = [...chopped].sort(compareLow).at(-1)!
    result.savedTeamIds.push(...group.filter(team => protectedIds.has(team.id) && compareLow(team, line) <= 0).map(team => team.id))
  }
  result.reasons.push(period.mode === 'gauntlet' ? 'Gauntlet: two managers chopped.' : 'Lowest eligible weekly scorer chopped; previous-week score breaks ties.')
  return result
}

export function gauntletPickCaptain(pickIndex: number, format: SGConfig['gauntletDraft']): 0 | 1 | null {
  if (!Number.isInteger(pickIndex) || pickIndex < 0) throw new Error('Pick index must be a nonnegative integer.')
  if (format === 'commissioner') return null
  return (format === 'snake' ? [0, 1, 1, 0][pickIndex % 4] : pickIndex % 2) as 0 | 1
}
