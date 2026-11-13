export interface GuardMeta {
  fallbackMode: boolean
  rankingSource: string
  rankingSourceNote: string
  warnings: string[]
}

export function buildBaselineMeta(
  source: string,
  note: string
): GuardMeta {
  return {
    fallbackMode: true,
    rankingSource: source,
    rankingSourceNote: note,
    warnings: [],
  }
}

export function ensureArray<T>(value: any): T[] {
  return Array.isArray(value) ? value : []
}

export function ensureNumber(value: any, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

