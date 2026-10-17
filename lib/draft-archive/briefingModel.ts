import type { ArchiveDetail } from './detail';
/** Deterministic on-page explanation. No model, provider or outbound request. */
export function draftBriefing(detail:ArchiveDetail){
  return {version:'draft-briefing-v1',source:{key:detail.choice.key,season:detail.choice.season,sport:detail.choice.sport,format:detail.choice.format,startedAt:detail.startedAt},
    evidence:{draftDay:detail.analysisReport?.state??'unavailable',results:detail.resultsReport?.state??'unavailable',resultsProvisional:detail.resultsReport?.provisional??false,resultsObservedAt:detail.resultsObservedAt??null,coverage:detail.coverage},
    teams:(detail.analysisReport?.teams??[]).map(t=>({name:t.name,rosterId:t.rosterId,rank:t.rank,picksCovered:t.covered,picks:t.selections,starterBaseline:t.starterPoints,starterGain:t.starterGain??null,benchValue:t.benchValue,missingSlots:t.missingSlots})),
    contribution:detail.resultsReport?.teams.map(t=>({rosterId:t.rosterId,rank:t.rank,starterPoints:t.starterPoints,starts:t.starts,weeks:t.weeks,coveredPicks:t.coveredPicks}))??[]};
}
