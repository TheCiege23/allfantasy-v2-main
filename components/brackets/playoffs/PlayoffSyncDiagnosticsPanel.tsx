"use client"

type Props = {
  diagnostics: unknown
  testId?: string
}

function safeDiagnostics(value: unknown) {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  return {
    attemptedProviders: record.attemptedProviders,
    providerSelected: record.source ?? record.selectedProvider,
    challengeSeasonYear: record.challengeSeasonYear ?? (record.diagnostics as any)?.challengeSeasonYear,
    selectedProviderSeason: record.selectedProviderSeason ?? (record.diagnostics as any)?.selectedProviderSeason,
    providerSeasonAttempts: record.providerSeasonAttempts ?? (record.diagnostics as any)?.providerSeasonAttempts,
    seasonSelectionExplanation: (record.diagnostics as any)?.seasonSelectionExplanation,
    seasonYear: record.seasonYear ?? (record.diagnostics as any)?.seasonYear,
    sport: record.sport ?? (record.diagnostics as any)?.sport,
    postseasonGames: record.postseasonGames,
    gamesSeen: record.gamesSeen,
    gamesMatched: record.gamesMatched,
    seriesReturned: record.seriesReturned,
    seriesMatched: record.seriesMatched,
    seriesUpdated: record.seriesUpdated,
    winnersUpdated: record.winnersUpdated,
    warnings: record.warnings,
    unmatchedExamples: record.unmatchedExamples,
    providerAttempts: (record.diagnostics as any)?.providerAttempts,
    existingSeriesExamples: (record.diagnostics as any)?.existingSeriesExamples,
    providerGameExamples: (record.diagnostics as any)?.providerGameExamples,
    providerSeriesExamples: (record.diagnostics as any)?.providerSeriesExamples,
    ignoredPlayInGames: (record.diagnostics as any)?.ignoredPlayInGames,
    eventNameRoundMapExamples: (record.diagnostics as any)?.eventNameRoundMapExamples,
    providerSeriesByRound: (record.diagnostics as any)?.providerSeriesByRound,
    providerRound2WestSeries: (record.diagnostics as any)?.providerRound2WestSeries,
    providerRound2EastSeries: (record.diagnostics as any)?.providerRound2EastSeries,
    officialSeriesSlotAssignments: (record.diagnostics as any)?.officialSeriesSlotAssignments,
    slotAssignmentWarnings: (record.diagnostics as any)?.slotAssignmentWarnings,
    unmappedProviderSeries: (record.diagnostics as any)?.unmappedProviderSeries,
    conflictingSlotAssignments: (record.diagnostics as any)?.conflictingSlotAssignments,
    expectedVsActualSlotExamples: (record.diagnostics as any)?.expectedVsActualSlotExamples,
    completedProviderSeries: (record.diagnostics as any)?.completedProviderSeries,
    completedSeriesWithWinner: (record.diagnostics as any)?.completedSeriesWithWinner,
    completedSeriesWithoutWinner: (record.diagnostics as any)?.completedSeriesWithoutWinner,
    resultsOnlyStrippedWinners: (record.diagnostics as any)?.resultsOnlyStrippedWinners,
    resultPersistenceExamples: (record.diagnostics as any)?.resultPersistenceExamples,
    finalScoreSupplementProvider: (record.diagnostics as any)?.finalScoreSupplementProvider,
    finalScoreDatesFetched: (record.diagnostics as any)?.finalScoreDatesFetched,
    finalScoreRowsSeen: (record.diagnostics as any)?.finalScoreRowsSeen,
    finalScoreRowsMatched: (record.diagnostics as any)?.finalScoreRowsMatched,
    seriesWinsComputed: (record.diagnostics as any)?.seriesWinsComputed,
    seriesWinnersComputed: (record.diagnostics as any)?.seriesWinnersComputed,
    templateReplacementCount: (record.diagnostics as any)?.templateReplacementCount,
    updatedSeriesExamples: (record.diagnostics as any)?.updatedSeriesExamples,
    noMatchReason: (record.diagnostics as any)?.noMatchReason,
  }
}

export default function PlayoffSyncDiagnosticsPanel({ diagnostics, testId = "playoff-sync-diagnostics" }: Props) {
  const safe = safeDiagnostics(diagnostics)
  if (!safe) return null

  return (
    <details data-testid={testId} className="mt-3 rounded-2xl border border-slate-300 bg-slate-950 p-3 text-xs text-slate-100">
      <summary className="cursor-pointer font-bold text-slate-100">Sync diagnostics</summary>
      {safe.seasonSelectionExplanation ? (
        <p className="mt-3 rounded-xl border border-sky-400/30 bg-sky-400/10 p-2 font-semibold text-sky-100">
          {String(safe.seasonSelectionExplanation)}
        </p>
      ) : null}
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words">
        {JSON.stringify(safe, null, 2)}
      </pre>
    </details>
  )
}
