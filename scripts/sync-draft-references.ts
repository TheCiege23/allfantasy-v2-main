/** Dry-run by default; additive immutable observations only. */
import { createRequire } from 'node:module';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { getDatabaseUrlOrThrow } from '../lib/env/database-url';
import { syncMarketReferences, captureCachedReferences, captureProviderAdp } from '../lib/draft-archive/referenceWriter';
const { identifyTarget } = createRequire(import.meta.url)('./db-target-identity.cjs');
async function main() {
  const apply = process.argv.includes('--apply'), target = identifyTarget(getDatabaseUrlOrThrow());
  if (apply && (target.kind === 'production' ? !process.argv.includes('--production') : target.kind !== 'safe')) throw new Error('Verified database target required');
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  const date = process.argv.find(v => v.startsWith('--date='))?.slice(7) ?? yesterday;
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', target: target.kind, date, market: await syncMarketReferences(date, apply), cached: await captureCachedReferences(apply) }));
  try { console.log(JSON.stringify({ providerAdp: await captureProviderAdp(apply) })); } catch (e) { console.log(JSON.stringify({ providerAdp: { failed:true,errorType:e instanceof Error ? e.name : 'Unknown' } })); process.exitCode = 1; }
  if (process.argv.includes('--historical')) {
    const offset = Math.max(0,Math.min(1000,Math.floor(Number(process.argv.find(v=>v.startsWith('--offset='))?.slice(9))||0)));
    const dates = await prisma.$queryRaw<Array<{ date: string }>>(Prisma.sql`WITH starts AS (
      SELECT "startedAt" AS at FROM draft_sessions WHERE "sessionKind"='live' AND "startedAt" IS NOT NULL
      UNION SELECT (metadata->'archiveDraft'->>'startTime')::timestamptz FROM dw_draft_facts WHERE metadata->'archiveDraft'->>'startTime' ~ '^\\d{4}-\\d{2}-\\d{2}T'
    ) SELECT DISTINCT to_char((at AT TIME ZONE 'UTC')::date - 1,'YYYY-MM-DD') AS date FROM starts WHERE at >= '2025-09-02'::timestamptz AND at < NOW() ORDER BY date DESC LIMIT 10 OFFSET ${offset}`);
    for (const item of dates) console.log(JSON.stringify({ historicalDate: item.date, market: await syncMarketReferences(item.date,apply) }));
  }
}
main().catch(() => { console.error('Reference sync failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
