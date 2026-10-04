import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { preparationFormatKey, type PreparationContext } from '@/lib/core-app/draftPreparationModel';
import { marketFormat, referenceAdpKey, validDraftReference, type DraftReference } from './referenceModel';
export const referenceStorageKey = (key: string) => 'hqr:' + createHash('sha256').update(key).digest('hex').slice(0,24);

export async function draftReferences(context: PreparationContext, cutoff: Date, budget?: number | null): Promise<DraftReference[]> {
  if (context.sport !== 'NFL') return [];
  const format = marketFormat(context);
  const keys = format ? [`sgf:${format}`] : [];
  const adp = referenceAdpKey(context);
  if (adp) keys.push(`sleeper:${context.season}:${adp}`);
  if (context.draftType === 'auction' && budget && budget > 0) keys.push(`auction:${preparationFormatKey(context)}:${budget}`);
  const rows = (await Promise.all(keys.map(key => prisma.aiAdpSnapshotHistory.findMany({ where: { sport: 'NFL', leagueType: 'draft_reference', formatKey: referenceStorageKey(key), computedAt: { lte: cutoff } }, orderBy: [{ computedAt: 'desc' }, { id: 'desc' }], take: 3, select: { formatKey: true, snapshotData: true } })))).flat();
  const found = new Map<string, DraftReference>();
  for (const row of rows) {
    if (found.has(row.formatKey ?? '')) continue;
    const snapshot = validDraftReference(row.snapshotData, cutoff);
    if (!snapshot) continue;
    const key = keys.find(k => referenceStorageKey(k) === row.formatKey);
    const matches = key === `sgf:${format}` ? snapshot.kind === 'market_value' && snapshot.format === format && (snapshot.season === null || snapshot.season === context.season)
      : key === `sleeper:${context.season}:${adp}` ? snapshot.kind === 'adp' && snapshot.format === adp && snapshot.season === context.season
      : key === `auction:${preparationFormatKey(context)}:${budget}` && snapshot.kind === 'auction_price' && snapshot.contextKey === preparationFormatKey(context) && snapshot.budget === budget;
    if (matches) found.set(row.formatKey ?? '', snapshot);
  }
  return [...found.values()];
}
