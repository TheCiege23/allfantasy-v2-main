import { acceptedDailyBoxSource } from '@/lib/sports-data/statCoverage'
import {createScoringLineupContext,readScoringPolicy,type LineupScoringProof} from './nativeLineupScoringContext'
import type { PrismaClient } from '@prisma/client'
import { getDailySportNormalizer, weekWindowFromSeasonStart } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import { bridgeRosterIdsToGameLogIds } from './rosterGameLogIdBridge'
import { normalizeNflTeam } from './lineupLock'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { dailyTeamCode, readDailyTeamNames } from './dailyTeamIdentity'
import { boxCertifiesNoContribution } from '@/lib/sports-data/gameBoxCoverage'
import { coverageGameKey, readStatCoverage, statCoverageCorrectionsReady } from '@/lib/sports-data/statCoverage'

export type HistoricalPlayerState = {
  id: string; rosterId: string; playerId: string; sport: string; position: string
  team: string | null; slotType: string; droppedAt: string | null; playerName?: string
}
export type PlayerStateEvent = {
  sourcePlayerRowId: string; effectiveAtMs: number; sequence: bigint
  afterState: HistoricalPlayerState | null
}
import { NON_SCORING_LINEUP_SLOTS } from './nonScoringLineupSlots'
export function historicalStartersAt(events: readonly PlayerStateEvent[], instant: number, includeBench = false, includeReserves = false): HistoricalPlayerState[] {
  const states = new Map<string, HistoricalPlayerState | null>()
  for (const event of events) {
    if (event.effectiveAtMs > instant) break
    states.set(event.sourcePlayerRowId, event.afterState)
  }
  const active = [...states.values()].filter((p): p is HistoricalPlayerState => !!p && !p.droppedAt)
  const owners = new Map<string, string>()
  for (const player of active) {
    if (owners.has(player.playerId)) throw new Error('LINEUP_HISTORY_DUPLICATE_OWNERSHIP')
    owners.set(player.playerId, player.rosterId)
  }
  return active.filter((p): p is HistoricalPlayerState =>
    !!p && !p.droppedAt && !!p.slotType && (includeReserves || !NON_SCORING_LINEUP_SLOTS.has(p.slotType.toUpperCase()) || (includeBench && ['BENCH','BN'].includes(p.slotType.toUpperCase()))))
}

export function usesLineupHistory(settings: unknown): boolean {
  return !!settings && typeof settings === 'object' && (settings as Record<string, unknown>).lineup_history_version === 1
}

/** History reads deliberately fail closed: a missing migration or past baseline
 * cannot be replaced with today's roster. No provider calls on this path. */
export async function readLineupHistory(db: PrismaClient, leagueId: string, seasonId: string, end: Date, verifiedFrom?: unknown) {
  const epochs = await db.$queryRaw<Array<{ coveredFrom: Date; legacyBaseline: boolean }>>`
    SELECT "coveredFrom", "legacyBaseline" FROM redraft_lineup_history_epochs WHERE "leagueId" = ${leagueId}`
  if (!epochs[0]) throw new Error('LINEUP_HISTORY_NOT_INITIALIZED')
  const events = await db.$queryRaw<PlayerStateEvent[]>`
    SELECT "sourcePlayerRowId", (extract(epoch from "effectiveAt") * 1000)::double precision AS "effectiveAtMs",
      sequence, "afterState" FROM redraft_player_state_events
    WHERE "leagueId" = ${leagueId} AND "seasonId" = ${seasonId} AND "effectiveAt" < ${end}
    ORDER BY "effectiveAt", sequence`
  let boundary = epochs[0]
  if (verifiedFrom !== undefined) {
    const floor = typeof verifiedFrom === 'string' ? new Date(verifiedFrom) : new Date(NaN)
    if (!Number.isFinite(floor.getTime())) throw new Error('LINEUP_HISTORY_INVALID_BASELINE')
    // PostgreSQL retains microseconds; JS game clocks retain milliseconds. Round
    // the gate forward rather than admitting a kickoff just before the repair.
    const microseconds = typeof verifiedFrom === 'string' ? verifiedFrom.match(/\.(\d{3})(\d+)Z$/)?.[2] : undefined
    const floorMs = floor.getTime() + (microseconds && /[1-9]/.test(microseconds) ? 1 : 0)
    boundary = { coveredFrom: new Date(Math.max(boundary.coveredFrom.getTime(), floorMs)), legacyBaseline: true }
  }
  return { ...boundary, events }
}

export type HistoricalContribution = { player: HistoricalPlayerState; stats: Record<string, number>; gameId: string; gameStartsAt?: number }
export type HistoricalPeriod = {
  periodPlayers?: HistoricalPlayerState[]
  contributions: HistoricalContribution[]; eligible: HistoricalPlayerState[]; missingPlayerIds: string[]
  slateFinal: boolean; correctionsReady: boolean; sourceSnapshotReady?: boolean; end: Date; policyProof?:LineupScoringProof
}

export async function loadHistoricalPeriod(db: PrismaClient, args: {
  leagueId: string; seasonId: string; sport: string; season: number; week: number; settings: unknown; includeBench?: boolean; includeReserves?: boolean; periodStartRoster?: boolean; reconcilePolicy?:boolean; includeOwnershipProof?:boolean; completedBefore?:Date
  frozenTournament?: { players: HistoricalPlayerState[]; startsAt: Date; endsAt: Date; now: Date; minimumGames: number }
  /** A saved specialty scoring calendar still uses historical ownership and source coverage. */
  scoringWindow?: { startsAt: Date; endsAt: Date }; requireAtomicNflSnapshot?: boolean
}): Promise<HistoricalPeriod> {
  const sport = args.sport.toUpperCase()
  const normalize = getDailySportNormalizer(sport)
  const frozen = args.frozenTournament
  const custom = args.scoringWindow
  if (custom && (!Number.isFinite(custom.startsAt.getTime()) || !Number.isFinite(custom.endsAt.getTime()) || custom.startsAt >= custom.endsAt)) throw Error('LINEUP_HISTORY_INVALID_SCORING_WINDOW')
  const window = custom ? { start: easternCalendarDay(custom.startsAt)!,
    end: new Date(easternCalendarDay(new Date(custom.endsAt.getTime() - 1))!.getTime() + 86_400_000) } : normalize ? (frozen ? {
    start: easternCalendarDay(frozen.startsAt)!,
    end: new Date(easternCalendarDay(new Date(frozen.endsAt.getTime() - 1))!.getTime() + 86_400_000),
  } : weekWindowFromSeasonStart(resolveDailySportSeasonStart(sport, args.season), args.week)) : null
  if (normalize && !window) throw new Error('LINEUP_HISTORY_SEASON_START_UNKNOWN')
  const start = window ? new Date(window.start) : new Date(Date.UTC(args.season, 0, 1))
  const end = window ? new Date(window.end) : new Date(Date.UTC(args.season + 1, 0, 1))
  const policyData=args.reconcilePolicy?await readScoringPolicy(db,{leagueId:args.leagueId,season:args.season,week:args.week}):null
  const historyEnd=policyData?new Date(Math.ceil(policyData.nowMs)+1):end
  const history = frozen ? { legacyBaseline: false, coveredFrom: new Date(0), events: [] as PlayerStateEvent[] }
    : await readLineupHistory(db, args.leagueId, args.seasonId, historyEnd, (args.settings as Record<string, unknown> | null)?.lineup_history_verified_from)
  const teamNames = normalize ? await readDailyTeamNames(db, sport) : undefined
  const teamCode = (team: string | null | undefined) => sport === 'NFL' ? normalizeNflTeam(team) : dailyTeamCode(sport, team, teamNames)
  if (end <= history.coveredFrom) throw new Error('LINEUP_HISTORY_BEFORE_BASELINE')
  const games = await db.sportsGame.findMany({ where: { sport, ...(sport === 'NFL' ? { season: args.season, week: args.week } : {}), ...(window
    ? { startTime: { gte: start, lt: new Date(end.getTime() + 6 * 3600_000) } }
    : { season: args.season, week: args.week }) } })
  // Daily providers populate `week` inconsistently. Select one source for the
  // fantasy window, not separate feeds for vendor week numbers 0/1/500.
  const slate = pickFreshestSourceRows(games.filter(g=>!policyData||g.fetchedAt<=new Date(policyData.nowMs)).map(g => ({ ...g, week: args.week, season: args.season }))).filter(g => {
    if (!g.startTime || normalizeGameStatus(g.status) === 'cancelled' || /postpon/i.test(g.status ?? '')) return false
    if (frozen && (g.startTime < frozen.startsAt || g.startTime >= frozen.endsAt)) return false
    if (custom && (g.startTime < custom.startsAt || g.startTime >= custom.endsAt)) return false
    if (frozen && frozen.now < frozen.endsAt && (g.startTime > frozen.now || normalizeGameStatus(g.status) !== 'final')) return false
    if (g.seasonType && /pre|post|playoff/i.test(g.seasonType)) return false
    const day = easternCalendarDay(g.startTime)
    return !window || (!!day && day >= start && day < end)
  })
  // Banked totals cannot include a future or partially played game.
  if (args.completedBefore) {
    if (!normalize || !Number.isFinite(args.completedBefore.getTime()) || args.completedBefore > new Date()) throw Error('LINEUP_HISTORY_INVALID_CUTOFF')
    const elapsed = slate.filter(g => g.startTime! < args.completedBefore!)
    if (elapsed.some(g => normalizeGameStatus(g.status) !== 'final')) throw Error('LINEUP_HISTORY_GAME_IN_PROGRESS')
    slate.splice(0, slate.length, ...elapsed)
  }
  const times = slate.map(g => g.startTime!.getTime())
  const firstKickoff = times.length ? Math.min(...times) : null
  const settings = args.settings as Record<string, any> | null
  const weekly = ['weekly', 'weekly_first_game', 'first_game', 'first_game_of_week'].includes(String(settings?.sportConfig?.lineupLockType))
  const firstTeamGameOfDay = new Map<string, number>()
  for (const game of slate) {
    const day = easternCalendarDay(game.startTime!)!.getTime()
    for (const team of [game.homeTeam, game.awayTeam]) {
      const key = `${day}:${teamCode(team)}`
      firstTeamGameOfDay.set(key, Math.min(firstTeamGameOfDay.get(key) ?? Infinity, game.startTime!.getTime()))
    }
  }
  const scoringSeason=policyData?await db.redraftSeason.findFirst({where:{id:args.seasonId,leagueId:args.leagueId},select:{currentWeek:true,status:true}}):null
  const policyContext=policyData&&scoringSeason?createScoringLineupContext({sport,week:args.week,games:slate.map(g=>({key:g.id,startAt:g.startTime!.toISOString(),day:easternCalendarDay(g.startTime!)!.toISOString().slice(0,10),teams:[teamCode(g.homeTeam),teamCode(g.awayTeam)]})),...policyData,history:history.events,coveredFrom:history.coveredFrom.getTime(),settings:args.settings,seasonStatus:scoringSeason.status,currentWeek:scoringSeason.currentWeek,team:teamCode}):null
  if(policyData&&!policyContext)throw Error('LINEUP_POLICY_SEASON_UNAVAILABLE')
  const statesAt = (kickoff: number, team?: string | null, gameId?:string) => {
    if (frozen) return frozen.players
    if(policyContext){
      const game=slate.find(g=>(!gameId||g.id===gameId)&&g.startTime!.getTime()===kickoff&&(!team||[teamCode(g.homeTeam),teamCode(g.awayTeam)].includes(teamCode(team))))
      if(!game)throw Error('LINEUP_POLICY_GAME_UNAVAILABLE')
      return policyContext.select({key:game.id,startAt:game.startTime!.toISOString(),day:easternCalendarDay(game.startTime!)!.toISOString().slice(0,10),teams:[teamCode(game.homeTeam),teamCode(game.awayTeam)]},team?teamCode(team):undefined).map(s=>s.player).filter(p=>args.includeReserves||!NON_SCORING_LINEUP_SLOTS.has(p.slotType.toUpperCase())||(args.includeBench&&['BENCH','BN'].includes(p.slotType.toUpperCase())))
    }

    const day = easternCalendarDay(new Date(kickoff))!.getTime()
    const dailyCutoff = normalize && team ? firstTeamGameOfDay.get(`${day}:${teamCode(team)}`) : null
    const instant = (weekly || args.periodStartRoster) && firstKickoff != null ? firstKickoff : dailyCutoff ?? kickoff
    if (instant < history.coveredFrom.getTime()) throw new Error('LINEUP_HISTORY_BEFORE_BASELINE')
    return historicalStartersAt(history.events, instant, args.includeBench, args.includeReserves)
  }
  const eligible = new Map<string, HistoricalPlayerState>()
  const expectedBoxes = new Map<string, { player: HistoricalPlayerState; game: typeof slate[number] }>()
  for (const game of slate) for (const gameTeam of [game.homeTeam, game.awayTeam]) for (const player of statesAt(game.startTime!.getTime(), gameTeam,game.id)) {
    const team = teamCode(player.team)
    if (team === teamCode(gameTeam)) {
      eligible.set(`${player.rosterId}:${player.playerId}`, player)
      expectedBoxes.set(`${game.id}:${player.rosterId}:${player.playerId}`, { player, game })
    }
  }
  // Best Ball scores the roster locked at the first game, including bench and verified no-game players.
  if (args.periodStartRoster && firstKickoff != null) {
    for (const player of statesAt(firstKickoff)) eligible.set(`${player.rosterId}:${player.playerId}`, player)
  }
  let sourceSnapshotReady = true
  const contributions: HistoricalContribution[] = []
  const missing = new Set<string>(frozen?.players.filter(player => !teamCode(player.team)).map(player => player.playerId))
  const proofs = await readStatCoverage(db, sport, args.season, args.week, start, end)
  if (!normalize) {
    // Full-roster Max PF cannot omit an unknown-team player and reward the
    // franchise with a lower total. Nonparticipants need a verified zero proof.
    const unplaced = args.includeReserves ? [...new Map(times.flatMap(time=>statesAt(time)).filter(p=>!eligible.has(`${p.rosterId}:${p.playerId}`)).map(p=>[`${p.rosterId}:${p.playerId}`,p])).values()] : []
    const ids = [...new Set([...eligible.values(),...unplaced].map(p => p.playerId))]
    const rows = await db.playerWeeklyScore.findMany({ where: { sport, season: args.season, week: args.week, playerId: { in: ids } } })
    const gameKeys = slate.map(game => coverageGameKey(game, normalizeNflTeam)).sort()
    const proof = proofs.find(row => row.kind === 'week' && row.identitySpace === 'sleeper' && row.source === 'sleeper_weekly_stats' &&
      row.week === args.week && JSON.stringify(row.gameKeys) === JSON.stringify(gameKeys))
    // Only verified Sleeper identities may use absence from its complete week
    // map. A synthetic DST or an unresolved roster id still requires its row.
    if (args.requireAtomicNflSnapshot && proof) sourceSnapshotReady = rows.every(row => row.updatedAt instanceof Date && proof.recordedAt instanceof Date && row.updatedAt.getTime() <= proof.recordedAt.getTime())
    const verified = proof ? new Set((await db.playerIdentityMap.findMany({ where: { sport, sleeperId: { in: ids } },
      select: { sleeperId: true } })).flatMap(row => row.sleeperId ? [row.sleeperId] : [])) : new Set<string>()
    for (const player of unplaced) if (!(proof&&verified.has(player.playerId)&&!proof.participantIds.includes(player.playerId))) missing.add(player.playerId)
    for (const player of eligible.values()) {
      const row = rows.find(r => r.playerId === player.playerId)
      if (row?.stats && typeof row.stats === 'object' && !Array.isArray(row.stats) && Object.keys(row.stats).length)
        contributions.push({ player, stats: row.stats as Record<string, number>, gameId: `week:${args.week}` })
      else if (!(proof && verified.has(player.playerId) && !proof.participantIds.includes(player.playerId))) missing.add(player.playerId)
    }
  } else {
    const coveredBoxes = new Set<string>()
    const ids = [...new Set(frozen ? frozen.players.map(p => p.playerId) : history.events.flatMap(e => e.afterState ? [e.afterState.playerId] : []))]
    const bridge = await bridgeRosterIdsToGameLogIds(db, [sport], ids)
    if (bridge.ambiguous.length) throw new Error('LINEUP_HISTORY_AMBIGUOUS_PLAYER_ID')
    const rows = await db.playerGameStat.findMany({ where: { sportType: sport, playerId: { in: bridge.gameLogIds }, gameDate: { gte: start, lt: args.completedBefore ? new Date(Math.min(end.getTime(), args.completedBefore.getTime())) : end } } })
    for (const row of rows) {
      const raw = row.normalizedStatMap as Record<string, any>
      if (raw?.seasonType === 'pre' || raw?.seasonType === 'post') continue
      const candidates = slate.filter(g => g.externalId === row.providerGameId || g.externalId === row.gameId ||
        (row.gameDate && easternCalendarDay(g.startTime!)?.getTime() === row.gameDate.getTime() &&
        (teamCode(row.team) === teamCode(g.homeTeam) || teamCode(row.team) === teamCode(g.awayTeam))))
      const storedTime = typeof raw?.gameStartTimeUtc === 'string' ? Date.parse(raw.gameStartTimeUtc) : NaN
      const kickoff = Number.isFinite(storedTime) ? storedTime : candidates.length === 1 ? candidates[0].startTime!.getTime() : null
      if (frozen && Number.isFinite(storedTime) && (storedTime < frozen.startsAt.getTime() || storedTime >= frozen.endsAt.getTime())) continue
      if (kickoff == null && frozen && frozen.now < frozen.endsAt && !candidates.length) continue
      if (kickoff == null) throw new Error('LINEUP_HISTORY_GAME_TIME_UNRESOLVED')
      const exactGame = candidates.find(g => (g.externalId === row.providerGameId || g.externalId === row.gameId) && g.startTime!.getTime() === kickoff)
        ?? candidates.find(g => g.startTime!.getTime() === kickoff)
      if (!exactGame && frozen && frozen.now < frozen.endsAt) continue
      if (!exactGame) throw new Error('LINEUP_HISTORY_GAME_UNRESOLVED')
      const playerId = bridge.rosterIdFor(row.playerId)
      for (const player of statesAt(kickoff, row.team,exactGame.id).filter(p => p.playerId === playerId)) {
        const boxKey = `${exactGame.id}:${player.rosterId}:${player.playerId}`
        // The measured game may reflect a real-team transfer before roster
        // metadata catches up. Its correction proof is required too.
        expectedBoxes.set(boxKey, { player, game: exactGame })
        if (sport === 'MLB') {
          const pitchingSlot = args.periodStartRoster || ((args.includeBench || args.includeReserves) && NON_SCORING_LINEUP_SLOTS.has(player.slotType.toUpperCase()))
            ? /(^|[\/,|])(P|SP|RP)([\/,|]|$)/.test(player.position.toUpperCase())
            : ['P', 'SP', 'RP'].includes(player.slotType.toUpperCase())
          if ((raw.group === 'pitching') !== pitchingSlot) { coveredBoxes.add(boxKey); continue }
        }
        // Older ingest retained time-on-ice only in the raw source payload.
        const payload = row.statPayload as Record<string, unknown> | null
        const stats = normalize({ ...raw, timeOnIce: raw.timeOnIce ?? payload?.time_on_ice }).stats
        if (!Object.keys(stats).length) { missing.add(player.playerId); continue }
        coveredBoxes.add(boxKey)
        eligible.set(`${player.rosterId}:${player.playerId}`, player)
        contributions.push({ player, stats, gameId: args.reconcilePolicy || frozen || custom ? exactGame.id : row.gameId, ...(frozen || custom ? { gameStartsAt: kickoff } : {}) })
      }
    }
    // Full-roster Max PF must hold unresolved/no-game ownership instead of
    // quietly omitting those players. A measured box can still resolve an old team label.
    if (args.includeReserves) for (const instant of times) for (const player of statesAt(instant))
      if (!eligible.has(`${player.rosterId}:${player.playerId}`)) missing.add(player.playerId)
    // A weekly aggregate cannot certify an absent game box. A complete final
    // API box can certify no stat contribution only for a verified identity
    // absent from its participants; a participant with a missing row stays missing.
    const gameProofs = proofs.filter(proof => proof.kind === 'game' && proof.identitySpace === 'canonical' && acceptedDailyBoxSource(sport, proof.source))
    const canonicalByRoster = new Map<string, string>()
    if (gameProofs.length) for (const row of await db.playerIdentityMap.findMany({ where: { sport, id: { in: bridge.gameLogIds } }, select: { id: true } })) {
      const rosterId = bridge.rosterIdFor(row.id)
      if (rosterId) canonicalByRoster.set(rosterId, row.id)
    }
    for (const [boxKey, { player, game }] of expectedBoxes) {
      if (coveredBoxes.has(boxKey)) continue
      const canonicalId = canonicalByRoster.get(player.playerId)
      const matching = canonicalId ? gameProofs.filter(proof => boxCertifiesNoContribution({ sport: proof.sport, providerGameId: proof.periodId,
        season: proof.season, startTime: proof.startTime, homeTeam: proof.teams[0], awayTeam: proof.teams[1], participantIds: proof.participantIds },
        game, canonicalId, teamCode)) : []
      if (matching.length !== 1) missing.add(player.playerId)
    }
  }
  if (args.periodStartRoster && normalize) {
    for (const player of eligible.values()) if (!teamCode(player.team)) missing.add(player.playerId)
  }
  const slateKeys = slate.map(game => coverageGameKey(game, teamCode)).sort()
  const correctionGames = [...new Map([...expectedBoxes.values()].map(({ game }) => [game.id, game])).values()]
  const correctionsReady = slate.length > 0 && (normalize
    ? correctionGames.every(game => proofs.some(proof => proof.kind === 'game' && proof.identitySpace === 'canonical' &&
      acceptedDailyBoxSource(sport, proof.source) && proof.startTime.getTime() === game.startTime!.getTime() &&
      proof.gameKeys.some(key => {
        try { const [home, away, time] = JSON.parse(key); return JSON.stringify([teamCode(home), teamCode(away), time]) === coverageGameKey(game, teamCode) }
        catch { return false }
      }) && statCoverageCorrectionsReady(proof)))
    : proofs.some(proof => proof.kind === 'week' && proof.identitySpace === 'sleeper' &&
      proof.source === 'sleeper_weekly_stats' && proof.week === args.week &&
      JSON.stringify(proof.gameKeys) === JSON.stringify(slateKeys) && statCoverageCorrectionsReady(proof)))
  // Preserve roster/slot attribution for unresolved full-roster identities.
  // A consumer must not assign another franchise's missing feed to this team.
  const periodPlayers=new Map<string,HistoricalPlayerState>()
  if(args.includeOwnershipProof)for(const instant of times)for(const player of statesAt(instant))periodPlayers.set(player.rosterId+':'+player.playerId+':'+player.slotType,player)
  const policyProof=policyContext?.proof()
  return { ...(policyProof?{policyProof}:{}), ...(args.includeOwnershipProof?{periodPlayers:[...periodPlayers.values()]}:{}), sourceSnapshotReady, contributions, eligible: [...eligible.values()], missingPlayerIds: [...missing], end, correctionsReady:correctionsReady&&(!policyProof||policyProof.closed),
    slateFinal: correctionsReady && slate.length >= (frozen?.minimumGames ?? 1) && slate.every(g => normalizeGameStatus(g.status) === 'final') &&
      Math.max(...times) + 12 * 3600_000 <= (frozen?.now.getTime() ?? Date.now()) &&
      (frozen ? frozen.endsAt <= frozen.now : !normalize || end.getTime() <= (easternCalendarDay(new Date())?.getTime() ?? 0)) }
}
