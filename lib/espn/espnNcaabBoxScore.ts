export type EspnCollegeBoxPlayer = { espnId: string; teamId: string; didNotPlay: boolean; stats: Record<string, number> | null }
export type EspnCollegeBoxScore = { eventId: string; status: 'scheduled' | 'live' | 'final' | 'unknown'; players: EspnCollegeBoxPlayer[]; rejected: number; complete: boolean }
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}
const number = (v: unknown): number | null => typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

/** Parse a game by provider IDs and measured labels; reject partial lines rather than invent zeros. */
export function parseEspnCollegeBoxScore(body: unknown, eventId: string): EspnCollegeBoxScore {
  if (!/^\d+$/.test(eventId)) throw new Error('Invalid ESPN event ID')
  const data = obj(body)
  const header = obj(data.header)
  if (header.id != null && String(header.id) !== eventId) throw new Error('ESPN event ID mismatch')
  const state = obj(obj((Array.isArray(header.competitions) ? header.competitions : [])[0]).status).type?.state
  const status = state === 'post' ? 'final' : state === 'in' ? 'live' : state === 'pre' ? 'scheduled' : 'unknown'
  const teams = obj(data.boxscore).players
  const players: EspnCollegeBoxPlayer[] = []
  let rejected = 0
  const seen = new Set<string>()
  const validTeams = new Set<string>()
  const aliases: Record<string, string> = { PTS: 'pts', REB: 'reb', AST: 'ast', TO: 'to', STL: 'stl', BLK: 'blk' }
  for (const rawTeam of Array.isArray(teams) ? teams : []) {
    const team = obj(rawTeam)
    const teamId = String(obj(team.team).id ?? '')
    if (!/^\d+$/.test(teamId) || validTeams.has(teamId)) { rejected++; continue }
    validTeams.add(teamId)
    const groups = Array.isArray(team.statistics) ? team.statistics : []
    if (groups.length !== 1) { rejected++; continue }
    const group = obj(groups[0])
    const labels = Array.isArray(group.labels) ? group.labels.map(String) : []
    const required = [...Object.keys(aliases), '3PT']
    if (required.some((label) => labels.filter((x: string) => x === label).length !== 1) || !Array.isArray(group.athletes)) { rejected++; continue }
    for (const raw of group.athletes) {
      const line = obj(raw)
      const espnId = String(obj(line.athlete).id ?? '')
      if (!/^\d+$/.test(espnId) || seen.has(espnId)) { rejected++; continue }
      seen.add(espnId)
      if (line.didNotPlay === true) { players.push({ espnId, teamId, didNotPlay: true, stats: null }); continue }
      if (!Array.isArray(line.stats)) { rejected++; continue }
      const stats: Record<string, number> = {}
      let valid = true
      for (const [label, key] of Object.entries(aliases)) {
        const value = number(line.stats[labels.indexOf(label)])
        if (value == null) { valid = false; break }
        stats[key] = value
      }
      const three = String(line.stats[labels.indexOf('3PT')] ?? '').match(/^(\d+)-(\d+)$/)
      if (!three || Number(three[1]) > Number(three[2])) valid = false
      if (!valid) { rejected++; continue }
      stats.threes = Number(three![1])
      players.push({ espnId, teamId, didNotPlay: false, stats })
    }
  }
  return { eventId, status, players, rejected, complete: validTeams.size === 2 && rejected === 0 && players.length > 0 }
}
