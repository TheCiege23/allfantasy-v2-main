import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { preparationContext } from '@/lib/core-app/draftPreparationModel';
import { getRosterIdForOverall } from '@/lib/live-draft-engine/DraftOrderService';
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver';
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types';
import { advanceArchiveClock, type ArchiveClock, type ClockEvent } from './clock';
import { resolveNextOpenPickOverall } from '@/lib/live-draft-engine/draftPickEmpty';
import { captureDraftAnalysisBasis } from './analysisBasis';
import { archiveLedger, archiveSequence } from './ledger';
export const ARCHIVE_EVENT = 'draft_archive_event';
export const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
export function archiveOwner(session: {
    slotOrder: unknown;
    tradedPicks?: unknown;
    teamCount: number;
    draftType: string;
    thirdRoundReversal?: boolean;
}, overall: number) {
    if (!['snake', 'linear'].includes(session.draftType) || overall < 1)
        return null;
    const order = Array.isArray(session.slotOrder) ? session.slotOrder as SlotOrderEntry[] : [];
    const original = getRosterIdForOverall(overall, session.teamCount, session.draftType as 'snake' | 'linear', !!session.thirdRoundReversal, order);
    if (!original)
        return null;
    const trades = Array.isArray(session.tradedPicks) ? session.tradedPicks as TradedPickRecord[] : [];
    return resolvePickOwner(Math.ceil(overall / session.teamCount), order.find(e => e.rosterId === original.rosterId)?.slot ?? 0, order, trades)?.rosterId ?? original.rosterId;
}
export async function recordArchiveEvent(tx: Prisma.TransactionClient, session: {
    id: string;
    leagueId: string;
    status: string;
    draftType: string;
    teamCount: number;
    rounds: number;
    slotOrder: unknown;
    tradedPicks?: unknown;
    nextOverallPick?: number;
    timerSeconds?: number | null;
    thirdRoundReversal?: boolean;
    overnightFrozenPickSeconds?: number | null;
}, event: ClockEvent, details: Record<string, unknown> = {}, at = new Date()) {
    // Serialize the ledger on the same row as the draft mutation; concurrent events must
    // not both advance the same previous clock state.
    await tx.$queryRaw(Prisma.sql `SELECT id FROM draft_sessions WHERE id=${session.id} AND "leagueId"=${session.leagueId} FOR UPDATE`);
    const [latest] = await archiveLedger(tx, session.leagueId, session.id);
    const sequence = (archiveSequence(latest?.afterState) ?? 0) + 1;
    const raw = object(object(latest?.afterState).clock);
    const previous = raw.version === 1 ? raw as unknown as ArchiveClock : null;
    const picks = typeof details.overall === 'number' ? null : await tx.draftPick.findMany({ where: { sessionId: session.id }, select: { overall: true, playerName: true, position: true, pickMetadata: true }, take: 10001 });
    const selectedOverall = typeof details.overall === 'number' ? details.overall : resolveNextOpenPickOverall(picks ?? [], session.rounds * session.teamCount) ?? session.rounds * session.teamCount + 1;
    const nextOverall = typeof details.nextOverall === 'number' ? details.nextOverall : selectedOverall;
    const running = session.status === 'in_progress' && session.overnightFrozenPickSeconds == null && event !== 'complete' && event !== 'reset_draft';
    // Clock skew must invalidate timing coverage rather than reject an otherwise valid pick.
    const skewed = previous != null && at.getTime() < Date.parse(previous.at);
    const ledgerAt = skewed ? new Date(previous!.at) : at;
    const advanced = advanceArchiveClock(previous, event, ledgerAt, selectedOverall, archiveOwner(session, selectedOverall), running);
    if (skewed) {
        advanced.clock.complete = false;
        advanced.selected = null;
    }
    if (event === 'selection') {
        advanced.clock.overall = nextOverall;
        advanced.clock.owner = archiveOwner(session, nextOverall);
    }
    let snapshot: unknown = undefined;
    if (event === 'start') {
        const [league, teams, rosters] = await Promise.all([tx.league.findUnique({ where: { id: session.leagueId }, select: { sport: true, season: true, scoring: true, isDynasty: true, leagueVariant: true, settings: true } }), tx.leagueTeam.findMany({ where: { leagueId: session.leagueId }, select: { externalId: true, teamName: true, ownerName: true, platformUserId: true, claimedByUserId: true } }), tx.roster.findMany({ where: { leagueId: session.leagueId }, select: { id: true, platformUserId: true, playerData: true } })]);
        const analysisBasis = await captureDraftAnalysisBasis(tx, league, at);
        snapshot = { session, league, teams, rosters, analysisBasis, context: league ? preparationContext(league, session) : null, capturedAt: at.toISOString() };
    }
    const context = event === 'start' ? object(snapshot).context ?? null : object(latest?.afterState).context ?? null;
    details = { timerSeconds: session.timerSeconds ?? null, status: session.status, overnightFrozenPickSeconds: session.overnightFrozenPickSeconds ?? null, ...details };
    const row = await tx.leagueAuditLog.create({ data: { leagueId: session.leagueId, entityType: 'draft_session', entityId: session.id, actionType: ARCHIVE_EVENT, userId: typeof details.actorUserId === 'string' ? details.actorUserId : null, createdAt: at, afterState: json({ sequence, event, clock: advanced.clock, context, ...(snapshot ? { snapshot } : {}), details }) } });
    return { eventId: row.id, selected: advanced.selected, clock: advanced.clock, context };
}
export async function updateSessionWithArchive(session: Parameters<typeof recordArchiveEvent>[1], data: Prisma.DraftSessionUpdateInput, event: ClockEvent, details: Record<string, unknown> = {}) {
    return prisma.$transaction(async (tx) => {
        const updated = await tx.draftSession.update({ where: { id: session.id }, data });
        await recordArchiveEvent(tx, updated, event, details, event === 'start' && updated.startedAt ? updated.startedAt : new Date());
        return updated;
    });
}
