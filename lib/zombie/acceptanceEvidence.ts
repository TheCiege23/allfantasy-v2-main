import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { getZombieSportConfig } from './sportRulesConfig'
import { ZombieOperationsError } from './seasonOperations'
import { IPHONE_CHECKS } from './acceptanceChecklist'
import { correctionHash } from './beta2025CorrectionPlan'
import { combatTransaction } from './beta2025CombatTransaction'
import { lockItemLeague } from './beta2025ItemService'

async function appendAcceptance(leagueId: string, actor: string, season: number, payload: unknown) {
  return combatTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { userId: true } })
    if (league.userId !== actor && !await tx.roster.count({ where: { leagueId, platformUserId: actor } })) throw new ZombieOperationsError('Current manager access required')
    const latest = await tx.zombieOperationsRecord.aggregate({ where: { scope: `l:${leagueId}`, kind: 'acceptance' }, _max: { createdAt: true } })
    const createdAt = new Date(Math.max(Date.now(), (latest._max.createdAt?.getTime() ?? 0) + 1))
    return tx.zombieOperationsRecord.create({ data: { id: `acceptance:${crypto.randomUUID()}`, scope: `l:${leagueId}`, season, kind: 'acceptance', actorUserId: actor, createdAt, payload: toPrismaJsonInput(payload) } })
  })
}

export const ZOMBIE_ACCEPTANCE_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
/** Stored evidence only: no provider requests, draft starts, or invented acceptance. */
export async function sportAcceptanceEvidence(leagueId: string, actor: string) {
  const z = await prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true } } } })
  if (z.league.userId !== actor) throw new ZombieOperationsError('Head commissioner access required')
  return Promise.all(ZOMBIE_ACCEPTANCE_SPORTS.map(async sport => {
    const cfg = getZombieSportConfig(sport)
    const [stats, seasons, calendars] = await Promise.all([
      prisma.playerWeeklyScore.aggregate({ where: { sport, season: z.season, isFinalized: true }, _count: true, _max: { updatedAt: true } }),
      prisma.redraftSeason.findMany({ where: { sport, season: z.season, league: { userId: actor, zombieLeague: { isNot: null } } }, select: { id: true, leagueId: true } }),
      prisma.sportsGame.count({ where: { sport, season: z.season, source: { in: ['api_sports', 'thesportsdb'] }, startTime: { not: null } } }),
    ])
    const ids = seasons.map(s => s.leagueId)
    const [receipts, configs, leagueRules] = await Promise.all([
      prisma.zombieOperationsRecord.findMany({ where: { scope: { in: ids.map(id => `l:${id}`) }, season: z.season, kind: 'acceptance' }, select: { scope: true, payload: true }, orderBy: { createdAt: 'desc' } }),
      prisma.zombieLeagueConfig.findMany({ where: { leagueId: { in: ids } } }),
      prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, scoringPresetId: true, settings: true } }),
    ])
    const matchups = await prisma.redraftMatchup.findMany({ where: { seasonId: { in: seasons.map(s => s.id) }, isMedianMatchup: false, awayRosterId: { not: null }, status: { in: ['final', 'complete', 'completed'] } }, select: { homeScore: true, awayScore: true, week: true } })
    const margins = matchups.map(m => Math.abs(m.homeScore - m.awayScore)), scores = matchups.flatMap(m => [m.homeScore, m.awayScore]).sort((a, b) => a - b)
    const seen = new Set<string>()
    const evidence = receipts.filter(r => { const key = `${r.scope}:${(r.payload as { type: string }).type}`; if (seen.has(key)) return false; seen.add(key); return true }).map(r => {
      const saved = r.payload as { type: string; passed: boolean; configurationHash?: string }
      if (saved.type !== 'sport_calibration') return { ...saved, scope: r.scope }
      const id = r.scope.slice(2), cfg = configs.find(c => c.leagueId === id), rules = leagueRules.find(l => l.id === id)
      const league = rules ? { scoringPresetId: rules.scoringPresetId, settings: rules.settings } : null
      return { ...saved, scope: r.scope, passed: Boolean(cfg && league && saved.configurationHash === correctionHash({ cfg: { ...cfg, updatedAt: undefined }, league })) }
    })
    const calibration = evidence.some(r => r.type === 'sport_calibration' && r.passed)
    return { sport, policy: sport === 'NFL' ? '2025 NFL rules' : 'Sport-specific policy; calibration approval required', calibrationRecorded: calibration,
      configuredBashing: cfg.bashingThreshold, configuredMauling: cfg.maulingThreshold, savedCalendarGames: calendars,
      finalizedPlayerRows: stats._count, latestPlayerRowAt: stats._max.updatedAt, completedMatchups: matchups.length,
      medianTeamScore: scores.length ? scores[Math.floor(scores.length / 2)] : null,
      observedBashRate: margins.length ? margins.filter(m => m >= cfg.bashingThreshold).length / margins.length : null,
      iphoneAccepted: evidence.some(r => r.type === 'iphone' && r.passed), realWeekAccepted: evidence.some(r => r.type === 'real_week' && r.passed),
      status: evidence.some(r => r.type === 'sport_calibration' && r.passed && evidence.some(w => w.scope === r.scope && w.type === 'real_week' && w.passed) && evidence.some(p => p.scope === r.scope && p.type === 'iphone' && p.passed)) ? 'manager_evidence_recorded' : 'acceptance_pending',
      note: 'Saved row counts and controlled rehearsals do not establish current provider completeness or sport calibration.' }
  }))
}
export async function saveAcceptanceEvidence(leagueId: string, actor: string, input: Record<string, unknown>) {
  const [z, seat] = await Promise.all([
    prisma.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true } } } }),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: actor }, select: { id: true } }),
  ])
  if (!seat && z.league.userId !== actor) throw new ZombieOperationsError('Manager access required')
  if (input.type === 'consent') return prisma.zombieOperationsRecord.upsert({ where: { id: `consent:${leagueId}:${z.season}:${actor}` },
    create: { id: `consent:${leagueId}:${z.season}:${actor}`, scope: `l:${leagueId}`, season: z.season, kind: 'consent', actorUserId: actor, payload: { consents: input.consents === true } }, update: { payload: { consents: input.consents === true } } })
  const note = String(input.note ?? '').trim()
  if (note.length < 20 || note.length > 2000) throw new ZombieOperationsError('Record what you actually tested and any failures')
  if (input.type === 'sport_calibration') {
    if (z.league.userId !== actor || input.providerCalendarReviewed !== true || input.itemEffectsReviewed !== true || input.thresholdsReviewed !== true) throw new ZombieOperationsError('The head commissioner must review the sport calendar, item effects and thresholds')
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId, season: z.season } })
    const matchups = await prisma.redraftMatchup.findMany({ where: { seasonId: season.id, awayRosterId: { not: null }, status: { in: ['final', 'complete', 'completed'] } }, select: { id: true, week: true, homeScore: true, awayScore: true } })
    if (!matchups.length) throw new ZombieOperationsError('Completed scored matchups are required before sport calibration can be recorded')
    const cfg = await prisma.zombieLeagueConfig.findUniqueOrThrow({ where: { leagueId } })
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { scoringPresetId: true, settings: true } })
    return appendAcceptance(leagueId, actor, z.season, { type: 'sport_calibration', passed: true, sport: z.sport, note, reportedByManager: actor, observedAt: new Date().toISOString(), matchups,
      config: cfg, scoring: league, configurationHash: correctionHash({ cfg: { ...cfg, updatedAt: undefined }, league }), providerCalendarReviewed: true, itemEffectsReviewed: true, thresholdsReviewed: true })
  }
  if (input.type === 'iphone') {
    const device = String(input.device ?? '').trim(), ios = String(input.ios ?? '').trim(), checks = input.checks as Record<string, unknown> | undefined
    if (device.length < 3 || device.length > 100 || ios.length < 2 || ios.length > 50 || !checks || IPHONE_CHECKS.some(k => typeof checks[k] !== 'boolean')) throw new ZombieOperationsError('A physical iPhone model, iOS version and every check result are required')
    const payload = { type: 'iphone', device, ios, note, checks: Object.fromEntries(IPHONE_CHECKS.map(k => [k, checks[k]])), passed: IPHONE_CHECKS.every(k => checks[k] === true), reportedByManager: actor, observedAt: new Date().toISOString() }
    return appendAcceptance(leagueId, actor, z.season, payload)
  }
  if (input.type !== 'real_week' || z.league.userId !== actor) throw new ZombieOperationsError('Head commissioner and a valid acceptance type are required')
  const week = Number(input.week)
  if (!Number.isInteger(week) || week < 1 || week > 52) throw new ZombieOperationsError('A valid scoring period is required')
  const [consents, resolution, reports, field] = await Promise.all([
    prisma.zombieOperationsRecord.findMany({ where: { scope: `l:${leagueId}`, season: z.season, kind: 'consent', payload: { path: ['consents'], equals: true } } }),
    prisma.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } } }),
    prisma.zombieAnnouncement.count({ where: { zombieLeagueId: z.id, week, type: 'weekly_update', isPosted: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { platformUserId: true } }),
  ])
  const participants = consents.filter(c => field.some(r => r.platformUserId === c.actorUserId)).map(c => c.actorUserId)
  if (new Set(participants).size < 2 || resolution?.status !== 'complete' || resolution.requiresStatCorrection || z.correctionHoldFromWeek != null || reports < 1) throw new ZombieOperationsError('Two consenting current managers, a completed unheld scoring week and its posted report are required')
  // The commissioner must attest to normal ingestion; a completed fixture can
  // never by itself establish a live scoring window.
  if (input.normalIngestionObserved !== true || input.noSyntheticScores !== true || input.locksAndItemsReviewed !== true) throw new ZombieOperationsError('Confirm normal ingestion, no synthetic scores, and reviewed locks/items')
  return appendAcceptance(leagueId, actor, z.season, { type: 'real_week', passed: true, week, participants, note, reportedByManager: actor, resolutionId: resolution.id, observedAt: new Date().toISOString(), normalIngestionObserved: true, noSyntheticScores: true, locksAndItemsReviewed: true })
}
