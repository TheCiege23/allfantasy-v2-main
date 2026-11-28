import 'server-only'

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { namesAgree } from '@/lib/player-data/getPlayerDataForSurface'
import { EspnBlockedError } from './espnNcaabFetch'
import { ESPN_PRO_HEADSHOT_SPORTS, isEspnProHeadshot, type EspnProSport } from './espnProHeadshots'
import { fetchEspnProRoster, fetchEspnProTeams, type EspnProAthlete, type EspnProTeam } from './espnProRosterFetch'

/**
 * ESPN current-team headshots for NBA, NHL and MLB players (owner decision 2026-11-27, contracts/espn GAPS E-08).
 *
 * Each tick reads a few ESPN team rosters per sport, rotating through the league, and links each athlete to
 * our Rolling Insights player row by NAME — and, when a name alone is ambiguous, by jersey number too. A link
 * that is not unique in both directions is refused, never guessed: a stranger's face is worse than an old one.
 * A linked athlete's ESPN headshot is written onto the RI `SportsPlayer` row (replacing an empty, TheSportsDB,
 * api-sports or older ESPN photo, nothing else), and its ESPN id onto `PlayerIdentityMap` (never overwritten).
 * Surfaces prefer that row's photo through `isEspnProHeadshot` (lib/espn/espnProHeadshots.ts).
 *
 * Only this module imports the adapter (`./espnProRosterFetch`), which is what keeps it allowlisted.
 */

const RI_SOURCE = 'rolling_insights'
const TEAMS_KEY = (sport: EspnProSport) => `espn:pro:teams:${sport}`
const CURSOR_KEY = (sport: EspnProSport) => `espn:pro:roster-cursor:${sport}`
const SNAPSHOT_KEY = (sport: EspnProSport, teamId: string) => `espn:pro:roster:${sport}:${teamId}`
const TEAMS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Stop starting a team this close to the deadline: one roster plus its writes. */
const TEAM_TAIL_MS = 6_000

export type ProRow = { id: string; externalId: string; name: string; number: number | null; status: string | null; imageUrl: string | null }
export type ProLink = { rowId: string; externalId: string; athleteId: string; headshotUrl: string; currentImageUrl: string | null }

/**
 * Pure. Athletes with a headshot → the one RI row each is. Ambiguity is refused: a name shared by several rows
 * narrows to active rows, then to the matching jersey; anything still not exactly one is no link. A row claimed
 * by two athletes is refused for both.
 */
export function matchProAthletes(athletes: readonly EspnProAthlete[], rows: readonly ProRow[]): { links: ProLink[]; refused: number; noCandidate: number } {
  const byRow = new Map<string, ProLink[]>()
  let refused = 0
  let noCandidate = 0
  for (const a of athletes) {
    if (!a.headshotUrl) continue
    let cands = rows.filter((r) => namesAgree(r.name, a.fullName))
    if (cands.length === 0) {
      noCandidate++
      continue
    }
    if (cands.length > 1) {
      const active = cands.filter((r) => String(r.status ?? '').toUpperCase() === 'ACT')
      if (active.length > 0) cands = active
    }
    if (cands.length > 1 && a.jersey) cands = cands.filter((r) => r.number != null && String(r.number) === a.jersey)
    if (cands.length !== 1) {
      refused++
      continue
    }
    const r = cands[0]!
    const list = byRow.get(r.id) ?? []
    list.push({ rowId: r.id, externalId: r.externalId, athleteId: a.id, headshotUrl: a.headshotUrl, currentImageUrl: r.imageUrl })
    byRow.set(r.id, list)
  }
  const links: ProLink[] = []
  for (const list of byRow.values()) {
    if (list.length === 1) links.push(list[0]!)
    else refused += list.length
  }
  return { links, refused, noCandidate }
}

/** A row photo this job may replace: none, TheSportsDB, api-sports, or an earlier ESPN pro headshot. */
export function replaceableRowPhoto(url: string | null | undefined): boolean {
  const u = String(url ?? '').trim()
  if (!u) return true
  return /thesportsdb\.com|api-sports\.io/i.test(u) || isEspnProHeadshot(u)
}

export type EspnProHeadshotResult = {
  blocked: boolean
  bySport: Record<string, { teamsFetched: number; athletes: number; linked: number; refused: number; noCandidate: number; photosWritten: number; espnIdsLinked: number }>
  errors: number
}

async function cachedTeams(sport: EspnProSport, now: Date, fetchImpl?: typeof fetch): Promise<EspnProTeam[]> {
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey: TEAMS_KEY(sport) }, select: { data: true, expiresAt: true } }).catch(() => null)
  if (cached && cached.expiresAt > now && Array.isArray(cached.data)) return cached.data as unknown as EspnProTeam[]
  const teams = await fetchEspnProTeams(sport, { fetchImpl })
  if (teams.length > 0) {
    const data = toPrismaJsonInput(teams)
    const expiresAt = new Date(now.getTime() + TEAMS_TTL_MS)
    await prisma.sportsDataCache.upsert({ where: { cacheKey: TEAMS_KEY(sport) }, create: { cacheKey: TEAMS_KEY(sport), data, expiresAt }, update: { data, expiresAt } }).catch(() => undefined)
  }
  return teams
}

async function readCursor(sport: EspnProSport): Promise<number> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: CURSOR_KEY(sport) }, select: { data: true } }).catch(() => null)
  const n = Number((row?.data as { next?: unknown } | null)?.next)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

async function writeCursor(sport: EspnProSport, next: number, now: Date): Promise<void> {
  const data = toPrismaJsonInput({ next, at: now.toISOString() })
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  await prisma.sportsDataCache.upsert({ where: { cacheKey: CURSOR_KEY(sport) }, create: { cacheKey: CURSOR_KEY(sport), data, expiresAt }, update: { data, expiresAt } }).catch(() => undefined)
}

export async function syncEspnProHeadshots(opts: { deadlineAt: number; teamsPerSport?: number; now?: Date; fetchImpl?: typeof fetch }): Promise<EspnProHeadshotResult> {
  const now = opts.now ?? new Date()
  const perSport = opts.teamsPerSport ?? 6
  const result: EspnProHeadshotResult = { blocked: false, bySport: {}, errors: 0 }

  for (const sport of ESPN_PRO_HEADSHOT_SPORTS) {
    if (Date.now() > opts.deadlineAt - TEAM_TAIL_MS) break
    const tally = { teamsFetched: 0, athletes: 0, linked: 0, refused: 0, noCandidate: 0, photosWritten: 0, espnIdsLinked: 0 }
    result.bySport[sport] = tally
    let teams: EspnProTeam[]
    try {
      teams = await cachedTeams(sport, now, opts.fetchImpl)
    } catch (err) {
      if (err instanceof EspnBlockedError) {
        result.blocked = true
        return result
      }
      result.errors++
      continue
    }
    if (teams.length === 0) continue
    const rows: ProRow[] = await prisma.sportsPlayer.findMany({
      where: { sport, source: RI_SOURCE },
      select: { id: true, externalId: true, name: true, number: true, status: true, imageUrl: true },
    })

    let cursor = (await readCursor(sport)) % teams.length
    for (let k = 0; k < Math.min(perSport, teams.length); k++) {
      if (Date.now() > opts.deadlineAt - TEAM_TAIL_MS) break
      const team = teams[cursor]!
      cursor = (cursor + 1) % teams.length
      let athletes: EspnProAthlete[] = []
      try {
        const roster = await fetchEspnProRoster(sport, team.id, { fetchImpl: opts.fetchImpl })
        athletes = roster.athletes
        const data = toPrismaJsonInput({ sport, teamId: team.id, team: team.abbreviation, seasonYear: roster.seasonYear, observedAt: now.toISOString(), athletes })
        const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS)
        const cacheKey = SNAPSHOT_KEY(sport, team.id)
        await prisma.sportsDataCache.upsert({ where: { cacheKey }, create: { cacheKey, data, expiresAt }, update: { data, expiresAt } })
      } catch (err) {
        if (err instanceof EspnBlockedError) {
          result.blocked = true
          await writeCursor(sport, cursor, now)
          return result
        }
        result.errors++
        continue
      }
      tally.teamsFetched++
      tally.athletes += athletes.length
      const { links, refused, noCandidate } = matchProAthletes(athletes, rows)
      tally.linked += links.length
      tally.refused += refused
      tally.noCandidate += noCandidate
      for (const link of links) {
        try {
          if (link.currentImageUrl !== link.headshotUrl && replaceableRowPhoto(link.currentImageUrl)) {
            await prisma.sportsPlayer.update({ where: { id: link.rowId }, data: { imageUrl: link.headshotUrl } })
            tally.photosWritten++
          }
          // The ESPN id onto the identity map: never overwritten, never given to a second row.
          const holder = await prisma.playerIdentityMap.findFirst({ where: { sport, espnId: link.athleteId }, select: { id: true } })
          if (!holder) {
            const written = await prisma.playerIdentityMap.updateMany({
              where: { sport, rollingInsightsId: link.externalId, espnId: null },
              data: { espnId: link.athleteId },
            })
            tally.espnIdsLinked += written.count
          }
        } catch {
          result.errors++
        }
      }
    }
    await writeCursor(sport, cursor, now)
  }
  return result
}
