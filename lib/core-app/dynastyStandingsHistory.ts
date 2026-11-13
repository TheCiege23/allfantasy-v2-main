/**
 * The Dynasty table on /core's Standings: every franchise's record across the seasons this league has on
 * file, its titles, and — only where they are stored — runner-up finishes and playoff trips. Pure; the
 * reads are in `dynastyStandingsHistoryLoader.ts`.
 *
 * ⚠ NOTHING HERE IS ESTIMATED OR INFERRED FROM A NAME. Every figure is a sum of stored rows:
 *   - `league_seasons.teamRecords` — one row per team per season (the Sleeper history walk,
 *     `lib/league/syncLeagueHistory.ts`; the native season archive, `RedraftOffseasonService`; the
 *     commissioner renewal snapshot);
 *   - `dw_season_standing_facts` (`SeasonStandingFact`) — the other providers' historical backfills,
 *     used only for a season that has no `teamRecords`, so a season is never counted twice;
 *   - `league_championships` and `league_seasons.championTeamId` / the `isChampion` flag — titles.
 *
 * 🛑 FRANCHISE IDENTITY ACROSS SEASONS IS A STORED KEY, NEVER A NAME. `computeAllTimeStandings` in
 * `lib/league/history-aggregates.ts` groups by lower-cased manager NAME, which merges two managers who
 * share a display name and splits one manager who renamed. This module does not use it. A team-season
 * row is attached to a franchise by, in order:
 *   1. its owner's user id (`ownerId` / `managerUserId` — a Sleeper user id or an AllFantasy user id);
 *   2. its `LeagueTeam` id (`franchiseId` / `teamId` — the native archive and renewal snapshot);
 *   3. its provider team key (`LeagueTeam.externalId`) — only when a `LeagueTeam` with that key exists.
 * Those keys are then joined through the league's `LeagueTeam` rows, each of which carries a team id, a
 * provider team key, a provider user id and the AllFantasy user who claimed it — so an imported season
 * keyed by Sleeper user id and a native season keyed by AllFantasy user id land on one franchise. A user
 * id that sits on more than one `LeagueTeam` (one account holding two teams) is NOT used as a join: it
 * cannot say which of the two a row belongs to. A row with none of the three keys is not guessed at; it
 * is counted in `unmatchedRows` and left out.
 */
import type { ChampionRafters } from '@/lib/league/dynastyHomeExtras'

export type DynastySeasonInput = {
  season: number
  /** `league_seasons.status` — 'complete' for a finished season; anything else is still being played. */
  status: string | null
  teamRecords: unknown
  championName: string | null
  championTeamId: string | null
}

type DynastyChampionshipInput = { season: number; championUserId: string; teamName: string | null }

export type DynastyTeamInput = {
  id: string
  externalId: string | null
  platformUserId: string | null
  claimedByUserId: string | null
  teamName: string | null
  ownerName: string | null
}

type DynastyStandingFactInput = {
  season: number
  /** The provider's team key — `LeagueTeam.externalId` (see `loadSeasonHistory` in leagueStandings.ts). */
  teamId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

export type DynastyFranchiseRow = {
  key: string
  /** The franchise's current team name when it still has a team in the league; else its latest on file. */
  name: string
  /** The manager on its latest season, when that differs from the name. */
  manager: string | null
  isYou: boolean
  /** Seasons with a stored record for this franchise, oldest first. */
  seasons: number[]
  wins: number
  losses: number
  ties: number
  /** (W + ½T) / games; null with no games. */
  winPct: number | null
  /** Null when any counted season is missing its points — a partial sum would read as a total. */
  pointsFor: number | null
  titles: number
  titleSeasons: number[]
  /** Null when the league stores no runner-up finishes at all. */
  runnerUps: number | null
  /** Null unless every season on file records playoff seeds. */
  playoffs: number | null
}

export type DynastyStandingsHistory = {
  rafters: ChampionRafters | null
  franchises: DynastyFranchiseRow[]
  /** Seasons whose per-team records are on file (and were played), oldest first. */
  recordSeasons: number[]
  /** The latest record season when it is not finished yet — its games so far are in the totals. */
  inProgressSeason: number | null
  /** Seasons with a champion on file but no per-team records, oldest first. */
  titleOnlySeasons: number[]
  /** Champions on file that no stored key ties to a franchise (a name only). Not counted in the table. */
  unattributedTitles: Array<{ season: number; name: string | null }>
  /** Team-season rows with no stored owner or team key, left out rather than matched by name. */
  unmatchedRows: number
  hasRunnerUps: boolean
  hasPlayoffs: boolean
  /** 'records' draws the table; 'titles-only' draws titles with the reason; 'empty' draws the reason. */
  status: 'records' | 'titles-only' | 'empty'
}

type Rec = Record<string, unknown>

const str = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t !== '0' && t.toLowerCase() !== 'null' ? t : null
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown): number => {
  const n = num(v)
  return n != null && n > 0 ? Math.round(n) : 0
}

/** Minimal union-find over string keys. */
class Links {
  private parent = new Map<string, string>()
  find(k: string): string {
    const first = this.parent.get(k)
    if (first == null) {
      this.parent.set(k, k)
      return k
    }
    // Typed explicitly: inferred, `p` and `gp` reference each other and tsc gives up (TS7022).
    let p: string = first
    while (p !== k) {
      // Every value in `parent` is itself a key (union only links roots `find` already registered).
      const gp: string = this.parent.get(p) ?? p
      this.parent.set(k, gp)
      k = p
      p = gp
    }
    return k
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra)
  }
}

type Row = {
  season: number
  key: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number | null
  teamName: string | null
  managerName: string | null
  isChampion: boolean
  isRunnerUp: boolean
  playoffSeed: number | null
}

export function buildDynastyStandingsHistory(input: {
  seasons: DynastySeasonInput[]
  championships: DynastyChampionshipInput[]
  teams: DynastyTeamInput[]
  standingFacts: DynastyStandingFactInput[]
  viewerUserId: string | null
  rafters: ChampionRafters | null
}): DynastyStandingsHistory {
  const links = new Links()
  const teamById = new Map(input.teams.map((t) => [t.id, t]))
  const externalIds = new Set(input.teams.map((t) => str(t.externalId)).filter((x): x is string => !!x))

  /* A user id on two teams cannot join anything — count first, then link only the unique ones. */
  const userTeams = new Map<string, number>()
  for (const t of input.teams) {
    for (const id of new Set([str(t.platformUserId), str(t.claimedByUserId)])) {
      if (id) userTeams.set(id, (userTeams.get(id) ?? 0) + 1)
    }
  }
  for (const t of input.teams) {
    const node = `lt:${t.id}`
    links.find(node)
    const ext = str(t.externalId)
    if (ext) links.union(node, `x:${ext}`)
    for (const id of [str(t.platformUserId), str(t.claimedByUserId)]) {
      if (id && userTeams.get(id) === 1) links.union(node, `u:${id}`)
    }
  }

  const keyOf = (r: Rec): string | null => {
    const owner = str(r.ownerId) ?? str(r.managerUserId)
    if (owner) return `u:${owner}`
    const team = str(r.franchiseId) ?? str(r.teamId) ?? str(r.team_id)
    if (team) return `lt:${team}`
    const ext = str(r.rosterId)
    if (ext && externalIds.has(ext)) return `x:${ext}`
    return null
  }

  // ── Per-team season rows ─────────────────────────────────────────────
  const rows: Row[] = []
  const recordSeasonSet = new Set<number>()
  const seasonStatus = new Map<number, string | null>()
  const seededSeasons = new Set<number>()
  const runnerUpSeasons = new Set<number>()
  for (const s of input.seasons) {
    if (!Number.isInteger(s.season)) continue
    seasonStatus.set(s.season, s.status)
    const recs = Array.isArray(s.teamRecords)
      ? (s.teamRecords.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Rec[])
      : []
    const parsed: Row[] = recs.map((r) => ({
      season: s.season,
      key: keyOf(r),
      wins: int(r.wins),
      losses: int(r.losses),
      ties: int(r.ties),
      pointsFor: num(r.pointsFor),
      teamName: str(r.teamName) ?? str(r.franchiseName),
      managerName: str(r.managerName) ?? str(r.ownerName),
      isChampion: r.isChampion === true,
      isRunnerUp: r.isRunnerUp === true,
      playoffSeed: num(r.playoffSeed),
    }))
    /* A season nobody has a game or a point in has not been played, whatever its row says. */
    if (!parsed.some((r) => r.wins + r.losses + r.ties > 0 || (r.pointsFor ?? 0) > 0)) continue
    recordSeasonSet.add(s.season)
    if (parsed.some((r) => r.isRunnerUp)) runnerUpSeasons.add(s.season)
    if (parsed.some((r) => r.playoffSeed != null)) seededSeasons.add(s.season)
    rows.push(...parsed)
  }

  /* Other providers' backfills — only for a season with no teamRecords, never on top of one. */
  const factsBySeason = new Map<number, DynastyStandingFactInput[]>()
  for (const f of input.standingFacts) {
    if (!Number.isInteger(f.season) || recordSeasonSet.has(f.season)) continue
    const b = factsBySeason.get(f.season)
    if (b) b.push(f)
    else factsBySeason.set(f.season, [f])
  }
  for (const [season, facts] of factsBySeason) {
    if (!facts.some((f) => f.wins + f.losses + f.ties > 0 || f.pointsFor > 0)) continue
    recordSeasonSet.add(season)
    for (const f of facts) {
      const ext = str(f.teamId)
      rows.push({
        season,
        key: ext && externalIds.has(ext) ? `x:${ext}` : null,
        wins: int(f.wins),
        losses: int(f.losses),
        ties: int(f.ties),
        pointsFor: num(f.pointsFor),
        teamName: null,
        managerName: null,
        isChampion: false,
        isRunnerUp: false,
        playoffSeed: null,
      })
    }
  }

  // ── Fold into franchises ─────────────────────────────────────────────
  type Acc = {
    root: string
    seasons: Set<number>
    wins: number
    losses: number
    ties: number
    pf: number
    pfComplete: boolean
    latest: { season: number; teamName: string | null; managerName: string | null } | null
    titles: Set<number>
    runnerUps: number
    playoffs: number
  }
  const acc = new Map<string, Acc>()
  const get = (root: string): Acc => {
    let a = acc.get(root)
    if (!a) {
      a = { root, seasons: new Set(), wins: 0, losses: 0, ties: 0, pf: 0, pfComplete: true, latest: null, titles: new Set(), runnerUps: 0, playoffs: 0 }
      acc.set(root, a)
    }
    return a
  }
  let unmatchedRows = 0
  const titleBySeason = new Map<number, string>()
  for (const r of rows) {
    if (!r.key) {
      unmatchedRows += 1
      continue
    }
    const a = get(links.find(r.key))
    /* Two rows of one season on one franchise means the join is wrong for this season — drop, do not add. */
    if (a.seasons.has(r.season)) {
      unmatchedRows += 1
      continue
    }
    a.seasons.add(r.season)
    a.wins += r.wins
    a.losses += r.losses
    a.ties += r.ties
    if (r.pointsFor == null) a.pfComplete = false
    else a.pf += r.pointsFor
    if (r.isRunnerUp) a.runnerUps += 1
    if (r.playoffSeed != null) a.playoffs += 1
    if (!a.latest || r.season > a.latest.season) a.latest = { season: r.season, teamName: r.teamName, managerName: r.managerName }
    if (r.isChampion) titleBySeason.set(r.season, a.root)
  }

  // ── Titles: league_championships first (it names a user), then the season's own champion ───────
  const unattributedTitles: DynastyStandingsHistory['unattributedTitles'] = []
  const titleOnlyName = new Map<string, string | null>()
  for (const c of input.championships) {
    const id = str(c.championUserId)
    if (!Number.isInteger(c.season) || !id) continue
    const root = links.find(`u:${id}`)
    titleBySeason.set(c.season, root)
    if (!acc.has(root)) titleOnlyName.set(root, str(c.teamName))
  }
  for (const s of input.seasons) {
    if (!Number.isInteger(s.season) || titleBySeason.has(s.season)) continue
    const teamId = str(s.championTeamId)
    if (teamId && teamById.has(teamId)) {
      const root = links.find(`lt:${teamId}`)
      titleBySeason.set(s.season, root)
      if (!acc.has(root)) titleOnlyName.set(root, str(teamById.get(teamId)!.teamName) ?? str(s.championName))
    } else if (str(s.championName)) {
      unattributedTitles.push({ season: s.season, name: str(s.championName) })
    }
  }
  for (const [season, root] of titleBySeason) get(root).titles.add(season)

  // ── Rows for the table ───────────────────────────────────────────────
  const teamsByRoot = new Map<string, DynastyTeamInput[]>()
  for (const t of input.teams) {
    const root = links.find(`lt:${t.id}`)
    const b = teamsByRoot.get(root)
    if (b) b.push(t)
    else teamsByRoot.set(root, [t])
  }
  const viewer = str(input.viewerUserId)
  const viewerRoot = viewer ? links.find(`u:${viewer}`) : null
  const hasRunnerUps = runnerUpSeasons.size > 0
  const recordSeasons = [...recordSeasonSet].sort((a, b) => a - b)
  const hasPlayoffs = recordSeasons.length > 0 && recordSeasons.every((s) => seededSeasons.has(s))

  const franchises: DynastyFranchiseRow[] = [...acc.values()].map((a) => {
    const current = teamsByRoot.get(a.root) ?? []
    const currentName = current.map((t) => str(t.teamName)).find(Boolean) ?? null
    const latestName = a.latest ? (a.latest.teamName ?? a.latest.managerName) : null
    const name = currentName ?? latestName ?? titleOnlyName.get(a.root) ?? current.map((t) => str(t.ownerName)).find(Boolean) ?? '—'
    const managerRaw = a.latest?.managerName ?? current.map((t) => str(t.ownerName)).find(Boolean) ?? null
    const games = a.wins + a.losses + a.ties
    return {
      key: a.root,
      name,
      manager: managerRaw && managerRaw !== name ? managerRaw : null,
      isYou: (viewerRoot != null && a.root === viewerRoot) || (!!viewer && current.some((t) => str(t.claimedByUserId) === viewer)),
      seasons: [...a.seasons].sort((x, y) => x - y),
      wins: a.wins,
      losses: a.losses,
      ties: a.ties,
      winPct: games > 0 ? (a.wins + a.ties / 2) / games : null,
      pointsFor: a.seasons.size > 0 && a.pfComplete ? a.pf : null,
      titles: a.titles.size,
      titleSeasons: [...a.titles].sort((x, y) => x - y),
      runnerUps: hasRunnerUps ? a.runnerUps : null,
      playoffs: hasPlayoffs ? a.playoffs : null,
    }
  })
  franchises.sort(compareFranchises)

  const latestRecord = recordSeasons[recordSeasons.length - 1]
  const inProgressSeason =
    latestRecord != null && String(seasonStatus.get(latestRecord) ?? 'complete').toLowerCase() !== 'complete' && seasonStatus.has(latestRecord)
      ? latestRecord
      : null
  const titleSeasons = new Set<number>([...titleBySeason.keys(), ...unattributedTitles.map((t) => t.season)])
  const titleOnlySeasons = [...titleSeasons].filter((s) => !recordSeasonSet.has(s)).sort((a, b) => a - b)
  const anyRecords = franchises.some((f) => f.seasons.length > 0)

  return {
    rafters: input.rafters,
    franchises,
    recordSeasons,
    inProgressSeason,
    titleOnlySeasons,
    unattributedTitles: unattributedTitles.sort((a, b) => a.season - b.season),
    unmatchedRows,
    hasRunnerUps,
    hasPlayoffs,
    status: anyRecords ? 'records' : franchises.length > 0 || unattributedTitles.length > 0 || input.rafters ? 'titles-only' : 'empty',
  }
}

/** Titles, then all-time win %, then wins, then name — the order the table opens in. */
function compareFranchises(a: DynastyFranchiseRow, b: DynastyFranchiseRow): number {
  return (
    b.titles - a.titles ||
    (b.winPct ?? -1) - (a.winPct ?? -1) ||
    b.wins - a.wins ||
    a.name.localeCompare(b.name)
  )
}

export type DynastySortKey = 'titles' | 'winPct' | 'wins' | 'pointsFor' | 'seasons'

/** A column sort; ties fall back to the default order so the table never reshuffles arbitrarily. */
export function sortFranchises(rows: DynastyFranchiseRow[], key: DynastySortKey): DynastyFranchiseRow[] {
  const val = (r: DynastyFranchiseRow): number =>
    key === 'titles' ? r.titles : key === 'winPct' ? (r.winPct ?? -1) : key === 'wins' ? r.wins : key === 'pointsFor' ? (r.pointsFor ?? -1) : r.seasons.length
  return [...rows].sort((a, b) => val(b) - val(a) || compareFranchises(a, b))
}
