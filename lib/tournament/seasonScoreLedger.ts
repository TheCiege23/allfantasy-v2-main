import 'server-only'
import { z } from 'zod'
import { seasonStatBatchSchema, scoreSeasonCanonicalStats, mapSeasonRiNbaStats, type SeasonStatBatch } from './seasonStatAdapter'
import { seasonMatchupScheduleSchema, suggestSeasonRoundRobin, validateSeasonMatchupSchedule, deriveSeasonMatchupOutcomes, type SeasonMatchupSchedule } from './seasonMatchupPolicy'
import type { OpeningStandingWeek } from './seasonFinalizedStandings'
import { readOpeningManifest } from './seasonNativeContract'
import { readSeasonDraftSnapshot } from './seasonDraftRuntime'
import { buildFinalizedOpeningStandings } from './seasonFinalizedStandings'
import { loadSeasonNativeSetup } from './seasonNativeProvisioning'
import { BlueprintOperationError } from './seasonBlueprintStore'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withControlLock } from '@/lib/draft/draftLock'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { assessSeasonDraftCompletion } from './seasonDraftReview'
import { readPreparedSeasonRosterState } from './seasonRosterPreparation'
import { seasonContractHash } from './seasonCalendarVerification'
import { scoringPeriodForGame } from './seasonRules'
import { projectSeasonWeek, seasonWeeklyEvidenceSchema, type SeasonWeeklyEvidence } from './seasonWeeklyProjection'
import { assertSeasonObservedStartsConsistent } from './seasonActualStartGuard'
import { reconcileSeasonStatSnapshots } from './seasonStatSnapshotReconciliation'
import { resolveSeasonLockedProviderGames, resolveSeasonLockedProviderPairs } from './seasonLockedPlayerCoverage'

const id = z.string().min(1).max(200)
const instant = z.string().datetime({ offset: true })
const gameSchema = z.object({ gameId: id, startsAt: instant, playerIds: z.array(id).min(1).max(1000) }).strict()
const batchSchema = z.object({ requestId: id, expectedRevision: z.number().int().min(0), period: z.number().int().positive(), source: id,
  observedAt: instant, coverage: z.enum(['missing', 'provisional', 'complete']), scores: seasonWeeklyEvidenceSchema.shape.scores.max(10000),
}).strict()
export type SeasonScoreBatch = z.infer<typeof batchSchema>
const LIMIT = 250
const statProviderSchema = z.enum(['rolling_insights', 'sleeper'])
type Review = NonNullable<Awaited<ReturnType<typeof assessSeasonDraftCompletion>>>
type LedgerState = { context: Review['context']; session: NonNullable<Review['session']>; rosters: Array<{ rosterId: string; playerIds: string[]; starterIds: string[] }>; expected: { rulesHash: string; rosterHash: string; rosterIds: string[] } }

/** Setup-only internal persistence. No HTTP ingestion route, provider IO or season activation. */
async function preparedLeague<T>(leagueId: string, run: (tx: Prisma.TransactionClient, state: LedgerState) => Promise<T>, ownerId?: string) {
  const locked = await withControlLock(leagueId, () => prisma.$transaction(async tx => {
    return run(tx, await loadPreparedScoringState(tx, leagueId, ownerId))
  }))
  if (!locked.acquired) throw new Error('Tournament scoring is busy. Retry shortly.')
  return locked.value
}
async function loadPreparedScoringState(tx: Prisma.TransactionClient, leagueId: string, ownerId?: string): Promise<LedgerState> {
    const review = await assessSeasonDraftCompletion(leagueId, tx)
    if (!review || review.state !== 'completed' || !review.boardHash || !review.session || !review.context.config.rules) throw new Error('A verified completed opening draft is required.')
    const { context, session, boardHash } = review
    const shell = await tx.tournamentShell.findUnique({ where: { id: context.tournamentId } })
    if (ownerId && shell?.commissionerId !== ownerId) throw new BlueprintOperationError('Only the tournament owner can review or finalize scoring.', 403)
    if (!shell || shell.status !== 'rules_published') throw new Error('The tournament is outside locked setup.')
    if (await readPreparedSeasonRosterState(leagueId, context.manifestHash, boardHash, session.id, tx) !== 'prepared') throw new Error('Verified prepared rosters are required.')
    const receipt = await tx.tournamentAuditLog.findFirst({ where: { tournamentId: context.tournamentId, targetId: leagueId, action: 'season_rosters_prepared' } })
    const rosterHash = (receipt!.data as Record<string, unknown>).rosterHash as string
    const rows = await tx.roster.findMany({ where: { leagueId } })
    const rosters = context.rosterIds.map(rosterId => {
      const data = rows.find(row => row.id === rosterId)!.playerData as any
      return { rosterId, playerIds: data.players as string[], starterIds: data.starters as string[] }
    })
    return { context, session, rosters, expected: { rulesHash: seasonContractHash(context.config.rules), rosterHash, rosterIds: context.rosterIds } }
}
function target(leagueId: string, period: number) { return leagueId + ':' + period }
function verifyReceipt(raw: any, state: LedgerState) {
  if (!raw || typeof raw !== 'object') throw new Error('Malformed scoring receipt.')
  const { digest, ...payload } = raw
  if (payload.version !== 1 || payload.mode !== 'locked_setup' || payload.manifestHash !== state.context.manifestHash || payload.rulesHash !== state.expected.rulesHash || payload.rosterHash !== state.expected.rosterHash || digest !== seasonContractHash(payload)) throw new Error('Scoring receipt differs from its checkpoint.')
  return payload
}
function checkedPeriod(state: any, startsAt: string) {
  const period = scoringPeriodForGame(state.context.config.rules, startsAt)
  if (period === null || period < state.context.config.startWeek || period > state.context.config.firstCutWeek) throw new Error('Only opening-stage scoring periods are supported.')
  return period
}
async function claim(tx: Prisma.TransactionClient, state: any) {
  const saved = await tx.draftSession.updateMany({ where: { id: state.session.id, version: state.session.version, status: 'completed' }, data: { version: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('The scoring checkpoint changed. Refresh and retry.')
}
async function save(tx: any, state: any, leagueId: string, period: number, action: string, resource: string, fields: object, actorId?: string) {
  const payload = { version: 1, mode: 'locked_setup', manifestHash: state.context.manifestHash, rulesHash: state.expected.rulesHash, rosterHash: state.expected.rosterHash, ...fields }
  await tx.tournamentAuditLog.create({ data: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':' + resource), tournamentId: state.context.tournamentId, action, actorType: actorId ? 'user' : 'system', actorId: actorId ?? null, targetType: 'league_period', targetId: target(leagueId, period), data: { ...payload, digest: seasonContractHash(payload) } as any } })
}

/** Captures immutable prepared starters before lock time; never accepts a client-supplied lock timestamp. */
export async function captureSeasonOpeningLineup(leagueId: string, raw: z.infer<typeof gameSchema>) {
  const game = gameSchema.parse(raw)
  if (new Set(game.playerIds).size !== game.playerIds.length) throw new Error('Game players must be distinct.')
  return preparedLeague(leagueId, async (tx, state) => {
    const now = new Date(Date.now()), period = checkedPeriod(state, game.startsAt)
    const rules = state.context.config.rules!
    const window = rules.calendar.periods.find((p: any) => p.number === period)!
    const deadline = rules.lineupLock === 'period_start' ? Date.parse(window.startsAt) : Date.parse(game.startsAt)
    const resource = 'scoring-lineup:' + game.gameId
    const receipt = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':' + resource) } })
    if (receipt) {
      if (receipt.tournamentId !== state.context.tournamentId || receipt.action !== 'season_lineup_locked' || receipt.targetId !== target(leagueId, period)) throw new Error('Lineup receipt binding differs.')
      const data = verifyReceipt(receipt.data, state)
      if (seasonContractHash(data.game) !== seasonContractHash(game)) throw new Error('A locked game cannot be rebound. Schedule correction review is required.')
      return { repeated: true, period, launchReady: false }
    }
    if ((await readFrames(tx, state, leagueId, period)).length >= LIMIT) throw new Error('Opening period snapshot limit exceeded.')
    if (now.getTime() >= deadline) throw new Error('Capture the lineup before its lock deadline; backdating is not permitted.')
    const known = new Set(state.rosters.flatMap((r: any) => r.playerIds))
    if (game.playerIds.some(p => !known.has(p))) throw new Error('Use mapped drafted player identities for game snapshots.')
    await claim(tx, state)
    await save(tx, state, leagueId, period, 'season_lineup_locked', resource, { period, game, lineups: state.rosters.map((r: any) => ({ rosterId: r.rosterId, lockedAt: now.toISOString(), starterIds: r.starterIds })) })
    return { repeated: false, period, launchReady: false }
  })
}

async function readFrames(tx: any, state: any, leagueId: string, period: number) {
  const events = await tx.tournamentAuditLog.findMany({ where: { tournamentId: state.context.tournamentId, action: 'season_lineup_locked', targetId: target(leagueId, period) }, take: LIMIT + 1 })
  if (events.length > LIMIT) throw new Error('Opening period snapshot limit exceeded.')
  return events.map((event: any) => {
    const data = verifyReceipt(event.data, state)
    const game = gameSchema.parse(data.game)
    if (data.period !== period || checkedPeriod(state, game.startsAt) !== period || event.id !== seasonResourceId(state.context.freezeId, state.context.pool.key + ':scoring-lineup:' + game.gameId)) throw new Error('Lineup period binding differs.')
    return { gameId: game.gameId, actualStartsAt: game.startsAt, playerIds: game.playerIds, lineups: data.lineups }
  })
}
function checkSourceStatVersions(evidence: any, versions: Map<string,string>) {
  if(!evidence) return
  for(const game of evidence.raw.games) for(const row of game.rows) {
    const key=JSON.stringify([evidence.raw.provider,game.providerGameId,row.providerPlayerId,row.revision])
    const digest=seasonContractHash({format:evidence.raw.format,status:game.status,actualStartsAt:game.actualStartsAt,stats:row.stats})
    if(versions.has(key)&&versions.get(key)!==digest) throw new Error('Conflicting source stat revision.')
    versions.set(key,digest)
  }
}
async function readHead(tx: any, state: any, leagueId: string, period: number) {
  const events = await tx.tournamentAuditLog.findMany({ where: { tournamentId: state.context.tournamentId, action: 'season_scores_ingested', targetId: target(leagueId, period) }, take: LIMIT + 1 })
  if (events.length > LIMIT) throw new Error('Opening period revision limit exceeded.')
  const ledgers = events.map((event: any) => {
    const data = verifyReceipt(event.data, state)
    const evidence = seasonWeeklyEvidenceSchema.parse(data.evidence)
    if (evidence.period !== period || !Number.isSafeInteger(data.revision) || data.revision < 1 || event.id !== seasonResourceId(state.context.freezeId, state.context.pool.key + ':scoring-batch:' + data.requestId)) throw new Error('Score ledger binding differs.')
    return { ...data, evidence, digestValue: (event.data as any).digest }
  }).sort((a: any, b: any) => a.revision - b.revision)
  ledgers.forEach((data: any, index: number) => { if (data.revision !== index + 1 || data.previousDigest !== (index ? ledgers[index - 1].digestValue : null)) throw new Error('Score ledger sequence differs.') })
  // Chain uses each persisted payload digest, not mutable query ordering or timestamps.
  const statVersions = new Map<string, string>()
  let priorStatSnapshot: unknown = null
  for (const ledger of ledgers) {
    checkSourceStatVersions(ledger.statEvidence, statVersions)
    if (ledger.statEvidence) {
      const expected = reconcileSeasonStatSnapshots(priorStatSnapshot, ledger.statEvidence.raw)
      if (seasonContractHash(expected) !== seasonContractHash(ledger.statEvidence.reconciliation)) throw new Error('Stat reconciliation receipt differs from full-period history.')
      priorStatSnapshot = ledger.statEvidence.raw
    }
  }
  const head = ledgers.at(-1)
  return head ? { ...head, statVersions } : null
}

/** Internal trusted-adapter boundary. Fetch/map/score/reconcile outside this transaction. */
async function persistSeasonScoreBatch(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, batch: SeasonScoreBatch, statEvidence?: Record<string, unknown>) {
    const requestHash = seasonContractHash(statEvidence ? { batch, statEvidence } : batch)
    const window = state.context.config.rules!.calendar.periods.find((p: any) => p.number === batch.period)
    if (!window || checkedPeriod(state, window.startsAt) !== batch.period) throw new Error('Unknown opening period.')
    const frames = await readFrames(tx, state, leagueId, batch.period)
    await assertSeasonObservedStartsConsistent(tx, { tournamentId: state.context.tournamentId, manifestHash: state.context.manifestHash,
      rulesHash: state.context.rulesHash, sport: state.context.config.sport, periodStartsAt: window.startsAt, periodEndsAt: window.endsAt }, frames)
    const prior = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':scoring-batch:' + batch.requestId) } })
    if (prior) {
      if (prior.tournamentId !== state.context.tournamentId || prior.action !== 'season_scores_ingested' || prior.targetId !== target(leagueId, batch.period)) throw new Error('Score request binding differs.')
      const data = verifyReceipt(prior.data, state)
      if (data.requestHash !== requestHash) throw new Error('Score request ID was reused with different content.')
      return { repeated: true, revision: data.revision, launchReady: false }
    }
    const head = await readHead(tx, state, leagueId, batch.period)
    if (statEvidence) checkSourceStatVersions(statEvidence, new Map(head?.statVersions ?? []))
    if (batch.expectedRevision >= LIMIT) throw new Error('Opening period revision limit exceeded.')
    if (batch.expectedRevision !== (head?.revision ?? 0)) throw new Error('The score ledger revision changed. Refresh and retry.')
    if (head && (!!head.statEvidence !== !!statEvidence || (statEvidence && head.statEvidence.identityDigest !== statEvidence.identityDigest))) throw new Error('Scoring identity provenance changed. Reconciliation is required.')
    if (head && (head.evidence.source !== batch.source || Date.parse(batch.observedAt) < Date.parse(head.evidence.observedAt))) throw new Error('Score source or observation order differs.')
    const reconciliation = statEvidence ? reconcileSeasonStatSnapshots(head?.statEvidence?.raw ?? null, statEvidence.raw) : null
    const evidence: SeasonWeeklyEvidence = { sport: state.context.config.sport, period: batch.period, rulesHash: state.expected.rulesHash, rosterHash: state.expected.rosterHash, source: batch.source, coverage: batch.coverage, observedAt: batch.observedAt,
      rosters: state.rosters.map((r: any) => ({ rosterId: r.rosterId, playerIds: r.playerIds })),
      games: frames.filter((g: any) => Date.parse(g.actualStartsAt) <= Date.parse(batch.observedAt)), scores: [...(head?.evidence.scores ?? []), ...batch.scores],
    }
    const history = new Map<string, SeasonScoreBatch['scores'][number]>()
    for (const score of evidence.scores) {
      const key = JSON.stringify([score.gameId, score.playerId, score.revision]), prior = history.get(key)
      if (prior && (Math.round(prior.points * 10000) !== Math.round(score.points * 10000) || prior.status !== score.status)) throw new Error('Conflicting score revision.')
      if (!prior) history.set(key, score)
    }
    evidence.scores = [...history.values()]
    if (evidence.scores.length > 10000) throw new Error('Period score history limit exceeded.')
    if (batch.coverage === 'complete' && evidence.games.length !== frames.length) throw new Error('Coverage cannot be complete while captured games have not started.')
    const projection = projectSeasonWeek(state.context.config.rules!, state.expected, evidence, new Date(Date.now()))
    await claim(tx, state)
    await save(tx, state, leagueId, batch.period, 'season_scores_ingested', 'scoring-batch:' + batch.requestId, { requestId: batch.requestId, requestHash, revision: batch.expectedRevision + 1, previousDigest: head?.digestValue ?? null, evidence, ...(statEvidence ? { statEvidence: { ...statEvidence, reconciliation } } : {}) })
    return { repeated: false, revision: batch.expectedRevision + 1, projection, ...(reconciliation ? { reconciliation } : {}), launchReady: false }
}

type DraftIdentityBinding = { id: string; playerId: string; canonicalPlayerId: string; providerPlayerId: string; provider: string; sport: string; leagueKey: string | null; sourceRecordId: string }
function sourceRowMatches(row: {id:string;sport:string;source:string;externalId:string;sleeperId:string|null}|undefined, provider: string, sport: string, draftId: string) {
  return Boolean(row && row.sport === sport && (provider === 'sleeper' ? sport === 'NFL' && row.sleeperId === draftId : provider === 'rolling_insights' && sport === 'NBA' && row.source === 'rolling_insights' && row.externalId === draftId && !row.sleeperId))
}
function draftIdentityResource(provider: string) { return 'scoring-draft-identity:' + provider }
/** An immutable provider-namespace crosswalk, recorded only when every prepared draft ID exactly
 * matches one current verified provider ID. No names or numeric resemblance are used. */
export async function recordSeasonDraftProviderBridge(leagueId: string, rawProvider: 'rolling_insights' | 'sleeper') {
  const provider = statProviderSchema.parse(rawProvider)
  return preparedLeague(leagueId, async (tx, state) => {
    const ids = state.rosters.flatMap(r => r.playerIds), sport = state.context.config.sport, now = Date.now()
    if (new Set(ids).size !== ids.length) throw new Error('Prepared draft player IDs must be unique.')
    const catalog = await readSeasonDraftSnapshot(leagueId, state.context.manifestHash, tx)
    if (!catalog) throw new Error('The frozen draft catalog is unavailable for source verification.')
    const catalogPlayers = ids.map(id => catalog.players.find(p => p.playerId === id))
    if (catalogPlayers.some(p => !p?.draftIdProvenance || p.draftIdProvenance.namespace !== provider || !p.draftIdProvenance.sourceRecordId)) throw new Error('Every drafted ID needs verified source-namespace evidence in the frozen catalog.')
    const sourceRows = await tx.sportsPlayer.findMany({ where: { id: { in: catalogPlayers.map(p => p!.draftIdProvenance!.sourceRecordId!) } } })
    if (catalogPlayers.some((p, i) => !sourceRowMatches(sourceRows.find(row => row.id === p!.draftIdProvenance!.sourceRecordId), provider, sport, ids[i]!))) throw new Error('The recorded draft source no longer matches its provider ID.')
    const rows = await tx.playerProviderIdentity.findMany({ where: { provider, sportKey: sport, verified: true, providerPlayerId: { in: ids } } })
    const bindings: DraftIdentityBinding[] = ids.map((playerId, index) => {
      const matches = rows.filter(row => row.providerPlayerId === playerId)
      if (matches.length !== 1 || !matches[0]!.playerId || (matches[0]!.expiresAt && matches[0]!.expiresAt.getTime() <= now)) throw new Error('Every drafted provider ID needs one current verified canonical player identity.')
      const row = matches[0]!
      return { id: row.id, playerId, canonicalPlayerId: row.playerId!, providerPlayerId: row.providerPlayerId, provider, sport, leagueKey: row.leagueKey, sourceRecordId: catalogPlayers[index]!.draftIdProvenance!.sourceRecordId! }
    })
    if (new Set(bindings.map(b => b.canonicalPlayerId)).size !== bindings.length) throw new Error('Two drafted IDs resolve to the same canonical player.')
    const resource = draftIdentityResource(provider)
    const existing = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':' + resource) } })
    if (existing) {
      if (existing.tournamentId !== state.context.tournamentId || existing.action !== 'season_draft_provider_bridge_locked' || existing.targetId !== target(leagueId, 0)) throw new Error('Draft identity bridge binding differs.')
      const data = verifyReceipt(existing.data, state)
      if (data.provider !== provider || seasonContractHash(data.bindings) !== seasonContractHash(bindings)) throw new Error('Verified draft identity bridge changed. Reconciliation is required.')
      return { repeated: true, players: bindings.length, launchReady: false }
    }
    await claim(tx, state)
    await save(tx, state, leagueId, 0, 'season_draft_provider_bridge_locked', resource, { provider, namespace: 'provider_player_id', bindings })
    return { repeated: false, players: bindings.length, launchReady: false }
  })
}
async function readSeasonDraftProviderBridge(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, provider: string) {
  const event = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':' + draftIdentityResource(provider)) } })
  if (!event) return null
  if (event.tournamentId !== state.context.tournamentId || event.action !== 'season_draft_provider_bridge_locked' || event.targetId !== target(leagueId, 0)) throw new Error('Draft identity bridge binding differs.')
  const data = verifyReceipt(event.data, state)
  const ids = state.rosters.flatMap(r => r.playerIds)
  if (data.provider !== provider || data.namespace !== 'provider_player_id' || !Array.isArray(data.bindings) || data.bindings.length !== ids.length || data.bindings.some((b: DraftIdentityBinding, i: number) => b.playerId !== ids[i] || b.providerPlayerId !== ids[i] || b.provider !== provider || b.sport !== state.context.config.sport || !b.canonicalPlayerId || !b.id || !b.sourceRecordId) || new Set(data.bindings.map((b: DraftIdentityBinding) => b.canonicalPlayerId)).size !== ids.length) throw new Error('Draft identity bridge differs from the prepared roster.')
  const catalog = await readSeasonDraftSnapshot(leagueId, state.context.manifestHash, tx)
  if (!catalog || data.bindings.some((b: DraftIdentityBinding) => { const p = catalog.players.find(p => p.playerId === b.playerId); return p?.draftIdProvenance?.namespace !== provider || p.draftIdProvenance.sourceRecordId !== b.sourceRecordId })) throw new Error('Draft identity source evidence changed. Reconciliation is required.')
  const sourceRows = await tx.sportsPlayer.findMany({ where: { id: { in: data.bindings.map((b: DraftIdentityBinding) => b.sourceRecordId) } } })
  if (data.bindings.some((b: DraftIdentityBinding) => !sourceRowMatches(sourceRows.find(row => row.id === b.sourceRecordId), provider, state.context.config.sport, b.playerId))) throw new Error('Draft identity source record changed. Reconciliation is required.')
  const registry = await tx.playerProviderIdentity.findMany({ where: { id: { in: data.bindings.map((b: DraftIdentityBinding) => b.id) }, verified: true } })
  for (const b of data.bindings as DraftIdentityBinding[]) {
    const row = registry.find(r => r.id === b.id)
    if (!row || row.playerId !== b.canonicalPlayerId || row.providerPlayerId !== b.providerPlayerId || row.provider !== provider || row.sportKey !== b.sport || row.leagueKey !== b.leagueKey || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) throw new Error('Verified draft identity bridge changed. Reconciliation is required.')
  }
  return { bindings: data.bindings as DraftIdentityBinding[], digest: (event.data as any).digest as string }
}

/** Read one league's hash-verified locked game/player receipts and current provider mappings.
 * Provider IDs stay server-side; missing mappings remain unresolved rather than becoming zeroes. */
export async function readSeasonOpeningLockedProviderPairs(leagueId: string, period: number, ownerId: string) {
  return preparedLeague(leagueId, async (tx, state) => {
    const window = state.context.config.rules!.calendar.periods.find(item => item.number === period)
    if (!window || checkedPeriod(state, window.startsAt) !== period) throw new Error('Unknown opening scoring period.')
    const frames = await readFrames(tx, state, leagueId, period) as Array<{ gameId: string; playerIds: string[] }>
    const provider = 'rolling_insights', sport = state.context.config.sport
    const bridge = await readSeasonDraftProviderBridge(tx, state, leagueId, provider)
    const playerIds = [...new Set(frames.flatMap(frame => frame.playerIds))]
    const direct = bridge ? [] : await tx.playerProviderIdentity.findMany({ where: { provider, sportKey: sport, verified: true, playerId: { in: playerIds } } })
    const gameIds = [...new Set(frames.map(frame => frame.gameId))]
    const scopedGames = await tx.gameProviderIdentity.findMany({ where: { provider, sportKey: sport, verified: true, gameId: { in: gameIds } } })
    const reverseGames = scopedGames.length ? await tx.gameProviderIdentity.findMany({ where: { provider, sportKey: sport, verified: true,
      providerGameId: { in: [...new Set(scopedGames.map(game => game.providerGameId))] } } }) : []
    const games = [...new Map([...scopedGames, ...reverseGames].map(game => [game.id, game])).values()]
    const playerIdentities = bridge ? bridge.bindings.map(binding => ({ playerId: binding.playerId, providerPlayerId: binding.providerPlayerId, expiresAt: null })) : direct
    const drafted = new Set(state.rosters.flatMap(roster => roster.playerIds))
    const assigned = new Set(frames.flatMap(frame => frame.playerIds))
    const draftedWithoutLockedGamePlayerIds = [...drafted].filter(id => !assigned.has(id))
    const now = new Date()
    return { ...resolveSeasonLockedProviderPairs({ frames, playerIdentities, gameIdentities: games, now }),
      gameBindings: resolveSeasonLockedProviderGames({ frames, gameIdentities: games, now }),
      draftedPlayers: drafted.size, draftedPlayersWithoutLockedGame: draftedWithoutLockedGamePlayerIds.length,
      draftedWithoutLockedGamePlayerIds }
  }, ownerId)
}

/** Low-level internal numeric ingest; stat-adapter receipts cannot mix with unverified point batches. */
export async function ingestSeasonOpeningScores(leagueId: string, raw: SeasonScoreBatch) {
  const batch = batchSchema.parse(raw)
  return preparedLeague(leagueId, (tx,state)=>persistSeasonScoreBatch(tx,state,leagueId,batch))
}

/** Trusted worker boundary. Provider fetching, actual-start proof and coverage reconciliation happen outside locks. */
export async function ingestSeasonOpeningStatEvidence(leagueId: string, raw: SeasonStatBatch) {
  const input=seasonStatBatchSchema.parse(raw)
  if(JSON.stringify(input).length>2000000) throw new Error('Scoring evidence batch exceeds the storage limit.')
  return preparedLeague(leagueId,async(tx,state)=>{
    const sport=state.context.config.sport, now=Date.now()
    if((sport==='NBA'&&((input.format!=='nba_ri_box_v1'&&input.format!=='canonical_game_v1')||input.provider!=='rolling_insights'))||(sport==='NFL'&&input.format!=='nfl_canonical_game_v1'&&input.format!=='canonical_game_v1')) throw new Error('Provider stat format differs from the frozen sport.')
    const playerIds=state.rosters.flatMap(r=>r.playerIds)
    const bridge=await readSeasonDraftProviderBridge(tx,state,leagueId,input.provider)
    let bindings: Array<{id:string;playerId:string;canonicalPlayerId?:string;providerPlayerId:string;provider:string;sport:string;leagueKey:string|null}>
    if (bridge) bindings=bridge.bindings
    else {
      const identities=await tx.playerProviderIdentity.findMany({where:{provider:input.provider,sportKey:sport,verified:true,playerId:{in:playerIds}}})
      const providerIds=new Set<string>()
      for(const playerId of playerIds) {
        const matches=identities.filter(i=>i.playerId===playerId)
        if(matches.length!==1||!matches[0]!.providerPlayerId||(matches[0]!.expiresAt&&matches[0]!.expiresAt.getTime()<=now)||providerIds.has(matches[0]!.providerPlayerId)) throw new Error('Every drafted player needs one current, unambiguous verified provider identity. No name matching is allowed.')
        providerIds.add(matches[0]!.providerPlayerId)
      }
      bindings=playerIds.map(playerId=>{const row=identities.find(i=>i.playerId===playerId)!;return {id:row.id,playerId,providerPlayerId:row.providerPlayerId,provider:row.provider,sport:row.sportKey,leagueKey:row.leagueKey}})
    }
    const identityDigest=seasonContractHash(bindings)
    const gameRows=await tx.gameProviderIdentity.findMany({where:{provider:input.provider,sportKey:sport,verified:true,providerGameId:{in:input.games.map(g=>g.providerGameId)}}})
    const frames=await readFrames(tx,state,leagueId,input.period)
    const seenGames=new Set<string>(), canonicalGames=new Set<string>(), scores: SeasonScoreBatch['scores']=[], games: Array<{identityId:string;gameId:string;providerGameId:string;actualStartsAt:string}>=[]
    for(const game of input.games) {
      if(seenGames.has(game.providerGameId)) throw new Error('Duplicate provider game in stat evidence.')
      seenGames.add(game.providerGameId)
      const matches=gameRows.filter(r=>r.providerGameId===game.providerGameId)
      if(matches.length!==1||!matches[0]!.gameId||(matches[0]!.expiresAt&&matches[0]!.expiresAt.getTime()<=now)) throw new Error('A current verified game identity is required.')
      const identity=matches[0]!,frame=frames.find((f:any)=>f.gameId===identity.gameId)
      if(!frame||Date.parse(frame.actualStartsAt)!==Date.parse(game.actualStartsAt)||scoringPeriodForGame(state.context.config.rules!,game.actualStartsAt)!==input.period) throw new Error('Actual game start differs from the locked window. Postponement reconciliation is required.')
      if(canonicalGames.has(identity.gameId!)) throw new Error('Duplicate canonical game in stat evidence.')
      canonicalGames.add(identity.gameId!)
      games.push({identityId:identity.id,gameId:identity.gameId!,providerGameId:game.providerGameId,actualStartsAt:game.actualStartsAt})
      const seenPlayers=new Set<string>()
      for(const row of game.rows) {
        if(seenPlayers.has(row.providerPlayerId)) throw new Error('Duplicate player/game stat row.')
        seenPlayers.add(row.providerPlayerId)
        const binding=bindings.find(b=>b.providerPlayerId===row.providerPlayerId)
        if(!binding||!frame.playerIds.includes(binding.playerId)) throw new Error('Stat row lacks a verified drafted player/game binding.')
        const canonical=input.format==='nba_ri_box_v1'?mapSeasonRiNbaStats(state.context.config.rules!,row.stats):row.stats
        const points=scoreSeasonCanonicalStats(state.context.config.rules!,canonical)
        scores.push({gameId:identity.gameId!,playerId:binding.playerId,revision:row.revision,status:game.status,points})
      }
      if(input.coverage==='complete'&&frame.playerIds.some((playerId:string)=>!game.rows.some(row=>bindings.find(b=>b.providerPlayerId===row.providerPlayerId)?.playerId===playerId))) throw new Error('Complete coverage requires explicit stats for every locked game player.')
    }
    if(scores.length>10000) throw new Error('Scoring evidence has too many player rows.')
    // Complete coverage requires the worker's full current period reconciliation, not just correction deltas.
    if(input.coverage==='complete'&&(seenGames.size!==frames.length||frames.some((f:any)=>!games.some(g=>g.gameId===f.gameId)))) throw new Error('Complete coverage must reconcile every locked game.')
    const batch: SeasonScoreBatch={requestId:input.requestId,expectedRevision:input.expectedRevision,period:input.period,source:input.provider+':'+input.format,observedAt:input.observedAt,coverage:input.coverage,scores}
    return persistSeasonScoreBatch(tx,state,leagueId,batch,{version:1,identityDigest,bindings,games,raw:input,...(bridge?{bridgeDigest:bridge.digest}:{})})
  })
}

async function verifyCurrentStatIdentities(tx: Prisma.TransactionClient, state: LedgerState, evidence: any) {
  if(!evidence) return
  if(evidence.version!==1||!Array.isArray(evidence.bindings)||!Array.isArray(evidence.games)||seasonContractHash(evidence.bindings)!==evidence.identityDigest) throw new Error('Malformed stat provenance receipt.')
  if (evidence.bridgeDigest) {
    const bridge = await readSeasonDraftProviderBridge(tx, state, seasonResourceId(state.context.freezeId, state.context.pool.key), evidence.raw.provider)
    if (!bridge || bridge.digest !== evidence.bridgeDigest || seasonContractHash(bridge.bindings) !== seasonContractHash(evidence.bindings)) throw new Error('Draft identity bridge changed. Reconciliation is required.')
  }
  const drafted = new Set(state.rosters.flatMap(r => r.playerIds))
  if (evidence.bindings.length !== drafted.size || evidence.bindings.some((b:any) => !drafted.has(b.playerId))) throw new Error('Scoring player binding differs from the prepared roster.')
  const players=await tx.playerProviderIdentity.findMany({where:{id:{in:evidence.bindings.map((b:any)=>b.id)},verified:true}})
  for(const binding of evidence.bindings) {
    const row=players.find(r=>r.id===binding.id)
    if(!row||row.playerId!==(binding.canonicalPlayerId ?? binding.playerId)||row.providerPlayerId!==binding.providerPlayerId||row.sportKey!==state.context.config.sport||row.provider!==binding.provider||row.leagueKey!==binding.leagueKey||(row.expiresAt&&row.expiresAt.getTime()<=Date.now())) throw new Error('Verified scoring player identity changed. Reconciliation is required.')
  }
  const games=await tx.gameProviderIdentity.findMany({where:{id:{in:evidence.games.map((g:any)=>g.identityId)},verified:true}})
  for(const binding of evidence.games) {
    const row=games.find(r=>r.id===binding.identityId)
    if(!row||row.gameId!==binding.gameId||row.providerGameId!==binding.providerGameId||row.provider!==evidence.raw.provider||row.sportKey!==state.context.config.sport||(row.expiresAt&&row.expiresAt.getTime()<=Date.now())) throw new Error('Verified scoring game identity changed. Reconciliation is required.')
  }
}

async function checkedWeek(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, period: number) {
  if (!Number.isInteger(period) || period < 1) throw new Error('A scoring period is required.')
  const window = state.context.config.rules!.calendar.periods.find(p => p.number === period)
  if (!window || checkedPeriod(state, window.startsAt) !== period) throw new Error('Unknown opening period.')
  const allFrames = await readFrames(tx, state, leagueId, period)
  await assertSeasonObservedStartsConsistent(tx, { tournamentId: state.context.tournamentId, manifestHash: state.context.manifestHash,
    rulesHash: state.context.rulesHash, sport: state.context.config.sport, periodStartsAt: window.startsAt, periodEndsAt: window.endsAt }, allFrames)
  const head = await readHead(tx, state, leagueId, period)
  if (!head) return { window, head: null, projection: null }
  await verifyCurrentStatIdentities(tx, state, head.statEvidence)
  const frames = allFrames.filter((g: any) => Date.parse(g.actualStartsAt) <= Date.parse(head.evidence.observedAt))
  const ordered = (games: any[]) => [...games].sort((a, b) => a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0)
  if (seasonContractHash(ordered(frames)) !== seasonContractHash(ordered(head.evidence.games))) throw new Error('The persisted lineup set changed. Reconciliation is required.')
  const projection = projectSeasonWeek(state.context.config.rules!, state.expected, head.evidence, new Date(Date.now()))
  return { window, head, projection }
}

/** DB-only internal readback. Owner APIs must project safe counts rather than player evidence. */
export async function readSeasonOpeningScoreLedger(leagueId: string, period: number) {
  return preparedLeague(leagueId, async (tx, state) => {
    const { head, projection } = await checkedWeek(tx, state, leagueId, period)
    if (!head || !projection) return { state: 'missing' as const, revision: 0, launchReady: false }
    return { state: projection.canFinalize ? 'eligible' as const : 'provisional' as const, revision: head.revision, projection, launchReady: false }
  })
}

export type SeasonWeekReport = {
  key: string; period: number; mode: 'locked_setup'; state: 'missing' | 'provisional' | 'ready' | 'finalized';
  revision: number; reviewToken?: string; teams: number; missingResults: number; provisionalResults: number;
  statRefresh?: { baselineRows: number; correctedRows: number; backfilledRows: number; statusChangedGames: number };
  blockers: string[]; finalizesAt: string; finalizedAt?: string; canFinalize: boolean; launchReady: false;
}
async function ownerLeague(userId: string, tournamentId: string, freezeId: string, key: string) {
  const setup = await loadSeasonNativeSetup(userId, tournamentId)
  if (!setup || setup.freezeId !== freezeId) throw new BlueprintOperationError('Reload the current frozen setup.', 409)
  const league = setup.leagues.find(l => l.key === key)
  if (!league?.leagueId) throw new BlueprintOperationError('Create this opening league first.', 409)
  return league.leagueId
}
function ownerBinding(state: LedgerState, tournamentId: string, freezeId: string, key: string) {
  if (state.context.tournamentId !== tournamentId || state.context.freezeId !== freezeId || state.context.pool.key !== key) throw new BlueprintOperationError('Reload the current frozen setup.', 409)
}
function finalResource(period: number, revision: number) { return 'scoring-final:' + period + ':' + revision }
async function finalReceipt(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, period: number, head: any, projection: NonNullable<Awaited<ReturnType<typeof checkedWeek>>['projection']>) {
  const event = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':' + finalResource(period, head.revision)) } })
  if (!event) return null
  const data = verifyReceipt(event.data, state)
  if (event.tournamentId !== state.context.tournamentId || event.action !== 'season_week_finalized_setup' || event.targetId !== target(leagueId, period) || data.period !== period || data.revision !== head.revision || data.ledgerDigest !== head.digestValue || data.totalsHash !== seasonContractHash(projection.teams) || !Number.isFinite(Date.parse(data.finalizedAt))) throw new Error('The weekly finalization receipt differs from current evidence.')
  return data
}

async function matchupWindow(state: LedgerState, period: number) {
  const window = state.context.config.rules!.calendar.periods.find(p => p.number === period)
  if (!window || checkedPeriod(state, window.startsAt) !== period) throw new Error('Unknown opening matchup period.')
  return window
}
async function lockedMatchupSchedule(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, period: number) {
  const window = await matchupWindow(state, period)
  const prior = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':scoring-matchups:' + period) } })
  if (!prior) return null
  if (prior.tournamentId !== state.context.tournamentId || prior.action !== 'season_matchups_locked' || prior.targetId !== target(leagueId, period)) throw new Error('Matchup schedule binding differs.')
  const data = verifyReceipt(prior.data, state), schedule = validateSeasonMatchupSchedule(data.schedule, state.context.rosterIds)
  if (schedule.period !== period || !Number.isFinite(Date.parse(data.lockedAt)) || Date.parse(data.lockedAt) >= Date.parse(window.startsAt)) throw new Error('Matchup publication checkpoint differs.')
  return { schedule, lockedAt: data.lockedAt as string }
}
async function persistLockedMatchups(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, input: SeasonMatchupSchedule, actorId?: string) {
  const schedule = validateSeasonMatchupSchedule(input, state.context.rosterIds), window = await matchupWindow(state, schedule.period)
  const prior = await lockedMatchupSchedule(tx, state, leagueId, schedule.period)
  if (prior) {
    if (seasonContractHash(prior.schedule) !== seasonContractHash(schedule)) throw new Error('Locked fantasy opponents cannot be rebound.')
    return { repeated: true, launchReady: false }
  }
  if (Date.now() >= Date.parse(window.startsAt)) throw new BlueprintOperationError('Publish fantasy matchups before the scoring week starts; backdating is not permitted.', 409)
  await claim(tx, state)
  const lockedAt = new Date(Date.now())
  if (lockedAt.getTime() >= Date.parse(window.startsAt)) throw new BlueprintOperationError('The publication deadline passed. This schedule was not saved.', 409)
  await save(tx, state, leagueId, schedule.period, 'season_matchups_locked', 'scoring-matchups:' + schedule.period, { schedule, lockedAt: lockedAt.toISOString() }, actorId)
  return { repeated: false, launchReady: false }
}
/** Internal scheduler boundary. Pairings must be published before the scoring period starts. */
export async function captureSeasonOpeningMatchups(leagueId: string, raw: SeasonMatchupSchedule) {
  const input = seasonMatchupScheduleSchema.parse(raw)
  return preparedLeague(leagueId, (tx, state) => persistLockedMatchups(tx, state, leagueId, input))
}
export type SeasonMatchupPreview = {
  key: string; period: number; state: 'draft' | 'published' | 'closed'; source: string; previewToken: string;
  pairs: Array<{ home: { entryId: string; displayName: string }; away: { entryId: string; displayName: string } }>;
  publishBefore: string; timezone: string; publishedAt?: string; canPublish: boolean; launchReady: false;
}
async function matchupPreview(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, period: number) {
  const window = await matchupWindow(state, period), prior = await lockedMatchupSchedule(tx, state, leagueId, period)
  const schedule = prior?.schedule ?? suggestSeasonRoundRobin(state.context.rosterIds, period, state.context.config.startWeek)
  const previewToken = seasonContractHash({ version: 1, manifestHash: state.context.manifestHash, ...state.expected, publishBefore: window.startsAt, schedule })
  const member = (rosterId: string) => { const entry = state.context.pool.members[state.context.rosterIds.indexOf(rosterId)]!; return { entryId: entry.id, displayName: entry.displayName } }
  const report: SeasonMatchupPreview = { key: state.context.pool.key, period, state: prior ? 'published' : Date.now() >= Date.parse(window.startsAt) ? 'closed' : 'draft', source: schedule.source, previewToken, pairs: schedule.pairs.map(pair => ({ home: member(pair.homeRosterId), away: member(pair.awayRosterId) })), publishBefore: window.startsAt, timezone: state.context.config.rules!.calendar.timezone, publishedAt: prior?.lockedAt, canPublish: !prior && Date.now() < Date.parse(window.startsAt), launchReady: false }
  return { report, schedule }
}
export async function previewSeasonOpeningMatchups(userId: string, tournamentId: string, freezeId: string, key: string, period: number) {
  const leagueId = await ownerLeague(userId, tournamentId, freezeId, key)
  return preparedLeague(leagueId, async (tx, state) => {
    ownerBinding(state, tournamentId, freezeId, key)
    return (await matchupPreview(tx, state, leagueId, period)).report
  }, userId)
}
/** Publishes only the exact current server preview; clients never choose roster IDs, source or lock timestamps. */
export async function publishSeasonOpeningMatchups(userId: string, tournamentId: string, freezeId: string, key: string, period: number, previewToken: string) {
  if (!/^[a-f0-9]{64}$/.test(previewToken)) throw new BlueprintOperationError('Preview this schedule before publishing.', 409)
  const leagueId = await ownerLeague(userId, tournamentId, freezeId, key)
  return preparedLeague(leagueId, async (tx, state) => {
    ownerBinding(state, tournamentId, freezeId, key)
    const current = await matchupPreview(tx, state, leagueId, period)
    if (current.report.previewToken !== previewToken) throw new BlueprintOperationError('Schedule evidence changed. Preview the current pairings again.', 409)
    return persistLockedMatchups(tx, state, leagueId, current.schedule, userId)
  }, userId)
}
async function matchupContext(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, period: number, head: any, projection: NonNullable<Awaited<ReturnType<typeof checkedWeek>>['projection']>) {
  const scheduleEvent = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':scoring-matchups:' + period) } })
  if (!scheduleEvent) return null
  if (scheduleEvent.tournamentId !== state.context.tournamentId || scheduleEvent.action !== 'season_matchups_locked' || scheduleEvent.targetId !== target(leagueId, period)) throw new Error('Matchup schedule binding differs.')
  const data = verifyReceipt(scheduleEvent.data, state), schedule = validateSeasonMatchupSchedule(data.schedule, state.context.rosterIds)
  const window = state.context.config.rules!.calendar.periods.find(p => p.number === period)!
  if (schedule.period !== period || !Number.isFinite(Date.parse(data.lockedAt)) || Date.parse(data.lockedAt) >= Date.parse(window.startsAt)) throw new Error('Fantasy matchup schedule was not locked in time.')
  const final = await finalReceipt(tx, state, leagueId, period, head, projection)
  if (!final || !projection.canFinalize) throw new Error('Finalize current scores before recording matchup outcomes.')
  const results = deriveSeasonMatchupOutcomes(schedule, projection.teams)
  return { results, ledgerDigest: head.digestValue, scheduleDigest: seasonContractHash(data), finalizationDigest: seasonContractHash(final) }
}
async function currentMatchupOutcomes(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, period: number, head: any, projection: NonNullable<Awaited<ReturnType<typeof checkedWeek>>['projection']>) {
  const context = await matchupContext(tx, state, leagueId, period, head, projection)
  if (!context) return null
  const event = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(state.context.freezeId, state.context.pool.key + ':scoring-outcomes:' + period + ':' + head.revision) } })
  if (!event) return null
  const data = verifyReceipt(event.data, state)
  if (event.tournamentId !== state.context.tournamentId || event.action !== 'season_matchup_outcomes_setup' || event.targetId !== target(leagueId, period) || data.period !== period || data.revision !== head.revision || data.ledgerDigest !== context.ledgerDigest || data.scheduleDigest !== context.scheduleDigest || data.finalizationDigest !== context.finalizationDigest || seasonContractHash(data.results) !== seasonContractHash(context.results)) throw new Error('Matchup outcomes differ from current schedule and finalized scores.')
  return context.results
}
async function ensureMatchupOutcomes(tx: Prisma.TransactionClient, state: LedgerState, leagueId: string, period: number, head: any, projection: NonNullable<Awaited<ReturnType<typeof checkedWeek>>['projection']>, needsClaim: boolean, actorId: string) {
  const context = await matchupContext(tx, state, leagueId, period, head, projection)
  if (!context) return
  if (await currentMatchupOutcomes(tx, state, leagueId, period, head, projection)) return
  if (needsClaim) await claim(tx, state)
  await save(tx, state, leagueId, period, 'season_matchup_outcomes_setup', 'scoring-outcomes:' + period + ':' + head.revision, { period, revision: head.revision, ...context }, actorId)
}

/** Owner-only bounded review. Only counts and an opaque evidence token leave this boundary. */
export async function reviewSeasonOpeningWeek(userId: string, tournamentId: string, freezeId: string, key: string, period: number): Promise<SeasonWeekReport> {
  const leagueId = await ownerLeague(userId, tournamentId, freezeId, key)
  return preparedLeague(leagueId, async (tx, state) => {
    ownerBinding(state, tournamentId, freezeId, key)
    const { window, head, projection } = await checkedWeek(tx, state, leagueId, period)
    const base = { key, period, mode: 'locked_setup' as const, teams: state.rosters.length, finalizesAt: window.finalizesAt, launchReady: false as const }
    if (!head || !projection) return { ...base, state: 'missing', revision: 0, missingResults: 0, provisionalResults: 0, blockers: ['No verified score batch is available. Missing scores are not zero.'], canFinalize: false }
    const receipt = await finalReceipt(tx, state, leagueId, period, head, projection)
    const reconciliation = head.statEvidence?.reconciliation
    const statRefresh = reconciliation ? { baselineRows: reconciliation.baselineRows, correctedRows: reconciliation.correctedRows,
      backfilledRows: reconciliation.backfilledRows, statusChangedGames: reconciliation.statusChangedGames } : undefined
    return { ...base, state: receipt && projection.canFinalize ? 'finalized' : projection.canFinalize ? 'ready' : 'provisional', revision: head.revision, reviewToken: head.digestValue, missingResults: projection.teams.reduce((n, t) => n + t.missing.length, 0), provisionalResults: projection.teams.reduce((n, t) => n + t.provisional.length, 0), ...(statRefresh ? { statRefresh } : {}), blockers: projection.blockers, finalizedAt: receipt?.finalizedAt, canFinalize: projection.canFinalize && !receipt }
  }, userId)
}

/** Saves a setup-only finalization receipt. No live standings, wins, cuts or activation. */
export async function finalizeSeasonOpeningWeek(userId: string, tournamentId: string, freezeId: string, key: string, period: number, revision: number, reviewToken: string) {
  if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(reviewToken)) throw new BlueprintOperationError('Review this scoring week before finalizing it.', 409)
  const leagueId = await ownerLeague(userId, tournamentId, freezeId, key)
  return preparedLeague(leagueId, async (tx, state) => {
    ownerBinding(state, tournamentId, freezeId, key)
    const { head, projection } = await checkedWeek(tx, state, leagueId, period)
    if (!head || !projection || head.revision !== revision || head.digestValue !== reviewToken) throw new BlueprintOperationError('Scores changed. Review the current revision before finalizing.', 409)
    if (!projection.canFinalize) throw new BlueprintOperationError('Resolve missing or provisional scores and wait for correction closure.', 409)
    const receipt = await finalReceipt(tx, state, leagueId, period, head, projection)
    if (receipt) { await ensureMatchupOutcomes(tx, state, leagueId, period, head, projection, true, userId); return { finalized: true, repeated: true, revision, launchReady: false } }
    await claim(tx, state)
    await save(tx, state, leagueId, period, 'season_week_finalized_setup', finalResource(period, revision), { period, revision, ledgerDigest: head.digestValue, totalsHash: seasonContractHash(projection.teams), finalizedAt: new Date(Date.now()).toISOString(), teams: projection.teams }, userId)
    await ensureMatchupOutcomes(tx, state, leagueId, period, head, projection, false, userId)
    return { finalized: true, repeated: false, revision, launchReady: false }
  }, userId)
}

/** One read-only repeatable snapshot for the frozen opening field; no client-supplied scores. */
export async function reviewSeasonOpeningStandings(userId: string, tournamentId: string, freezeId: string, throughPeriod: number) {
  // Check access before the larger read, and recheck it inside the snapshot.
  const setup = await loadSeasonNativeSetup(userId, tournamentId)
  if (!setup || setup.freezeId !== freezeId) throw new BlueprintOperationError('Reload the current frozen setup.', 409)
  return prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.commissionerId !== userId) throw new BlueprintOperationError('Only the tournament owner can review standings.', 403)
    if (shell.status !== 'rules_published') throw new BlueprintOperationError('Setup standings are unavailable outside locked setup.', 409)
    const event = await tx.tournamentAuditLog.findFirst({ where: { id: freezeId, tournamentId, action: 'season_opening_field_frozen' } })
    if (!event) throw new BlueprintOperationError('Reload the frozen tournament field.', 409)
    const raw = event.data as Record<string, unknown>, { manifestHash, ...payload } = raw
    if (seasonContractHash(payload) !== manifestHash) throw new Error('Frozen field checksum differs.')
    const manifest = readOpeningManifest(raw), c = manifest.config
    if (!Number.isInteger(throughPeriod) || throughPeriod < c.startWeek || throughPeriod > c.firstCutWeek) throw new BlueprintOperationError('Choose a frozen opening scoring week.', 409)
    const periods = Array.from({ length: throughPeriod - c.startWeek + 1 }, (_, i) => c.startWeek + i)
    const entrants = manifest.leagues.flatMap(pool => pool.members.map(member => ({ id: member.id, displayName: member.displayName, leagueId: seasonResourceId(freezeId, pool.key), leagueKey: pool.key, leagueName: pool.name, rosterId: seasonResourceId(freezeId, pool.key + ':roster:' + member.id) })))
    const weeks: OpeningStandingWeek[] = []
    for (const pool of manifest.leagues) {
      const leagueId = seasonResourceId(freezeId, pool.key)
      let state: LedgerState
      try {
        state = await loadPreparedScoringState(tx, leagueId, userId)
        ownerBinding(state, tournamentId, freezeId, pool.key)
      } catch (e) {
        if (e instanceof BlueprintOperationError && e.status === 403) throw e
        periods.forEach(period => weeks.push({ leagueKey: pool.key, period, state: 'review_required', revision: 0 }))
        continue
      }
      for (const period of periods) {
        try {
          const { head, projection } = await checkedWeek(tx, state, leagueId, period)
          if (!head || !projection) { weeks.push({ leagueKey: pool.key, period, state: 'missing', revision: 0 }); continue }
          const receipt = await finalReceipt(tx, state, leagueId, period, head, projection)
          if (!receipt || !projection.canFinalize) { weeks.push({ leagueKey: pool.key, period, state: 'unfinalized', revision: head.revision }); continue }
          let outcomes: OpeningStandingWeek['outcomes'], matchupsState: OpeningStandingWeek['matchupsState'] = 'missing'
          try { const current = await currentMatchupOutcomes(tx, state, leagueId, period, head, projection); if (current) { outcomes = current; matchupsState = 'verified' } } catch { matchupsState = 'review_required' }
          weeks.push({ leagueKey: pool.key, period, state: 'finalized', revision: head.revision, points: projection.teams.map(t => ({ rosterId: t.rosterId, points: t.points! })), outcomes, matchupsState })
        } catch { weeks.push({ leagueKey: pool.key, period, state: 'review_required', revision: 0 }) }
      }
    }
    return buildFinalizedOpeningStandings({ entrants, periods, weeks, tiebreakers: c.tiebreakers, throughPeriod })
  }, { isolationLevel: 'RepeatableRead', timeout: 15000 })
}
