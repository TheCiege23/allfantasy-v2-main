export type RegradeHorizon = '30d' | 'end_of_season' | '1y' | '3y' | '5y'

function anniversary(date: Date, years: number): Date {
  const result = new Date(date)
  result.setUTCFullYear(result.getUTCFullYear() + years)
  if (result.getUTCMonth() !== date.getUTCMonth()) result.setUTCDate(0)
  return result
}

/** Stable keys make scheduler retries idempotent when used as the storage unique key. */
export function scheduleRegrades(decisionId: string, acceptedAt: string, seasonEndsAt: string) {
  const start = new Date(acceptedAt), end = new Date(seasonEndsAt)
  if (!decisionId || !Number.isFinite(+start) || !Number.isFinite(+end) || end < start) throw new Error('Invalid regrade dates')
  const dates: [RegradeHorizon, Date][] = [
    ['30d', new Date(+start + 30 * 86400000)], ['end_of_season', end],
    ['1y', anniversary(start, 1)], ['3y', anniversary(start, 3)], ['5y', anniversary(start, 5)],
  ]
  return dates.map(([horizon, date]) => ({ key: `${decisionId}:${horizon}`, decisionId, horizon, dueAt: date.toISOString() }))
}

export interface ModelCandidate {
  version: string
  rollbackVersion: string
  cohort: string
  sampleSize: number
  trainingStart: string
  trainingEnd: string
  validationStart: string
  validationEnd: string
  metric: 'acceptance_brier' | 'value_mae'
  validationLoss: number
  baselineLoss: number
  invariantsPassed: boolean
}

/** Acceptance calibration and value calibration are intentionally different promotion tracks. */
export function canPromoteModel(model: ModelCandidate, minimumSamples: number): boolean {
  const dates = [model.trainingStart, model.trainingEnd, model.validationStart, model.validationEnd].map(Date.parse)
  return !!model.version && !!model.rollbackVersion && model.version !== model.rollbackVersion && !!model.cohort &&
    Number.isInteger(minimumSamples) && minimumSamples > 0 && Number.isInteger(model.sampleSize) && model.sampleSize >= minimumSamples &&
    dates.every(Number.isFinite) && dates[0] <= dates[1] && dates[1] < dates[2] && dates[2] <= dates[3] &&
    Number.isFinite(model.validationLoss) && Number.isFinite(model.baselineLoss) && model.validationLoss >= 0 &&
    model.validationLoss < model.baselineLoss && model.invariantsPassed
}
