type NormalizedDraftPoolInjuryStatus =
  | 'OUT'
  | 'DOUBTFUL'
  | 'QUESTIONABLE'
  | 'PROBABLE'
  | 'ACTIVE'
  | 'IR'
  | 'PUP'
  | 'SUSPENDED'
  | 'UNKNOWN'

function compactStatusToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function normalizeDraftPoolInjuryStatus(
  rawStatus?: string | null,
  rawGameStatus?: string | null,
): NormalizedDraftPoolInjuryStatus {
  const direct = String(rawStatus ?? '').trim()
  const fallback = String(rawGameStatus ?? '').trim()
  const merged = `${direct} ${fallback}`.trim().toLowerCase()
  const compact = compactStatusToken(merged)

  if (!merged) return 'UNKNOWN'

  if (
    compact.includes('injuredreserve') ||
    compact === 'ir' ||
    compact.startsWith('ir')
  ) {
    return 'IR'
  }

  if (compact.includes('physicallyunabletoperform') || compact.includes('pup')) {
    return 'PUP'
  }

  if (compact.includes('suspend') || compact.includes('suspens')) {
    return 'SUSPENDED'
  }

  if (
    compact.includes('inactive') ||
    compact === 'inact' ||
    compact.includes('ruledout') ||
    compact.includes('out') ||
    compact === 'o'
  ) {
    return 'OUT'
  }

  if (compact.includes('doubtful') || compact === 'd') {
    return 'DOUBTFUL'
  }

  if (compact.includes('questionable') || compact === 'q') {
    return 'QUESTIONABLE'
  }

  if (compact.includes('probable') || compact === 'p') {
    return 'PROBABLE'
  }

  if (
    compact === 'act' ||
    compact.includes('active') ||
    compact.includes('healthy') ||
    compact.includes('available') ||
    compact.includes('clear')
  ) {
    return 'ACTIVE'
  }

  return 'UNKNOWN'
}
