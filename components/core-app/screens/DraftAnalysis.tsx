'use client';
import { InfoTip } from '../InfoTip';
import { useMessages } from '@/components/i18n/useMessages';
import { draftScreensMessages } from '@/lib/core-app/messages/draftScreens';
import type { DraftAnalysisReport, ResultsReport } from '@/lib/draft-archive/analysisModel';
import '@/components/core-app/af-draft-analysis.css';
export function DraftAnalysis({ report, results }: { report?: DraftAnalysisReport; results?: ResultsReport }) {
  const m = useMessages(draftScreensMessages);
  if (!report && !results) return null;
  return <section className="af-draft-analysis" aria-label={m.analysisDraftRankingComponents}>
    {results?.provisional && <p>{m.analysisProvisionalNote}</p>}
    <h3>{m.analysisDraftRankingComponents} <InfoTip label={m.analysisAboutDraftRankings} title={m.analysisHowRankingsWork}><span className="af-info-para">{m.analysisRankingsHelp}</span></InfoTip></h3>
    {report && <><h4>{m.analysisDraftDayOutlook} · {report.state === 'ready' ? m.analysisComparableBaseline : report.state === 'partial' ? m.analysisPartialCoverage : m.analysisInsufficientData}</h4><p>{m.analysisReportReason(report.reason)}</p>
      {!!report.teams.length && <div className="af-archive-table" tabIndex={0} role="region" aria-label={m.analysisDraftDayTeamRanks}><table><thead><tr>{[m.analysisRank,m.analysisTeam,m.analysisCoveredPicks,m.analysisOptimalStarterPoints,m.analysisBenchValueOver,m.analysisMissingSlots].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.teams.map(team => <tr key={team.rosterId}><td>{team.rank ?? '—'}</td><td>{team.name}</td><td>{team.covered}/{team.selections}</td><td>{team.starterPoints?.toFixed(1) ?? '—'}</td><td>{team.benchValue?.toFixed(1) ?? '—'}</td><td>{team.missingSlots.join(', ') || '—'}</td></tr>)}</tbody></table></div>}
      {!!report.players.length && <details><summary>{m.analysisPlayerValueCoverage}</summary><p>{m.analysisReplacementBasis(report.replacementBasis)}</p><div className="af-archive-table" tabIndex={0} role="region" aria-label={m.analysisPlayerBaselines}><table><thead><tr>{[m.analysisPlayer,m.analysisPointsGame,m.analysisReplacement,m.analysisValueOverReplacement,m.analysisUnrepresentedRules].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.players.map(p => <tr key={p.playerId}><td>{p.name} · {p.position}</td><td>{p.points.toFixed(1)}</td><td>{p.replacement?.toFixed(1) ?? '—'}</td><td>{p.valueOverReplacement?.toFixed(1) ?? '—'}</td><td>{p.unrepresentedScoring.join(', ') || '—'}</td></tr>)}</tbody></table></div></details>}
    </>}
    {results && <><h4>{m.analysisResultsToDate} · {results.state === 'ready' ? m.analysisComparableContribution : results.state === 'partial' ? m.analysisPartialCoverage : m.analysisInsufficientData}</h4><p>{results.provisional ? m.analysisCoverageProvisional(results.coverage) : m.analysisCoverageFinal(results.coverage)}</p><div className="af-archive-table" tabIndex={0} role="region" aria-label={m.analysisRecordedContributionRanks}><table><thead><tr>{[m.analysisRank,m.analysisTeam,m.analysisCoveredPicks,m.analysisProduction,m.analysisActualStarterContribution,m.analysisStarts,results.provisional ? m.analysisCoveredScoredWeeks : m.analysisCoveredFinalWeeks].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{results.teams.map(team => <tr key={team.rosterId}><td>{team.rank ?? '—'}</td><td>{team.name}</td><td>{team.coveredPicks}</td><td>{team.coveredPicks ? team.points.toFixed(1) : '—'}</td><td>{team.coveredPicks ? team.starterPoints.toFixed(1) : '—'}</td><td>{team.coveredPicks ? team.starts : '—'}</td><td>{team.weeks.join(', ') || '—'}</td></tr>)}</tbody></table></div></>}
  </section>;
}
