import 'server-only'
import { prisma } from '@/lib/prisma'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { classifyRiSeasonType } from '@/lib/sports-data/riSeasonType'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { fetchSeasonCalendarGames, seasonContractHash } from './seasonCalendarVerification'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { loadPublishedScheduleContract } from './seasonScheduleReview'
import { assessSeasonActualStart, classifyRiLiveStartState, type GameStartObservation } from './seasonActualStartEvidence'
import { readSeasonGameStartImpact } from './seasonActualStartImpact'

const ACTION = 'season_game_start_observed'
type Receipt = GameStartObservation & { manifestHash: string; rulesHash: string; version: 1; digest: string }
function readReceipt(value: unknown, manifestHash: string, rulesHash: string): GameStartObservation {
  if (!value || typeof value !== 'object') throw new BlueprintOperationError('Malformed game-start observation receipt.', 409)
  const { digest, ...payload } = value as Receipt
  if (payload.version !== 1 || payload.manifestHash !== manifestHash || payload.rulesHash !== rulesHash || digest !== seasonContractHash(payload)) throw new BlueprintOperationError('Game-start observation checksum differs.', 409)
  const { providerGameId, sport, state, observedAt, scheduledAt, rawDigest } = payload
  return { providerGameId, sport, state, observedAt, scheduledAt, rawDigest }
}

/** Samples one fresh vendor live row and appends its server-observed state; never certifies exact tipoff. */
export async function sampleSeasonGameStart(userId: string, tournamentId: string, freezeId: string, gameId: string) {
  const { manifest, calendar } = await loadPublishedScheduleContract(userId, tournamentId, freezeId)
  const original = calendar.assignments.find(item => item.gameId === gameId)
  if (!original) throw new BlueprintOperationError('Choose a game in the published tournament calendar.', 404)
  const schedule = await fetchSeasonCalendarGames(manifest.config)
  const matches = schedule.games.filter(item => item.gameId === gameId)
  if (matches.length !== 1 || matches[0]!.seasonType !== 'regular' || !matches[0]!.startTime) throw new BlueprintOperationError('Current game schedule is missing or ambiguous. Review schedule drift first.', 409)
  const day = easternCalendarDay(new Date(matches[0]!.startTime))
  if (!day) throw new BlueprintOperationError('Current scheduled game day is invalid.', 409)
  const dayString = day.toISOString().slice(0, 10)
  const today = easternCalendarDay(new Date())!.getTime()
  if (Math.abs(today - day.getTime()) > 86400000) throw new BlueprintOperationError('Live status can be checked only around the scheduled game day.', 409)
  const feed = await riFetchRows('live', { sport: manifest.config.sport, date: dayString, timeoutMs: 15000 })
  if (feed.error || feed.notModified || feed.unsupported) throw new BlueprintOperationError('A fresh live game status is unavailable.', 409)
  const rows = feed.rows.filter(row => row && typeof row === 'object' && String((row as Record<string, unknown>).game_ID ?? '') === gameId)
  if (rows.length !== 1) throw new BlueprintOperationError('The live feed does not identify this game exactly once.', 409)
  const raw = rows[0] as Record<string, unknown>
  if (classifyRiSeasonType(raw.season_type) !== 'regular') throw new BlueprintOperationError('The live game is not verified as regular season.', 409)
  const observation: GameStartObservation = {
    providerGameId: gameId, sport: manifest.config.sport,
    state: classifyRiLiveStartState(raw.status ?? raw.game_status),
    observedAt: new Date().toISOString(), scheduledAt: matches[0]!.startTime,
    rawDigest: seasonContractHash(raw),
  }
  const rules = manifest.config.rules!, window = rules.calendar.periods.find(period => period.number === original.period)
  if (!window) throw new BlueprintOperationError('The published game is outside an opening scoring period.', 409)
  return prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.commissionerId !== userId || shell.status !== 'rules_published') throw new BlueprintOperationError('Tournament access changed during the live-status check.', 409)
    const existing = await tx.tournamentAuditLog.findMany({ where: { tournamentId, action: ACTION, targetId: gameId }, orderBy: { createdAt: 'asc' }, take: 101 })
    if (existing.length >= 100) throw new BlueprintOperationError('Game-status observation limit reached; review the saved evidence.', 409)
    const observations = existing.map(row => readReceipt(row.data, manifest.manifestHash, manifest.rulesHash))
    const impact = await readSeasonGameStartImpact(tx, manifest, tournamentId, freezeId, gameId, original.period!)
    const payload = { version: 1 as const, manifestHash: manifest.manifestHash, rulesHash: manifest.rulesHash, ...observation }
    await tx.tournamentAuditLog.create({ data: { tournamentId, action: ACTION, actorType: 'system', actorId: null, targetType: 'provider_game', targetId: gameId, data: { ...payload, digest: seasonContractHash(payload) } } })
    const assessment = assessSeasonActualStart([...observations, observation], { providerGameId: gameId, sport: manifest.config.sport, periodStartsAt: window.startsAt, periodEndsAt: window.endsAt, ...(impact.latestLineupLockAt ? { lineupLockedAt: impact.latestLineupLockAt } : {}) })
    return { gameId, status: observation.state, observedAt: observation.observedAt, scheduledAt: observation.scheduledAt, ...assessment, impact, exactStartVerified: false, lineupLockCertified: false, launchReady: false }
  })
}
