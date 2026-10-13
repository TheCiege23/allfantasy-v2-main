/**
 * ALL-TIME STANDINGS: every manager's record across every season this league has on file.
 *
 * Reads `LeagueSeason.teamRecords`, which two writers fill in two shapes:
 *   - an imported (Sleeper) season — `ownerId`, `managerName`, `isChampion` / `isRunnerUp`;
 *   - a native AllFantasy season, written when the season is archived (RedraftOffseasonService) —
 *     `managerUserId`, `franchiseId`, `franchiseName`, `rank`, no champion flags (the champion is the
 *     season row's `championTeamId` / `championName`).
 * plus, for a native league, the season being played now, read live from its rosters.
 *
 * ⚠ A MANAGER IS KEYED BY OWNER ID, NOT BY NAME. The older aggregator (history-aggregates.ts) keyed on
 * the display name, so a manager who renamed became two people, and two managers sharing a name became
 * one. The owner id (Sleeper user id, or the AllFantasy user id on a native season) is stable; the name
 * shown is the most recent one. A record with no owner id falls back to its name.
 *
 * Pure: the database half is lib/league/allTimeStandingsServer.ts.
 */
import type { ManagerAllTime } from './history-aggregates'

export type StandingsSeasonInput = {
  season: number
  championTeamId?: string | null
  championName?: string | null
  runnerUpName?: string | null
  teamRecords: unknown
  /** The season being played now: counts toward the record, cannot count a title. */
  inProgress?: boolean
}

export type AllTimeStandingRow = ManagerAllTime & {
  teamName: string | null
  totalPointsAgainst: number
  /** Adds, claims and trades made on AllFantasy in this league; null when the league has none on file. */
  moves: number | null
  /** League chat messages posted on AllFantasy; null when the league has none on file. */
  messages: number | null
}

type Rec = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function nameKey(name: string): string {
  return `name:${name.trim().toLowerCase()}`
}

/** The key a record belongs to. `aliases` maps one id onto another (e.g. an AllFantasy user to a Sleeper id). */
export function managerKeyOf(record: Rec, aliases?: ReadonlyMap<string, string>): string {
  const id = str(record.ownerId) ?? str(record.managerUserId)
  if (id) return aliases?.get(id) ?? id
  return nameKey(str(record.managerName) ?? str(record.franchiseName) ?? str(record.rosterId) ?? 'unknown')
}

function finishLabel(rank: number): string {
  const mod100 = rank % 100
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th'
  return `${rank}${suffix}`
}

export function computeAllTimeStandingsByOwner(input: {
  seasons: StandingsSeasonInput[]
  aliases?: ReadonlyMap<string, string>
  moves?: ReadonlyMap<string, number> | null
  messages?: ReadonlyMap<string, number> | null
}): AllTimeStandingRow[] {
  type Acc = {
    name: string
    nameSeason: number
    avatar: string | null
    teamName: string | null
    years: Set<number>
    w: number
    l: number
    t: number
    pf: number
    pa: number
    titles: number
    runnerUps: number
    bestRank: number | null
  }
  const acc = new Map<string, Acc>()

  for (const s of [...input.seasons].sort((a, b) => a.season - b.season)) {
    const records = Array.isArray(s.teamRecords) ? (s.teamRecords as Rec[]).filter((r) => r && typeof r === 'object') : []
    for (const r of records) {
      const key = managerKeyOf(r, input.aliases)
      const name = str(r.managerName) ?? str(r.franchiseName) ?? 'Unknown'
      const cur =
        acc.get(key) ??
        ({ name, nameSeason: -1, avatar: null, teamName: null, years: new Set(), w: 0, l: 0, t: 0, pf: 0, pa: 0, titles: 0, runnerUps: 0, bestRank: null } as Acc)
      if (s.season >= cur.nameSeason) {
        cur.name = name
        cur.nameSeason = s.season
        cur.avatar = str(r.managerAvatar) ?? cur.avatar
        cur.teamName = str(r.teamName) ?? str(r.franchiseName) ?? cur.teamName
      }
      cur.years.add(s.season)
      cur.w += num(r.wins)
      cur.l += num(r.losses)
      cur.t += num(r.ties)
      cur.pf += num(r.pointsFor)
      cur.pa += num(r.pointsAgainst)

      if (!s.inProgress) {
        const teamName = str(r.franchiseName) ?? str(r.teamName)
        const champion =
          r.isChampion === true ||
          (r.isChampion === undefined &&
            ((s.championTeamId && str(r.franchiseId) === s.championTeamId) ||
              (!s.championTeamId && s.championName && (teamName === s.championName || name === s.championName))))
        const runnerUp =
          r.isRunnerUp === true ||
          (r.isRunnerUp === undefined && Boolean(s.runnerUpName) && (teamName === s.runnerUpName || name === s.runnerUpName))
        if (champion) cur.titles += 1
        else if (runnerUp) cur.runnerUps += 1
        // A real finish only: the native rank, or the imported title flags. Never estimated from wins.
        const rank = champion ? 1 : runnerUp ? 2 : Number.isInteger(r.rank) && num(r.rank) > 0 ? num(r.rank) : null
        if (rank != null) cur.bestRank = cur.bestRank == null ? rank : Math.min(cur.bestRank, rank)
      }
      acc.set(key, cur)
    }
  }

  const rows: AllTimeStandingRow[] = [...acc.entries()].map(([key, v]) => {
    const years = [...v.years].sort((a, b) => a - b)
    const games = v.w + v.l + v.t
    const round2 = (n: number) => Math.round(n * 100) / 100
    return {
      managerKey: key,
      managerName: v.name,
      managerAvatar: v.avatar,
      teamName: v.teamName,
      seasonsPlayed: years.length,
      years,
      yearRange: years.length ? (years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`) : '—',
      totalWins: v.w,
      totalLosses: v.l,
      totalTies: v.t,
      // A tie is half a win, the usual fantasy convention.
      winPct: games > 0 ? (v.w + v.t / 2) / games : 0,
      totalPoints: round2(v.pf),
      totalPointsAgainst: round2(v.pa),
      avgPointsPerSeason: years.length ? round2(v.pf / years.length) : 0,
      championships: v.titles,
      runnerUps: v.runnerUps,
      bestFinish: v.bestRank != null ? finishLabel(v.bestRank) : '—',
      moves: input.moves ? input.moves.get(key) ?? 0 : null,
      messages: input.messages ? input.messages.get(key) ?? 0 : null,
    }
  })

  rows.sort(
    (a, b) =>
      b.winPct - a.winPct ||
      b.championships - a.championships ||
      b.totalWins - a.totalWins ||
      b.totalPoints - a.totalPoints ||
      a.managerName.localeCompare(b.managerName),
  )
  return rows
}
