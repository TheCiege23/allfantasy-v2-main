import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { normalizeTeamAbbr } from '@/lib/player-identity/playerIdentityResolution'
import { fetchOfficialNhlGoalieDay, matchOfficialNhlGoalieGame, OFFICIAL_GOALIE_SOURCE,
  type OfficialNhlGoalieGame } from './officialGoalieGameStats'

const CACHE_PREFIX = 'nhl:official:goalie-summary:v1:'
const MAX_DATES = 3
const PER_DATE_BUDGET_MS = 45_000
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null
const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null

type Box = Awaited<ReturnType<typeof readBoxes>>[number]
type Candidate = { box: Box; row: OfficialNhlGoalieGame; date: string;
  saves: number; goalsAgainst: number }

async function readBoxes(date: string) {
  return prisma.playerGameStat.findMany({ where: { sportType: 'NHL', source: 'rolling_insights_live',
    gameDate: new Date(`${date}T00:00:00Z`), gameId: { endsWith: ':goalies' } },
  select: { id: true, playerId: true, providerGameId: true, gameDate: true,
    team: true, opponent: true, normalizedStatMap: true, updatedAt: true } })
}

function validCachedRows(value: unknown, date: string): OfficialNhlGoalieGame[] | null {
  const rows = record(value)?.rows
  if (!Array.isArray(rows)) return null
  const keys = new Set<string>()
  for (const item of rows) {
    const row = record(item)
    if (!row || row.gameDate !== date || typeof row.goalieFullName !== 'string' ||
      typeof row.teamAbbrev !== 'string' || typeof row.opponentTeamAbbrev !== 'string' ||
      !Number.isInteger(row.gameId) || !Number.isInteger(row.playerId) ||
      !Number.isInteger(row.saves) || !Number.isInteger(row.goalsAgainst) ||
      !Number.isInteger(row.goals) || !Number.isInteger(row.assists) ||
      !Number.isInteger(row.penaltyMinutes)) return null
    const key = `${row.gameId}:${row.playerId}`
    if (keys.has(key)) return null
    keys.add(key)
  }
  return rows as OfficialNhlGoalieGame[]
}

async function officialDay(date: string, now: Date, deadlineAt: number,
  fetchImpl?: typeof fetch, cacheWrite = true) {
  const cacheKey = `${CACHE_PREFIX}${date}`
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey },
    select: { data: true, expiresAt: true } })
  const cachedRows = cached && cached.expiresAt.getTime() > now.getTime()
    ? validCachedRows(cached.data, date) : null
  if (cachedRows) return { rows: cachedRows, cacheHit: true }
  const rows = await fetchOfficialNhlGoalieDay(date, fetchImpl, deadlineAt)
  const recent = now.getTime() - new Date(`${date}T00:00:00Z`).getTime() < 72 * 3600_000
  const expiresAt = new Date(now.getTime() + (recent ? 60 : 24 * 60) * 60_000)
  if (cacheWrite) await prisma.sportsDataCache.upsert({ where: { cacheKey },
    create: { cacheKey, data: { rows }, expiresAt }, update: { data: { rows }, expiresAt } })
  return { rows, cacheHit: false }
}

type OfficialNhlGoalieReport = { requestedDates: number; selectedDates: string[];
  deferredDates: string[]; cacheHits: number; fetchedDates: number; matched: number;
  alreadyPresent: number; wouldWrite: number; written: number; corrected: number;
  stale: number; missing: number; ambiguous: number; conflicting: number; errors: string[] }

/** Enrich final RI goalie boxes with verified official goals, assists and penalty minutes. */
export async function enrichOfficialNhlGoalieGameStats(input: { dates: string[]; now?: Date;
  shouldStop?: () => boolean; fetchImpl?: typeof fetch; dryRun?: boolean }): Promise<OfficialNhlGoalieReport> {
  const validDates = [...new Set(input.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))]
  const selectedDates = validDates.slice(0, MAX_DATES)
  const report: OfficialNhlGoalieReport = { requestedDates: validDates.length,
    selectedDates, deferredDates: validDates.slice(MAX_DATES), cacheHits: 0, fetchedDates: 0,
    matched: 0, alreadyPresent: 0, wouldWrite: 0, written: 0, corrected: 0,
    stale: 0, missing: 0, ambiguous: 0, conflicting: 0, errors: [] }
  for (const date of selectedDates) {
    if (input.shouldStop?.()) { report.deferredDates.push(date); continue }
    const allBoxes = await readBoxes(date)
    const providerIds = [...new Set(allBoxes.map((box) => box.providerGameId)
      .filter((id): id is string => !!id))]
    const games = await prisma.sportsGame.findMany({ where: { sport: 'NHL',
      source: 'rolling_insights', externalId: { in: providerIds } },
    select: { externalId: true, status: true } })
    const finalGames = new Set(games.filter((game) => normalizeGameStatus(game.status) === 'final')
      .map((game) => game.externalId))
    const boxes = allBoxes.filter((box) => record(box.normalizedStatMap)?.seasonType === 'regular' &&
      !!box.providerGameId && finalGames.has(box.providerGameId))
    if (!boxes.length) continue
    const names = new Map<string, string>()
    const ids = [...new Set(boxes.map((box) => box.playerId))]
    for (let start = 0; start < ids.length; start += 250) {
      const rows = await prisma.playerIdentityMap.findMany({ where: { sport: 'NHL',
        id: { in: ids.slice(start, start + 250) } }, select: { id: true, canonicalName: true } })
      for (const row of rows) names.set(row.id, row.canonicalName)
    }
    let official: OfficialNhlGoalieGame[]
    try {
      const result = await officialDay(date, input.now ?? new Date(),
        Date.now() + PER_DATE_BUDGET_MS, input.fetchImpl, !input.dryRun)
      official = result.rows
      result.cacheHit ? report.cacheHits++ : report.fetchedDates++
    } catch (error) {
      report.errors.push(`${date}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const officialIdsByProviderGame = new Map<string, Set<number>>()
    const pending = new Map<string, Candidate[]>()
    for (const box of boxes) {
      const name = names.get(box.playerId)
      const outer = record(box.normalizedStatMap), stats = record(outer?.stats)
      const saves = integer(stats?.saves), goalsAgainst = integer(stats?.goals_allowed)
      if (!name || !box.team || !box.opponent || !box.providerGameId ||
        saves === null || goalsAgainst === null) { report.missing++; continue }
      const match = matchOfficialNhlGoalieGame({ date, team: box.team,
        opponent: box.opponent, playerName: name, saves, goalsAgainst }, official)
      if (!match.row) {
        match.reason === 'ambiguous_official_player' ? report.ambiguous++ :
          match.reason === 'official_game_stat_conflict' ? report.conflicting++ : report.missing++
        continue
      }
      report.matched++
      const row = match.row, providerGameId = box.providerGameId
      const ids = officialIdsByProviderGame.get(providerGameId) ?? new Set<number>()
      ids.add(row.gameId)
      officialIdsByProviderGame.set(providerGameId, ids)
      const proof = record(outer?.officialGoalieGameStats)
      if (stats?.goalie_goals === row.goals && stats.goalie_assists === row.assists &&
        stats.goalie_penalty_minutes === row.penaltyMinutes && proof?.source === OFFICIAL_GOALIE_SOURCE &&
        proof.gameId === row.gameId && proof.playerId === row.playerId) { report.alreadyPresent++; continue }
      if ((stats?.goalie_goals != null || stats?.goalie_assists != null ||
        stats?.goalie_penalty_minutes != null) && proof?.source !== OFFICIAL_GOALIE_SOURCE) {
        report.conflicting++; continue
      }
      const candidates = pending.get(providerGameId) ?? []
      candidates.push({ box, row, date, saves, goalsAgainst })
      pending.set(providerGameId, candidates)
    }
    for (const [providerGameId, candidates] of pending) {
      if (input.shouldStop?.()) { report.deferredDates.push(date); break }
      if (officialIdsByProviderGame.get(providerGameId)?.size !== 1) {
        report.conflicting += candidates.length; continue
      }
      report.wouldWrite += candidates.length
      if (input.dryRun) continue
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`NHL:${providerGameId}`}, 0))`
        for (const candidate of candidates) {
          const current = await tx.playerGameStat.findUnique({ where: { id: candidate.box.id },
            select: { normalizedStatMap: true, updatedAt: true, source: true, providerGameId: true,
              gameDate: true, team: true, opponent: true } })
          const outer = record(current?.normalizedStatMap), stats = record(outer?.stats)
          if (!current || current.updatedAt.getTime() !== candidate.box.updatedAt.getTime() ||
            current.source !== 'rolling_insights_live' || current.providerGameId !== providerGameId ||
            day(current.gameDate) !== candidate.date || integer(stats?.saves) !== candidate.saves ||
            integer(stats?.goals_allowed) !== candidate.goalsAgainst ||
            normalizeTeamAbbr(current.team, 'NHL') !== normalizeTeamAbbr(candidate.box.team, 'NHL') ||
            normalizeTeamAbbr(current.opponent, 'NHL') !== normalizeTeamAbbr(candidate.box.opponent, 'NHL') ||
            !outer || !stats) { report.stale++; continue }
          const row = candidate.row, proof = record(outer.officialGoalieGameStats)
          if ((stats.goalie_goals != null || stats.goalie_assists != null ||
            stats.goalie_penalty_minutes != null) && proof?.source !== OFFICIAL_GOALIE_SOURCE) {
            report.conflicting++; continue
          }
          const value = { ...outer, stats: { ...stats, goalie_goals: row.goals,
            goalie_assists: row.assists, goalie_penalty_minutes: row.penaltyMinutes },
          officialGoalieGameStats: { source: OFFICIAL_GOALIE_SOURCE, gameId: row.gameId,
            playerId: row.playerId, gameDate: candidate.date } }
          const changed = await tx.playerGameStat.updateMany({
            where: { id: candidate.box.id, updatedAt: candidate.box.updatedAt },
            data: { normalizedStatMap: value as Prisma.InputJsonValue },
          })
          if (changed.count === 1) {
            report.written++
            if (proof?.source === OFFICIAL_GOALIE_SOURCE) report.corrected++
          } else report.stale++
        }
      }, { timeout: 30_000 })
    }
  }
  return report
}
