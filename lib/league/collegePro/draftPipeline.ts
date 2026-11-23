import type { PipelinePick } from './pipeline'

/**
 * The whole league's draft pipeline for one draft year, franchise by franchise — what the
 * commissioner needs to run the offseason, and what each manager is told when their college player
 * is drafted. `pipeline.ts` answers the same question for ONE viewer; this answers it for everyone.
 *
 * Pure. Players are tied to picks by athlete id only (CFBD for football, ESPN for basketball), each
 * reached through `PlayerIdentityMap` by the caller — never by name.
 */

export type DraftedPlayer = {
  fantraxId: string
  athleteId: string
  name: string
  position: string
  /** The pro team that drafted him ("NYJ", "Lakers"). */
  proTeam: string
  round: number
  pick: number
  overall: number
}

export type FranchiseMoveUp = {
  /** The college team that held him. */
  collegeKey: string
  collegeName: string
  /** The pro team he moves to, through the pair's team map. Null when the map has no match yet. */
  proKey: string | null
  proName: string | null
  players: DraftedPlayer[]
}

export type RookiePoolPlayer = { athleteId: string; name: string; position: string; proTeam: string; college: string | null; round: number; pick: number; overall: number }

export type DraftPipelineReport = {
  year: number
  /** Franchises with at least one drafted college player, best pick first. */
  movingUp: FranchiseMoveUp[]
  /** Drafted players no college team in the league held: the rookie draft's pool, in draft order. */
  rookiePool: RookiePoolPlayer[]
  /** Picks the store could not tie to an athlete id: reported, never guessed. */
  unlinked: number
}

export function buildDraftPipelineReport(args: {
  year: number
  picks: readonly PipelinePick[]
  /** Every player on a college roster in the league, with the college team that holds him. */
  collegeRoster: ReadonlyArray<{ fantraxId: string; teamName: string }>
  /** Fantrax id -> athlete id; null when the id resolved to two different athletes (left out). */
  athleteIdOf: ReadonlyMap<string, string | null>
  collegeTeams: ReadonlyArray<{ key: string; name: string }>
  proTeams: ReadonlyArray<{ key: string; name: string }>
  /** Pro team key -> college team key. */
  map: Readonly<Record<string, string>>
  unlinked?: number
}): DraftPipelineReport {
  const pickOf = new Map(args.picks.map((p) => [p.collegeAthleteId, p]))
  const collegeKeyByName = new Map(args.collegeTeams.map((t) => [t.name.trim().toLowerCase(), t]))
  const proByCollegeKey = new Map(Object.entries(args.map).map(([pro, college]) => [college, pro]))
  const proName = new Map(args.proTeams.map((t) => [t.key, t.name]))

  const held = new Set<string>()
  const byTeam = new Map<string, FranchiseMoveUp>()
  for (const row of args.collegeRoster) {
    const athleteId = args.athleteIdOf.get(row.fantraxId)
    if (!athleteId) continue
    held.add(athleteId)
    const pick = pickOf.get(athleteId)
    const team = collegeKeyByName.get(row.teamName.trim().toLowerCase())
    if (!pick || !team) continue
    const entry =
      byTeam.get(team.key) ??
      (() => {
        const proKey = proByCollegeKey.get(team.key) ?? null
        const created: FranchiseMoveUp = { collegeKey: team.key, collegeName: team.name, proKey, proName: proKey ? proName.get(proKey) ?? null : null, players: [] }
        byTeam.set(team.key, created)
        return created
      })()
    if (entry.players.some((p) => p.athleteId === athleteId)) continue
    entry.players.push({
      fantraxId: row.fantraxId,
      athleteId,
      name: pick.name,
      position: pick.position,
      proTeam: pick.nflTeam,
      round: pick.round,
      pick: pick.pick,
      overall: pick.overall,
    })
  }

  const movingUp = [...byTeam.values()]
    .map((f) => ({ ...f, players: [...f.players].sort((a, b) => a.overall - b.overall) }))
    .sort((a, b) => a.players[0]!.overall - b.players[0]!.overall)
  const rookiePool = args.picks
    .filter((p) => !held.has(p.collegeAthleteId))
    .map((p) => ({ athleteId: p.collegeAthleteId, name: p.name, position: p.position, proTeam: p.nflTeam, college: p.college ?? null, round: p.round, pick: p.pick, overall: p.overall }))
    .sort((a, b) => a.overall - b.overall)
  return { year: args.year, movingUp, rookiePool, unlinked: args.unlinked ?? 0 }
}
