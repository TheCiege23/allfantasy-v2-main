export interface FormatOutcomeSample {
  format: string
  predictedSuccess: number
  actualSuccess: 0 | 1
  predictedPlayoffProbabilityDelta?: number | null
  actualPlayoffOutcomeDelta?: number | null
  predictedSurvivalProbabilityDelta?: number | null
  actualSurvivalOutcomeDelta?: number | null
}

export interface FormatCalibrationRow {
  format: string
  sampleSize: number
  brierScore: number
  thresholdAccuracy: number
  playoffDeltaMae: number | null
  survivalDeltaMae: number | null
  promotionEligible: boolean
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

/** Calibrates each format independently; one format's outcomes can never tune another's threshold. */
export function calibrateTradeOutcomesByFormat(
  samples: FormatOutcomeSample[],
  minSampleSize = 50,
): FormatCalibrationRow[] {
  const groups = new Map<string, FormatOutcomeSample[]>()
  for (const sample of samples) {
    if (!Number.isFinite(sample.predictedSuccess) || sample.predictedSuccess < 0 || sample.predictedSuccess > 1) continue
    const format = sample.format.trim().toLowerCase() || 'unknown'
    groups.set(format, [...(groups.get(format) ?? []), sample])
  }
  return [...groups.entries()].map(([format, rows]) => {
    const playoff = rows.flatMap((row) =>
      row.predictedPlayoffProbabilityDelta == null || row.actualPlayoffOutcomeDelta == null
        ? [] : [Math.abs(row.predictedPlayoffProbabilityDelta - row.actualPlayoffOutcomeDelta)])
    const survival = rows.flatMap((row) =>
      row.predictedSurvivalProbabilityDelta == null || row.actualSurvivalOutcomeDelta == null
        ? [] : [Math.abs(row.predictedSurvivalProbabilityDelta - row.actualSurvivalOutcomeDelta)])
    return {
      format,
      sampleSize: rows.length,
      brierScore: mean(rows.map((row) => (row.predictedSuccess - row.actualSuccess) ** 2)) ?? 0,
      thresholdAccuracy: mean(rows.map((row) => (row.predictedSuccess >= 0.5 ? 1 : 0) === row.actualSuccess ? 1 : 0)) ?? 0,
      playoffDeltaMae: mean(playoff),
      survivalDeltaMae: mean(survival),
      promotionEligible: rows.length >= minSampleSize,
    }
  }).sort((a, b) => a.format.localeCompare(b.format))
}
