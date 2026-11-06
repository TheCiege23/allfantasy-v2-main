'use client';
import { InfoTip } from '../InfoTip';
import { useMessages } from '@/components/i18n/useMessages';
import { draftScreensMessages } from '@/lib/core-app/messages/draftScreens';
import type { DraftAnalysisReport, ResultsReport } from '@/lib/draft-archive/analysisModel';
import '@/components/core-app/af-draft-analysis.css';

type State = 'ready' | 'partial' | 'unavailable' | (string & {});
const tone = (state: State) => state === 'ready' ? 'ok' : state === 'partial' ? 'warn' : 'muted';

/** [1,2,3,4,7,9,10] → "1–4, 7, 9–10". A sorted, de-duplicated list reads as ranges instead of a long run of numbers. */
export function weekRanges(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b), out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(', ');
}

/** Ranked teams first, best rank on top; unranked teams after, by what they actually produced. */
const byRank = <T extends { rank: number | null }>(teams: T[], score: (t: T) => number | null) =>
  [...teams].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (score(b) ?? -Infinity) - (score(a) ?? -Infinity));

export function DraftAnalysis({ report, results }: { report?: DraftAnalysisReport; results?: ResultsReport }) {
  const m = useMessages(draftScreensMessages);
  if (!report && !results) return null;
  const label = (state: State, ready: string) => state === 'ready' ? ready : state === 'partial' ? m.analysisPartialCoverage : m.analysisInsufficientData;
  const part = (title: string, state: State, ready: string) => <div className="af-analysis-part-head"><h4>{title}</h4><span className="af-analysis-state" data-tone={tone(state)}>{label(state, ready)}</span></div>;
  return <section className="af-draft-analysis" aria-label={m.analysisDraftRankingComponents}>
    <div className="af-analysis-head"><h3>{m.analysisDraftRankingComponents}</h3><InfoTip label={m.analysisAboutDraftRankings} title={m.analysisHowRankingsWork}><span className="af-info-para">{m.analysisRankingsHelp}</span></InfoTip></div>
    {results?.provisional && <p className="af-analysis-note">{m.analysisProvisionalNote}</p>}
    {report && <div className="af-analysis-part">
      {part(m.analysisDraftDayOutlook, report.state, m.analysisComparableBaseline)}
      <p className="af-analysis-reason">{m.analysisReportReason(report.reason)}</p>
      {!!report.teams.length && <div className="af-archive-table" tabIndex={0} role="region" aria-label={m.analysisDraftDayTeamRanks}><table><thead><tr>{[m.analysisRank,m.analysisTeam,m.analysisCoveredPicks,m.analysisOptimalStarterPoints,m.analysisBenchValueOver,m.analysisMissingSlots].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{byRank(report.teams, t => t.starterPoints).map(team => <tr key={team.rosterId}><td className="af-analysis-rank">{team.rank ?? '—'}</td><td>{team.name}</td><td>{team.covered}/{team.selections}</td><td>{team.starterPoints?.toFixed(1) ?? '—'}</td><td>{team.benchValue?.toFixed(1) ?? '—'}</td><td>{team.missingSlots.join(', ') || '—'}</td></tr>)}</tbody></table></div>}
      {!!report.players.length && <details><summary>{m.analysisPlayerValueCoverage}</summary><p className="af-analysis-reason">{m.analysisReplacementBasis(report.replacementBasis)}</p><div className="af-archive-table" tabIndex={0} role="region" aria-label={m.analysisPlayerBaselines}><table><thead><tr>{[m.analysisPlayer,m.analysisPointsGame,m.analysisReplacement,m.analysisValueOverReplacement,m.analysisUnrepresentedRules].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.players.map(p => <tr key={p.playerId}><td>{p.name} · {p.position}</td><td>{p.points.toFixed(1)}</td><td>{p.replacement?.toFixed(1) ?? '—'}</td><td>{p.valueOverReplacement?.toFixed(1) ?? '—'}</td><td>{p.unrepresentedScoring.join(', ') || '—'}</td></tr>)}</tbody></table></div></details>}
    </div>}
    {results && <div className="af-analysis-part">
      {part(m.analysisResultsToDate, results.state, m.analysisComparableContribution)}
      <p className="af-analysis-reason">{results.provisional ? m.analysisCoverageProvisional(results.coverage) : m.analysisCoverageFinal(results.coverage)}</p>
      <div className="af-archive-table" tabIndex={0} role="region" aria-label={m.analysisRecordedContributionRanks}><table><thead><tr>{[m.analysisRank,m.analysisTeam,m.analysisCoveredPicks,m.analysisProduction,m.analysisActualStarterContribution,m.analysisStarts,results.provisional ? m.analysisCoveredScoredWeeks : m.analysisCoveredFinalWeeks].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{byRank(results.teams, t => t.coveredPicks ? t.starterPoints : null).map(team => <tr key={team.rosterId}><td className="af-analysis-rank">{team.rank ?? '—'}</td><td>{team.name}</td><td>{team.coveredPicks}</td><td>{team.coveredPicks ? team.points.toFixed(1) : '—'}</td><td>{team.coveredPicks ? team.starterPoints.toFixed(1) : '—'}</td><td>{team.coveredPicks ? team.starts : '—'}</td><td>{weekRanges(team.weeks) || '—'}</td></tr>)}</tbody></table></div>
    </div>}
  </section>;
}
