import 'server-only';
import { prisma } from '@/lib/prisma';
import type { ResultsReport, AnalysisSelection } from './analysisModel';
import type { PlayerContribution } from './resultsDecisionModel';
import { importedWeeklyReport, type ImportedWeeklyEvidence } from './importedWeeklyModel';
import { referenceStorageKey } from './references';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const storageKey = (leagueId: string, key: string) => referenceStorageKey(leagueId + ':' + key);
export type ImportedResultsObservation = { version: 'draft-results-v1'|'draft-results-v2'; leagueId: string; key: string; observedAt: string; sourceLeagueId: string; sourceDraftId: string; report: ResultsReport; weekly?:ImportedWeeklyEvidence; contributions?:PlayerContribution[] };
function validReport(value:unknown):ResultsReport|null {
  const r=object(value);
  if (!['ready','partial','unavailable'].includes(String(r.state))||r.provisional!==true||typeof r.coverage!=='string'||!Array.isArray(r.teams)||r.teams.length<2||r.teams.length>32) return null;
  const teams:ResultsReport['teams']=[];
  for (const value of r.teams) {
    const t=object(value);
    if (typeof t.rosterId!=='string'||!t.rosterId||typeof t.name!=='string'||!t.name||typeof t.points!=='number'||!Number.isFinite(t.points)||typeof t.starterPoints!=='number'||!Number.isFinite(t.starterPoints)||typeof t.starts!=='number'||!Number.isInteger(t.starts)||t.starts<0||typeof t.coveredPicks!=='number'||!Number.isInteger(t.coveredPicks)||t.coveredPicks<0||t.coveredPicks>1000||!Array.isArray(t.weeks)||t.weeks.length>18||new Set(t.weeks).size!==t.weeks.length||t.weeks.some(w=>typeof w!=='number'||!Number.isInteger(w)||w<1||w>18)) return null;
    if (r.state==='ready' ? typeof t.rank!=='number'||!Number.isInteger(t.rank)||t.rank<1||t.rank>r.teams.length : t.rank!==null) return null;
    teams.push({rosterId:t.rosterId,name:t.name,rank:t.rank as number|null,points:t.points,starterPoints:t.starterPoints,starts:t.starts,weeks:[...t.weeks] as number[],coveredPicks:t.coveredPicks});
  }
  if (new Set(teams.map(t=>t.rosterId)).size!==teams.length) return null;
  return {state:r.state as ResultsReport['state'],provisional:true,coverage:r.coverage,teams};
}
export async function readImportedResults(leagueId: string, key: string, picks:AnalysisSelection[]=[]): Promise<ImportedResultsObservation | null> {
  const row = await prisma.aiAdpSnapshotHistory.findFirst({ where: { sport: 'NFL', leagueType: 'draft_results', formatKey: storageKey(leagueId,key+':weekly-v2') }, orderBy: [{ computedAt:'desc' },{id:'desc'}], select: { snapshotData:true } })
    ?? await prisma.aiAdpSnapshotHistory.findFirst({ where: { sport: 'NFL', leagueType: 'draft_results', formatKey: storageKey(leagueId,key) }, orderBy: [{ computedAt:'desc' },{id:'desc'}], select: { snapshotData:true } });
  const raw = object(row?.snapshotData);
  if (!['draft-results-v1','draft-results-v2'].includes(String(raw.version))||raw.leagueId!==leagueId||raw.key!==key||typeof raw.observedAt!=='string'||!Number.isFinite(Date.parse(raw.observedAt))||Date.parse(raw.observedAt)>Date.now()||typeof raw.sourceLeagueId!=='string'||!/^\d+$/.test(raw.sourceLeagueId)||raw.sourceDraftId!==key.replace(/^imported:/,'')) return null;
  const report=validReport(raw.report);
  if (!report) return null;
  const weekly=raw.version==='draft-results-v2'?importedWeeklyReport(raw.weekly,picks,report.teams):null;
  if (raw.version==='draft-results-v2'&&!weekly) return null;
  return {version:raw.version as ImportedResultsObservation['version'],leagueId,key,observedAt:raw.observedAt,sourceLeagueId:raw.sourceLeagueId,sourceDraftId:raw.sourceDraftId as string,report:weekly?.report??report,...(weekly?{contributions:weekly.contributions}:{})};
}
