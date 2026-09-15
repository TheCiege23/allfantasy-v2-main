import type { AfProjectionBasis, ProjectionAccuracyCalibration, ProjectionCalibrationMap } from './types'
import type { AccuracyAggregate, ProjectionAccuracyRecord } from '@/lib/projections/projectionAccuracy'

const MIN_EXACT_SAMPLE = 24
const MIN_BASIS_SAMPLE = 40
const SHRINKAGE_SAMPLE = 80
const MAX_CORRECTION = 2.5

type AggregateInput = { n: number; weightedBias: number; weeks: Set<number> }

function add(target: Map<string, AggregateInput>, key: string, value: AccuracyAggregate, week: number) {
  if (!Number.isFinite(value.bias) || value.n <= 0) return
  const current = target.get(key) ?? { n: 0, weightedBias: 0, weeks: new Set<number>() }
  current.n += value.n
  current.weightedBias += value.bias * value.n
  current.weeks.add(week)
  target.set(key, current)
}

function finish(value: AggregateInput, scope: ProjectionAccuracyCalibration['scope']): ProjectionAccuracyCalibration {
  const bias = value.weightedBias / value.n
  const shrink = value.n / (value.n + SHRINKAGE_SAMPLE)
  const points = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, -bias * shrink))
  return { points: Math.round(points * 100) / 100, sample: value.n, weeks: value.weeks.size, scope }
}

export function deriveProjectionCalibration(records: ProjectionAccuracyRecord[]): ProjectionCalibrationMap {
  const basis = new Map<string, AggregateInput>()
  const exact = new Map<string, AggregateInput>()
  for (const record of records) {
    if (record.status !== 'scored') continue
    const source = record.sources.allfantasy
    if (!source) continue
    for (const [key, aggregate] of Object.entries(source.byBasis ?? {})) {
      if (!key.startsWith('sleeper_weekly')) add(basis, key, aggregate, record.week)
    }
    for (const [key, aggregate] of Object.entries(source.byPositionBasis ?? {})) {
      if (!key.includes('|sleeper_weekly')) add(exact, key, aggregate, record.week)
    }
  }
  const out: ProjectionCalibrationMap = {}
  for (const [key, value] of basis) if (value.n >= MIN_BASIS_SAMPLE) out[key] = finish(value, 'basis')
  for (const [key, value] of exact) if (value.n >= MIN_EXACT_SAMPLE) out[key] = finish(value, 'position_basis')
  return out
}

export function calibrationFor(
  map: ProjectionCalibrationMap,
  basis: AfProjectionBasis,
  position: string | null | undefined,
): ProjectionAccuracyCalibration | null {
  const pos = String(position ?? '').trim().toUpperCase()
  return (pos ? map[`${pos}|${basis}`] : null) ?? map[basis] ?? null
}
