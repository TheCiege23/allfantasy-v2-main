import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * sleeperLeagueHistoryService — slice 3 of the Broadcast Deck league redesign.
 *
 * Walks a Sleeper league's FULL `previous_league_id` chain (every season since
 * the league was created) live from the public read-only API and builds the
 * Legacy payload: per-season champion / runner-up / top scorer / standings /
 * draft results, plus the cross-season all-time manager table.
 *
 * Design constraints (deliberate):
 *  - NO new schema. Results cache in the existing `SportsDataCache` JSON table
 *    (same infra the Sleeper import uses), TTL below; stale cache is served on
 *    upstream failure with `staleAsOf` set, never silently.
 *  - Honesty: every season carries a `missing` list naming exactly which pieces
 *    could not be fetched (bracket, draft, users…) — the UI renders absence,
 *    never invents. Head-to-head/manager-vs-manager scoring needs per-week
 *    matchup ingestion (~18 fetches per season) and is intentionally NOT part
 *    of this payload — `deepSync: false` says so.
 */

const SLEEPER = 'https://api.sleeper.app/v1'
const CACHE_PREFIX = 'league-history:v1:'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const MAX_CHAIN = 12

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ── Wire types (subset of Sleeper responses we consume) ──────────────────────
type SleeperLeague = {
  league_id: string
  name: string
  season: string
  status: string
  total_rosters: number
  previous_league_id: string | null
  metadata?: { latest_league_winner_roster_id?: string | null } | null
}
type SleeperUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}
type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
  } | null
}
type SleeperBracketNode = { r: number; m: number; w?: number | null; l?: number | null; p?: number | null }
type SleeperDraft = { draft_id: string; status: string; settings?: { rounds?: number } | null }
type SleeperPick = {
  round: number
  pick_no: number
  roster_id: number | null
  picked_by: string | null
  metadata?: {
    first_name?: string | null
    last_name?: string | null
    position?: string | null
    team?: string | null
  } | null
}

// ── Payload types (what the API route returns) ───────────────────────────────
export type HistoryManagerRef = {
  ownerId: string | null
  name: string
  avatar: string | null
  teamName: string | null
}
export type HistoryStandingRow = HistoryManagerRef & {
  rosterId: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
}
export type HistoryDraftPick = {
  round: number
  pickNo: number
  playerName: string
  position: string | null
  nflTeam: string | null
  pickedBy: HistoryManagerRef | null
}
export type HistorySeason = {
  season: string
  sleeperLeagueId: string
  name: string
  status: string
  champion: HistoryManagerRef | null
  runnerUp: HistoryManagerRef | null
  topScorer: (HistoryManagerRef & { pointsFor: number }) | null
  standings: HistoryStandingRow[]
  draft: { draftId: string; status: string; rounds: number; picks: HistoryDraftPick[] } | null
  missing: string[]
}
export type HistoryAllTimeRow = HistoryManagerRef & {
  wins: number
  losses: number
  ties: number
  pointsFor: number
  titles: number
  seasons: number
}
export type LeagueHistoryPayload = {
  version: 1
  sleeperLeagueId: string
  fetchedAt: string
  staleAsOf: string | null
  deepSync: false
  seasons: HistorySeason[]
  allTime: HistoryAllTimeRow[]
}

function points(r: SleeperRoster): number {
  const whole = r.settings?.fpts ?? 0
  const dec = r.settings?.fpts_decimal ?? 0
  return whole + dec / 100
}

function refFor(
  ownerId: string | null | undefined,
  usersById: Map<string, SleeperUser>,
): HistoryManagerRef {
  const u = ownerId ? usersById.get(ownerId) : undefined
  return {
    ownerId: ownerId ?? null,
    name: u?.display_name ?? (ownerId ? 'Manager' : 'Unclaimed'),
    avatar: u?.avatar ?? null,
    teamName: u?.metadata?.team_name?.trim() || null,
  }
}

async function buildSeason(league: SleeperLeague): Promise<HistorySeason> {
  const missing: string[] = []
  const id = league.league_id

  const [users, rosters, drafts] = await Promise.all([
    j<SleeperUser[]>(`/league/${id}/users`),
    j<SleeperRoster[]>(`/league/${id}/rosters`),
    j<SleeperDraft[]>(`/league/${id}/drafts`),
  ])
  if (!users) missing.push('managers')
  if (!rosters) missing.push('rosters')

  const usersById = new Map((users ?? []).map((u) => [u.user_id, u]))
  const rosterById = new Map((rosters ?? []).map((r) => [r.roster_id, r]))
  const ownerOfRoster = (rosterId: number | null | undefined): HistoryManagerRef | null => {
    if (rosterId == null) return null
    const roster = rosterById.get(rosterId)
    if (!roster) return null
    return refFor(roster.owner_id, usersById)
  }

  // Champion + runner-up: playoff bracket first, league metadata as fallback.
  let champion: HistoryManagerRef | null = null
  let runnerUp: HistoryManagerRef | null = null
  const isComplete = String(league.status).toLowerCase() === 'complete'
  if (isComplete) {
    const bracket = await j<SleeperBracketNode[]>(`/league/${id}/winners_bracket`)
    const finalGame = bracket?.find((n) => n.p === 1)
    if (finalGame) {
      champion = ownerOfRoster(finalGame.w ?? null)
      runnerUp = ownerOfRoster(finalGame.l ?? null)
    }
    if (!champion) {
      const metaWinner = league.metadata?.latest_league_winner_roster_id
      const metaRosterId = metaWinner != null ? Number(metaWinner) : NaN
      if (Number.isFinite(metaRosterId)) champion = ownerOfRoster(metaRosterId)
    }
    if (!champion) missing.push('champion')
    if (!runnerUp) missing.push('runner-up')
  }

  const standings: HistoryStandingRow[] = (rosters ?? [])
    .map((r) => ({
      rosterId: r.roster_id,
      ...refFor(r.owner_id, usersById),
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pointsFor: points(r),
    }))
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)

  const topRow = standings.reduce<HistoryStandingRow | null>(
    (best, row) => (best == null || row.pointsFor > best.pointsFor ? row : best),
    null,
  )
  const topScorer =
    topRow && topRow.pointsFor > 0
      ? { ownerId: topRow.ownerId, name: topRow.name, avatar: topRow.avatar, teamName: topRow.teamName, pointsFor: topRow.pointsFor }
      : null

  // Draft results: first draft of the season (Sleeper leagues have one per season).
  let draft: HistorySeason['draft'] = null
  const draftMeta = drafts?.[0]
  if (draftMeta) {
    const picks = await j<SleeperPick[]>(`/draft/${draftMeta.draft_id}/picks`)
    if (picks) {
      draft = {
        draftId: draftMeta.draft_id,
        status: draftMeta.status,
        rounds: draftMeta.settings?.rounds ?? 0,
        picks: picks.map((p) => ({
          round: p.round,
          pickNo: p.pick_no,
          playerName:
            [p.metadata?.first_name, p.metadata?.last_name].filter(Boolean).join(' ').trim() || 'Player',
          position: p.metadata?.position ?? null,
          nflTeam: p.metadata?.team ?? null,
          pickedBy: p.picked_by ? refFor(p.picked_by, usersById) : ownerOfRoster(p.roster_id),
        })),
      }
    } else {
      missing.push('draft picks')
    }
  } else if (drafts == null) {
    missing.push('draft')
  }

  return {
    season: league.season,
    sleeperLeagueId: id,
    name: league.name,
    status: league.status,
    champion,
    runnerUp,
    topScorer,
    standings,
    draft,
    missing,
  }
}

function buildAllTime(seasons: HistorySeason[]): HistoryAllTimeRow[] {
  const byOwner = new Map<string, HistoryAllTimeRow>()
  // Iterate oldest → newest so the LATEST season's name/avatar wins.
  for (const season of [...seasons].reverse()) {
    for (const row of season.standings) {
      if (!row.ownerId) continue
      const prev = byOwner.get(row.ownerId)
      const next: HistoryAllTimeRow = prev ?? {
        ownerId: row.ownerId,
        name: row.name,
        avatar: row.avatar,
        teamName: row.teamName,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        titles: 0,
        seasons: 0,
      }
      next.wins += row.wins
      next.losses += row.losses
      next.ties += row.ties
      next.pointsFor += row.pointsFor
      next.seasons += 1
      next.name = row.name
      next.avatar = row.avatar
      next.teamName = row.teamName
      byOwner.set(row.ownerId, next)
    }
    if (season.champion?.ownerId) {
      const champ = byOwner.get(season.champion.ownerId)
      if (champ) champ.titles += 1
    }
  }
  return [...byOwner.values()].sort((a, b) => b.titles - a.titles || b.wins - a.wins || b.pointsFor - a.pointsFor)
}

async function buildHistory(sleeperLeagueId: string): Promise<LeagueHistoryPayload | null> {
  // Walk the chain: current league → previous_league_id → … (bounded).
  const chain: SleeperLeague[] = []
  let cursor: string | null = sleeperLeagueId
  while (cursor && chain.length < MAX_CHAIN) {
    // Explicit annotation breaks a circular inference: `cursor` builds the URL
    // that yields `league`, and `league.previous_league_id` reassigns `cursor`.
    const league: SleeperLeague | null = await j<SleeperLeague>(`/league/${cursor}`)
    if (!league) break
    chain.push(league)
    cursor = league.previous_league_id
  }
  if (chain.length === 0) return null

  const seasons = await Promise.all(chain.map((l) => buildSeason(l)))
  return {
    version: 1,
    sleeperLeagueId,
    fetchedAt: new Date().toISOString(),
    staleAsOf: null,
    deepSync: false,
    seasons,
    allTime: buildAllTime(seasons),
  }
}

/** Cached accessor: fresh cache → cached; else rebuild; upstream failure → stale cache flagged. */
export async function getSleeperLeagueHistory(
  sleeperLeagueId: string,
): Promise<LeagueHistoryPayload | null> {
  const cacheKey = `${CACHE_PREFIX}${sleeperLeagueId}`
  const now = new Date()

  const cached = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey } })
    .catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as LeagueHistoryPayload)
      : null
  if (cachedPayload?.version === 1 && cached && cached.expiresAt > now) {
    return cachedPayload
  }

  const fresh = await buildHistory(sleeperLeagueId)
  if (fresh) {
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey },
        update: { data: fresh as unknown as object, expiresAt },
        create: { cacheKey, data: fresh as unknown as object, expiresAt },
      })
      .catch((err) => {
        console.error('[league-history] cache write failed (serving live result)', { sleeperLeagueId, err })
      })
    return fresh
  }

  // Upstream failed: serve stale cache honestly flagged, or nothing.
  if (cachedPayload?.version === 1 && cached) {
    return { ...cachedPayload, staleAsOf: cached.expiresAt.toISOString() }
  }
  return null
}
