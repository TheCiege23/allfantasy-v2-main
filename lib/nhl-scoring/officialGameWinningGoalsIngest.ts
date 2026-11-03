import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { normalizeTeamAbbr } from '@/lib/player-identity/playerIdentityResolution'
import { fetchOfficialNhlSkaterDay, matchOfficialNhlSkaterGame,
  type OfficialNhlSkaterGame } from './officialGameWinningGoals'

const SOURCE = 'nhl_stats_rest_game_summary_v1'
const CACHE_PREFIX = 'nhl:official:skater-summary:v1:'
const MAX_DATES = 3
const PER_DATE_BUDGET_MS = 45_000

type StoredBox = Awaited<ReturnType<typeof readBoxes>>[number]
type Candidate = { box: StoredBox; gameId: number; playerId: number; goals: number;
  gameWinningGoals: number; date: string }

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null
const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null

function validCachedRows(value: unknown, date: string): OfficialNhlSkaterGame[] | null {
  const rows = record(value)?.rows
  if (!Array.isArray(rows)) return null
  const keys = new Set<string>()
  for (const item of rows) {
    const row = record(item)
    if (!row || row.gameDate !== date || typeof row.skaterFullName !== 'string' ||
      typeof row.teamAbbrev !== 'string' || typeof row.opponentTeamAbbrev !== 'string' ||
      !Number.isInteger(row.gameId) || !Number.isInteger(row.playerId) ||
      !Number.isInteger(row.goals) || !Number.isInteger(row.gameWinningGoals)) return null
    const key = `${row.gameId}:${row.playerId}`
    if (keys.has(key)) return null
    keys.add(key)
  }
  return rows as OfficialNhlSkaterGame[]
}

async function officialDay(date: string, now: Date, deadlineAt: number,
  fetchImpl?: typeof fetch, cacheWrite = true): Promise<{ rows: OfficialNhlSkaterGame[]; cacheHit: boolean }> {
  const cacheKey = `${CACHE_PREFIX}${date}`
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey },
    select: { data: true, expiresAt: true } })
  const cachedRows = cached && cached.expiresAt.getTime() > now.getTime()
    ? validCachedRows(cached.data, date) : null
  if (cachedRows) return { rows: cachedRows, cacheHit: true }
  const rows = await fetchOfficialNhlSkaterDay(date, fetchImpl, deadlineAt)
  // Recent games can be corrected. Older days refresh on the next daily sweep.
  const recent = now.getTime() - new Date(`${date}T00:00:00Z`).getTime() < 72 * 3600_000
  const expiresAt = new Date(now.getTime() + (recent ? 60 : 24 * 60) * 60_000)
  if (cacheWrite) await prisma.sportsDataCache.upsert({ where: { cacheKey },
    create: { cacheKey, data: { rows }, expiresAt },
    update: { data: { rows }, expiresAt } })
  return { rows, cacheHit: false }
}

async function readBoxes(date: string) {
  return prisma.playerGameStat.findMany({ where: { sportType: 'NHL', source: 'rolling_insights_live',
    gameDate: new Date(`${date}T00:00:00Z`), gameId: { endsWith: ':skaters' } },
  select: { id: true, playerId: true, gameId: true, providerGameId: true,
    gameDate: true, team: true, opponent: true, normalizedStatMap: true, updatedAt: true } })
}

export type OfficialNhlEnrichmentReport = {
  requestedDates: number; selectedDates: string[]; deferredDates: string[]
  cacheHits: number; fetchedDates: number; matched: number; alreadyPresent: number
  wouldWrite: number; corrected: number; written: number; stale: number; missing: number; ambiguous: number
  conflicting: number; errors: string[]
}

/** Complete final RI skater boxes using exact official joins. No guess is made for unmatched rows. */
export async function enrichOfficialNhlGameWinningGoals(input: {
  dates: string[]; now?: Date; shouldStop?: () => boolean; fetchImpl?: typeof fetch
  dryRun?: boolean
}): Promise<OfficialNhlEnrichmentReport> {
  const validDates = [...new Set(input.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))]
  const selectedDates = validDates.slice(0, MAX_DATES)
  const report: OfficialNhlEnrichmentReport = {
    requestedDates: validDates.length, selectedDates, deferredDates: validDates.slice(MAX_DATES),
    cacheHits: 0, fetchedDates: 0, matched: 0, alreadyPresent: 0, wouldWrite: 0,
    corrected: 0, written: 0, stale: 0, missing: 0, ambiguous: 0, conflicting: 0, errors: [],
  }
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
    const boxes = allBoxes.filter((box) => {
      const outer = record(box.normalizedStatMap)
      return outer?.seasonType === 'regular' && !!box.providerGameId &&
        finalGames.has(box.providerGameId)
    })
    if (!boxes.length) continue
    const ids = [...new Set(boxes.map((box) => box.playerId))]
    const names = new Map<string, string>()
    for (let start = 0; start < ids.length; start += 250) {
      const rows = await prisma.playerIdentityMap.findMany({ where: { sport: 'NHL',
        id: { in: ids.slice(start, start + 250) } }, select: { id: true, canonicalName: true } })
      for (const row of rows) names.set(row.id, row.canonicalName)
    }
    let official: OfficialNhlSkaterGame[]
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
      const goals = integer(stats?.goals)
      if (!name || !box.team || !box.opponent || !box.providerGameId || goals === null) {
        report.missing++
        continue
      }
      const match = matchOfficialNhlSkaterGame({ date, team: box.team,
        opponent: box.opponent, playerName: name, goals }, official)
      if (!match.row) {
        match.reason === 'ambiguous_official_player' ? report.ambiguous++ :
          match.reason === 'official_game_stat_conflict' ? report.conflicting++ : report.missing++
        continue
      }
      report.matched++
      const row = match.row
      const group = box.providerGameId
      const officialIds = officialIdsByProviderGame.get(group) ?? new Set<number>()
      officialIds.add(row.gameId)
      officialIdsByProviderGame.set(group, officialIds)
      const proof = record(outer?.officialGameWinningGoals)
      const prior = integer(stats?.game_winning_goals)
      if (prior === row.gameWinningGoals && proof?.source === SOURCE &&
        proof.gameId === row.gameId && proof.playerId === row.playerId) {
        report.alreadyPresent++
        continue
      }
      // Another source may own this field. Do not overwrite conflicting evidence.
      if (prior !== null && proof?.source !== SOURCE && prior !== row.gameWinningGoals) {
        report.conflicting++
        continue
      }
      const candidates = pending.get(group) ?? []
      candidates.push({ box, gameId: row.gameId, playerId: row.playerId,
        goals, gameWinningGoals: row.gameWinningGoals, date })
      pending.set(group, candidates)
    }
    for (const [providerGameId, candidates] of pending) {
      if (input.shouldStop?.()) { report.deferredDates.push(date); break }
      if (officialIdsByProviderGame.get(providerGameId)?.size !== 1) {
        report.conflicting += candidates.length
        continue
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
            day(current.gameDate) !== date || integer(stats?.goals) !== candidate.goals ||
            normalizeTeamAbbr(current.team, 'NHL') !== normalizeTeamAbbr(candidate.box.team, 'NHL') ||
            normalizeTeamAbbr(current.opponent, 'NHL') !== normalizeTeamAbbr(candidate.box.opponent, 'NHL') ||
            !outer || !stats) { report.stale++; continue }
          const prior = integer(stats.game_winning_goals)
          const proof = record(outer.officialGameWinningGoals)
          const value = { ...outer, stats: { ...stats,
            game_winning_goals: candidate.gameWinningGoals },
          officialGameWinningGoals: { source: SOURCE, gameId: candidate.gameId,
            playerId: candidate.playerId, gameDate: date, stat: 'gameWinningGoals' } }
          const changed = await tx.playerGameStat.updateMany({
            where: { id: candidate.box.id, updatedAt: candidate.box.updatedAt },
            data: { normalizedStatMap: value as Prisma.InputJsonValue },
          })
          if (changed.count === 1) {
            report.written++
            if (prior !== null && prior !== candidate.gameWinningGoals && proof?.source === SOURCE)
              report.corrected++
          } else report.stale++
        }
      }, { timeout: 30_000 })
    }
  }
  return report
}
