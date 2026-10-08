import type {ArchiveDetail} from './detail';

/** Results coverage is independent of draft-time component availability. */
export function draftRankComparison(detail: ArchiveDetail) {
  const teams = new Map<string, string>();
  for (const row of [
    ...(detail.resultsReport?.teams ?? []),
    ...(detail.preDraftReport?.teams ?? []),
    ...(detail.analysisReport?.teams ?? []),
    ...(detail.phase4?.components ?? []),
  ]) teams.set(row.rosterId, row.name);
  const rank = (report: ArchiveDetail['resultsReport'] | ArchiveDetail['analysisReport'], rosterId: string) =>
    report?.state === 'ready' ? report.teams.find(row => row.rosterId === rosterId)?.rank ?? null : null;
  return [...teams].map(([rosterId, name]) => ({
    rosterId, name,
    preDraft: rank(detail.preDraftReport, rosterId),
    draftDay: rank(detail.analysisReport, rosterId),
    results: rank(detail.resultsReport, rosterId),
  }));
}
