import 'server-only';
import { prisma } from '@/lib/prisma';
import type { ResultsReport } from './analysisModel';
import { referenceStorageKey } from './references';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const storageKey = (leagueId: string, key: string) => referenceStorageKey(leagueId + ':' + key);
export type ImportedResultsObservation = { version: 'draft-results-v1'; leagueId: string; key: string; observedAt: string; sourceLeagueId: string; sourceDraftId: string; report: ResultsReport };
export async function readImportedResults(leagueId: string, key: string): Promise<ImportedResultsObservation | null> {
  const row = await prisma.aiAdpSnapshotHistory.findFirst({ where: { sport: 'NFL', leagueType: 'draft_results', formatKey: storageKey(leagueId,key) }, orderBy: [{ computedAt:'desc' },{id:'desc'}], select: { snapshotData:true } });
  const raw = object(row?.snapshotData);
  return raw.version === 'draft-results-v1' && raw.leagueId === leagueId && raw.key === key && typeof raw.observedAt === 'string' && Array.isArray(object(raw.report).teams) ? raw as ImportedResultsObservation : null;
}
