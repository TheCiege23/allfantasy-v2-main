import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
export type ArchiveChoice = {
    key: string;
    leagueId: string;
    leagueName: string;
    source: 'native' | 'imported' | 'legacy' | 'reset';
    sourceId: string;
    season: number | null;
    sport: string;
    format: string;
    status: string;
    createdAt: Date;
    total: bigint | number;
};
/** IDs come from the render's authorized league inventory. No per-league fan-out. */
export async function draftArchiveCatalog(leagueIds: string[], options: {
    page?: number;
    query?: string;
    key?: string;
    limit?: number;
    season?: number | null;
} = {}) {
    if (!leagueIds.length)
        return { choices: [] as ArchiveChoice[], more: false, page: 1, total: 0 };
    const page = Math.max(1, Math.min(10000, Math.floor(options.page ?? 1) || 1)), limit = Math.max(1, Math.min(200, options.limit ?? 20));
    const query = '%' + (options.query ?? '').slice(0, 120).replace(/[\\%_]/g, '\\$&') + '%';
    const rows = await prisma.$queryRaw<ArchiveChoice[]>(Prisma.sql `
 WITH imported AS (
 SELECT f."leagueId",f.season,f.sport,COALESCE(NULLIF(f.metadata->>'sourceDraftId',''),'legacy:'||f.sport||':'||COALESCE(f.season::text,'unknown')) AS source_id,
 MAX(f.metadata->'archiveDraft'->>'format') AS format, MAX(f.metadata->'archiveDraft'->>'status') AS status, MIN(f."createdAt") AS created_at
 FROM dw_draft_facts f WHERE f."leagueId" IN (${Prisma.join(leagueIds)}) GROUP BY f."leagueId",f.season,f.sport,source_id
 ), drafts AS (
 SELECT 'native:'||s.id AS key,s."leagueId",l.name AS "leagueName",'native'::text AS source,s.id AS "sourceId",CASE WHEN s."startedAt" IS NULL OR s.status IN ('pre_draft','scheduled','configuring','configured') THEN l.season ELSE (a."afterState"->'context'->>'season')::int END AS season,l.sport::text AS sport,s."draftType" AS format,s.status,s."createdAt" AS "createdAt"
 FROM draft_sessions s JOIN leagues l ON l.id=s."leagueId"
 LEFT JOIN LATERAL (SELECT "afterState" FROM audit_logs WHERE "entityId"=s.id AND "leagueId"=s."leagueId" AND "actionType"='draft_archive_event' AND "afterState"->>'event'='start' ORDER BY "createdAt" DESC,id DESC LIMIT 1) a ON true
 WHERE s."leagueId" IN (${Prisma.join(leagueIds)}) AND s."sessionKind"='live' AND NOT EXISTS (SELECT 1 FROM imported i WHERE i."leagueId"=s."leagueId" AND i.source_id=s."sleeperDraftId")
 UNION ALL
 SELECT CASE WHEN i.source_id LIKE 'legacy:%' THEN i.source_id ELSE 'imported:'||i.source_id END,i."leagueId",l.name,CASE WHEN i.source_id LIKE 'legacy:%' THEN 'legacy' ELSE 'imported' END,i.source_id,i.season,i.sport,COALESCE(i.format,'unknown'),COALESCE(i.status,'unknown'),i.created_at
 FROM imported i JOIN leagues l ON l.id=i."leagueId"
 UNION ALL
 SELECT 'reset:'||a.id,a."leagueId",l.name,'reset',a.id,(a."afterState"->'context'->>'season')::int,l.sport::text,COALESCE(a."afterState"->'details'->'priorSession'->>'draftType','unknown'),'archived',a."createdAt"
 FROM audit_logs a JOIN leagues l ON l.id=a."leagueId" WHERE a."leagueId" IN (${Prisma.join(leagueIds)}) AND a."actionType"='draft_archive_event' AND a."afterState"->>'event'='reset_draft'
 ), filtered AS (SELECT * FROM drafts WHERE (${options.key ?? null}::text IS NULL OR key=${options.key ?? null}) AND (${options.season ?? null}::int IS NULL OR season=${options.season ?? null}) AND CONCAT_WS(' ',"leagueName",season::text,sport,format,status) ILIKE ${query})
 SELECT *,COUNT(*) OVER() AS total FROM filtered ORDER BY season DESC NULLS LAST,"createdAt" DESC,key,"leagueId" OFFSET ${(page - 1) * limit} LIMIT ${limit + 1}
 `);
    return { choices: rows.slice(0, limit), more: rows.length > limit, page, total: Number(rows[0]?.total ?? 0) };
}
