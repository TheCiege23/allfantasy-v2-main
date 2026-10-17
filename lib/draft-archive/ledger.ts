import { Prisma } from '@prisma/client';

export type ArchiveLedgerRow = { id: string; createdAt: Date; afterState: unknown };
export function archiveSequence(state: unknown): number | null {
    const value = state && typeof state === 'object' && 'sequence' in state ? state.sequence : null;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
const sequenceSql = Prisma.sql`CASE WHEN "afterState"->>'sequence' ~ '^[0-9]{1,15}$' THEN ("afterState"->>'sequence')::bigint ELSE 0 END`;

/** Sequence is allocated under the draft row lock. Wall-clock skew cannot reorder mutations. */
export async function archiveLedger(db: Pick<Prisma.TransactionClient, '$queryRaw'>, leagueId: string, sessionId: string, options: {
    event?: string;
    startAt?: string;
    fromSequence?: number | null;
    beforeSequence?: number | null;
    fromTime?: Date;
    beforeTime?: Date;
    skip?: number;
    take?: number;
} = {}) {
    return db.$queryRaw<ArchiveLedgerRow[]>(Prisma.sql`
        SELECT id,"createdAt","afterState" FROM audit_logs
        WHERE "leagueId"=${leagueId} AND "entityType"='draft_session' AND "entityId"=${sessionId} AND "actionType"='draft_archive_event'
        ${options.event ? Prisma.sql`AND "afterState"->>'event'=${options.event}` : Prisma.empty}
        ${options.startAt ? Prisma.sql`AND ("afterState"->'snapshot'->'session'->>'startedAt'=${options.startAt} OR (${sequenceSql}=0 AND "createdAt">=${new Date(options.startAt)}))` : Prisma.empty}
        ${options.fromSequence != null ? Prisma.sql`AND ${sequenceSql}>=${options.fromSequence}` : options.fromTime ? Prisma.sql`AND "createdAt">=${options.fromTime}` : Prisma.empty}
        ${options.beforeSequence != null ? Prisma.sql`AND ${sequenceSql}<${options.beforeSequence}` : options.beforeTime ? Prisma.sql`AND "createdAt"<${options.beforeTime}` : Prisma.empty}
        ORDER BY ${sequenceSql} DESC,"createdAt" DESC,id DESC
        OFFSET ${options.skip ?? 0} LIMIT ${options.take ?? 1}
    `);
}
