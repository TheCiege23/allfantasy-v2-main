import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolvePlayerNames } from '@/lib/core-app/draftHq';
import { canViewLeague, isElevatedCommissioner } from '@/server/services/permissionService';
import { draftArchiveCatalog, type ArchiveChoice } from './catalog';
import { object, ARCHIVE_EVENT } from './events';
import { preparationFormatKey, preparationPlayerKey, validPreparationSnapshot, type PreparationContext } from '@/lib/core-app/draftPreparationModel';
import { analysisReadiness } from './analysisBasis';
export type ArchivePick = {
    id: string;
    overall: number;
    round: number;
    slot: number | null;
    originalRosterId: string | null;
    rosterId: string | null;
    teamName: string | null;
    actor: string | null;
    playerId: string | null;
    playerName: string;
    position: string;
    club: string | null;
    selectedAt: string | null;
    source: string | null;
    keeper: boolean;
    amount: number | null;
    allowanceSeconds: number | null;
    activeMs: number | null;
    ownerTime: Record<string, number> | null;
    identityBasis: string;
    adp?: number | null;
    adpDifference?: number | null;
    adpSample?: number | null;
    adpObservedAt?: string | null;
};
export type ArchiveDetail = {
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
    const nativeStart = iso(object(session).startedAt);
    const skip = (Math.max(1, Math.min(10000, Math.floor(timelinePage) || 1)) - 1) * 100;
    const [startEvent, lastEvent, gate] = native && sessionId ? await Promise.all([
        nativeStart ? prisma.leagueAuditLog.findFirst({ where: { leagueId, entityId: sessionId, actionType: ARCHIVE_EVENT, afterState: { path: ['event'], equals: 'start' }, createdAt: { gte: new Date(nativeStart), ...(boundary ? { lte: boundary } : {}) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : Promise.resolve(null),
        nativeStart ? prisma.leagueAuditLog.findFirst({ where: { leagueId, entityId: sessionId, actionType: ARCHIVE_EVENT, createdAt: { gte: new Date(nativeStart), ...(boundary ? { lt: boundary } : {}) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : Promise.resolve(null),
        isElevatedCommissioner(leagueId, userId),
    ]) : [null, null, false];
    const range = { ...(startEvent ? { gte: startEvent.createdAt } : {}), ...(boundary ? { lte: boundary } : {}) };
    const events = native && sessionId && nativeStart ? await prisma.leagueAuditLog.findMany({ where: { leagueId, entityId: sessionId, actionType: ARCHIVE_EVENT, createdAt: range }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: 101, select: { id: true, createdAt: true, afterState: true } }) : [];
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
    const startedAt = iso(native ? object(session).startedAt : providerSnap.startTime);
    const endedAt = iso(native ? object(session).completedAt : providerSnap.lastPickedTime);
    const clock = object(object(lastEvent?.afterState).clock);
    const ids = rows.map(r => string(r.playerId)).filter((v): v is string => !!v);
    const platform = native ? 'sleeper' : string(object(rows[0]?.metadata).provider) ?? (await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } }))?.platform ?? '';
    const names = await resolvePlayerNames([...new Set(ids)], platform);
    const order = Array.isArray(object(nativeSnap.session).slotOrder) ? object(nativeSnap.session).slotOrder as Record<string, unknown>[] : [];
    const sourceSlotMap = object(providerSnap.slotToRosterId);
    const picks: ArchivePick[] = rows.map(r => {
        const meta = object(r.metadata), archive = object(object(r.pickMetadata).archive), player = object(meta.playerSnapshot), timing = object(archive.timing);
        const overall = number(native ? r.overall : r.pickNumber) ?? 0, round = number(r.round) ?? 0;
        const slot = number(native ? r.slot : meta.originalDraftSlot);
        const original = string(native ? r.originalRosterId : sourceSlotMap[String(slot)]) ?? (native ? string(archive.originalRosterId) : null);
        const roster = string(native ? r.rosterId : meta.selectionRosterId);
        const id = string(r.playerId), resolved = id ? names.get(id) : null;
        const name = string(native ? r.playerName : player.name);
        return { id: String(native ? r.id : r.draftId), overall, round, slot, originalRosterId: original, rosterId: roster, teamName: string(r.displayName) ?? (native ? string(order.find(e => String(e.rosterId) === roster)?.displayName) : null), actor: string(native ? r.ownerUserId : meta.providerPickedBy), playerId: id, playerName: name ?? resolved?.name ?? ('Player ' + (id ?? 'unknown')), position: string(native ? r.position : player.position) ?? resolved?.position ?? 'Unknown', club: string(native ? r.team : player.team), selectedAt: native ? iso(r.pickedAt) : null, source: string(r.source) ?? (native ? null : platform), keeper: r.source === 'keeper' || meta.isKeeper === true, amount: number(native ? r.amount : meta.auctionAmount), allowanceSeconds: number(archive.clockAllowanceSeconds), activeMs: number(timing.activeMs), ownerTime: timing.byOwner && typeof timing.byOwner === 'object' ? timing.byOwner as Record<string, number> : null, identityBasis: name ? 'Recorded at selection' : 'Current identity mapping by provider ID' };
    });
    const frozen = object(nativeSnap.context);
    const context = typeof frozen.sport === 'string' && typeof frozen.season === 'number' && Array.isArray(frozen.rosterSlots) ? frozen as unknown as PreparationContext : null;
    const historicalBenchmark = native && context && startedAt && choice.format !== 'auction' ? await prisma.aiAdpSnapshotHistory.findFirst({
        where: { sport: context.sport, leagueType: 'draft_hq', formatKey: preparationFormatKey(context), computedAt: { lte: new Date(startedAt) } },
        orderBy: [{ computedAt: 'desc' }, { id: 'desc' }], select: { snapshotData: true },
    }) : null;
    const benchmark = context && startedAt ? validPreparationSnapshot(historicalBenchmark?.snapshotData, context, new Date(startedAt)) : null;
    const entries = new Map(benchmark?.entries.map(e => [e.playerKey, e]) ?? []);
    for (const pick of picks) {
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
        native && sessionId ? prisma.draftPickTradeProposal.findMany({ where: { sessionId, status: 'accepted', respondedAt: range }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take: 101 }) : choice.season ? prisma.transactionFact.findMany({ where: { leagueId, season: choice.season, type: 'trade' }, orderBy: [{ createdAt: 'desc' }, { transactionId: 'desc' }], skip, take: 101 }) : Promise.resolve([]),
    ]);
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
    const publicSnapshot = native ? { context: nativeSnap.context ?? null, capturedAt: nativeSnap.capturedAt ?? null, teams: Array.isArray(nativeSnap.teams) ? nativeSnap.teams.map(t => ({ externalId: object(t).externalId, teamName: object(t).teamName })) : [], rules: { draftType: object(nativeSnap.session).draftType, rounds: object(nativeSnap.session).rounds, teamCount: object(nativeSnap.session).teamCount, timerSeconds: object(nativeSnap.session).timerSeconds, thirdRoundReversal: object(nativeSnap.session).thirdRoundReversal } } : snapshot;
    const publicEvents = events.slice(0, 100).map(e => ({ id: e.id, at: e.createdAt.toISOString(), event: object(e.afterState).event, clock: object(e.afterState).clock }));
    const analysis = analysisReadiness(nativeSnap.analysisBasis, picks.length);
    return JSON.parse(JSON.stringify({ analysis, choice: publicChoice, picks, snapshot: publicSnapshot, startedAt, endedAt, endMeaning: native ? 'Completed at' : 'Provider last selection time', elapsedMs: duration(startedAt, endedAt), activeMs: native && clock.complete === true ? number(clock.totalActiveMs) : null, events: publicEvents, eventsMore: events.length > 100, corrections: corrections.slice(0, 100), correctionsMore: corrections.length > 100, trades: trades.slice(0, 100), tradesMore: trades.length > 100, coverage, sessionId })) as ArchiveDetail;
}
