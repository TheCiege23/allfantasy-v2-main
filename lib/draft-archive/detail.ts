import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolvePlayerNames } from '@/lib/core-app/draftHq';
import { canViewLeague, isElevatedCommissioner } from '@/server/services/permissionService';
import { draftArchiveCatalog, type ArchiveChoice } from './catalog';
import { object, ARCHIVE_EVENT } from './events';
import { preparationContext, preparationFormatKey, preparationPlayerKey, validPreparationSnapshot, type PreparationContext } from '@/lib/core-app/draftPreparationModel';
import { analysisReadiness } from './analysisBasis';
import { archiveLedger, archiveSequence } from './ledger';
import { draftDayReport, resultsReport, type DraftAnalysisReport, type ResultsReport } from './analysisModel';
import { draftReferences } from './references';
import type { DraftReference } from './referenceModel';
import { readImportedResults } from './importedResults';
import { buildReplay, frozenExistingRoster, decisionComponents, auctionAwardBudget, type ReplayData, type DecisionComponents } from './phase4Model';
import { calibratedScores, type CalibrationModel } from './calibrationModel';
import { readCalibration, loadAssetLineage, dynastyMarks, type LineageReport, type DynastyMark } from './phase4Loader';
import { playerContributions, type PlayerContribution } from './resultsDecisionModel';

export type ArchivePick = {
    id: string;
    overall: number;
    round: number;
    slot: number | null;
    originalRosterId: string | null;
    originalTeamName?: string | null;
    rosterId: string | null;
    teamName: string | null;
    actor: string | null;
    actorName?: string | null;
    playerId: string | null;
    playerName: string;
    position: string;
    club: string | null;
    selectedAt: string | null;
    source: string | null;
    keeper: boolean;
    amount: number | null;
    auctionEvidence?: unknown;
    allowanceSeconds: number | null;
    activeMs: number | null;
    elapsedMs?: number | null;
    pausedMs?: number | null;
    onClockAt?: string | null;
    ownerTime: Record<string, number> | null;
    identityBasis: string;
    adp?: number | null;
    adpDifference?: number | null;
    adpSample?: number | null;
    adpObservedAt?: string | null;
};
export type ArchiveDetail = {
    phase4?: { components:DecisionComponents[]; replay:ReplayData; calibration:CalibrationModel|null; scores:ReturnType<typeof calibratedScores>; lineage:LineageReport; dynasty:DynastyMark[]; contributions?:PlayerContribution[] };
    canReconcile?: boolean;
    canRefreshResults?: boolean;
    resultsObservedAt?: string | null;
    references?: DraftReference[];
    analysisReport?: DraftAnalysisReport;
    resultsReport?: ResultsReport;
    choice: Omit<ArchiveChoice, 'total' | 'createdAt'>;
    picks: ArchivePick[];
    snapshot: unknown;
    startedAt: string | null;
    endedAt: string | null;
    endMeaning: string;
    elapsedMs: number | null;
    activeMs: number | null;
    events: unknown[];
    eventsMore: boolean;
    corrections: unknown[];
    correctionsMore: boolean;
    trades: unknown[];
    tradesMore: boolean;
    playerTrades?: unknown[];
    playerTradesMore?: boolean;
    coverage: string[];
    sessionId: string | null;
    analysis?: ReturnType<typeof analysisReadiness>;
};
const string = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null;
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const iso = (v: unknown) => v instanceof Date ? v.toISOString() : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
function duration(start: string | null, end: string | null) { return start && end && Date.parse(end) >= Date.parse(start) ? Date.parse(end) - Date.parse(start) : null; }
export async function draftArchiveDetail(leagueId: string, userId: string, key: string, timelinePage = 1) {
    if (!await canViewLeague(leagueId, userId))
        return null;
    const catalog = await draftArchiveCatalog([leagueId], { key, limit: 1 });
    const choice = catalog.choices[0];
    if (!choice)
        return null;
    const native = choice.source === 'native' || choice.source === 'reset';
    const reset = choice.source === 'reset' ? await prisma.leagueAuditLog.findFirst({ where: { id: choice.sourceId, leagueId, actionType: ARCHIVE_EVENT } }) : null;
    const prior = object(object(reset?.afterState).details);
    const session = native ? choice.source === 'reset' ? object(prior.priorSession) : await prisma.draftSession.findFirst({ where: { id: choice.sourceId, leagueId } }) : null;
    if (native && !session)
        return null;
    const sessionId = native ? string(object(session).id) : null;
    const boundary = reset?.createdAt;
    const unstarted = ['pre_draft', 'scheduled', 'configuring', 'configured'].includes(String(object(session).status));
    const nativeStart = unstarted ? null : iso(object(session).startedAt);
    const skip = (Math.max(1, Math.min(10000, Math.floor(timelinePage) || 1)) - 1) * 100;
    const beforeSequence = archiveSequence(reset?.afterState);
    const [starts, gate] = native && sessionId ? await Promise.all([
        nativeStart ? archiveLedger(prisma, leagueId, sessionId, { event: 'start', startAt: nativeStart, beforeSequence, beforeTime: boundary }) : Promise.resolve([]),
        isElevatedCommissioner(leagueId, userId),
    ]) : [[], false];
    const startEvent = starts[0] ?? null;
    const attempt = { fromSequence: archiveSequence(startEvent?.afterState), fromTime: startEvent?.createdAt ?? (nativeStart ? new Date(nativeStart) : undefined), beforeSequence, beforeTime: boundary };
    const [lastEvent] = native && sessionId && nativeStart ? await archiveLedger(prisma, leagueId, sessionId, attempt) : [];
    const range = { ...(startEvent ? { gte: startEvent.createdAt } : {}), ...(boundary ? { lte: boundary } : {}) };
    const events = native && sessionId && nativeStart ? await archiveLedger(prisma, leagueId, sessionId, { ...attempt, skip, take: 101 }) : [];
    let rows: Record<string, unknown>[] = [];
    let snapshot: unknown = object(startEvent?.afterState).snapshot ?? null;
    let coverage: string[] = [];
    if (native) {
        rows = choice.source === 'reset' && Array.isArray(prior.archivedPicks) ? prior.archivedPicks as Record<string, unknown>[] : await prisma.draftPick.findMany({ where: { sessionId: sessionId! }, orderBy: { overall: 'asc' }, take: 10001 }) as unknown as Record<string, unknown>[];
        if (!snapshot)
            coverage.push(nativeStart ? 'Original draft-time settings were not archived for this older native draft.' : 'Draft-time settings and clock coverage will be captured when this draft starts.');
    }
    else {
        rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql `SELECT * FROM dw_draft_facts WHERE "leagueId"=${leagueId} AND sport=${choice.sport} AND season IS NOT DISTINCT FROM ${choice.season} AND COALESCE(NULLIF(metadata->>'sourceDraftId',''),'legacy:'||sport||':'||COALESCE(season::text,'unknown'))=${choice.sourceId} ORDER BY "pickNumber","draftId" LIMIT 10001`);
        snapshot = rows.map(r => object(r.metadata).archiveDraft).find(Boolean) ?? null;
        coverage.push('Exact per-pick selection timestamps and active OTC were not supplied by this provider.');
        if (choice.source === 'legacy')
            coverage.push('Legacy records have no individual source draft ID. Separate drafts may remain unresolved until verified backfill.');
    }
    if (rows.length > 10000)
        throw new Error('Draft exceeds archive display bound; no partial report is returned');
    const nativeSnap = object(snapshot), providerSnap = object(snapshot);
    const startedAt = native ? nativeStart : iso(providerSnap.startTime);
    const endedAt = native ? unstarted ? null : iso(object(session).completedAt) : iso(providerSnap.lastPickedTime);
    const clock = object(object(lastEvent?.afterState).clock);
    const ids = rows.map(r => string(r.playerId)).filter((v): v is string => !!v);
    const platform = native ? 'sleeper' : string(object(rows[0]?.metadata).provider) ?? (await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } }))?.platform ?? '';
    // Native selections already carry their identity. No provider namespace is inferred
    // from a native numeric ID; imported fallbacks require both provider and sport.
    const names = native ? new Map<string, { name: string; position: string }>() : await resolvePlayerNames([...new Set(ids)], platform, choice.sport);
    const order = Array.isArray(object(nativeSnap.session).slotOrder) ? object(nativeSnap.session).slotOrder as Record<string, unknown>[] : [];
    const sourceSlotMap = object(providerSnap.slotToRosterId);
    const providerRosters = Array.isArray(providerSnap.observedSeasonRosters) ? providerSnap.observedSeasonRosters.map(object) : [];
    const picks: ArchivePick[] = rows.map(r => {
        const meta = object(r.metadata), archive = object(object(r.pickMetadata).archive), player = object(meta.playerSnapshot), timing = object(archive.timing);
        const overall = number(native ? r.overall : r.pickNumber) ?? 0, round = number(r.round) ?? 0;
        const slot = choice.format === 'auction' ? null : number(native ? r.slot : meta.originalDraftSlot);
        const original = string(native ? r.originalRosterId : sourceSlotMap[String(slot)]) ?? (native ? string(archive.originalRosterId) : null);
        const roster = string(native ? r.rosterId : meta.selectionRosterId);
        const id = string(r.playerId), resolved = id ? names.get(id) : null;
        const name = string(native ? r.playerName : player.name);
        const providerTeam = providerRosters.find(t => string(t.roster_id) === roster);
        return { id: String(native ? r.id : r.draftId), overall, round, slot, originalRosterId: original, rosterId: roster, teamName: string(r.displayName) ?? (native ? string(order.find(e => String(e.rosterId) === roster)?.displayName) : string(object(providerTeam?.metadata).team_name)), actor: string(native ? r.ownerUserId : meta.providerPickedBy), playerId: id, playerName: name ?? resolved?.name ?? ('Player ' + (id ?? 'unknown')), position: string(native ? r.position : player.position) ?? resolved?.position ?? 'Unknown', club: string(native ? r.team : player.team), selectedAt: native ? iso(r.pickedAt) : null, source: string(r.source) ?? (native ? null : platform), keeper: r.source === 'keeper' || meta.isKeeper === true, amount: number(native ? r.amount : meta.auctionAmount), allowanceSeconds: number(archive.clockAllowanceSeconds), activeMs: number(timing.activeMs), ownerTime: timing.byOwner && typeof timing.byOwner === 'object' ? timing.byOwner as Record<string, number> : null, identityBasis: name ? 'Recorded at selection' : native ? 'Recorded native ID; display identity unavailable' : 'Current identity mapping by provider ID and sport' };
    });
    const frozen = object(nativeSnap.context);
    const context = typeof frozen.sport === 'string' && typeof frozen.season === 'number' && Array.isArray(frozen.rosterSlots) ? frozen as unknown as PreparationContext : null;
    const historicalBenchmark = native && context && startedAt && choice.format !== 'auction' ? await prisma.aiAdpSnapshotHistory.findFirst({
        where: { sport: context.sport, leagueType: 'draft_hq', formatKey: preparationFormatKey(context), computedAt: { lte: new Date(startedAt) } },
        orderBy: [{ computedAt: 'desc' }, { id: 'desc' }], select: { snapshotData: true },
    }) : null;
    const benchmark = context && startedAt ? validPreparationSnapshot(historicalBenchmark?.snapshotData, context, new Date(startedAt)) : null;
    const entries = new Map(benchmark?.entries.map(e => [e.playerKey, e]) ?? []);
    const rowsById = new Map(rows.map(r => [String(native ? r.id : r.draftId), r]));
    for (const pick of picks) {
        const row = rowsById.get(pick.id);
        const timing = object(object(object(row?.pickMetadata).archive).timing);
        const budget = auctionAwardBudget({...pick,auctionEvidence:object(object(row?.pickMetadata).archive).auctionEvidence});
        pick.auctionEvidence = budget ? {version:'auction-award-v1',rosterId:pick.rosterId,...budget} : null;
        pick.elapsedMs = number(timing.elapsedMs);
        pick.pausedMs = number(timing.pausedMs);
        pick.onClockAt = iso(timing.openedAt);
        pick.originalTeamName = native
            ? string(order.find(t => string(t.rosterId) === pick.originalRosterId)?.displayName)
            : string(object(providerRosters.find(t => string(t.roster_id) === pick.originalRosterId)?.metadata).team_name);
        const recordedTeams = Array.isArray(nativeSnap.teams) ? nativeSnap.teams.map(object) : [];
        pick.actorName = native && pick.actor ? string(recordedTeams.find(t => string(t.claimedByUserId) === pick.actor || string(t.platformUserId) === pick.actor)?.ownerName) : null;
        const entry = pick.playerId ? entries.get(preparationPlayerKey(pick.playerName, pick.position, pick.playerId)) : null;
        pick.adp = entry?.adp ?? null;
        pick.adpDifference = entry ? pick.overall - entry.adp : null;
        pick.adpSample = entry?.sampleSize ?? null;
        pick.adpObservedAt = entry ? benchmark?.observedAt ?? null : null;
    }
    if (!benchmark)
        coverage.push(choice.format === 'auction' ? 'Auction prices require a compatible observed bid-value benchmark; pick-order ADP is not used.' : 'No verified compatible ADP observation from before this draft is available.');
    const [corrections, trades] = await Promise.all([
        native && sessionId && gate ? prisma.draftPickAuditLog.findMany({ where: { leagueId, draftSessionId: sessionId, createdAt: range }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: 101 }) : Promise.resolve([]),
        native && sessionId ? prisma.draftPickTradeProposal.findMany({ where: { sessionId, status: 'accepted', respondedAt: boundary ? { lte: boundary } : undefined }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: 101 }) : choice.season ? prisma.transactionFact.findMany({ where: { leagueId, season: choice.season, type: 'trade' }, orderBy: [{ createdAt: 'desc' }, { transactionId: 'desc' }], skip, take: 101 }) : Promise.resolve([]),
    ]);
    const playerTradeRows = native && startedAt ? await (async () => prisma.tradeExecutionSnapshot.findMany({
        where: { leagueId, executedAt: { gte: new Date(startedAt), lte: endedAt ? new Date(endedAt) : boundary ?? new Date() } },
        orderBy: [{ executedAt: 'desc' }, { id: 'desc' }], skip, take: 101,
        select: { tradeId: true, executedAt: true, assetSummary: true, completeness: true, reversal: { select: { reversedAt: true } } },
    }))().catch(() => null) : [];
    if (native && startedAt) coverage.push(playerTradeRows === null
        ? 'Native executed-player trade history is unavailable.'
        : 'Native player trade packages cover recorded executions during this draft window; timing does not prove linkage to a particular pick.');
    const playerTrades = (playerTradeRows ?? []).slice(0, 100).map(row => {
        const summary = object(row.assetSummary);
        const assets = Array.isArray(summary.assets) ? summary.assets.map(object) : [];
        return { tradeId: row.tradeId, executedAt: row.executedAt, reversedAt: row.reversal?.reversedAt ?? null, completeness: row.completeness,
            recordedAssetCount: typeof summary.items === 'number' ? summary.items : assets.length,
            assets: assets.map(asset => ({ assetType: asset.assetType ?? asset.itemType, itemReference: asset.itemReference, faabAmount: asset.faabAmount, fromRosterId: asset.fromRosterId, toRosterId: asset.toRosterId,
                playerId: asset.playerId ?? (String(asset.itemType).toLowerCase() === 'player' ? asset.itemReference : null), playerName: asset.playerName ?? object(asset.metadata).playerName,
                pickSeason: asset.pickSeason ?? object(asset.metadata).season, pickRound: asset.pickRound ?? object(asset.metadata).round,
                pickNumber: asset.pickNumber ?? object(asset.metadata).pickNumber })) };
    });
    if (!native)
        coverage.push('Transaction packages are season-level records; exact linkage to this individual draft is not inferred.');
    if (native && !gate)
        coverage.push('Commissioner correction details are restricted to commissioners.');
    if (native && clock.complete !== true)
        coverage.push('Complete native clock-event coverage is unavailable for this draft.');
    const { total, createdAt, ...publicChoice } = choice;
    void total;
    void createdAt;
    // Publish only settings and clock facts. Internal roster JSON, actor IDs and correction
    // reasons are retained durably but must not leak through the public snapshot/timeline.
    const publicSnapshot = native ? { context: nativeSnap.context ?? null, capturedAt: nativeSnap.capturedAt ?? null, teams: Array.isArray(nativeSnap.teams) ? nativeSnap.teams.map(t => ({ externalId: object(t).externalId, teamName: object(t).teamName })) : [], rules: { draftType: object(nativeSnap.session).draftType, rounds: object(nativeSnap.session).rounds, teamCount: object(nativeSnap.session).teamCount, timerSeconds: object(nativeSnap.session).timerSeconds, thirdRoundReversal: object(nativeSnap.session).thirdRoundReversal } } : {
        format: providerSnap.format, status: providerSnap.status, sport: providerSnap.sport, name: providerSnap.name,
        draftSettings: providerSnap.draftSettings, draftOrder: providerSnap.draftOrder,
        observedSeasonScoring: providerSnap.observedSeasonScoring, observedSeasonRosterPositions: providerSnap.observedSeasonRosterPositions,
        tradeCoverage: providerSnap.tradeCoverage,
        tradedPicks: Array.isArray(providerSnap.tradedPicks) ? providerSnap.tradedPicks.map(t => {
            const trade = object(t);
            return { season: trade.season, round: trade.round, rosterId: trade.roster_id, previousOwnerId: trade.previous_owner_id, ownerId: trade.owner_id };
        }) : null,
        startTime: providerSnap.startTime, lastPickedTime: providerSnap.lastPickedTime, slotToRosterId: providerSnap.slotToRosterId,
        teams: providerRosters.map(t => ({ rosterId: t.roster_id, teamName: object(t.metadata).team_name })),
    };
    const publicEvents = events.slice(0, 100).map(e => {
        const state = object(e.afterState), details = object(state.details);
        const selection = object(details.pick);
        return { id: e.id, at: e.createdAt.toISOString(), event: state.event, clock: state.clock, allowanceSeconds: details.timerSeconds ?? null,
            nomination: details.nomination ?? null, bidderRosterId: details.rosterId ?? null, amount: details.amount ?? null, ownershipChanges: details.trades ?? null,
            selection: state.event === 'selection' ? { overall: details.overall, playerId: selection.playerId, playerName: selection.playerName, position: selection.position, team: selection.team, rosterId: selection.rosterId, displayName: selection.displayName, originalRosterId: selection.originalRosterId, source: selection.source, actorId: details.actorUserId } : null };
    });
    const publicTrades = trades.slice(0, 100).map(t => {
        const trade = object(t);
        if (native) return { id: trade.id, proposerRosterId: trade.proposerRosterId, receiverRosterId: trade.receiverRosterId, proposerName: trade.proposerName, receiverName: trade.receiverName,
            give: { round: trade.giveRound, slot: trade.giveSlot, originalRosterId: trade.giveOriginalRosterId },
            receive: { round: trade.receiveRound, slot: trade.receiveSlot, originalRosterId: trade.receiveOriginalRosterId }, acceptedAt: trade.respondedAt };
        const payload = object(trade.payload);
        return { transactionId: trade.transactionId, season: trade.season, week: trade.weekOrPeriod, adds: payload.adds, drops: payload.drops, draftPicks: payload.draft_picks, rosterIds: payload.roster_ids, providerCreatedAt: payload.created, providerStatusUpdatedAt: payload.status_updated };
    });
    const analysis = analysisReadiness(nativeSnap.analysisBasis, picks.length);
    const analysisTeams = native ? order.flatMap(t => string(t.rosterId) ? [{ rosterId: string(t.rosterId)!, name: string(t.displayName) ?? string(t.rosterId)! }] : []) : providerRosters.flatMap(t => string(t.roster_id) ? [{ rosterId: string(t.roster_id)!, name: string(object(t.metadata).team_name) ?? string(t.roster_id)! }] : []);
    const existingRoster = native ? frozenExistingRoster(nativeSnap,context,analysisTeams) : null;
    const analysisReport = draftDayReport(nativeSnap.analysisBasis, context, picks, analysisTeams, startedAt,existingRoster);
    let results: ResultsReport | undefined;
    let contributions:PlayerContribution[]=[];
    if (native && choice.sport === 'NFL' && choice.season && startedAt) {
      try {
        const [scores, finalRows, games] = await Promise.all([
            prisma.weeklyScore.findMany({ where: { leagueId, season: choice.season }, take: 10001, select: { rosterId: true, playerId: true, points: true, isStarter: true, week: true } }),
            prisma.teamWeekResult.findMany({ where: { leagueId, season: choice.season, status: 'final' }, take: 1001, select: { week: true, rosterId: true } }),
            prisma.sportsGame.findMany({where:{sport:'NFL',season:choice.season,seasonType:'regular'},take:1001,select:{week:true,startTime:true}}),
        ]);
        const finalWeeks = [...new Set(finalRows.map(r => r.week))].filter(week => games.some(g=>g.week===week) && games.filter(g=>g.week===week).every(g=>g.startTime && g.startTime.getTime()>Date.parse(startedAt)) && analysisTeams.length > 1 && analysisTeams.every(team => finalRows.some(row => row.week === week && row.rosterId === team.rosterId)));
        if (scores.length <= 10000 && finalRows.length <= 1000 && games.length <= 1000) { results = resultsReport(picks, analysisTeams, scores, finalWeeks); contributions=playerContributions(picks,scores,finalWeeks); }
        else coverage.push('Weekly result data exceeds the analysis bound; no partial team rank is returned.');
      } catch { coverage.push('Recorded weekly starter results are temporarily unavailable.'); }
    }
    let references: DraftReference[] = [];
    let referenceContext = context;
    if (!native && choice.source === 'imported' && platform.toLowerCase() === 'sleeper' && choice.season && startedAt) {
      try {
        const sourceIds = new Set(rows.map(r => string(object(r.metadata).sourceLeagueId)));
        const sourceId = sourceIds.size === 1 ? [...sourceIds][0] : null;
        const seasonRow = sourceId ? await prisma.leagueDynastySeason.findFirst({ where: { leagueId,season:choice.season,platformLeagueId:sourceId,provider:'sleeper' },select:{metadata:true} }) : null;
        const seasonMeta = object(seasonRow?.metadata), settings = object(seasonMeta.rawSettings), leagueType = settings.type === 2 ? 'dynasty' : settings.type === 0 ? 'redraft' : null;
        if (leagueType && seasonMeta.sourceProvider === 'sleeper' && number(seasonMeta.season) === choice.season && Array.isArray(seasonMeta.rosterPositions)) referenceContext = preparationContext({sport:'NFL',season:choice.season,leagueVariant:leagueType,scoring:string(seasonMeta.scoringFormat)?.toLowerCase(),settings:{roster_positions:seasonMeta.rosterPositions,scoring_settings:seasonMeta.scoringSettings}},{draftType:choice.format,teamCount:number(seasonMeta.totalRosters) ?? 0,playerPool:'all'});
      } catch { coverage.push('Historical season format references are temporarily unavailable.'); }
    }
    if (referenceContext && startedAt) {
        try {
            const aliases = new Map<string, string>();
            const basis = object(nativeSnap.analysisBasis);
            if (basis.version === 'draft-analysis-basis-v2' && Array.isArray(basis.entries)) for (const raw of basis.entries) {
                const e = object(raw); if (string(e.playerId) && string(e.sleeperId)) { aliases.set(string(e.playerId)!, string(e.sleeperId)!); aliases.set(string(e.sleeperId)!, string(e.sleeperId)!); }
            }
            if (!native) for (const playerId of ids) aliases.set(playerId,playerId);
            else if (basis.version !== 'draft-analysis-basis-v2') {
                const mappings = await prisma.playerIdentityMap.findMany({where:{sport:'NFL',OR:[{id:{in:ids}},{sleeperId:{in:ids}}]},take:5001,select:{id:true,sleeperId:true}});
                if (mappings.length > 5000) throw new Error('Identity reference bound exceeded');
                const conflicts = new Set<string>();
                for (const mapping of mappings) if (mapping.sleeperId) for (const alias of [mapping.id,mapping.sleeperId]) { if (aliases.has(alias) && aliases.get(alias)!==mapping.sleeperId) conflicts.add(alias); else aliases.set(alias,mapping.sleeperId); }
                for (const alias of conflicts) aliases.delete(alias);
            }
            const playerIds = new Set(picks.flatMap(p => p.playerId ? [p.playerId] : []));
            const sleeperIds = new Set(picks.flatMap(p => p.playerId && aliases.has(p.playerId) ? [aliases.get(p.playerId)!] : []));
            references = (await draftReferences(referenceContext, new Date(startedAt), number(object(nativeSnap.session).auctionBudgetPerTeam))).map(r => ({ ...r, displayScope:'draft_selections' as const,identityBasis:!native ? 'provider_recorded_id' as const : basis.version === 'draft-analysis-basis-v2' ? 'draft_start_mapping' as const : 'current_verified_mapping' as const,formatBasis:context ? 'frozen_draft_context' as const : 'observed_historical_season' as const, entries: r.entries.filter(e => (r.identitySpace === 'native' ? playerIds : sleeperIds).has(e.playerId)).map(e => {
                const pick = picks.find(p => p.playerId && (r.identitySpace === 'native' ? p.playerId : aliases.get(p.playerId)) === e.playerId);
                return { ...e, name: pick?.playerName ?? e.name, ...(r.kind === 'adp' && pick ? { draftedOverall: pick.overall, difference: pick.overall - e.value } : {}) };
            }) })).filter(r => r.entries.length);
        } catch { coverage.push('Market reference data is temporarily unavailable.'); }
    }
    const canReconcile = choice.source === 'legacy' && await isElevatedCommissioner(leagueId, userId);
    let resultsObservedAt: string | null = null;
    if (choice.source === 'imported' && choice.sport === 'NFL') {
        try { const observation = await readImportedResults(leagueId,key); if (observation) { results = observation.report; resultsObservedAt = observation.observedAt; } }
        catch { coverage.push('Historical result observations are temporarily unavailable.'); }
    }
    const canRefreshResults = choice.source === 'imported' && choice.sport === 'NFL' && platform.toLowerCase() === 'sleeper' && await isElevatedCommissioner(leagueId,userId);
    const replay = buildReplay(nativeSnap.analysisBasis,context,startedAt,picks,existingRoster);
    const components = decisionComponents(analysisReport,replay);
    let calibration:CalibrationModel|null=null;
    let lineage:LineageReport={state:'unavailable',lineages:[],pending:[],reason:'Trade lineage is temporarily unavailable.',observedAt:new Date().toISOString()};
    let dynasty:DynastyMark[]=[];
    try { calibration = await readCalibration(context,startedAt); } catch { coverage.push('Draft model calibration is temporarily unavailable.'); }
    try {
      const inventory=await draftArchiveCatalog([leagueId],{season:choice.season,limit:2});
      lineage=await loadAssetLineage(leagueId,choice.source,choice.sourceId,sessionId,choice.season,choice.sport,picks,inventory.choices.length===1,nativeSnap.analysisBasis,context,startedAt,boundary);
    } catch { coverage.push('Recorded trade lineage is temporarily unavailable.'); }
    try { dynasty=await dynastyMarks(referenceContext,picks,nativeSnap.analysisBasis,startedAt,references); } catch { coverage.push('Current dynasty market references are temporarily unavailable.'); }
    const phase4={contributions,components,replay,calibration,scores:calibratedScores(components,calibration,choice.season,startedAt),lineage,dynasty};
    return JSON.parse(JSON.stringify({ phase4, canReconcile, canRefreshResults, resultsObservedAt, references, analysisReport, resultsReport: results, analysis, choice: publicChoice, picks, snapshot: publicSnapshot, startedAt, endedAt, endMeaning: native ? 'Completed at' : 'Provider last selection time', elapsedMs: duration(startedAt, endedAt), activeMs: native && clock.complete === true ? number(clock.totalActiveMs) : null, events: publicEvents, eventsMore: events.length > 100, corrections: corrections.slice(0, 100), correctionsMore: corrections.length > 100, trades: publicTrades, tradesMore: trades.length > 100, playerTrades, playerTradesMore: (playerTradeRows?.length ?? 0) > 100, coverage, sessionId })) as ArchiveDetail;
}
